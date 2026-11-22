// audit/routes.js — HTTP endpoints for the CJA audit. All routes require login and are read-only
// toward Adobe: the only Adobe calls are GETs made through audit/cja-client.js.

'use strict';

const checks = require('./checks');
const { chooseSource } = require('./cja-client');
const { summarize, renderMarkdown } = require('./report');
const { explain } = require('./explain');

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/;

function httpError(err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  let message = err.message || 'Something went wrong.';
  if (status === 401) message = 'Adobe rejected the credential (401). Check the Server-to-Server client ID, secret and scopes.';
  if (status === 403) message = 'Adobe refused access (403). Check that the credential\'s product profile can see this data view, and that the Experience Platform API is attached to the same credential.';
  if (status === 404) message = 'Adobe could not find that item (404).';
  return { status, message };
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function cleanPlan(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const columns = Array.isArray(p.columns) ? p.columns.slice(0, 300).map((c) => String(c).slice(0, 200)) : str(p.columns, 20000);
  return {
    name: str(p.name, 1000),
    description: str(p.description, 2000),
    feedType: str(p.feedType, 20),
    frequency: str(p.frequency, 20),
    startDate: str(p.startDate, 40),
    endDate: str(p.endDate, 40),
    lookbackDays: p.lookbackDays === '' || p.lookbackDays == null ? undefined : p.lookbackDays,
    processingDelayHours: p.processingDelayHours === '' || p.processingDelayHours == null ? undefined : p.processingDelayHours,
    compression: str(p.compression, 40),
    columns,
  };
}

function registerAuditRoutes(app, requireAuth, deps = {}) {
  const source = deps.source || chooseSource(deps.cjaApiRequest);
  const sample = source.source === 'mock';
  const now = () => (deps.now ? deps.now() : new Date());

  async function loadTarget(dataViewId, notes) {
    const dvRes = await source.getDataView(dataViewId);
    notes.push(...dvRes.notes);
    const dv = dvRes.value;
    const compRes = await source.getComponents(dataViewId);
    notes.push(...compRes.notes);

    let conn = null;
    let connReason = null;
    if (dv.parentDataGroupId) {
      try {
        const c = await source.getConnection(dv.parentDataGroupId);
        notes.push(...c.notes);
        conn = c.value;
      } catch (err) {
        connReason =
          `Connection ${dv.parentDataGroupId} could not be read (${err.status ? 'HTTP ' + err.status : 'error'}).` +
          (err.status === 403 ? ' Viewing connections needs product administration privileges.' : '');
      }
    }
    return { dv, conn, connReason, comps: checks.normalizeComponents(compRes.dimensions, compRes.metrics) };
  }

  app.get('/api/audit/status', requireAuth, (req, res) => {
    res.json({ source: source.source, sample });
  });

  app.get('/api/audit/dataviews', requireAuth, async (req, res) => {
    try {
      const list = await source.listDataViews();
      res.json({ source: source.source, sample, dataViews: list });
    } catch (err) {
      console.error('Audit list error:', err);
      const e = httpError(err);
      res.status(e.status).json({ error: e.message });
    }
  });

  app.post('/api/audit/run', requireAuth, async (req, res) => {
    try {
      const dataViewId = req.body?.dataViewId;
      if (typeof dataViewId !== 'string' || !ID_PATTERN.test(dataViewId)) {
        return res.status(400).json({ error: 'dataViewId is required.' });
      }
      const notes = [];
      const { dv, conn, connReason, comps } = await loadTarget(dataViewId, notes);

      const connAudit = checks.auditConnection(conn, { now: now(), unavailableReason: connReason || undefined });
      const dvAudit = checks.auditDataView(dv, comps, { connection: conn });
      const findings = checks.sortFindings([...connAudit.findings, ...dvAudit.findings]);

      res.json({
        source: source.source,
        sample,
        ranAt: now().toISOString(),
        target: {
          dataView: { id: dv.id || dataViewId, name: dv.name || dataViewId },
          connection: conn ? { id: conn.id, name: conn.name } : null,
        },
        counts: summarize(findings),
        findings,
        skipped: [...connAudit.skipped, ...dvAudit.skipped],
        notes,
      });
    } catch (err) {
      console.error('Audit run error:', err);
      const e = httpError(err);
      res.status(e.status).json({ error: e.message });
    }
  });

  app.post('/api/audit/feed-plan', requireAuth, async (req, res) => {
    try {
      const dataViewId = req.body?.dataViewId;
      if (typeof dataViewId !== 'string' || !ID_PATTERN.test(dataViewId)) {
        return res.status(400).json({ error: 'dataViewId is required.' });
      }
      const plan = cleanPlan(req.body?.plan);
      const notes = [];
      const { dv, conn, connReason, comps } = await loadTarget(dataViewId, notes);
      if (connReason) notes.push(connReason);

      const result = checks.auditFeedPlan(plan, dv, comps, {
        today: now(),
        dataRetentionMonths: typeof conn?.dataRetentionMonths === 'number' ? conn.dataRetentionMonths : undefined,
      });
      const findings = checks.sortFindings(result.findings);

      res.json({
        source: source.source,
        sample,
        ranAt: now().toISOString(),
        target: {
          dataView: { id: dv.id || dataViewId, name: dv.name || dataViewId },
          connection: conn ? { id: conn.id, name: conn.name } : null,
        },
        counts: summarize(findings),
        findings,
        columns: result.columns,
        skipped: result.skipped,
        plan: result.plan,
        notes,
      });
    } catch (err) {
      console.error('Feed plan error:', err);
      const e = httpError(err);
      res.status(e.status).json({ error: e.message });
    }
  });

  app.post('/api/audit/explain', requireAuth, async (req, res) => {
    try {
      const findings = req.body?.findings;
      if (!Array.isArray(findings) || findings.length > 80) {
        return res.status(400).json({ error: 'findings must be an array of at most 80 items.' });
      }
      const result = await explain({
        client: deps.anthropic || null,
        model: deps.model,
        maxTokens: deps.maxTokens,
        findings,
        question: typeof req.body?.question === 'string' ? req.body.question : '',
      });
      res.json(result);
    } catch (err) {
      console.error('Explain error:', err);
      res.status(500).json({ error: 'Could not write the explanation. The findings above are unaffected.' });
    }
  });

  app.post('/api/audit/markdown', requireAuth, (req, res) => {
    try {
      const a = req.body?.audit || {};
      const plan = req.body?.plan || null;
      const findings = [...(Array.isArray(a.findings) ? a.findings : []), ...(Array.isArray(plan?.findings) ? plan.findings : [])];
      const md = renderMarkdown({
        title: 'CJA audit report',
        source: a.sample || plan?.sample ? 'mock' : 'live',
        generatedAt: new Date().toISOString(),
        target: a.target || plan?.target,
        findings,
        skipped: [...(a.skipped || []), ...(plan?.skipped || [])],
        notes: [...(a.notes || []), ...(plan?.notes || [])],
        columns: plan?.columns || null,
        explanation: req.body?.explanation || null,
      });
      res.type('text/markdown').send(md);
    } catch (err) {
      console.error('Report error:', err);
      res.status(500).json({ error: 'Could not build the report.' });
    }
  });
}

module.exports = registerAuditRoutes;

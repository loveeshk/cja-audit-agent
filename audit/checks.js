// audit/checks.js — deterministic, read-only audit checks. No network, no model calls.
//
// Every check works only on fields that the CJA API actually returned. If a field
// is missing from a response (for example because an expansion was rejected), the
// related check is listed under "skipped" instead of being guessed.

'use strict';

const rules = require('./feed-rules.json');

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const AREA_ORDER = { connection: 0, dataview: 1, feed: 2 };

function finding(id, severity, area, title, detail, extra = {}) {
  return {
    id,
    severity,
    area,
    title,
    detail,
    evidence: extra.evidence ?? null,
    fix: extra.fix ?? null,
    // Used by the explain step to retrieve the matching documentation chunks.
    kbQuery: extra.kbQuery || `${id} ${title}`,
  };
}

function sortFindings(list) {
  return [...list].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      AREA_ORDER[a.area] - AREA_ORDER[b.area] ||
      a.id.localeCompare(b.id)
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const lc = (s) => String(s ?? '').trim().toLowerCase();
const norm = (s) => lc(s).replace(/[^a-z0-9]+/g, '');
const isBlank = (s) => !String(s ?? '').trim();
const cap = (arr, n) => arr.slice(0, n);

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  const ta = new Set(lc(a).split(/[^a-z0-9]+/).filter(Boolean));
  const tb = new Set(lc(b).split(/[^a-z0-9]+/).filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jac = ta.size + tb.size - inter ? inter / (ta.size + tb.size - inter) : 0;
  const contains = na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na)) ? 0.75 : 0;
  return Math.max(lev, jac, contains);
}

function periodsToDays(granularity, numPeriods) {
  const n = Number(numPeriods);
  if (!Number.isFinite(n) || n <= 0) return null;
  const per = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, quarter: 91, year: 365 }[
    lc(granularity).replace(/s$/, '')
  ];
  return per ? n * per : null;
}

// Persistence is only read when the API says it is enabled. The exact enum values
// for expiration are not fully documented, so unknown shapes yield days = null
// and are reported as "could not be interpreted" rather than guessed.
function persistenceInfo(comp) {
  const ps = comp.persistenceSetting;
  if (!ps || ps.enabled !== true) return null;
  const am = ps.allocationModel || {};
  const exp = am.expiration || am.lookbackExpiration || ps.lookback || {};
  const func = lc(exp.func);
  return {
    days: periodsToDays(exp.granularity, exp.numPeriods),
    windowBased: /window|person|report/.test(func),
    func: exp.func || null,
    allocation: am.func || null,
  };
}

function normalizeComponents(dimensions = [], metrics = []) {
  const mk = (c, kind) => ({
    kind,
    id: c.id,
    name: c.name || c.id,
    description: c.description,
    hasData: c.hasData,
    hidden: c.hidden ?? c.hideFromReporting,
    dataSetType: c.dataSetType,
    schemaPath: c.schemaPath,
    persistenceSetting: c.persistenceSetting,
    isDeleted: c.isDeleted,
  });
  return [...dimensions.map((d) => mk(d, 'dimension')), ...metrics.map((m) => mk(m, 'metric'))].filter(
    (c) => c.id && c.isDeleted !== true
  );
}

// ---------------------------------------------------------------------------
// Connection audit
// ---------------------------------------------------------------------------
function auditConnection(conn, opts = {}) {
  const findings = [];
  const skipped = [];

  if (!conn) {
    findings.push(
      finding(
        'conn.unavailable', 'info', 'connection', 'The connection could not be read',
        opts.unavailableReason ||
          'The data view did not point to a readable connection, or the API credential lacks permission (viewing connections needs product administration privileges). Connection checks were skipped.',
        { kbQuery: 'Connections API fields product administration privileges' }
      )
    );
    skipped.push('All connection checks');
    return { findings, skipped };
  }

  const now = opts.now ? new Date(opts.now) : new Date();
  const staleDays = opts.staleDays ?? 3;

  if (conn.isDeleted === true || conn.isDisabled === true) {
    findings.push(
      finding('conn.deleted-or-disabled', 'high', 'connection', 'The connection is deleted or disabled',
        'A deleted or disabled connection does not ingest data, so data views and feeds built on it will not receive anything new.',
        { evidence: { isDeleted: conn.isDeleted ?? null, isDisabled: conn.isDisabled ?? null }, kbQuery: 'What a connection does' })
    );
  }
  if (conn.description !== undefined && isBlank(conn.description)) {
    findings.push(
      finding('conn.no-description', 'low', 'connection', 'The connection has no description',
        'A description helps the next person understand which sources this connection combines.')
    );
  }

  const errs = conn.validationErrors || conn.connectionValidationErrors;
  if (Array.isArray(errs) && errs.length) {
    findings.push(
      finding('conn.validation-errors', 'high', 'connection', `The connection reports ${errs.length} validation error(s)`,
        'Validation errors usually mean a field is missing or not allowed in one of the datasets.',
        { evidence: cap(errs, 10), fix: 'Open the connection and resolve each error, starting with the datasets named in the evidence.' })
    );
  } else if (errs === undefined) {
    skipped.push('Validation errors (not returned; request the validationErrors expansion)');
  }

  const sets = Array.isArray(conn.dataSets) ? conn.dataSets : null;
  if (!sets) {
    skipped.push('Dataset checks (dataSets not returned; request the dataSets expansion)');
    return { findings, skipped };
  }
  if (sets.length === 0) {
    findings.push(
      finding('conn.no-datasets', 'high', 'connection', 'The connection has no datasets',
        'Without datasets nothing is ingested, so there is nothing to report on or export.',
        { kbQuery: 'conn.no-event-dataset What a connection does' })
    );
    return { findings, skipped };
  }

  const events = sets.filter((d) => lc(d.type) === 'event');
  if (!events.length) {
    findings.push(
      finding('conn.no-event-dataset', 'high', 'connection', 'The connection has no event dataset',
        `The connection has ${sets.length} dataset(s), but none is an event dataset. Reports and data feeds are built from event data.`,
        { evidence: sets.map((d) => ({ name: d.name, type: d.type })), fix: 'Check the dataset types in the connection.' })
    );
  }

  for (const d of events) {
    if (isBlank(d.timestampId)) {
      findings.push(
        finding('conn.timestamp-missing', 'high', 'connection', `Event dataset "${d.name}" has no timestamp field`,
          'Events need a timestamp to be placed in time, and Timestamp UTC is a required column in every data feed.',
          { evidence: { dataset: d.name, dataSetId: d.dataSetId } })
      );
    }
    if (d.streaming === false) {
      findings.push(
        finding('conn.import-new-data-off', 'high', 'connection', `New data is not being imported for "${d.name}"`,
          'The dataset reports streaming as off. In the connection settings this normally corresponds to importing all new data, so batches ingested later will not reach CJA or any data feed.',
          { evidence: { dataset: d.name, dataSetId: d.dataSetId, streaming: false },
            fix: 'Confirm the "import all new data" setting for this dataset in the Connections interface.' })
      );
    }
  }

  // Backfill status
  if (!sets.some((d) => d.backfillSummary)) {
    skipped.push('Backfill status (backfillSummary not returned; request the backfillsSummaryDataSets expansion)');
  }
  for (const d of sets) {
    const bs = d.backfillSummary;
    if (!bs) continue;
    if (Number(bs.failed) > 0) {
      findings.push(
        finding('conn.backfill-failed', 'high', 'connection', `${bs.failed} backfill(s) failed for "${d.name}"`,
          'A failed backfill leaves a gap in historical data, and a backfill feed can only export data that CJA holds.',
          { evidence: { dataset: d.name, ...bs }, fix: 'List the backfills for this dataset and check the status and date range of the failed ones.' })
      );
    }
    if (Number(bs.inProgress) > 0) {
      findings.push(
        finding('conn.backfill-running', 'info', 'connection', `${bs.inProgress} backfill(s) still running for "${d.name}"`,
          'Historical data for this dataset is not complete until the backfill finishes.',
          { evidence: { dataset: d.name, ...bs }, kbQuery: 'conn.backfill-failed backfill status' })
      );
    }
  }

  // Freshness
  if (!events.some((d) => 'lastIngestedTime' in d)) {
    skipped.push('Ingestion freshness (lastIngestedTime not returned; request the dataSetLastIngested expansion)');
  }
  for (const d of events) {
    if (!d.lastIngestedTime) continue;
    const t = new Date(d.lastIngestedTime);
    if (Number.isNaN(t.getTime())) continue;
    const ageDays = (now - t) / 86400000;
    if (ageDays > staleDays) {
      findings.push(
        finding('conn.stale-ingestion', 'medium', 'connection', `"${d.name}" has not ingested data for ${Math.floor(ageDays)} days`,
          `The last ingestion was more than ${staleDays} days ago. A live data feed will be empty or sparse while ingestion is stale.`,
          { evidence: { dataset: d.name, lastIngestedTime: d.lastIngestedTime, ageDays: Number(ageDays.toFixed(1)), thresholdDays: staleDays },
            fix: 'Check recent batches for this dataset in Experience Platform, and the import setting in the connection.' })
      );
    }
  }

  // Identity
  const withNs = events.filter((d) => !isBlank(d.identityNamespace));
  const namespaces = [...new Set(withNs.map((d) => lc(d.identityNamespace)))];
  if (events.length > 1 && namespaces.length > 1) {
    findings.push(
      finding('conn.identity-namespace-mismatch', 'medium', 'connection', 'Event datasets use different identity namespaces',
        'Datasets merge on the person ID value. Values from different namespaces rarely match, so journeys across these datasets can stay separate. This may be intentional.',
        { evidence: events.map((d) => ({ dataset: d.name, personIdField: d.visitorId ?? null, identityNamespace: d.identityNamespace ?? null })),
          fix: 'If you expect one person across these sources, align the person ID or consider stitching.' })
    );
  }
  if (events.length) {
    findings.push(
      finding('conn.person-id-fields', 'info', 'connection', 'Person ID per event dataset',
        events.map((d) => `${d.name}: ${d.visitorId ?? 'not set'} (${d.identityNamespace || 'no namespace'})`).join('; '),
        { kbQuery: 'conn.identity-namespace-mismatch Person ID and dataset settings' })
    );
  }

  for (const d of sets.filter((x) => lc(x.type) === 'lookup')) {
    if (isBlank(d.lookupKeyField)) {
      findings.push(
        finding('conn.lookup-incomplete', 'medium', 'connection', `Lookup dataset "${d.name}" has no key field`,
          'Without a key field the lookup cannot be joined to event data, so its values stay empty in reports and feeds.',
          { evidence: { dataset: d.name, dataSetId: d.dataSetId } })
      );
    }
  }

  if (conn.backfillEnabled === false) {
    findings.push(
      finding('conn.backfill-disabled', 'low', 'connection', 'Backfill is disabled for this connection',
        'Historical data from before the connection was created is not imported, which limits what a backfill feed can export.',
        { kbQuery: 'conn.retention Backfill window and destinations' })
    );
  }
  if (typeof conn.dataRetentionMonths === 'number') {
    findings.push(
      finding('conn.retention', 'info', 'connection', `Data retention is ${conn.dataRetentionMonths} months`,
        'A backfill feed must start inside the data retention window.')
    );
  } else {
    skipped.push('Data retention (dataRetentionMonths not returned)');
  }

  return { findings, skipped };
}

// ---------------------------------------------------------------------------
// Data view audit
// ---------------------------------------------------------------------------
function auditDataView(dv, comps, opts = {}) {
  const findings = [];
  const skipped = [];

  if (dv.isDeleted === true) {
    findings.push(finding('dv.deleted', 'high', 'dataview', 'The data view is marked as deleted',
      'A deleted data view cannot be used to create or run a data feed.', { kbQuery: 'How data view settings affect a feed' }));
  }

  if (dv.parentDataGroupId === undefined) {
    skipped.push('Connection link (parentDataGroupId not returned)');
  } else if (isBlank(dv.parentDataGroupId)) {
    findings.push(finding('dv.no-connection', 'high', 'dataview', 'The data view is not linked to a connection',
      'Without a connection the data view has no data behind it.', { kbQuery: 'dv.no-connection' }));
  } else if (opts.connection?.id && opts.connection.id !== dv.parentDataGroupId) {
    findings.push(finding('dv.connection-mismatch', 'medium', 'dataview', 'The connection supplied differs from the data view\'s own connection',
      `The data view points to ${dv.parentDataGroupId}, but ${opts.connection.id} was audited.`,
      { evidence: { dataViewConnection: dv.parentDataGroupId, auditedConnection: opts.connection.id }, kbQuery: 'dv.no-connection' }));
  }

  if (dv.timezoneDesignator === undefined) {
    skipped.push('Time zone (timezoneDesignator not returned)');
  } else if (isBlank(dv.timezoneDesignator)) {
    findings.push(finding('dv.timezone-missing', 'medium', 'dataview', 'The data view has no time zone',
      'Daily feeds run from midnight to midnight in the data view\'s time zone, so a missing time zone makes feed boundaries unclear.',
      { kbQuery: 'dv.timezone' }));
  } else {
    findings.push(finding('dv.timezone', 'info', 'dataview', `Time zone is ${dv.timezoneDesignator}`,
      `Daily feeds start and end at midnight in ${dv.timezoneDesignator}, and feed dates are read in that time zone.`));
  }

  if (dv.description !== undefined && isBlank(dv.description)) {
    findings.push(finding('dv.no-description', 'low', 'dataview', 'The data view has no description',
      'A description tells the next person what this data view is for.'));
  }

  if (dv.sessionDefinition === undefined) {
    skipped.push('Session settings (sessionDefinition not returned)');
  } else {
    findings.push(finding('dv.session', 'info', 'dataview', 'Session settings returned',
      JSON.stringify(dv.sessionDefinition).slice(0, 300),
      { kbQuery: 'How data view settings affect a feed sessions' }));
  }

  const dims = comps.filter((c) => c.kind === 'dimension');
  const mets = comps.filter((c) => c.kind === 'metric');
  findings.push(finding('dv.components-summary', 'info', 'dataview', `${dims.length} dimensions and ${mets.length} metrics`,
    'Feed columns come from these components, so only components that exist here can be selected.',
    { kbQuery: 'Where the feed columns come from' }));

  // Duplicate names
  const byName = new Map();
  for (const c of comps) {
    const k = norm(c.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }
  const dups = [...byName.values()].filter((g) => g.length > 1);
  if (dups.length) {
    findings.push(finding('dv.duplicate-names', 'medium', 'dataview', `${dups.length} component name(s) are used more than once`,
      'When feed columns are picked by name it is ambiguous which component is meant.',
      { evidence: cap(dups, 10).map((g) => ({ name: g[0].name, components: g.map((c) => `${c.kind}:${c.id}`) })),
        fix: 'Rename the duplicates in the data view so each name is distinct.' }));
  }

  // Components without data
  if (comps.some((c) => c.hasData !== undefined)) {
    const empty = comps.filter((c) => c.hasData === false);
    if (empty.length) {
      findings.push(finding('dv.no-data-components', 'medium', 'dataview', `${empty.length} component(s) report no data`,
        'A feed column built on a component with no data would be empty.',
        { evidence: { count: empty.length, components: cap(empty, 15).map((c) => `${c.kind}:${c.name}`) },
          fix: 'Check whether the field is populated in the schema and in the connected datasets, or leave it out of the feed.' }));
    }
  } else {
    skipped.push('Components without data (hasData not returned)');
  }

  // Raw schema names
  const raw = comps.filter((c) => /^[_a-z0-9-]+(\.[_a-z0-9-]+)+$/i.test(String(c.name)) || (c.schemaPath && c.name === c.schemaPath));
  if (raw.length) {
    findings.push(finding('dv.raw-schema-names', 'low', 'dataview', `${raw.length} component(s) are named like raw schema paths`,
      'Feed columns take their names from data view components, so readable names make the files easier to use.',
      { evidence: cap(raw, 10).map((c) => c.name) }));
  }

  // Descriptions
  const withDescField = dims.filter((d) => d.description !== undefined);
  if (withDescField.length >= 5) {
    const missing = withDescField.filter((d) => isBlank(d.description));
    if (missing.length / withDescField.length > 0.5) {
      findings.push(finding('dv.missing-descriptions', 'low', 'dataview',
        `${missing.length} of ${withDescField.length} dimensions have no description`,
        'Descriptions help people choose the right columns.'));
    }
  } else if (!withDescField.length) {
    skipped.push('Dimension descriptions (description not returned)');
  }

  // Persistence
  const persisted = dims.map((d) => ({ d, p: persistenceInfo(d) })).filter((x) => x.p);
  if (persisted.length) {
    findings.push(finding('dv.persistence-summary', 'info', 'dataview', `${persisted.length} dimension(s) use persistence`,
      'A feed\'s lookback date range bounds how far back persistence is evaluated.',
      { evidence: cap(persisted, 15).map((x) => ({ dimension: x.d.name, days: x.p.days, windowBased: x.p.windowBased, allocation: x.p.allocation })),
        kbQuery: 'dv.persistence' }));
  }

  return { findings, skipped };
}

// ---------------------------------------------------------------------------
// Planned data feed (pre-flight)
// ---------------------------------------------------------------------------
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}
function todayDay(today) {
  if (typeof today === 'string') return parseDay(today);
  const d = today ? new Date(today) : new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}
function addMonthsDay(dayNum, months) {
  const d = new Date(dayNum * 86400000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 86400000);
}
const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

function parseColumns(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}

const RESTRICTED_DIMS = new Set(rules.dimensionsNotAvailable.map(lc));
const RESTRICTED_METS = new Set(rules.metricsNotAvailable.map(lc));
const SUBSTITUTE = Object.fromEntries(Object.entries(rules.metricsToSubstitute).map(([k, v]) => [lc(k), v]));
const ALWAYS = new Set(rules.alwaysIncluded.map(lc));
const CONFLICT_DIMS = new Set(rules.deviceConflictDimensions.map(lc));
const CONFLICT_TRIGGERS = new Set(rules.deviceConflictTriggers.map(lc));

function resolveColumn(requested, comps) {
  const r = lc(requested);
  const byId = comps.filter((c) => lc(c.id) === r);
  if (byId.length === 1) return { status: 'matched', matches: byId };
  const byName = comps.filter((c) => lc(c.name) === r);
  if (byName.length === 1) return { status: 'matched', matches: byName };
  if (byName.length > 1) return { status: 'ambiguous', matches: byName };
  const suggestions = comps
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, score: Number(similarity(requested, c.name).toFixed(2)) }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { status: 'unresolved', matches: [], suggestions };
}

function auditFeedPlan(plan, dvInfo, comps, opts = {}) {
  const findings = [];
  const skipped = [];
  const p = plan || {};
  const feedType = lc(p.feedType) || 'live';
  const frequency = lc(p.frequency) || 'daily';
  const lookbackProvided = p.lookbackDays !== undefined && p.lookbackDays !== null && p.lookbackDays !== '';
  const lookbackDays = lookbackProvided ? Number(p.lookbackDays) : rules.defaults.lookbackDays;
  const tz = dvInfo?.timezoneDesignator;

  // Always-shown notices
  findings.push(finding('feed.availability', 'info', 'feed', 'Data feeds were labelled Limited Testing',
    'Confirm that the Data feeds tab exists under Components > Exports in your CJA environment before building this plan.'));
  findings.push(finding('feed.uniqueness-unchecked', 'info', 'feed', 'Feed name uniqueness and column overlap cannot be checked here',
    'No CJA API for listing data feeds was found, so existing feeds are not visible. Names must be unique within the data view, and feeds on the same data view need different column definitions.'));

  // Name and description
  const name = String(p.name ?? '').trim();
  if (!name) {
    findings.push(finding('feed.name-invalid', 'high', 'feed', 'The feed has no name', 'A name is required.',
      { kbQuery: 'Details tab name unique 255 characters' }));
  } else if (name.length > rules.limits.nameMaxChars) {
    findings.push(finding('feed.name-invalid', 'high', 'feed', `The feed name is ${name.length} characters`,
      `Names can be up to ${rules.limits.nameMaxChars} characters.`, { kbQuery: 'Details tab name unique 255 characters' }));
  }
  if (p.description && String(p.description).length > rules.limits.descriptionMaxChars) {
    findings.push(finding('feed.description-too-long', 'high', 'feed', 'The description is too long',
      `Descriptions can be up to ${rules.limits.descriptionMaxChars} characters.`, { kbQuery: 'Details tab name unique 255 characters' }));
  }

  // Columns
  const requestedAll = parseColumns(p.columns);
  const seen = new Set();
  const requested = [];
  const dupes = [];
  for (const r of requestedAll) {
    const k = lc(r);
    if (seen.has(k)) { dupes.push(r); continue; }
    seen.add(k);
    requested.push(r);
  }
  if (!requested.length) {
    findings.push(finding('feed.no-columns', 'high', 'feed', 'No columns were requested',
      'A feed needs at least one dimension or metric beyond the automatic columns.', { kbQuery: 'Data structure tab' }));
  }
  if (dupes.length) {
    findings.push(finding('feed.column-duplicate', 'low', 'feed', `${dupes.length} column(s) listed more than once`,
      'Repeated columns were ignored.', { evidence: dupes }));
  }

  const rows = [];
  const buckets = { unresolved: [], ambiguous: [], notAvailable: [], substitute: [], always: [], noData: [] };
  const namesInPlan = new Set();
  const matchedComps = [];

  for (const r of requested) {
    const res = resolveColumn(r, comps);
    const row = { requested: r, status: 'ok', notes: [], matched: null, suggestions: res.suggestions || [] };
    const comp = res.status === 'matched' ? res.matches[0] : null;
    if (comp) {
      row.matched = { id: comp.id, name: comp.name, kind: comp.kind };
      matchedComps.push(comp);
    }
    const checkName = lc(comp ? comp.name : r);
    namesInPlan.add(checkName);

    if (ALWAYS.has(checkName)) {
      row.status = 'always-included';
      row.notes.push('Included automatically in every feed.');
      buckets.always.push(comp ? comp.name : r);
    } else if (SUBSTITUTE[checkName]) {
      row.status = 'substitute';
      row.notes.push(`Not exportable as a metric. Use ${SUBSTITUTE[checkName]}.`);
      buckets.substitute.push({ column: comp ? comp.name : r, use: SUBSTITUTE[checkName] });
    } else if (RESTRICTED_DIMS.has(checkName) || RESTRICTED_METS.has(checkName)) {
      row.status = 'not-available';
      row.notes.push('Adobe lists this component as not available in data feeds.');
      buckets.notAvailable.push(comp ? comp.name : r);
    } else if (res.status === 'ambiguous') {
      row.status = 'ambiguous';
      row.notes.push(`Matches ${res.matches.length} components: ${res.matches.map((m) => `${m.kind}:${m.id}`).join(', ')}. Use the ID.`);
      buckets.ambiguous.push({ column: r, matches: res.matches.map((m) => `${m.kind}:${m.id}`) });
    } else if (res.status === 'unresolved') {
      row.status = 'unresolved';
      row.notes.push(row.suggestions.length ? `Not found. Did you mean: ${row.suggestions.map((s) => s.name).join(', ')}?` : 'Not found in the data view.');
      buckets.unresolved.push({ column: r, suggestions: row.suggestions.map((s) => s.name) });
    } else if (comp && comp.hasData === false) {
      row.status = 'no-data';
      row.notes.push('The data view reports no data for this component.');
      buckets.noData.push(comp.name);
    }
    rows.push(row);
  }

  if (buckets.unresolved.length) {
    findings.push(finding('feed.column-unresolved', 'high', 'feed', `${buckets.unresolved.length} column(s) not found in the data view`,
      'Only components that exist in the data view can be added to the feed.',
      { evidence: buckets.unresolved, fix: 'Correct the spelling or use the suggested components.' }));
  }
  if (buckets.ambiguous.length) {
    findings.push(finding('feed.column-ambiguous', 'medium', 'feed', `${buckets.ambiguous.length} column name(s) match more than one component`,
      'Select these by component ID so the right one is used.', { evidence: buckets.ambiguous, kbQuery: 'dv.duplicate-names' }));
  }
  if (buckets.notAvailable.length) {
    findings.push(finding('feed.column-not-available', 'high', 'feed', `${buckets.notAvailable.length} column(s) cannot be included in a data feed`,
      'Adobe lists these components as not available in data feeds. Timestamp UTC is always included, so time breakdowns can usually be rebuilt downstream.',
      { evidence: buckets.notAvailable, fix: 'Remove them from the plan.' }));
  }
  if (buckets.substitute.length) {
    findings.push(finding('feed.column-substitute', 'high', 'feed', `${buckets.substitute.length} metric(s) must be substituted`,
      'These metrics are exported through a count distinct of an ID column.', { evidence: buckets.substitute }));
  }
  if (buckets.always.length) {
    findings.push(finding('feed.column-always-included', 'info', 'feed', `${buckets.always.length} column(s) are already included automatically`,
      'Remove them from the list. They are always in the file.', { evidence: buckets.always, kbQuery: 'Columns that are always included in a feed' }));
  }
  if (buckets.noData.length) {
    findings.push(finding('feed.column-no-data', 'medium', 'feed', `${buckets.noData.length} column(s) have no data`,
      'These columns would be empty.', { evidence: buckets.noData, kbQuery: 'dv.no-data-components' }));
  }

  // Combination rule
  const triggers = [...namesInPlan].filter((n) => CONFLICT_TRIGGERS.has(n));
  const conflicts = [...namesInPlan].filter((n) => CONFLICT_DIMS.has(n));
  if (triggers.length && conflicts.length) {
    findings.push(finding('feed.column-conflict', 'high', 'feed', 'User Agent / Mobile ID cannot be combined with these device columns',
      'These dimensions cannot exist together in Experience Platform datasets, so they cannot share a feed.',
      { evidence: { includes: triggers, conflictsWith: conflicts },
        fix: 'Remove either the User Agent / Mobile ID column or the conflicting device columns.' }));
    for (const row of rows) {
      const n = lc(row.matched ? row.matched.name : row.requested);
      if (CONFLICT_DIMS.has(n) || CONFLICT_TRIGGERS.has(n)) {
        if (row.status === 'ok') row.status = 'conflict';
        row.notes.push('Conflicts with other device columns in this plan.');
      }
    }
  }

  // Type and frequency
  if (!['live', 'backfill'].includes(feedType)) {
    findings.push(finding('feed.type-invalid', 'high', 'feed', `Unknown feed type "${p.feedType}"`, 'Use live or backfill.', { kbQuery: 'Feed type, start date and end date' }));
  } else if (!rules.frequencies[feedType].includes(frequency)) {
    findings.push(finding('feed.backfill-dates', 'high', 'feed',
      feedType === 'backfill' ? 'Backfill feeds must be daily' : `Frequency "${p.frequency}" is not valid for a ${feedType} feed`,
      'Hourly is available for live feeds only, and backfill feeds are locked to daily.', { kbQuery: 'Feed frequency' }));
  }

  // Dates
  const today = todayDay(opts.today);
  const start = parseDay(p.startDate);
  const end = parseDay(p.endDate);
  const tzNote = tz ? ` Dates are read in the data view's time zone (${tz}); this check compares them with today's UTC date.` : '';
  if (feedType === 'live') {
    if (start === null) {
      findings.push(finding('feed.dates-missing', 'high', 'feed', 'A live feed needs a start date', 'Enter a start date of today or later.', { kbQuery: 'feed.backfill-dates' }));
    } else if (start < today) {
      findings.push(finding('feed.live-start-past', 'high', 'feed', 'The live feed starts in the past',
        `A live feed must start today or later, and ${dayStr(start)} is before ${dayStr(today)}. Use a backfill feed for historical data.${tzNote}`,
        { kbQuery: 'feed.backfill-dates' }));
    }
    if (end !== null && start !== null && end < start) {
      findings.push(finding('feed.dates-order', 'high', 'feed', 'The expiration date is before the start date', 'Choose an expiration date after the start date.', { kbQuery: 'feed.backfill-dates' }));
    }
  } else if (feedType === 'backfill') {
    if (start === null || end === null) {
      findings.push(finding('feed.dates-missing', 'high', 'feed', 'A backfill feed needs a start and an end date', 'Enter both dates.', { kbQuery: 'feed.backfill-dates' }));
    } else {
      if (start >= today) findings.push(finding('feed.backfill-dates', 'high', 'feed', 'The backfill start date is not in the past', `A backfill start must be a past date.${tzNote}`));
      if (end > today) findings.push(finding('feed.backfill-dates', 'high', 'feed', 'The backfill end date is in the future', `A backfill end date cannot be in the future.${tzNote}`));
      if (end < start) findings.push(finding('feed.dates-order', 'high', 'feed', 'The end date is before the start date', 'Choose an end date after the start date.', { kbQuery: 'feed.backfill-dates' }));
      const months = opts.dataRetentionMonths;
      if (typeof months === 'number') {
        const earliest = addMonthsDay(today, -months);
        if (start < earliest) {
          findings.push(finding('feed.outside-retention', 'high', 'feed', 'The backfill starts before the data retention window',
            `With ${months} months of retention the earliest usable start is about ${dayStr(earliest)}.${tzNote}`,
            { evidence: { start: dayStr(start), earliestAllowed: dayStr(earliest), dataRetentionMonths: months }, kbQuery: 'conn.retention Feed type, start date and end date' }));
        }
      } else {
        findings.push(finding('feed.retention-unknown', 'info', 'feed', 'Data retention could not be checked',
          'The connection\'s data retention was not available, so the backfill start date was not compared with it.', { kbQuery: 'conn.retention' }));
      }
    }
  }

  // Lookback and persistence
  if (lookbackProvided && !(Number.isFinite(lookbackDays) && lookbackDays > 0)) {
    findings.push(finding('feed.lookback-invalid', 'high', 'feed', 'The lookback date range is not a positive number of days', 'Enter a number of days, or leave it blank for the 30-day default.', { kbQuery: 'Lookback date range' }));
  } else {
    const persisted = matchedComps
      .filter((c) => c.kind === 'dimension')
      .map((c) => ({ c, p: persistenceInfo(c) }))
      .filter((x) => x.p);
    const longer = persisted.filter((x) => x.p.days !== null && x.p.days > lookbackDays);
    if (longer.length) {
      findings.push(finding('feed.lookback-short', 'medium', 'feed', `Lookback (${lookbackDays} days) is shorter than the persistence of ${longer.length} column(s)`,
        'Persisted values older than the lookback are not seen when the feed is generated, so values can differ from Analysis Workspace.',
        { evidence: longer.map((x) => ({ dimension: x.c.name, persistenceDays: Math.round(x.p.days) })), fix: `Raise the lookback to at least ${Math.ceil(Math.max(...longer.map((x) => x.p.days)))} days, accepting slower deliveries.` }));
    }
    const windowBased = persisted.filter((x) => x.p.windowBased);
    if (windowBased.length) {
      findings.push(finding('feed.persistence-window', 'info', 'feed', `${windowBased.length} column(s) use a reporting-window style expiration`,
        'For these, the feed\'s lookback date range becomes the reporting window.', { evidence: windowBased.map((x) => x.c.name), kbQuery: 'feed.lookback-short Lookback date range' }));
    }
    const unreadable = persisted.filter((x) => x.p.days === null && !x.p.windowBased);
    if (unreadable.length) skipped.push(`Persistence length for ${unreadable.length} column(s) could not be interpreted`);
  }

  // Processing delay and compression
  if (p.processingDelayHours !== undefined && p.processingDelayHours !== null && p.processingDelayHours !== '') {
    if (!rules.processingDelayHours.includes(Number(p.processingDelayHours))) {
      findings.push(finding('feed.processing-delay', 'medium', 'feed', `${p.processingDelayHours} hours is not one of the listed delays`,
        `Adobe lists ${rules.processingDelayHours.join(', ')} hours for manual selection (the default is ${rules.defaults.processingDelayHours}).`));
    }
  }
  if (p.compression) {
    const c = lc(p.compression).replace(/[^a-z]/g, '').replace('zstandard', 'zstd');
    if (!rules.compression.includes(c)) {
      findings.push(finding('feed.compression', 'high', 'feed', `Compression "${p.compression}" is not offered`,
        `Parquet files can use ${rules.compression.join(', ')}.`, { kbQuery: 'Compression, destination and manifest' }));
    }
  }

  if (tz) {
    findings.push(finding('feed.timezone-boundary', 'info', 'feed', `Feed days run in ${tz}`,
      `${frequency === 'hourly' ? 'Hourly' : 'Daily'} windows and the dates above follow the data view's time zone.`, { kbQuery: 'dv.timezone' }));
  }

  return {
    findings,
    skipped,
    columns: rows,
    plan: { name, feedType, frequency, startDate: p.startDate || null, endDate: p.endDate || null, lookbackDays, columns: requested },
  };
}

module.exports = {
  auditConnection,
  auditDataView,
  auditFeedPlan,
  normalizeComponents,
  sortFindings,
  resolveColumn,
  similarity,
  persistenceInfo,
  parseColumns,
  SEVERITY_ORDER,
};

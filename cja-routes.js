// cja-routes.js — Customer Journey Analytics Reporting API wrapper
//
// Uses the real CJA Reporting API (cja.adobe.io) — this queries data views
// directly rather than exporting raw files like Data Feeds does.
//
// Required .env values:
//   ADOBE_S2S_CLIENT_ID=       (from Developer Console > Customer Journey Analytics API > OAuth Server-to-Server)
//   ADOBE_S2S_CLIENT_SECRET=
//   ADOBE_S2S_SCOPES=          (must include cja.reporting and cja.workspace — Console generates the full string)
//   ADOBE_ORG_ID=              (your IMS Org ID, format: XXXXXXXX@AdobeOrg)

const IMS_HOST = process.env.ADOBE_IMS_HOST || 'https://ims-na1.adobelogin.com';
const CJA_API_HOST = 'https://cja.adobe.io';

let cachedToken = null;
let tokenExpiresAt = 0;

// Expected "not configured" errors are not logged as stack traces.
function logErr(label, err) {
  if (!err.quiet) console.error(label, err);
}

async function getAccessToken() {
  if (!process.env.ADOBE_S2S_CLIENT_ID || !process.env.ADOBE_S2S_CLIENT_SECRET || !process.env.ADOBE_S2S_SCOPES) {
    const e = new Error('Adobe Server-to-Server credentials are not set in .env (ADOBE_S2S_CLIENT_ID, ADOBE_S2S_CLIENT_SECRET, ADOBE_S2S_SCOPES), so this part cannot reach Adobe. The CJA Audit tab works without them.');
    e.status = 503;
    e.quiet = true;
    throw e;
  }

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(`${IMS_HOST}/ims/token/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ADOBE_S2S_CLIENT_ID,
      client_secret: process.env.ADOBE_S2S_CLIENT_SECRET,
      scope: process.env.ADOBE_S2S_SCOPES,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('CJA S2S token error:', data);
    throw new Error('Failed to get Adobe access token');
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function cjaApiRequest(path, options = {}) {
  const token = await getAccessToken();

  const res = await fetch(`${CJA_API_HOST}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': process.env.ADOBE_S2S_CLIENT_ID,
      'x-gw-ims-org-id': process.env.ADOBE_ORG_ID,
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.message || `CJA API error (${res.status})`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function registerCjaRoutes(app, requireAuth) {
  // List data views available to this account
  app.get('/api/cja/dataviews', requireAuth, async (req, res) => {
    try {
      const data = await cjaApiRequest('/data/dataviews');
      res.json(data);
    } catch (err) {
      logErr('List dataviews error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // List dimensions for a data view
  app.get('/api/cja/dataviews/:id/dimensions', requireAuth, async (req, res) => {
    try {
      const data = await cjaApiRequest(`/data/dataviews/${req.params.id}/dimensions`);
      res.json(data);
    } catch (err) {
      logErr('List dimensions error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // List metrics for a data view
  app.get('/api/cja/dataviews/:id/metrics', requireAuth, async (req, res) => {
    try {
      const data = await cjaApiRequest(`/data/dataviews/${req.params.id}/metrics`);
      res.json(data);
    } catch (err) {
      logErr('List metrics error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Run a report: one dimension, one or more metrics, a date range
  app.post('/api/cja/report', requireAuth, async (req, res) => {
    try {
      const { dataviewId, dimension, metrics, startDate, endDate, limit } = req.body;

      if (!dataviewId || !dimension || !Array.isArray(metrics) || metrics.length === 0 || !startDate || !endDate) {
        return res.status(400).json({ error: 'dataviewId, dimension, metrics (array), startDate, and endDate are required' });
      }

      const payload = {
        rsid: dataviewId,
        globalFilters: [
          {
            type: 'dateRange',
            dateRange: `${startDate}/${endDate}`,
          },
        ],
        metricContainer: {
          metrics: metrics.map((m, i) => ({ columnId: String(i), id: m })),
        },
        dimension,
        settings: {
          countRepeatInstances: true,
          limit: limit || 50,
          page: 0,
        },
      };

      const data = await cjaApiRequest('/reports', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      res.json(data);
    } catch (err) {
      logErr('Run report error:', err);
      res.status(err.status || 500).json({ error: err.message, details: err.details });
    }
  });
  // Full dump: every dimension in the data view, each run against every
  // metric, for the given date range. Runs one API call per dimension —
  // slower than a single report, but that's inherent to the API (it only
  // accepts one dimension per call).
  app.post('/api/cja/dump', requireAuth, async (req, res) => {
    try {
      const { dataviewId, startDate, endDate, limit } = req.body;

      if (!dataviewId || !startDate || !endDate) {
        return res.status(400).json({ error: 'dataviewId, startDate, and endDate are required' });
      }

      const [dimsRes, metsRes] = await Promise.all([
        cjaApiRequest(`/data/dataviews/${dataviewId}/dimensions`),
        cjaApiRequest(`/data/dataviews/${dataviewId}/metrics`),
      ]);

      const dimensions = dimsRes.content || dimsRes || [];
      const metrics = metsRes.content || metsRes || [];
      const metricIds = metrics.map((m) => m.id);
      const rowLimit = limit || 100;

      if (dimensions.length === 0 || metrics.length === 0) {
        return res.status(400).json({ error: 'This data view has no dimensions or no metrics to report on.' });
      }

      const results = [];

      // Sequential on purpose — safer against rate limits than firing all at once
      for (const dim of dimensions) {
        try {
          const payload = {
            rsid: dataviewId,
            globalFilters: [{ type: 'dateRange', dateRange: `${startDate}/${endDate}` }],
            metricContainer: {
              metrics: metricIds.map((id, i) => ({ columnId: String(i), id })),
            },
            dimension: dim.id,
            settings: { countRepeatInstances: true, limit: rowLimit, page: 0 },
          };

          const data = await cjaApiRequest('/reports', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          results.push({
            dimensionId: dim.id,
            dimensionName: dim.name || dim.id,
            metricIds,
            metricNames: metrics.map((m) => m.name || m.id),
            rows: data.rows || [],
          });
        } catch (err) {
          // Don't let one bad dimension kill the whole dump — record and move on
          results.push({
            dimensionId: dim.id,
            dimensionName: dim.name || dim.id,
            error: err.message,
          });
        }
      }

      res.json({ dataviewId, startDate, endDate, results });
    } catch (err) {
      logErr('Dump error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });
}

module.exports = registerCjaRoutes;
// Reused by the read-only audit so both tools share one token cache.
module.exports.cjaApiRequest = cjaApiRequest;

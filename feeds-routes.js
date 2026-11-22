// feeds-routes.js — Adobe Data Feed API wrapper
//
// Add this to your existing server.js with:
//   const registerFeedRoutes = require('./feeds-routes');
//   registerFeedRoutes(app, requireAuth);
//
// Required .env values (from Adobe Developer Console > OAuth Server-to-Server credential):
//   ADOBE_S2S_CLIENT_ID=
//   ADOBE_S2S_CLIENT_SECRET=
//   ADOBE_S2S_SCOPES=            (the exact scope string Console generates for this credential)
//   ADOBE_GLOBAL_COMPANY_ID=     (your Analytics/CJA company ID, e.g. "yourcompany")

const fs = require('fs');
const path = require('path');

const IMS_HOST = process.env.ADOBE_IMS_HOST || 'https://ims-na1.adobelogin.com';
const ANALYTICS_API_HOST = 'https://analytics.adobe.io';

// --- Token caching ---
// Server-to-server tokens are valid for a while (usually 24h) — cache instead
// of fetching a new one on every request.
let cachedToken = null;
let tokenExpiresAt = 0;

// Expected "not configured" errors are not logged as stack traces.
function logErr(label, err) {
  if (!err.quiet) console.error(label, err);
}

// Every attempt to change something in Adobe is recorded here, whether it was allowed or not.
// The file holds who, what and the outcome. It never holds credentials.
function writeAudit(entry) {
  if (process.env.WRITE_AUDIT_LOG === 'false') return;
  try {
    const file = process.env.WRITE_AUDIT_FILE || path.join(__dirname, 'logs', 'write-audit.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (_) { /* logging must never break a request */ }
}

const creationEnabled = () => process.env.ALLOW_FEED_CREATION === 'true';

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
    console.error('Adobe S2S token error:', data);
    throw new Error('Failed to get Adobe access token');
  }

  cachedToken = data.access_token;
  // Refresh a little early to be safe
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function adobeApiRequest(path, options = {}) {
  const token = await getAccessToken();
  const companyId = process.env.ADOBE_GLOBAL_COMPANY_ID;

  const res = await fetch(`${ANALYTICS_API_HOST}/api/${companyId}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': process.env.ADOBE_S2S_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.message || `Adobe API error (${res.status})`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function registerFeedRoutes(app, requireAuth) {
  // List cloud export locations — used to populate a dropdown instead of
  // requiring the UUID to be copied in by hand
  app.get('/api/locations', requireAuth, async (req, res) => {
    try {
      const data = await adobeApiRequest('/export_locations/analytics/exportlocations/location');
      res.json(data);
    } catch (err) {
      logErr('List locations error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // List all data feeds
  app.get('/api/feeds', requireAuth, async (req, res) => {
    try {
      const data = await adobeApiRequest('/data_feed/datafeed');
      res.json(data);
    } catch (err) {
      logErr('List feeds error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Get a single feed
  app.get('/api/feeds/:id', requireAuth, async (req, res) => {
    try {
      const data = await adobeApiRequest(`/data_feed/datafeed/${req.params.id}`);
      res.json(data);
    } catch (err) {
      logErr('Get feed error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Tells the page whether creating feeds is allowed, so it can explain instead of failing.
  app.get('/api/feed-settings', requireAuth, (req, res) => {
    res.json({ creationEnabled: creationEnabled() });
  });

  // Create a new data feed. This is the ONLY place the app changes anything in Adobe.
  // Guardrails: off unless ALLOW_FEED_CREATION=true, an explicit confirmation from the person, and an audit record.
  app.post('/api/feeds', requireAuth, async (req, res) => {
    const body = req.body || {};
    const who = req.session?.user?.name || req.session?.user?.email || 'unknown';
    const record = (outcome, extra = {}) => writeAudit({
      ts: new Date().toISOString(), action: 'create_data_feed', user: who,
      feedName: String(body.feedName || '').slice(0, 200), rsid: String(body.rsid || '').slice(0, 100),
      interval: String(body.interval || '').slice(0, 20), outcome, ...extra,
    });

    if (!creationEnabled()) {
      record('denied: feed creation is turned off');
      return res.status(403).json({ error: 'Creating feeds is turned off. Set ALLOW_FEED_CREATION=true in .env and restart the server to allow it.' });
    }
    if (body.confirm !== true) {
      record('denied: no confirmation');
      return res.status(400).json({ error: 'This creates a feed in Adobe, so it needs your explicit confirmation.' });
    }

    try {
      const { feedName, rsid, columnPreset, startDate, endDate, interval, delay, cloudLocationId, notifyEmails } = body;

      if (!feedName || !rsid || !columnPreset || !startDate || !cloudLocationId) {
        return res.status(400).json({ error: 'feedName, rsid, columnPreset, startDate, and cloudLocationId are required' });
      }

      const payload = {
        feedName,
        rsid,
        columnPreset,
        dynamicLookups: false,
        replaceEscapedChars: false,
        customerVisible: true,
        schedule: {
          startDate,
          endDate: endDate || null,
          interval: interval || 'hourly', // 'hourly' or 'daily'
          delay: delay || 0,
        },
        packaging: {
          type: 'chunked',
          chunkSize: 4096,
          compression: 'gzip',
          manifest: 'manifest-file',
          noDataManifest: true,
        },
        delivery: {
          cloudLocationUUID: cloudLocationId,
          ...(notifyEmails ? { notificationEmails: notifyEmails.split(',').map((e) => e.trim()) } : {}),
        },
      };

      const data = await adobeApiRequest('/data_feed/datafeed', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      record('created', { feedId: data.id || data.feedId || null });
      res.json(data);
    } catch (err) {
      record('failed', { status: err.status || 500 });
      logErr('Create feed error:', err);
      res.status(err.status || 500).json({ error: err.message, details: err.details });
    }
  });
}

module.exports = registerFeedRoutes;

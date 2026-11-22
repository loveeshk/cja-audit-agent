'use strict';
// The only action that changes anything in Adobe is creating a classic data feed.
// These tests prove it is off by default, needs confirmation, is recorded, and that no other write exists.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUDIT = path.join(os.tmpdir(), `write-audit-${process.pid}-${Date.now()}.jsonl`);
process.env.WRITE_AUDIT_FILE = AUDIT;
process.env.ADOBE_S2S_CLIENT_ID = 'id';
process.env.ADOBE_S2S_CLIENT_SECRET = 'secret';
process.env.ADOBE_S2S_SCOPES = 'scope';
process.env.ADOBE_GLOBAL_COMPANY_ID = 'acme';
delete process.env.ALLOW_FEED_CREATION;

const registerFeedRoutes = require('../feeds-routes');

function fakeApp() {
  const routes = {};
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  return { routes, get: reg('GET'), post: reg('POST') };
}
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } });
const goodBody = { feedName: 'f1', rsid: 'rs1', columnPreset: 'p', startDate: '2026-11-01T00:00:00Z', cloudLocationId: 'loc', interval: 'daily' };
const audit = () => (fs.existsSync(AUDIT) ? fs.readFileSync(AUDIT, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

function withFetch(fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    if (String(url).includes('/ims/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({ id: 'feed-123' }) };
  };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = real; });
}

test('creating a feed is OFF by default: refused, nothing sent to Adobe, attempt recorded', async () => {
  await withFetch(async (calls) => {
    const app = fakeApp();
    registerFeedRoutes(app, (q, s, n) => n());
    const r = res();
    await app.routes['POST /api/feeds']({ body: { ...goodBody, confirm: true }, session: { user: { name: 'Pat' } } }, r);
    assert.strictEqual(r.code, 403);
    assert.match(r.body.error, /ALLOW_FEED_CREATION/);
    assert.strictEqual(calls.length, 0, 'no request may reach Adobe');
    const last = audit().pop();
    assert.strictEqual(last.user, 'Pat');
    assert.match(last.outcome, /^denied: feed creation is turned off/);
  });
});

test('the page can ask whether creation is allowed', () => {
  const app = fakeApp();
  registerFeedRoutes(app, (q, s, n) => n());
  const off = res(); app.routes['GET /api/feed-settings']({}, off);
  assert.deepStrictEqual(off.body, { creationEnabled: false });
  process.env.ALLOW_FEED_CREATION = 'true';
  const on = res(); app.routes['GET /api/feed-settings']({}, on);
  assert.deepStrictEqual(on.body, { creationEnabled: true });
  delete process.env.ALLOW_FEED_CREATION;
});

test('even when enabled, it needs explicit confirmation', async () => {
  process.env.ALLOW_FEED_CREATION = 'true';
  await withFetch(async (calls) => {
    const app = fakeApp();
    registerFeedRoutes(app, (q, s, n) => n());
    for (const confirm of [undefined, false, 'true', 1]) {
      const r = res();
      await app.routes['POST /api/feeds']({ body: { ...goodBody, confirm }, session: {} }, r);
      assert.strictEqual(r.code, 400, `confirm=${String(confirm)}`);
    }
    assert.strictEqual(calls.length, 0);
    assert.ok(audit().some((a) => a.outcome === 'denied: no confirmation'));
  });
  delete process.env.ALLOW_FEED_CREATION;
});

test('enabled and confirmed: exactly one POST to the feed endpoint, and it is recorded', async () => {
  process.env.ALLOW_FEED_CREATION = 'true';
  await withFetch(async (calls) => {
    const app = fakeApp();
    registerFeedRoutes(app, (q, s, n) => n());
    const r = res();
    await app.routes['POST /api/feeds']({ body: { ...goodBody, confirm: true }, session: { user: { name: 'Sam' } } }, r);
    assert.strictEqual(r.code, 200);
    const writes = calls.filter((c) => c.method === 'POST' && c.url.includes('/data_feed/datafeed'));
    assert.strictEqual(writes.length, 1);
    const last = audit().pop();
    assert.deepStrictEqual([last.outcome, last.feedId, last.user, last.feedName], ['created', 'feed-123', 'Sam', 'f1']);
    assert.ok(!JSON.stringify(last).includes('secret'), 'credentials must never reach the audit record');
  });
  delete process.env.ALLOW_FEED_CREATION;
});

test('an Adobe failure is recorded as failed', async () => {
  process.env.ALLOW_FEED_CREATION = 'true';
  const real = global.fetch;
  global.fetch = async (url) => (String(url).includes('/ims/token')
    ? { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) }
    : { ok: false, status: 400, json: async () => ({ message: 'bad feed' }) });
  try {
    const app = fakeApp();
    registerFeedRoutes(app, (q, s, n) => n());
    const r = res();
    await app.routes['POST /api/feeds']({ body: { ...goodBody, confirm: true }, session: {} }, r);
    assert.strictEqual(r.code, 400);
    assert.strictEqual(audit().pop().outcome, 'failed');
  } finally { global.fetch = real; delete process.env.ALLOW_FEED_CREATION; }
});

// ----------------------------------------------------------------------------------------------
// Write inventory: every outbound call that is not a GET, found by reading the source.
// If a new one appears this test fails, so a new write cannot be added without a deliberate review.
// ----------------------------------------------------------------------------------------------
test('write inventory: the only mutating call to Adobe is the guarded feed creation', () => {
  const root = path.join(__dirname, '..');
  const files = ['server.js', 'feeds-routes.js', 'cja-routes.js', 'core.js', 'rag.js', ...fs.readdirSync(path.join(root, 'audit')).filter((f) => f.endsWith('.js')).map((f) => path.join('audit', f))];
  const found = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/(adobeApiRequest|cjaApiRequest)\(\s*'([^']+)'\s*,\s*\{[^}]*?method:\s*'(POST|PUT|PATCH|DELETE)'/gs)) found.push(`${f}: ${m[3]} ${m[2]}`);
    const tokenCalls = [...src.matchAll(/fetch\([^)]*(?:IMS|ims)[^)]*\)?[\s\S]{0,80}?method:\s*'(POST|PUT|PATCH|DELETE)'/g)];
    for (const t of tokenCalls) found.push(`${f}: ${t[1]} <login or token exchange>`);
  }
  // CJA /reports uses POST for read-only reporting queries; the feed endpoint is the only real write.
  const allowed = [
    'cja-routes.js: POST /reports',
    'cja-routes.js: POST /reports',
    'feeds-routes.js: POST /data_feed/datafeed',
  ];
  const calls = found.filter((x) => !x.includes('<login or token exchange>')).sort();
  assert.deepStrictEqual(calls, allowed.sort(), `unexpected mutating calls:\n${calls.join('\n')}`);
  // and nothing in the audit code mutates anything at all
  const auditSrc = fs.readdirSync(path.join(root, 'audit')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(root, 'audit', f), 'utf8')).join('\n');
  assert.ok(!/method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i.test(auditSrc), 'audit code must not make mutating calls');
  assert.ok(!/ALLOW_FEED_CREATION/.test(auditSrc), 'audit code has no path to the write switch');
});

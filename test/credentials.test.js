'use strict';
// Without Adobe Server-to-Server credentials the Adobe-backed routes must answer with a clear
// 503 message, never contact Adobe, and never print a stack trace.
const test = require('node:test');
const assert = require('node:assert');

for (const k of ['ADOBE_S2S_CLIENT_ID', 'ADOBE_S2S_CLIENT_SECRET', 'ADOBE_S2S_SCOPES']) delete process.env[k];

const registerFeedRoutes = require('../feeds-routes');
const registerCjaRoutes = require('../cja-routes');

function fakeApp() {
  const routes = {};
  const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  return { routes, get: reg('GET'), post: reg('POST') };
}
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } });

test('classic feeds and CJA report routes explain missing credentials without calling Adobe', async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; throw new Error('should not be called'); };
  const logged = [];
  const realErr = console.error;
  console.error = (...a) => logged.push(a);
  try {
    const app = fakeApp();
    registerFeedRoutes(app, (q, s, n) => n());
    registerCjaRoutes(app, (q, s, n) => n());
    for (const key of ['GET /api/feeds', 'GET /api/locations', 'GET /api/cja/dataviews']) {
      const r = res();
      await app.routes[key]({ params: {}, body: {} }, r);
      assert.strictEqual(r.code, 503, key);
      assert.ok(/not set in \.env/.test(r.body.error), key);
      assert.ok(/CJA Audit tab works/.test(r.body.error), key);
    }
    assert.strictEqual(fetchCalls, 0, 'must not contact Adobe without credentials');
    assert.deepStrictEqual(logged, [], 'must not print stack traces for an expected condition');
  } finally {
    global.fetch = realFetch;
    console.error = realErr;
  }
});

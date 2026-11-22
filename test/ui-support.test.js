'use strict';
// Tests for the pieces behind the finished UI: status strip, retrieval inspector data, one-click launchers.
process.env.RAG_EMBEDDER = 'mock';
process.env.RAG_TRACE_LOG = 'false';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rag = require('../rag');
const registerAsk = require('../ask-routes');
const registerStatus = require('../status');
const { buildStatus } = registerStatus;
const { browserCommand } = require('../launcher');

const fakeApp = () => { const routes = {}; const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: reg('GET'), post: reg('POST') }; };
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } });
const pass = (q, s, n) => n();
const stats = { ready: true, chunks: 53, embedder: 'transformers', config: { k: 4, minScore: 0.3, lexWeight: 0.3 } };
const base = { disableAuth: true, auditSource: 'mock', hasAnthropicKey: false, model: 'm', ragStats: stats, env: {} };

// ------------------------------------------------------------------ status strip
test('status describes login, data source, answer mode, retrieval and safety in plain words', () => {
  const s = buildStatus(base);
  assert.strictEqual(s.login.enabled, false);
  assert.match(s.login.detail, /this computer/);
  assert.strictEqual(s.data.source, 'sample');
  assert.strictEqual(s.answers.mode, 'copy-prompt');
  assert.strictEqual(s.retrieval.ready, true);
  assert.match(s.retrieval.label, /53 chunks/);
  assert.strictEqual(s.safety.auditReadOnly, true);
  assert.strictEqual(s.safety.feedCreation.enabled, false);
});

test('status changes with the configuration', () => {
  const s = buildStatus({ ...base, disableAuth: false, auditSource: 'live', hasAnthropicKey: true, env: { ALLOW_FEED_CREATION: 'true' }, ragStats: { ready: false } });
  assert.strictEqual(s.login.enabled, true);
  assert.strictEqual(s.data.source, 'live');
  assert.strictEqual(s.answers.mode, 'claude');
  assert.strictEqual(s.retrieval.ready, false);
  assert.match(s.retrieval.label, /full notes/);
  assert.strictEqual(s.safety.feedCreation.enabled, true);
  assert.notStrictEqual(buildStatus({ ...base, env: { ALLOW_FEED_CREATION: 'yes' } }).safety.feedCreation.enabled, true, 'only the exact value "true" turns writes on');
});

test('status never contains a key or secret, even when they are set in the environment', () => {
  process.env.ANTHROPIC_API_KEY = 'FAKE-TEST-KEY-NOT-REAL-123456';
  process.env.ADOBE_S2S_CLIENT_SECRET = 'TOPSECRETVALUE';
  process.env.SESSION_SECRET = 'SESSIONSECRETVALUE';
  const app = fakeApp();
  registerStatus(app, pass, { disableAuth: true, auditSource: { source: 'mock' }, hasAnthropicKey: true, model: 'claude-test' });
  const res = fakeRes();
  app.routes['GET /api/system-status']({}, res);
  const text = JSON.stringify(res.body);
  for (const secret of ['FAKE-TEST-KEY', 'TOPSECRETVALUE', 'SESSIONSECRETVALUE']) assert.ok(!text.includes(secret), secret);
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ADOBE_S2S_CLIENT_SECRET; delete process.env.SESSION_SECRET;
});

// -------------------------------------------------------------- retrieval inspector
test('Ask the docs returns a retrieval trace that matches the sources shown', async () => {
  await rag.init();
  const app = fakeApp();
  registerAsk(app, pass, { anthropic: null, model: 'm', maxTokens: 10, pickMode: () => 'rag' });
  const res = fakeRes();
  await app.routes['POST /api/search']({ body: { query: 'what does the hasData field tell me about a dimension' } }, res);
  assert.strictEqual(res.code, 200);
  const t = res.body.trace;
  assert.ok(t && t.candidates.length > 0 && t.candidates.length <= 8);
  assert.ok(t.candidates.every((c, i) => c.rank === i + 1 && typeof c.semantic === 'number' && typeof c.keyword === 'number'));
  const used = t.candidates.filter((c) => c.returned);
  assert.strictEqual(used.length, res.body.sources.length, 'the inspector marks exactly the sources that were used');
  assert.ok(!JSON.stringify(t).includes('"body"'), 'chunk text is not sent in the trace');
});

test('a question the notes do not cover still shows the trace, with nothing marked as used', async () => {
  const app = fakeApp();
  registerAsk(app, pass, { anthropic: null, model: 'm', maxTokens: 10, pickMode: () => 'rag' });
  const res = fakeRes();
  await app.routes['POST /api/search']({ body: { query: 'zzqq xxjj kkvv' } }, res);
  assert.strictEqual(res.body.modelCalled, false);
  assert.ok(res.body.trace.candidates.every((c) => !c.returned));
});

test('Ask the docs rejects an empty question', async () => {
  const app = fakeApp();
  registerAsk(app, pass, { anthropic: null, model: 'm', maxTokens: 10, pickMode: () => 'rag' });
  const res = fakeRes();
  await app.routes['POST /api/search']({ body: { query: '   ' } }, res);
  assert.strictEqual(res.code, 400);
});

// ----------------------------------------------------------------------- launchers
test('the browser is only ever opened on our own local address', () => {
  assert.strictEqual(browserCommand('win32', 'http://localhost:3000'), 'start "" "http://localhost:3000"');
  assert.strictEqual(browserCommand('darwin', 'http://localhost:3000'), 'open "http://localhost:3000"');
  assert.strictEqual(browserCommand('linux', 'http://127.0.0.1:3000/'), 'xdg-open "http://127.0.0.1:3000/"');
  for (const bad of ['http://evil.example.com', 'http://localhost:3000"; calc', 'file:///etc/passwd', 'http://localhost', 'javascript:alert(1)']) {
    assert.strictEqual(browserCommand('win32', bad), null, bad);
  }
});

test('start.bat and start.sh install on first run, open the browser and start the server', () => {
  const bat = fs.readFileSync(path.join(root, 'start.bat'), 'utf8');
  const sh = fs.readFileSync(path.join(root, 'start.sh'), 'utf8');
  assert.ok(bat.includes('\r\n') && !/[^\r]\n/.test(bat), 'start.bat must use Windows line endings');
  assert.ok(!sh.includes('\r'), 'start.sh must use Unix line endings');
  for (const [name, text] of [['start.bat', bat], ['start.sh', sh]]) {
    assert.ok(/npm install/.test(text), `${name} installs on first run`);
    assert.ok(/OPEN_BROWSER=true/.test(text), `${name} asks the server to open the browser`);
    assert.ok(/node server\.js/.test(text), `${name} starts the server`);
    assert.ok(/nodejs\.org/.test(text), `${name} tells the user how to get Node.js`);
  }
  assert.ok(sh.startsWith('#!/usr/bin/env bash'));
  assert.ok(fs.statSync(path.join(root, 'start.sh')).mode & 0o111, 'start.sh is executable');
  const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert.ok(/\*\.bat text eol=crlf/.test(attrs) && /\*\.sh text eol=lf/.test(attrs));
});

// ------------------------------------------------------------------- page wiring
test('the page has the status strip, the report link, the inspector and escapes the user name', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'assistant.html'), 'utf8');
  for (const id of ['statusStrip', 'reportTab', 'logoutLink']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('href="/report"') && html.includes('renderInspector') && html.includes('/api/system-status'));
  assert.ok(!html.includes("querySelectorAll('.tab')"), 'tab switching must only touch tabs that have a data-view, so the Report Builder link cannot break it');
  assert.ok(!/Signed in as <strong>\$\{data\.user/.test(html), 'the user name must be escaped before it is put in the page');
  const report = fs.readFileSync(path.join(root, 'public', 'report.html'), 'utf8');
  assert.ok(report.includes('href="/"'), 'the Report Builder links back to the audit');
});

test('server.js uses the shared modules and no longer defines the Ask routes inline', () => {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(/registerAskRoutes\(app/.test(src) && /registerStatusRoutes\(app/.test(src));
  assert.ok(!/app\.post\('\/api\/search'/.test(src));
  assert.ok(/OPEN_BROWSER === 'true'/.test(src));
});

// Public demo mode must strip every credential and the only write before the server listens publicly.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { applyPublicDemo, REMOVED_KEYS } = require('../demo-mode');

const FAKE = Object.fromEntries(REMOVED_KEYS.map((k) => [k, `fake-${k}`]));

test('demo mode is off unless PUBLIC_DEMO=true, and then changes nothing', () => {
  const env = { ...FAKE, ALLOW_FEED_CREATION: 'true', PUBLIC_DEMO: 'yes' };
  const r = applyPublicDemo(env);
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(env.ANTHROPIC_API_KEY, FAKE.ANTHROPIC_API_KEY);
  assert.strictEqual(env.ALLOW_FEED_CREATION, 'true');
});

test('demo mode removes every credential, forces sample data and turns feed creation off', () => {
  const env = { ...FAKE, ALLOW_FEED_CREATION: 'true', AUDIT_SOURCE: 'live', DISABLE_AUTH: 'false', PUBLIC_DEMO: 'true' };
  const r = applyPublicDemo(env);
  assert.strictEqual(r.enabled, true);
  for (const k of REMOVED_KEYS) assert.strictEqual(env[k], undefined, `${k} must be removed`);
  assert.deepStrictEqual(r.removed.sort(), [...REMOVED_KEYS].sort());
  assert.strictEqual(env.ALLOW_FEED_CREATION, 'false');
  assert.strictEqual(env.AUDIT_SOURCE, 'mock');
  assert.strictEqual(env.DISABLE_AUTH, 'true');
});

test('a server started in demo mode with credentials planted serves sample data and refuses to create feeds', async (t) => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...FAKE, PUBLIC_DEMO: 'true', ALLOW_FEED_CREATION: 'true', AUDIT_SOURCE: 'live', PORT: String(port), RAG_EMBEDDER: 'mock', OPEN_BROWSER: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const base = `http://127.0.0.1:${port}`;
  let status;
  for (let i = 0; i < 100 && !status; i++) {
    try { status = await (await fetch(`${base}/api/system-status`)).json(); } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.ok(status, `server did not start:\n${log}`);
  assert.strictEqual(status.login.label, 'Public demo');
  assert.strictEqual(status.login.publicDemo, true, 'the page header must not claim local mode on a public site');
  assert.strictEqual(status.data.source, 'sample');
  assert.strictEqual(status.answers.mode, 'copy-prompt');
  assert.strictEqual(status.safety.feedCreation.enabled, false);

  const create = await fetch(`${base}/api/feeds`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, feedName: 'x' }),
  });
  assert.strictEqual(create.status, 403);

  assert.match(log, /PUBLIC DEMO MODE/);
  for (const v of Object.values(FAKE)) assert.ok(!log.includes(v), 'credential values must never be logged');
});

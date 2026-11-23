// scripts/mutation-check.js — injects one deliberate bug at a time and checks that the test suite catches it.
// Run:  npm run eval:mutations      (offline, no keys; about a minute)
//
// Each mutation copies the repository to a temporary folder, makes ONE change that breaks a check or a guardrail,
// runs the full offline test suite there, and records whether at least one test failed. The working copy is never
// touched. Results are saved to examples/mutation-results.md.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

// [what it breaks, file, exact text, replacement]
const MUTATIONS = [
  ['Check: "new data not imported" downgraded from high to low', 'audit/checks.js',
    "finding('conn.import-new-data-off', 'high'", "finding('conn.import-new-data-off', 'low'"],
  ['Check: failed backfill downgraded from high to info', 'audit/checks.js',
    "finding('conn.backfill-failed', 'high'", "finding('conn.backfill-failed', 'info'"],
  ['Feed rule: unavailable columns downgraded from high to low', 'audit/checks.js',
    "findings.push(finding('feed.column-not-available', 'high'", "findings.push(finding('feed.column-not-available', 'low'"],
  ['Feed rule: metrics needing a substitute downgraded from high to info', 'audit/checks.js',
    "findings.push(finding('feed.column-substitute', 'high'", "findings.push(finding('feed.column-substitute', 'info'"],
  ['Write guard: feed creation allowed even when switched off', 'feeds-routes.js',
    'if (!creationEnabled()) {', 'if (false) {'],
  ['Write guard: feed created without the user\'s confirmation', 'feeds-routes.js',
    'if (body.confirm !== true) {', 'if (false) {'],
  ['Refusal gate: similarity threshold ignored', 'rag.js',
    'scored.filter((s) => s.semantic + s.idBoost >= minScore)', 'scored.filter((s) => s.semantic + s.idBoost >= -1)'],
  ['Refusal gate: "not covered" answer skipped when nothing is retrieved', 'core.js',
    'if (retrieval.hits.length === 0) {', 'if (false) {'],
  ['Grounding: low and info findings sent to the model', 'audit/explain.js',
    "['high', 'medium'].includes(f.severity)", "['high', 'medium', 'low', 'info'].includes(f.severity)"],
  ['Prompt-injection guard: untrusted finding text no longer cut to length', 'audit/explain.js',
    "detail: String(f.detail || '').slice(0, 600),", "detail: String(f.detail || ''),"],
  ['Demo lockdown: credentials kept in public demo mode', 'demo-mode.js',
    'for (const k of REMOVED_KEYS) delete env[k];', '// credentials kept'],
  ['Demo lockdown: feed creation left on in public demo mode', 'demo-mode.js',
    "env.ALLOW_FEED_CREATION = 'false';", "env.ALLOW_FEED_CREATION = env.ALLOW_FEED_CREATION || 'false';"],
  ['Read-only audit: a POST request added to the CJA client', 'audit/cja-client.js',
    'function chooseSource(cjaApiRequest) {', "function chooseSource(cjaApiRequest) {\n  const unused = { method: 'POST' };"],
];

const SKIP = new Set(['node_modules', '.git', 'logs', 'rag-index.json']);

function copyRepo(dest) {
  fs.cpSync(root, dest, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || src === root });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

function runTests(dir) {
  const files = fs.readdirSync(path.join(dir, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('test', f));
  const r = spawnSync(process.execPath, ['--test', ...files], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, RAG_EMBEDDER: 'mock', RAG_TRACE_LOG: 'false' }, timeout: 180000,
  });
  const failed = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
  return { code: r.status, failed: failed ? Number(failed) : null };
}

const rows = [];
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cja-mut-'));
try {
  const clean = path.join(base, 'clean');
  copyRepo(clean);
  const baseline = runTests(clean);
  console.log(`Baseline (no bug): ${baseline.failed === 0 ? 'all tests pass' : `${baseline.failed} failing — fix the suite first`}`);
  if (baseline.failed !== 0) process.exit(1);

  MUTATIONS.forEach(([what, file, from, to], i) => {
    const dir = path.join(base, `m${i + 1}`);
    copyRepo(dir);
    const target = path.join(dir, file);
    const src = fs.readFileSync(target, 'utf8');
    if (src.split(from).length !== 2) throw new Error(`Mutation ${i + 1}: text not found exactly once in ${file}`);
    fs.writeFileSync(target, src.replace(from, to));
    const r = runTests(dir);
    const caught = r.code !== 0;
    rows.push({ n: i + 1, what, file, caught, failed: r.failed });
    console.log(`${String(i + 1).padStart(2)}. ${caught ? 'CAUGHT ' : 'MISSED '} ${what}${r.failed ? ` (${r.failed} test(s) failed)` : ''}`);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

const caught = rows.filter((r) => r.caught).length;
console.log(`\n${caught} of ${rows.length} injected bugs were caught by a failing test.`);
const md = `# Mutation check: are deliberate bugs caught by the tests?

Generated by \`npm run eval:mutations\` on ${new Date().toISOString()}. Each row copies the repository, injects ONE bug,
runs the full offline test suite, and records whether at least one test failed. The baseline run (no bug) passes.

| # | Bug injected | File | Caught | Tests failed |
|---|---|---|---|---|
${rows.map((r) => `| ${r.n} | ${r.what} | \`${r.file}\` | ${r.caught ? 'yes' : '**no**'} | ${r.failed ?? '-'} |`).join('\n')}

**Result: ${caught} of ${rows.length} injected bugs were caught.**
`;
fs.writeFileSync(path.join(root, 'examples', 'mutation-results.md'), md);
console.log('Saved examples/mutation-results.md');
process.exit(caught === rows.length ? 0 : 1);

// scripts/make-examples.js — regenerates examples/sample-*.{json,md} from the built-in SAMPLE data.
// No API key, network or Adobe account needed.   npm run examples
process.env.RAG_EMBEDDER = process.env.RAG_EMBEDDER || 'mock';
process.env.RAG_TRACE_LOG = 'false';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const register = require(path.join(root, 'audit', 'routes'));
const { createMockSource } = require(path.join(root, 'audit', 'mock-data'));

const NOW = new Date('2026-11-22T12:00:00Z'); // fixed so the sample output is reproducible
const routes = {};
const reg = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
register({ get: reg('GET'), post: reg('POST') }, (q, s, n) => n(), { source: createMockSource(() => NOW), now: () => NOW });
const call = async (key, body) => {
  const res = { body: null, status() { return this; }, json(o) { this.body = o; return this; }, type() { return this; }, send(x) { this.body = x; return this; } };
  await routes[key]({ body }, res);
  return res.body;
};

(async () => {
  const out = path.join(root, 'examples');
  const write = (f, o) => fs.writeFileSync(path.join(out, f), typeof o === 'string' ? o : JSON.stringify(o, null, 2) + '\n');
  const audit = await call('POST /api/audit/run', { dataViewId: 'dv_sample0001' });
  write('sample-audit-run.json', audit);
  const plan = {
    name: 'sample-web-export', feedType: 'live', frequency: 'hourly', startDate: '2026-11-21', lookbackDays: 14,
    columns: ['Page Name', 'Marketing Channel', 'variables/campaign', 'Page Nmae', 'Day', 'Events', 'User Agent', 'Browser', 'Region'],
  };
  write('sample-feed-plan.input.json', { dataViewId: 'dv_sample0001', plan });
  const fp = await call('POST /api/audit/feed-plan', { dataViewId: 'dv_sample0001', plan });
  write('sample-feed-plan.output.json', fp);
  write('sample-report.md', await call('POST /api/audit/markdown', { audit, plan: fp }));
  console.log(`Wrote examples/ (audit: ${JSON.stringify(audit.counts)}, plan: ${JSON.stringify(fp.counts)})`);
})().catch((e) => { console.error(e); process.exit(1); });

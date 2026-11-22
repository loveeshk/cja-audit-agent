'use strict';
// The keyword (BM25) channel is independent of the embedding model, so it is tested for real here.
process.env.RAG_EMBEDDER = 'mock';
const test = require('node:test');
const assert = require('node:assert');
const rag = require('../rag');

test.before(async () => { await rag.init(); });

const rankedSections = (q) => {
  const chunks = rag.getChunks();
  return rag.bm25(q).map((s, i) => ({ s, section: chunks[i].section })).sort((a, b) => b.s - a.s);
};

test('tokenizer drops filler words, keeps meaningful ones, and matches word forms', () => {
  const t = rag.tokenize('Which columns cannot be included in a CJA data feed?');
  assert.ok(!t.includes('which') && !t.includes('be') && !t.includes('in'));
  for (const w of ['column', 'cannot', 'cja', 'data', 'feed']) assert.ok(t.includes(w), w);
  assert.deepStrictEqual(rag.tokenize('included'), rag.tokenize('include'));
  assert.deepStrictEqual(rag.tokenize('includes'), rag.tokenize('including'));
  assert.deepStrictEqual(rag.tokenize('feed'), ['feed']); // short words are not mangled
  assert.ok(rag.tokenize('parentDataGroupId').includes('parent')); // camelCase is split
});

test('wording that embeddings blur is found by keywords: "cannot be included" finds the unavailable-columns section', () => {
  const top = rankedSections('Which columns cannot be included in a CJA data feed?').slice(0, 4).map((x) => x.section);
  assert.ok(top.some((s) => /Columns that are not available in a feed/.test(s)), top.join(' | '));
});

test('a rare exact word dominates: SFTP finds the destinations section first', () => {
  const top = rankedSections('Can CJA data feeds be delivered over SFTP?')[0];
  assert.match(top.section, /Backfill window and destinations/);
});

test('a question with no shared words scores zero everywhere', () => {
  assert.ok(rag.bm25('zzqq xxjj kkvv').every((s) => s === 0));
});

test('keyword overlap alone can never pass the "not covered" gate', async () => {
  // Even with the keyword weight turned far up, a high threshold on meaning still refuses.
  const r = await rag.retrieve('Which columns cannot be included in a CJA data feed?', { lexWeight: 50, minScore: 0.99 });
  assert.strictEqual(r.hits.length, 0);
  assert.ok(r.candidates.length > 0); // the candidates were found, they just did not clear the gate
});

test('keyword-only mode orders by keyword score, and every trace row exposes both scores', async () => {
  const r = await rag.retrieve('Can CJA data feeds be delivered over SFTP?', { mode: 'keyword', minScore: -1 });
  assert.match(r.candidates[0].section, /Backfill window and destinations/);
  for (const c of r.candidates) {
    assert.ok(typeof c.semantic === 'number' && typeof c.lexical === 'number' && c.lexical >= 0 && c.lexical <= 1);
  }
  assert.strictEqual(r.candidates[0].lexical, 1);
});

test('semantic-only mode ignores the keyword weight', async () => {
  const a = await rag.retrieve('delivered over SFTP', { mode: 'semantic', minScore: -1 });
  const b = await rag.retrieve('delivered over SFTP', { mode: 'semantic', lexWeight: 5, minScore: -1 });
  assert.deepStrictEqual(a.candidates.map((c) => c.id), b.candidates.map((c) => c.id));
});

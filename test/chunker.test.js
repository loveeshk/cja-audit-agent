'use strict';
process.env.RAG_EMBEDDER = 'mock';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chunkMarkdown, CONFIG, extractIdentifiers } = require('../rag');

const md = fs.readFileSync(path.join(__dirname, '..', 'knowledge.md'), 'utf-8');
const chunks = chunkMarkdown(md);
const lineCount = md.split(/\r?\n/).length;

test('produces a sensible number of chunks', () => {
  assert.ok(chunks.length > 30, `only ${chunks.length} chunks`);
});

test('housekeeping text marked "(not indexed)" is never retrieved', () => {
  assert.ok(md.includes('(not indexed)'));
  assert.ok(!chunks.some((c) => /not indexed|CJA reference notes for the audit assistant/i.test(c.section)));
  const doc = chunkMarkdown('# Intro (not indexed)\n\n' + Array(30).fill('word').join(' ') + '\n\n# Real\n\n' + Array(30).fill('text').join(' ') + '\n');
  assert.deepStrictEqual(doc.map((c) => c.section), ['Real']);
});

test('every chunk carries its heading path and body', () => {
  for (const c of chunks) {
    assert.ok(c.section && c.section.length > 0);
    assert.ok(c.text.startsWith(c.section));
    assert.ok(c.body.trim().length > 0);
  }
});

test('Adobe documentation chunks keep their source URL for citation', () => {
  const docTops = ['Data feeds overview', 'Comparing CJA', 'Creating a data feed', 'Connections', 'Data views', 'API access'];
  const docChunks = chunks.filter((c) => docTops.some((t) => c.section.startsWith(t)));
  assert.ok(docChunks.length > 20);
  for (const c of docChunks) assert.ok(/Source: (https?:\/\/|this project)/.test(c.body), `no Source line in: ${c.section}`);
});

test('audit tool notes are separate, labelled chunks (not mixed into documentation)', () => {
  const notes = chunks.filter((c) => c.section.includes('Audit tool note'));
  assert.ok(notes.length >= 15);
  for (const c of notes) assert.ok(!/Source: https/.test(c.body), `tool note should not claim an Adobe source: ${c.section}`);
});

test('each section stays on its own topic', () => {
  const na = chunks.find((c) => /Columns that are not available/.test(c.section));
  assert.ok(na, 'missing "not available" chunk');
  assert.ok(na.body.includes('Weekend/Weekday') && na.body.includes('Session Starts'));
  assert.ok(!na.body.includes('Processing delay'));
  const look = chunks.find((c) => /Lookback date range/.test(c.section));
  assert.ok(look.body.includes('30 days'));
});

test('chunks respect the size limit (allowing one oversized paragraph)', () => {
  for (const c of chunks) assert.ok(c.words <= CONFIG.maxWords * 2, `${c.section} has ${c.words} words`);
});

test('line ranges point inside the source file', () => {
  for (const c of chunks) {
    const [a, b] = c.lines.split('-').map(Number);
    assert.ok(a >= 1 && b <= lineCount && a <= b, c.lines);
  }
});

test('long sections are split with overlap, short ones are not', () => {
  const small = chunkMarkdown('# A\n\n' + Array(40).fill('word').join(' ') + '\n', { maxWords: 100 });
  assert.strictEqual(small.length, 1);
  const paras = Array.from({ length: 10 }, (_, i) => `para${i} ` + Array(30).fill('w').join(' ')).join('\n\n');
  const big = chunkMarkdown('# A\n\n' + paras + '\n', { maxWords: 100, overlapWords: 30 });
  assert.ok(big.length > 1);
  const lastOfFirst = big[0].body.split('\n').pop().split(' ')[0];
  assert.ok(big[1].body.includes(lastOfFirst));
});

test('fenced code is not mistaken for headings', () => {
  const doc = '# Title\n\nSome intro text that is long enough to be indexed on its own here.\n\n```\n# not a heading\nconsole.log(1)\n```\n';
  const out = chunkMarkdown(doc);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].body.includes('# not a heading'));
});

test('identifier extraction finds API fields and finding ids', () => {
  const ids = extractIdentifiers('what is parentDataGroupId and conn.no-event-dataset and web.thing');
  assert.ok(ids.includes('parentdatagroupid'));
  assert.ok(ids.includes('conn.no-event-dataset'));
});

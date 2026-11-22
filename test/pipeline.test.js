'use strict';
process.env.RAG_EMBEDDER = 'mock';
process.env.RAG_TRACE_LOG = 'false';
const test = require('node:test');
const assert = require('node:assert');
const rag = require('../rag');
const { answerMessages, NOT_COVERED } = require('../core');

function fakeClient() {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        return { content: [{ type: 'text', text: 'stub answer' }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  };
}
const base = (client, query, mode = 'rag', extra = []) => ({
  client, model: 'm', maxTokens: 100, mode,
  messages: [...extra, { role: 'user', content: query }],
});

// This test runs first, before the index exists.
test('falls back to the full notes when the index is unavailable', async () => {
  const client = fakeClient();
  const r = await answerMessages(base(client, 'hasData dimension'));
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.fallbackReason, 'retrieval index unavailable');
  assert.ok(client.calls[0].system.includes('--- REFERENCE NOTES ---'));
});

test('index builds', async () => {
  const info = await rag.init();
  assert.ok(info.ready && info.chunks > 30);
});

test('rag mode sends excerpts, not the whole notes', async () => {
  const full = (await answerMessages(base(fakeClient(), 'x', 'full'))).system.length;
  const client = fakeClient();
  const r = await answerMessages(base(client, 'what does the hasData field tell me about a dimension'));
  const sys = client.calls[0].system;
  assert.strictEqual(r.mode, 'rag');
  assert.ok(sys.includes('--- RETRIEVED EXCERPTS ---'));
  assert.ok(sys.includes('Dimensions and metrics API fields'));
  assert.ok(sys.length < full / 2, `rag prompt ${sys.length} vs full ${full}`);
  assert.ok(r.sources.length >= 1 && r.sources.length <= rag.CONFIG.k);
});

test('an identifier in the question pulls in the exact chunk', async () => {
  const r = await rag.retrieve('what is parentDataGroupId');
  assert.ok(r.hits.some((h) => /Data views API fields/.test(h.section)));
});

test('a finding id retrieves its own audit tool note', async () => {
  const r = await rag.retrieve('conn.import-new-data-off New data is not being imported', { k: 2 });
  assert.ok(r.hits.some((h) => /conn\.import-new-data-off/.test(h.section)), r.hits.map((h) => h.section).join(' | '));
});

test('no match: the model is not called and the user is told it is not covered', async () => {
  const client = fakeClient();
  const r = await answerMessages(base(client, 'zzqq xxjj kkvv'));
  assert.strictEqual(client.calls.length, 0);
  assert.strictEqual(r.modelCalled, false);
  assert.strictEqual(r.answer, NOT_COVERED);
  assert.deepStrictEqual(r.sources, []);
});

test('short follow-ups borrow the previous question for retrieval', async () => {
  const r = await rag.retrieve('what about backfill?', { previousQuery: 'can a live feed start in the past' });
  assert.ok(r.retrievalQuery.includes('live feed start'));
  const alone = await rag.retrieve('what about backfill?');
  assert.strictEqual(alone.retrievalQuery, 'what about backfill?');
});

test('none mode sends no notes at all', async () => {
  const client = fakeClient();
  await answerMessages(base(client, 'anything', 'none'));
  const sys = client.calls[0].system;
  assert.ok(!sys.includes('REFERENCE NOTES') && !sys.includes('RETRIEVED EXCERPTS'));
});

test('conversation history is passed through to the model', async () => {
  const client = fakeClient();
  await answerMessages(base(client, 'what about backfill?', 'rag', [
    { role: 'user', content: 'can a live feed start in the past' },
    { role: 'assistant', content: 'earlier answer' },
  ]));
  assert.strictEqual(client.calls[0].messages.length, 3);
});

test('no API key: the full prompt with the retrieved excerpts is returned for manual use', async () => {
  const r = await answerMessages({ client: null, model: 'm', maxTokens: 1, mode: 'rag', messages: [{ role: 'user', content: 'what does the hasData field tell me about a dimension' }] });
  assert.strictEqual(r.modelCalled, false);
  assert.ok(r.manualPrompt.includes('--- RETRIEVED EXCERPTS ---'));
  assert.ok(r.manualPrompt.includes('--- USER MESSAGE ---'));
  assert.ok(r.manualPrompt.includes('what does the hasData field'));
  assert.ok(r.answer.includes('No ANTHROPIC_API_KEY'));
  assert.ok(r.sources.length >= 1);
});

test('no API key and nothing relevant: still told the notes do not cover it, no prompt offered', async () => {
  const r = await answerMessages({ client: null, model: 'm', maxTokens: 1, mode: 'rag', messages: [{ role: 'user', content: 'zzqq xxjj kkvv' }] });
  assert.strictEqual(r.answer, NOT_COVERED);
  assert.strictEqual(r.manualPrompt, undefined);
});

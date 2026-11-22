// scripts/trace-table.js — prints the retrieval trace for one question as paste-ready Markdown.
// Needs no API key. Uses the same retrieval as the app, with the real embedding model.
//   npm run rag:table -- "Which columns cannot be included in a CJA data feed?"
// For a follow-up, add the previous question:  npm run rag:table -- "What about backfill?" --prev "Can a live feed start in the past?"

try { require('dotenv').config(); } catch (_) {}
const rag = require('../rag');

const args = process.argv.slice(2);
const prevAt = args.indexOf('--prev');
const previousQuery = prevAt >= 0 ? args.splice(prevAt, 2)[1] : undefined;
const question = args.join(' ').trim();

(async () => {
  if (!question) { console.error('Usage: npm run rag:table -- "your question"'); process.exit(1); }
  const info = await rag.init();
  const r = await rag.retrieve(question, { previousQuery });
  const urlOf = (body) => (/Source:\s*(\S+)/.exec(body) || [])[1];
  const chunkById = new Map(rag.getChunks().map((c) => [c.id, c]));

  if (info.embedder === 'mock') console.log('> MOCK EMBEDDER: plumbing check only. Do not use these numbers as evidence.\n');
  console.log(`Question: ${question}${previousQuery ? `  (follow-up to: ${previousQuery})` : ''}\n`);

  if (!r.hits.length) {
    console.log(`The agent embedded the question and no chunk reached the similarity threshold of ${r.params.minScore}, so the model was not called and the user was told the notes do not cover it.\n`);
  } else {
    console.log(`The agent embedded the question and retrieved ${r.hits.length} chunk${r.hits.length > 1 ? 's' : ''} above the similarity threshold of ${r.params.minScore}:\n`);
    console.log('| # | Similarity score | Keyword score | Section heading | Source URL |\n|---|---|---|---|---|');
    r.hits.forEach((h) => {
      console.log(`| ${h.n} | ${h.semantic} | ${h.lexical} | ${h.section} | ${urlOf(h.body) || 'none (audit tool note, not Adobe documentation)'} |`);
    });
  }

  const returned = new Set(r.hits.map((h) => h.id));
  console.log(`\nAll ${r.candidates.length} candidates examined (ranked by similarity plus keyword score; the top ${r.params.k} whose similarity reaches the threshold were returned):\n`);
  console.log('| Rank | Combined | Similarity | Keyword | Section heading | Returned |\n|---|---|---|---|---|---|');
  r.candidates.forEach((c, i) => console.log(`| ${i + 1} | ${c.score} | ${c.semantic} | ${c.lexical} | ${c.section} | ${returned.has(c.id) ? 'yes' : 'no'} |`));
  console.log(`\nRetrieval query used: "${r.retrievalQuery}"`);
})().catch((e) => { console.error(e.message); process.exit(1); });

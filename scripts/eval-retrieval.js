// scripts/eval-retrieval.js — measures retrieval quality on eval/questions.json
// Run:  npm run rag:eval
// Needs no API key (it only uses the embedding model).
//
// It compares three ways of ranking the notes for every question:
//   semantic = embeddings only      keyword = BM25 word matching only      hybrid = both (what the app uses)
// then sweeps the keyword weight so the setting can be chosen from measurements.

try { require('dotenv').config(); } catch (_) { /* dotenv optional here */ }
const fs = require('fs');
const path = require('path');
const rag = require('../rag');
const set = require('../eval/questions.json');

const matches = (section, expect) => expect.some((e) => section.toLowerCase().includes(e.toLowerCase()));

(async () => {
  const info = await rag.init();
  const mock = info.embedder === 'mock';
  const all = rag.getChunks().length;
  const K = rag.CONFIG.k;

  console.log(`Index: ${info.chunks} chunks, avg ${info.avgWords} words, max ${info.maxWords} (embedder: ${info.embedder})`);
  console.log(`Settings: k=${K}, candidates=${rag.CONFIG.candidates}, threshold=${rag.CONFIG.minScore}, keyword weight=${rag.CONFIG.lexWeight}`);
  if (mock) console.log('*** MOCK EMBEDDER: semantic and hybrid numbers are NOT evidence (keyword-only numbers are real). ***');

  const sections = rag.getChunks().map((c) => c.section);
  for (const item of set.inScope) {
    if (!sections.some((s) => matches(s, item.expect))) {
      console.warn(`WARNING: no chunk section matches expectation ${JSON.stringify(item.expect)} for "${item.q}"`);
    }
  }

  // rank of the first expected section for one question under one setting
  async function rankOf(item, opts) {
    const r = await rag.retrieve(item.q, { previousQuery: item.prev, candidates: all, minScore: -1, ...opts });
    const idx = r.candidates.findIndex((c) => matches(c.section, item.expect));
    return { rank: idx === -1 ? null : idx + 1, cand: r.candidates, matched: idx === -1 ? null : r.candidates[idx] };
  }
  const summarize = (ranks) => {
    const n = ranks.length;
    const at = (k) => ranks.filter((r) => r !== null && r <= k).length;
    return { n, h1: at(1), hk: at(K), h8: at(8), mrr: ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / n };
  };
  const line = (label, s) => `  ${label.padEnd(26)} hit@1 ${String(s.h1).padStart(2)}/${s.n}   hit@${K} ${String(s.hk).padStart(2)}/${s.n}   hit@8 ${String(s.h8).padStart(2)}/${s.n}   MRR ${s.mrr.toFixed(3)}`;

  // 1. per question, three rankings
  const rows = [];
  for (const item of set.inScope) {
    const sem = await rankOf(item, { mode: 'semantic' });
    const kw = await rankOf(item, { mode: 'keyword' });
    const hy = await rankOf(item, { mode: 'hybrid' });
    rows.push({ q: item.q, sem: sem.rank, kw: kw.rank, hy: hy.rank, hybridMatched: hy.matched, semMatched: sem.matched, hybridTop: hy.cand[0] });
  }
  console.log('\nRANK OF THE CORRECT SECTION (lower is better, - means not found)');
  console.log('  semantic | keyword | hybrid | question');
  for (const r of rows) console.log(`  ${String(r.sem ?? '-').padStart(8)} | ${String(r.kw ?? '-').padStart(7)} | ${String(r.hy ?? '-').padStart(6)} | ${r.q}`);

  const sSem = summarize(rows.map((r) => r.sem));
  const sKw = summarize(rows.map((r) => r.kw));
  const sHy = summarize(rows.map((r) => r.hy));
  console.log('\nSUMMARY');
  console.log(line('semantic only', sSem));
  console.log(line('keyword only', sKw));
  console.log(line(`hybrid (weight ${rag.CONFIG.lexWeight})`, sHy));

  // 2. keyword weight sweep
  console.log('\nKEYWORD WEIGHT SWEEP (hybrid)');
  const sweep = [];
  for (const w of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0]) {
    const ranks = [];
    for (const item of set.inScope) ranks.push((await rankOf(item, { mode: 'hybrid', lexWeight: w })).rank);
    const s = summarize(ranks);
    sweep.push({ w, ...s });
    console.log(line(`weight ${w}`, s));
  }
  const best = sweep.reduce((a, b) => (b.mrr > a.mrr + 1e-9 ? b : a), sweep[0]);
  console.log(`  Highest MRR at weight ${best.w}. With only ${set.inScope.length} questions, prefer a middle value in a flat region over a sharp peak.`);

  // 3. out-of-scope questions and the threshold (the gate uses semantic similarity only)
  const outRows = [];
  for (const q of set.outOfScope) {
    const r = await rag.retrieve(q, { candidates: 1, minScore: -1, mode: 'hybrid' });
    outRows.push({ q, topSemantic: r.candidates[0].semantic, topSection: r.candidates[0].section });
  }
  console.log('\nOUT-OF-SCOPE QUESTIONS (should be refused: their semantic score should be below the threshold)');
  for (const r of outRows) console.log(`  top semantic ${String(r.topSemantic).padEnd(6)} | ${r.q}  -> ${r.topSection}`);

  const inScores = rows.filter((r) => r.hybridMatched).map((r) => r.hybridMatched.semantic);
  const minIn = Math.min(...inScores);
  const maxOut = Math.max(...outRows.map((r) => r.topSemantic));
  const t = rag.CONFIG.minScore;
  console.log(`\nTHRESHOLD (current RAG_MIN_SCORE = ${t})`);
  console.log(`  lowest semantic score of a correct section : ${minIn}`);
  console.log(`  highest semantic score of an out-of-scope question: ${maxOut}`);
  if (minIn > maxOut) console.log(`  Separable. A threshold near ${((minIn + maxOut) / 2).toFixed(2)} splits the two groups on this set.`);
  else console.log('  NOT cleanly separable: the two ranges overlap. Lower = fewer wrongly refused questions, higher = fewer answers built on weak matches.');
  console.log(`  correct sections wrongly refused at ${t}: ${inScores.filter((s) => s < t).length}/${inScores.length}`);
  console.log(`  out-of-scope questions wrongly answered at ${t}: ${outRows.filter((r) => r.topSemantic >= t).length}/${outRows.length}`);

  fs.writeFileSync(path.join(__dirname, '..', 'eval', 'last-run.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), info, settings: { k: K, minScore: t, lexWeight: rag.CONFIG.lexWeight }, semantic: sSem, keyword: sKw, hybrid: sHy, sweep, rows, outRows }, null, 2));
  console.log('\nSaved eval/last-run.json');
})().catch((e) => { console.error(e); process.exit(1); });

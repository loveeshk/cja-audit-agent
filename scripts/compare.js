// scripts/compare.js — runs the SAME question in three modes and saves the evidence
//   none = Claude alone (no document)   full = whole notes in the prompt   rag = retrieved chunks only
// Run:  npm run rag:compare                      (uses the questions in eval/questions.json)
//       npm run rag:compare -- "your question"   (or your own question)
// Needs ANTHROPIC_API_KEY in .env

try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const rag = require('../rag');
const { answerMessages } = require('../core');
const set = require('../eval/questions.json');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 1500;

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const info = await rag.init();
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(' ')] : set.compare;

  let md = `# Retrieval comparison\n\nRun: ${new Date().toISOString()}  \nModel: ${MODEL}  \nIndex: ${info.chunks} chunks, embedder ${info.embedder}, k=${info.config.k}, threshold=${info.config.minScore}\n`;
  if (info.embedder === 'mock') md += '\n> MOCK EMBEDDER: plumbing check only, not evidence.\n';

  for (const q of questions) {
    md += `\n---\n\n## Question: ${q}\n`;
    for (const mode of ['none', 'full', 'rag']) {
      const r = await answerMessages({ client, model: MODEL, maxTokens: MAX_TOKENS, messages: [{ role: 'user', content: q }], mode });
      const tokens = r.usage ? `${r.usage.input_tokens} input tokens` : 'n/a (model not called)';
      md += `\n### Mode: ${mode}  (${tokens})\n\n${r.answer}\n`;
      if (mode === 'rag' && r.retrieval) {
        md += `\n**Retrieval trace** (query used: "${r.retrieval.retrievalQuery}")\n\n| # | Score | Section | Notes lines | Returned |\n|---|---|---|---|---|\n`;
        const returned = new Set(r.retrieval.hits.map((h) => h.id));
        r.retrieval.candidates.forEach((c) => {
          md += `| ${c.n} | ${c.score} | ${c.section} | ${c.lines} | ${returned.has(c.id) ? 'yes' : 'no'} |\n`;
        });
        if (!r.modelCalled) md += '\nNo chunk passed the threshold, so the model was not called.\n';
      }
      console.log(`done: ${mode} — ${q}`);
    }
  }
  const out = path.join(__dirname, '..', 'eval', `compare-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(out, md);
  console.log(`\nSaved ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });

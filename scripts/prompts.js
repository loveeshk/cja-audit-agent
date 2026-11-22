// scripts/prompts.js — builds the three prompts for the with/without-retrieval comparison WITHOUT an API key.
// Paste each prompt into a NEW chat with Claude (claude.ai), copy the answers back into the file, and you have the
// same comparison that `npm run rag:compare` makes automatically.
//   npm run rag:prompts                      (questions from eval/questions.json)
//   npm run rag:prompts -- "your question"

try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const rag = require('../rag');
const { answerMessages } = require('../core');
const set = require('../eval/questions.json');

(async () => {
  const info = await rag.init();
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(' ')] : set.compare;
  let md = `# Manual retrieval comparison (no API key)\n\nCreated: ${new Date().toISOString()}  \nIndex: ${info.chunks} chunks, embedder ${info.embedder}, k=${info.config.k}, threshold=${info.config.minScore}\n\n`;
  md += `How to use: for each question, paste Prompt A, then Prompt B, then Prompt C into **separate new chats** with Claude and paste each answer under it.\n`;
  md += `Caveat to state in your write-up: claude.ai adds its own instructions and may use memory, so answers can differ from an API call. The retrieved excerpts and the retrieval trace are produced by this tool and are not affected.\n`;
  if (info.embedder === 'mock') md += '\n> MOCK EMBEDDER: plumbing check only, not evidence.\n';

  for (const q of questions) {
    md += `\n---\n\n## Question: ${q}\n`;
    const labels = { none: 'A: no notes (Claude alone)', full: 'B: all notes in the prompt', rag: 'C: retrieved chunks only' };
    for (const mode of ['none', 'full', 'rag']) {
      const r = await answerMessages({ client: null, model: 'n/a', maxTokens: 0, messages: [{ role: 'user', content: q }], mode });
      md += `\n### Prompt ${labels[mode]}\n`;
      if (r.manualPrompt) {
        md += `\n\`\`\`text\n${r.manualPrompt}\n\`\`\`\n`;
        md += `\nApprox. prompt size: ${r.manualPrompt.length.toLocaleString()} characters\n`;
      } else {
        md += `\nNo chunk passed the threshold, so the tool would not call the model. Answer shown to the user: ${r.answer}\n`;
      }
      if (mode === 'rag' && r.retrieval) {
        md += `\n**Retrieval trace** (query used: "${r.retrieval.retrievalQuery}")\n\n| # | Score | Section | Notes lines | Returned |\n|---|---|---|---|---|\n`;
        const returned = new Set(r.retrieval.hits.map((h) => h.id));
        r.retrieval.candidates.forEach((c) => { md += `| ${c.n} | ${c.score} | ${c.section} | ${c.lines} | ${returned.has(c.id) ? 'yes' : 'no'} |\n`; });
      }
      md += `\n**Answer from Claude (paste here):**\n\n> \n`;
    }
  }
  const out = path.join(__dirname, '..', 'eval', 'manual-compare.md');
  fs.writeFileSync(out, md);
  console.log(`Saved ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });

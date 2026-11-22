// rag.js — semantic retrieval over knowledge.md
//
// Pipeline:  knowledge.md -> heading-aware chunks -> local embeddings -> cached index
//            query -> embedding -> cosine similarity (+ small identifier boost)
//            -> top candidates -> similarity threshold -> top-k chunks
//
// No external package is needed to import this file. The embedding model
// (@xenova/transformers) is loaded lazily, only when an index is built or a
// query is embedded. Set RAG_EMBEDDER=mock to run tests offline.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration (every value can be overridden from .env)
// ---------------------------------------------------------------------------
const CONFIG = {
  // all-MiniLM-L6-v2 was trained on inputs of up to ~256 word-pieces, and code
  // tokenizes into many pieces, so chunks are kept small (about 180 words).
  maxWords: Number(process.env.RAG_CHUNK_WORDS) || 180,
  overlapWords: Number(process.env.RAG_OVERLAP_WORDS) || 30,
  minWords: 12, // sections with less body text than this are not indexed alone
  k: Number(process.env.RAG_TOP_K) || 4, // chunks sent to the model
  candidates: Number(process.env.RAG_CANDIDATES) || 8, // chunks examined before the threshold
  minScore: process.env.RAG_MIN_SCORE !== undefined && process.env.RAG_MIN_SCORE !== ''
    ? Number(process.env.RAG_MIN_SCORE)
    : 0.3,
  model: process.env.RAG_EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2',
  embedder: process.env.RAG_EMBEDDER || 'transformers', // 'transformers' | 'mock'
  lexWeight: process.env.RAG_LEX_WEIGHT !== undefined && process.env.RAG_LEX_WEIGHT !== '' ? Number(process.env.RAG_LEX_WEIGHT) : 0.5, // weight of the keyword (BM25) score added to the semantic score; 0.5 = middle of the flat 0.4-0.75 region in the rag:eval sweep
  identifierBoost: 0.12, // added when the query names an identifier found in few chunks
  rareIdentifierMaxChunks: 6,
  shortQueryWords: 8, // shorter queries are treated as follow-ups
};

const state = {
  ready: false,
  chunks: [],
  buildMs: 0,
  loadedFromCache: false,
  knowledgePath: null,
  lex: null,
};

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
const HEADING = /^(#{1,6})(?:[ \t]+(.*))?$/;
// A heading ending in "(not indexed)" marks housekeeping text (such as the file's introduction) that is
// kept in the file for readers but never embedded or retrieved.
const NOT_INDEXED = /\(not indexed\)\s*$/i;
// "Deployment Instructions ..." headings repeat under every event. They must
// stay inside their parent section, otherwise a chunk of code would not say
// which event it belongs to.
const NON_BOUNDARY = /^deployment instructions/i;

function countWords(s) {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

// Light cleanup that helps embeddings without touching code: drop table rules,
// reduce [text](url) links to their text.
function cleanLine(line) {
  if (/^[\s\-+=|:]+$/.test(line) && line.trim().length > 0) return '';
  return line.replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, '$1');
}

function toParagraphs(sectionLines) {
  const paras = [];
  let cur = null;
  for (const { text, no } of sectionLines) {
    const cleaned = cleanLine(text);
    if (!cleaned.trim()) {
      if (cur) { paras.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = { text: cleaned.trim(), start: no, end: no };
    else { cur.text += '\n' + cleaned.trim(); cur.end = no; }
  }
  if (cur) paras.push(cur);
  return paras.map((p) => ({ ...p, words: countWords(p.text) }));
}

function chunkMarkdown(md, opts = {}) {
  const maxWords = opts.maxWords ?? CONFIG.maxWords;
  const overlapWords = opts.overlapWords ?? CONFIG.overlapWords;
  const minWords = opts.minWords ?? CONFIG.minWords;

  const lines = md.split(/\r?\n/);
  const stack = []; // [{ level, title }]
  const sections = [];
  let cur = { path: [], lines: [] };
  sections.push(cur);
  let inFence = false;

  lines.forEach((line, i) => {
    const no = i + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : line.match(HEADING);
    if (m) {
      const title = (m[2] || '').replace(/\s*#+\s*$/, '').trim();
      if (!title) return; // empty heading line such as "####"
      if (NON_BOUNDARY.test(title)) { cur.lines.push({ text: line, no }); return; }
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      cur = { path: stack.map((s) => s.title), lines: [] };
      sections.push(cur);
      return;
    }
    cur.lines.push({ text: line, no });
  });

  const chunks = [];
  for (const sec of sections) {
    const paras = toParagraphs(sec.lines);
    const bodyWords = paras.reduce((n, p) => n + p.words, 0);
    if (bodyWords < minWords) continue;
    if (sec.path.some((t) => NOT_INDEXED.test(t))) continue;

    const breadcrumb = sec.path.length ? sec.path.join(' > ') : 'Document preamble';
    let win = [];
    let wcount = 0;
    let fresh = 0; // paragraphs in `win` not yet emitted

    const emit = () => {
      if (!win.length || !fresh) return;
      const body = win.map((p) => p.text).join('\n');
      chunks.push({
        id: `c${chunks.length}`,
        section: breadcrumb,
        lines: `${win[0].start}-${win[win.length - 1].end}`,
        body,
        text: `${breadcrumb}\n${body}`,
        words: wcount,
      });
    };

    for (const p of paras) {
      if (win.length && wcount + p.words > maxWords) {
        emit();
        const carry = [];
        let c = 0;
        for (let j = win.length - 1; j >= 0 && c < overlapWords; j--) {
          carry.unshift(win[j]);
          c += win[j].words;
        }
        win = carry;
        wcount = c;
        fresh = 0;
      }
      win.push(p);
      wcount += p.words;
      fresh += 1;
    }
    emit();
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', CONFIG.model);
    })();
  }
  return extractorPromise;
}

// Deterministic bag-of-words vector. For automated tests only: it checks the
// plumbing, it is NOT a semantic model and must not be used for evidence.
function mockEmbed(text, dims = 256) {
  const v = new Array(dims).fill(0);
  const tokens = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
  for (const t of tokens) {
    const h = crypto.createHash('md5').update(t).digest();
    v[h.readUInt16BE(0) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function embedTexts(texts) {
  if (CONFIG.embedder === 'mock') return texts.map((t) => mockEmbed(t));
  const extractor = await getExtractor();
  const out = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---------------------------------------------------------------------------
// Keyword channel (BM25). Embeddings match topics well but are weak on exact wording, so a word-matching
// score is added to the semantic score. Rare words ("cannot", "SFTP") count for more than common ones.
// ---------------------------------------------------------------------------
const STOP = new Set(('a an the of to in is are was were be been being can could do does did how what which why when where who whom ' +
  'i me my we our you your it its this that these those for and or on at by from with as if so than then there here into about over also ' +
  'should would will may might must').split(' '));

function stem(w) {
  if (w.length < 4) return w;
  const cut = (s, re) => { const t = s.replace(re, ''); return t.length >= 4 ? t : s; };
  return cut(cut(w, /(ing|ed)$/), /(es|s|e)$/);
}

function tokenize(text) {
  return (String(text).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((t) => !STOP.has(t))
    .map(stem);
}

function buildLexicalIndex() {
  const tf = [];
  const len = [];
  const df = new Map();
  for (const c of state.chunks) {
    const toks = [...tokenize(c.section), ...tokenize(c.section), ...tokenize(c.body)]; // headings count double
    const m = new Map();
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
    tf.push(m);
    len.push(toks.length);
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = tf.length;
  const avgdl = len.reduce((a, b) => a + b, 0) / (N || 1);
  const idf = new Map([...df].map(([t, d]) => [t, Math.log(1 + (N - d + 0.5) / (d + 0.5))]));
  state.lex = { tf, len, avgdl, idf };
}

// BM25 score of every chunk for a query, in chunk order. Zero where no query word appears.
function bm25(query) {
  const { tf, len, avgdl, idf } = state.lex;
  const q = [...new Set(tokenize(query))];
  const k1 = 1.2, b = 0.75;
  return tf.map((m, i) => {
    let s = 0;
    for (const t of q) {
      const f = m.get(t);
      if (!f) continue;
      s += (idf.get(t) || 0) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len[i]) / avgdl)));
    }
    return s;
  });
}

// ---------------------------------------------------------------------------
// Index build / load
// ---------------------------------------------------------------------------
async function init({ knowledgePath, cachePath } = {}) {
  const started = Date.now();
  knowledgePath = knowledgePath || path.join(__dirname, 'knowledge.md');
  cachePath = cachePath || path.join(__dirname, 'rag-index.json');

  const md = fs.readFileSync(knowledgePath, 'utf-8');
  const fingerprint = crypto
    .createHash('sha256')
    .update(md)
    .update(JSON.stringify([CONFIG.model, CONFIG.maxWords, CONFIG.overlapWords, CONFIG.minWords, CONFIG.embedder]))
    .digest('hex');

  state.ready = false;
  state.knowledgePath = knowledgePath;
  const useCache = CONFIG.embedder !== 'mock';

  if (useCache && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (cached.fingerprint === fingerprint && Array.isArray(cached.chunks)) {
        state.chunks = cached.chunks.map((c) => ({ ...c, lower: c.text.toLowerCase() }));
        state.loadedFromCache = true;
        buildLexicalIndex();
        state.buildMs = Date.now() - started;
        state.ready = true;
        return stats();
      }
    } catch (_) { /* rebuild below */ }
  }

  const chunks = chunkMarkdown(md);
  const vectors = await embedTexts(chunks.map((c) => c.text));
  state.chunks = chunks.map((c, i) => ({
    ...c,
    embedding: vectors[i].map((x) => Math.round(x * 1e5) / 1e5),
    lower: c.text.toLowerCase(),
  }));
  state.loadedFromCache = false;
  buildLexicalIndex();

  if (useCache) {
    const toSave = { fingerprint, chunks: state.chunks.map(({ lower, ...rest }) => rest) };
    try { fs.writeFileSync(cachePath, JSON.stringify(toSave)); } catch (e) {
      console.warn('Could not write RAG index cache:', e.message);
    }
  }
  state.buildMs = Date.now() - started;
  state.ready = true;
  return stats();
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------
// camelCase API fields (parentDataGroupId), dotted paths, and audit finding ids
// (conn.no-event-dataset). Exact names matter in technical notes and are
// where embedding models are weakest.
function extractIdentifiers(query) {
  const found = new Set();
  const dotted = query.match(/[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)+/g) || [];
  const camel = query.match(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g) || [];
  for (const t of [...dotted, ...camel]) found.add(t.toLowerCase());
  return [...found];
}

function buildRetrievalQuery(query, previousQuery) {
  if (previousQuery && countWords(query) < CONFIG.shortQueryWords) {
    return `${previousQuery} ${query}`;
  }
  return query;
}

async function retrieve(query, opts = {}) {
  if (!state.ready) throw new Error('RAG index is not ready');
  const k = opts.k ?? CONFIG.k;
  const candidates = opts.candidates ?? CONFIG.candidates;
  const minScore = opts.minScore ?? CONFIG.minScore;

  const retrievalQuery = buildRetrievalQuery(query, opts.previousQuery);
  const [qv] = await embedTexts([retrievalQuery]);

  const ids = extractIdentifiers(query).filter((t) => {
    const df = state.chunks.filter((c) => c.lower.includes(t)).length;
    return df > 0 && df <= CONFIG.rareIdentifierMaxChunks;
  });

  // mode: 'hybrid' (default), 'semantic' (embeddings only) or 'keyword' (BM25 only; used by the evaluation).
  const mode = opts.mode || 'hybrid';
  const lexWeight = mode === 'semantic' ? 0 : (opts.lexWeight ?? CONFIG.lexWeight);
  const lexRaw = bm25(retrievalQuery);
  const lexMax = Math.max(...lexRaw, 0);

  const scored = state.chunks
    .map((c, i) => {
      const semantic = dot(qv, c.embedding);
      const lexical = lexMax > 0 ? lexRaw[i] / lexMax : 0; // 0..1, the best keyword match is 1
      const boosted = ids.some((t) => c.lower.includes(t));
      const idBoost = boosted ? CONFIG.identifierBoost : 0;
      const score = mode === 'keyword' ? lexical + 0.001 * semantic : semantic + idBoost + lexWeight * lexical;
      return { chunk: c, semantic, lexical, boosted, idBoost, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, candidates);

  const toTrace = (s, i) => ({
    n: i + 1,
    id: s.chunk.id,
    section: s.chunk.section,
    lines: s.chunk.lines,
    score: Number(s.score.toFixed(3)),
    semantic: Number(s.semantic.toFixed(3)),
    lexical: Number(s.lexical.toFixed(3)),
    boosted: s.boosted,
    words: s.chunk.words,
  });

  // The no-match threshold looks at meaning (plus an exact identifier match), never at keyword overlap alone,
  // so generic words like "data feed" cannot make an unrelated question look covered.
  const kept = scored.filter((s) => s.semantic + s.idBoost >= minScore).slice(0, k);
  return {
    retrievalQuery,
    params: { k, candidates, minScore },
    candidates: scored.map(toTrace), // everything examined, for traces and tuning
    hits: kept.map((s, i) => ({ ...toTrace(s, i), body: s.chunk.body })),
  };
}

function isReady() { return state.ready; }

function stats() {
  const words = state.chunks.map((c) => c.words);
  return {
    ready: state.ready,
    chunks: state.chunks.length,
    avgWords: words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0,
    maxWords: words.length ? Math.max(...words) : 0,
    buildMs: state.buildMs,
    loadedFromCache: state.loadedFromCache,
    embedder: CONFIG.embedder,
    model: CONFIG.model,
    config: { k: CONFIG.k, candidates: CONFIG.candidates, minScore: CONFIG.minScore,
      chunkWords: CONFIG.maxWords, overlapWords: CONFIG.overlapWords },
  };
}

function getChunks() { return state.chunks; }

module.exports = { CONFIG, tokenize, bm25, init, retrieve, isReady, stats, chunkMarkdown, getChunks, extractIdentifiers };

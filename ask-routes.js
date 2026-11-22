// ask-routes.js — "Ask the docs" and retrieval-inspection endpoints.
// Moved out of server.js so they can be tested and reused. Behaviour is unchanged except that /api/search now also
// returns a `trace` (every candidate the retriever examined, with scores) so the page can show why sources were chosen.

'use strict';

const rag = require('./rag');
const { answerMessages } = require('./core');

// Builds the compact trace shown in the page: every candidate examined, and which were returned.
function buildTrace(retrieval) {
  if (!retrieval) return null;
  const returned = new Set((retrieval.hits || []).map((h) => h.id));
  return {
    retrievalQuery: retrieval.retrievalQuery,
    params: retrieval.params,
    candidates: (retrieval.candidates || []).map((c, i) => ({
      rank: i + 1,
      section: c.section,
      lines: c.lines,
      semantic: c.semantic,
      keyword: c.lexical,
      combined: c.score,
      returned: returned.has(c.id),
    })),
  };
}

function registerAskRoutes(app, requireAuth, deps) {
  const { anthropic, model, maxTokens, pickMode } = deps;

  // Chat endpoint (used by the legacy floating widget)
  app.post('/api/chat', requireAuth, async (req, res) => {
    try {
      const { messages, mode } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages array is required' });
      }
      const result = await answerMessages({
        client: anthropic || null, model, maxTokens, messages, mode: pickMode(mode),
      });
      res.json({ reply: result.answer, sources: result.sources, manualPrompt: result.manualPrompt });
    } catch (err) {
      console.error('Chat error:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // "Ask the docs": the current query plus prior turns, so follow-ups keep their context.
  app.post('/api/search', requireAuth, async (req, res) => {
    try {
      const { query, history, mode } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'query is required' });
      }
      const priorMessages = Array.isArray(history)
        ? history.flatMap((turn) => [
            { role: 'user', content: turn.query },
            { role: 'assistant', content: turn.answer },
          ])
        : [];
      const messages = [...priorMessages, { role: 'user', content: query }];

      const result = await answerMessages({
        client: anthropic || null, model, maxTokens, messages, mode: pickMode(mode),
      });

      res.json({
        answer: result.answer,
        sources: result.sources,
        mode: result.mode,
        modelCalled: result.modelCalled,
        fallbackReason: result.fallbackReason,
        manualPrompt: result.manualPrompt,
        trace: buildTrace(result.retrieval),
      });
    } catch (err) {
      console.error('Search error:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // Retrieval inspection without calling the model.
  app.get('/api/rag/status', requireAuth, (req, res) => {
    res.json(rag.stats());
  });

  app.get('/api/rag/trace', requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'q is required' });
      if (!rag.isReady()) return res.status(503).json({ error: 'Retrieval index is not ready' });
      const prev = req.query.prev ? String(req.query.prev) : undefined;
      const r = await rag.retrieve(q, { previousQuery: prev });
      res.json({
        query: q,
        retrievalQuery: r.retrievalQuery,
        params: r.params,
        candidates: r.candidates,
        returned: r.hits.map(({ body, ...rest }) => rest),
      });
    } catch (err) {
      console.error('Trace error:', err);
      res.status(500).json({ error: 'Trace failed' });
    }
  });
}

module.exports = registerAskRoutes;
module.exports.buildTrace = buildTrace;

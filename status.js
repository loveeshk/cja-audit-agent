// status.js — a plain-language summary of how the app is currently running, for the status strip in the page.
// It reports modes and switches only. It never includes keys, secrets or credentials.

'use strict';

function buildStatus({ disableAuth, auditSource, hasAnthropicKey, model, ragStats, env = process.env }) {
  const live = auditSource === 'live';
  return {
    login: env.PUBLIC_DEMO === 'true'
      ? { enabled: false, publicDemo: true, label: 'Public demo', detail: 'Hosted demo: sample data only. Adobe access, feed creation and the Claude API are switched off on the server.' }
      : disableAuth
      ? { enabled: false, label: 'Login off', detail: 'Local mode: everyone is "Test User" and the server only accepts connections from this computer.' }
      : { enabled: true, label: 'Login on', detail: 'Signed in with Adobe single sign-on.' },
    data: live
      ? { source: 'live', label: 'Live CJA data', detail: 'Reading your real CJA data views with read-only requests.' }
      : { source: 'sample', label: 'Sample data', detail: 'Built-in sample data with deliberate problems. Not your environment.' },
    answers: hasAnthropicKey
      ? { mode: 'claude', label: 'Answers: Claude', detail: `Explanations and Q&A are written by Claude (${model}).` }
      : { mode: 'copy-prompt', label: 'Answers: copy-prompt mode', detail: 'No API key. The page gives you the exact prompt to paste into a chat with Claude.' },
    retrieval: ragStats && ragStats.ready
      ? { ready: true, label: `Retrieval: ${ragStats.chunks} chunks`, detail: `Embedder: ${ragStats.embedder}. Top ${ragStats.config.k} chunks, refusal threshold ${ragStats.config.minScore}, keyword weight ${ragStats.config.lexWeight ?? 'n/a'}.` }
      : { ready: false, label: 'Retrieval: using full notes', detail: 'The retrieval index is not available, so answers use the full notes.' },
    safety: {
      auditReadOnly: true,
      feedCreation: env.ALLOW_FEED_CREATION === 'true'
        ? { enabled: true, label: 'Feed creation: ON', detail: 'Creating classic data feeds is allowed. Each one needs your confirmation and is logged.' }
        : { enabled: false, label: 'Feed creation: off', detail: 'Creating feeds is turned off. The audit never changes anything in Adobe.' },
    },
  };
}

function registerStatusRoutes(app, requireAuth, deps) {
  const rag = require('./rag');
  app.get('/api/system-status', requireAuth, (req, res) => {
    res.json(buildStatus({
      disableAuth: deps.disableAuth,
      auditSource: deps.auditSource.source === 'live' ? 'live' : 'mock',
      hasAnthropicKey: Boolean(deps.hasAnthropicKey),
      model: deps.model,
      ragStats: rag.stats(),
    }));
  });
}

module.exports = registerStatusRoutes;
module.exports.buildStatus = buildStatus;

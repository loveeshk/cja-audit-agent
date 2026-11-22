// server.js — CJA audit + documentation assistant backend, with Adobe SSO (IMS) login

require('dotenv').config();
// Must run before anything reads the environment: a public demo removes every credential and the only write.
const { applyPublicDemo } = require('./demo-mode');
const PUBLIC_DEMO = applyPublicDemo(process.env);
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const registerFeedRoutes = require('./feeds-routes');
const registerCjaRoutes = require('./cja-routes');
const registerAuditRoutes = require('./audit/routes');
const registerAskRoutes = require('./ask-routes');
const registerStatusRoutes = require('./status');
const { chooseSource } = require('./audit/cja-client');
const { openBrowser } = require('./launcher');
const rag = require('./rag');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Sanity checks ---
// Login is OFF by default until Adobe SSO values are configured, so the tool can be tried locally
// without any setup. Set DISABLE_AUTH=false to force login on, or add the SSO values to .env.
const HAS_SSO = Boolean(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET && process.env.ADOBE_REDIRECT_URI);
const DISABLE_AUTH = process.env.DISABLE_AUTH === 'true' || (process.env.DISABLE_AUTH !== 'false' && !HAS_SSO);

// Only the login path needs these. A session secret is generated for each run when login is off.
const required = DISABLE_AUTH ? [] : ['ADOBE_CLIENT_ID', 'ADOBE_CLIENT_SECRET', 'ADOBE_REDIRECT_URI', 'SESSION_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Login is enabled but these .env values are missing: ${missing.join(', ')}. Add them, or set DISABLE_AUTH=true to run without login.`);
  process.exit(1);
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (PUBLIC_DEMO.enabled) {
  console.warn(`PUBLIC DEMO MODE: listening on all interfaces with sample data only. Adobe access, feed creation and the Claude API are disabled.${PUBLIC_DEMO.removed.length ? ` Ignored and removed: ${PUBLIC_DEMO.removed.join(', ')}.` : ''}`);
} else if (DISABLE_AUTH) {
  console.warn('Login is OFF: every visitor is treated as "Test User". The server listens on this computer only (127.0.0.1). Do not expose it to a network.');
}

if (process.env.ALLOW_FEED_CREATION === 'true' && DISABLE_AUTH) {
  console.warn('WARNING: feed creation is ON while login is OFF. Anyone who can open this page can create feeds in Adobe. Turn login on, or set ALLOW_FEED_CREATION=false.');
}

// Without an Anthropic key the audit checks still work. Explanations and Ask the docs report a clear message.
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
if (!anthropic) {
  console.warn('ANTHROPIC_API_KEY is not set: the audit checks work. "Explain findings" and "Ask the docs" will give you a ready-to-paste prompt to use in a chat with Claude (claude.ai).');
}

// --- Adobe IMS config ---
const IMS_HOST = process.env.ADOBE_IMS_HOST || 'https://ims-na1.adobelogin.com';
const IMS_AUTHORIZE_URL = `${IMS_HOST}/ims/authorize/v2`;
const IMS_TOKEN_URL = `${IMS_HOST}/ims/token/v3`;
const IMS_USERINFO_URL = `${IMS_HOST}/ims/userinfo/v2`;

// --- Retrieval (RAG) over knowledge.md (the CJA reference notes) ---
// The notes are split into heading-aware chunks, embedded locally, and the most
// relevant chunks are retrieved for each question and for each audit finding
// (see rag.js, core.js and audit/explain.js).
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 1500; // raised from 800 so long code answers are not cut off
const DEFAULT_MODE = ['rag', 'full'].includes(process.env.RAG_MODE) ? process.env.RAG_MODE : 'rag';
const RAG_DEBUG = process.env.RAG_DEBUG === 'true'; // lets a request choose mode: rag | full | none (for evidence/comparison)

function pickMode(requested) {
  if (RAG_DEBUG && ['rag', 'full', 'none'].includes(requested)) return requested;
  return DEFAULT_MODE;
}

// With login off, refuse cross-origin requests so other websites open in your browser cannot call this local server.
app.use(cors({ origin: DISABLE_AUTH ? false : true, credentials: true }));
app.use(express.json());

// --- Session setup ---
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // requires HTTPS once deployed
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (DISABLE_AUTH) {
    req.session.user = req.session.user || { name: 'Test User', email: 'test@local.dev' };
    return next();
  }

  if (req.session.user) return next();

  // For API calls, respond with 401 instead of a redirect so fetch() can handle it cleanly
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/auth/login');
}

// --- Data Feed Manager routes ---
registerFeedRoutes(app, requireAuth);

app.get('/feeds', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assistant.html'));
});

// --- CJA Report Builder routes ---
registerCjaRoutes(app, requireAuth);

// --- CJA Audit routes (read-only toward Adobe) ---
// One data source (sample or live) is chosen once and shared with the status endpoint.
const auditSource = chooseSource(registerCjaRoutes.cjaApiRequest);
registerAuditRoutes(app, requireAuth, {
  source: auditSource,
  cjaApiRequest: registerCjaRoutes.cjaApiRequest,
  anthropic,
  model: MODEL,
  maxTokens: MAX_TOKENS,
});


app.get('/report', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// --- Auth routes ---

// Kicks off the Adobe SSO flow
app.get('/auth/login', (req, res) => {
  if (DISABLE_AUTH) return res.redirect('/');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.ADOBE_CLIENT_ID,
    redirect_uri: process.env.ADOBE_REDIRECT_URI,
    scope: 'openid,AdobeID',
    state,
    response_type: 'code',
  });

  res.redirect(`${IMS_AUTHORIZE_URL}?${params.toString()}`);
});

// Adobe redirects back here after the user signs in
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid or missing OAuth state. Please try logging in again.');
  }
  delete req.session.oauthState;

  try {
    // Exchange the authorization code for an access token
    const tokenRes = await fetch(IMS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.ADOBE_CLIENT_ID,
        client_secret: process.env.ADOBE_CLIENT_SECRET,
        code,
        redirect_uri: process.env.ADOBE_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('IMS token exchange failed:', tokenData);
      return res.status(502).send('Login failed during token exchange. Please try again.');
    }

    // Fetch the user's profile
    const userRes = await fetch(`${IMS_USERINFO_URL}?client_id=${process.env.ADOBE_CLIENT_ID}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await userRes.json();
    if (!userRes.ok) {
      console.error('IMS userinfo fetch failed:', profile);
      return res.status(502).send('Login failed while fetching your profile. Please try again.');
    }

    // Store just what we need in the session — not the raw token
    req.session.user = {
      name: profile.name,
      email: profile.email,
    };

    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Something went wrong during login. Please try again.');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

// Lets the frontend check who's logged in
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// --- Protected routes ---

// "Ask the docs", the legacy chat widget endpoint, and retrieval inspection (see ask-routes.js)
registerAskRoutes(app, requireAuth, { anthropic, model: MODEL, maxTokens: MAX_TOKENS, pickMode });

// A plain-language summary of how the app is running, shown in the page's status strip (see status.js)
registerStatusRoutes(app, requireAuth, {
  disableAuth: DISABLE_AUTH,
  auditSource,
  hasAnthropicKey: Boolean(anthropic),
  model: MODEL,
});

// Main page — requires login, so serve it manually rather than via express.static
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assistant.html'));
});

// Widget assets stay public (no sensitive data in the JS/CSS itself)
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  try {
    const info = await rag.init();
    console.log(
      `RAG index ready: ${info.chunks} chunks (avg ${info.avgWords} words) in ${info.buildMs} ms` +
      `${info.loadedFromCache ? ' [from cache]' : ''} — embedder: ${info.embedder}`
    );
  } catch (err) {
    console.error('RAG index failed to build:', err.message);
    if (process.env.RAG_FALLBACK_FULL === 'false') process.exit(1);
    console.warn('Falling back to full-document mode for every request.');
  }

  const onListen = () => {
    console.log(`Audit data source: ${process.env.AUDIT_SOURCE || (process.env.ADOBE_S2S_CLIENT_ID ? 'live (credentials found)' : 'mock (sample data, no credentials)')}`);
    console.log(`Assistant running at http://localhost:${PORT}`);
    if (!DISABLE_AUTH) console.log(`Sign in at http://localhost:${PORT}/auth/login`);
    if (process.env.OPEN_BROWSER === 'true') openBrowser(`http://localhost:${PORT}`);
  };
  if (DISABLE_AUTH && !PUBLIC_DEMO.enabled) app.listen(PORT, '127.0.0.1', onListen);
  else app.listen(PORT, onListen);
}

start();

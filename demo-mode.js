// demo-mode.js — locks the app down for a public, read-only demo (PUBLIC_DEMO=true).
//
// Locally, with login off, the server listens on 127.0.0.1 only. A hosted demo must listen on all interfaces
// so a platform such as Render can reach it. That is only safe if nothing behind it can reach Adobe or spend money,
// so this runs before anything else reads the environment and REMOVES those capabilities instead of trusting
// that they were left unset:
//   - every Adobe credential is deleted, so neither the audit nor the feed and report builder tabs can reach Adobe
//   - feed creation is forced off (the only write in the codebase)
//   - the Anthropic key is deleted, so visitors get copy-prompt mode and cannot run up API costs
//   - the audit is forced to the labelled sample data
//   - login is off, because there is nothing private behind it
// It returns the list of what it removed, for the startup log (names only, never values).

'use strict';

const REMOVED_KEYS = [
  'ADOBE_S2S_CLIENT_ID', 'ADOBE_S2S_CLIENT_SECRET', 'ADOBE_S2S_SCOPES', 'ADOBE_ORG_ID', 'ADOBE_GLOBAL_COMPANY_ID',
  'ADOBE_CLIENT_ID', 'ADOBE_CLIENT_SECRET', 'ADOBE_REDIRECT_URI',
  'ANTHROPIC_API_KEY',
];

const isPublicDemo = (env = process.env) => env.PUBLIC_DEMO === 'true';

function applyPublicDemo(env = process.env) {
  if (!isPublicDemo(env)) return { enabled: false, removed: [] };
  const removed = REMOVED_KEYS.filter((k) => env[k] !== undefined && env[k] !== '');
  for (const k of REMOVED_KEYS) delete env[k];
  env.ALLOW_FEED_CREATION = 'false';
  env.AUDIT_SOURCE = 'mock';
  env.DISABLE_AUTH = 'true';
  return { enabled: true, removed };
}

module.exports = { applyPublicDemo, isPublicDemo, REMOVED_KEYS };

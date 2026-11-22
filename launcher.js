// launcher.js — opens the default browser once the server is ready (used by start.bat and start.sh).
// The command is built only from the platform name and a fixed local URL, never from user input.

'use strict';

const { exec } = require('child_process');

function browserCommand(platform, url) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url)) return null; // only ever our own local address
  if (platform === 'win32') return `start "" "${url}"`;
  if (platform === 'darwin') return `open "${url}"`;
  return `xdg-open "${url}"`;
}

function openBrowser(url, platform = process.platform) {
  const cmd = browserCommand(platform, url);
  if (!cmd) return false;
  exec(cmd, () => { /* if no browser can be opened, the printed address still works */ });
  return true;
}

module.exports = { browserCommand, openBrowser };

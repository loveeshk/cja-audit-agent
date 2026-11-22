#!/usr/bin/env bash
# Starts the CJA Audit Agent and opens it in your browser. Run: ./start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies. This can take a minute or two..."
  npm install || { echo "npm install failed. Read the messages above."; exit 1; }
fi

echo
echo "Starting the CJA Audit Agent. Your browser opens when it is ready."
echo "The first start downloads a small embedding model, so it can take a minute."
echo "Press Ctrl+C to stop it."
echo
OPEN_BROWSER=true exec node server.js

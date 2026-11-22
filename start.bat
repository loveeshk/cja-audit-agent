@echo off
setlocal
cd /d "%~dp0"
title CJA Audit Agent

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies. This can take a minute or two...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Read the messages above.
    pause
    exit /b 1
  )
)

echo.
echo Starting the CJA Audit Agent. Your browser opens when it is ready.
echo The first start downloads a small embedding model, so it can take a minute.
echo Close this window, or press Ctrl+C, to stop it.
echo.
set OPEN_BROWSER=true
node server.js
echo.
echo The server stopped. Scroll up to see why.
pause

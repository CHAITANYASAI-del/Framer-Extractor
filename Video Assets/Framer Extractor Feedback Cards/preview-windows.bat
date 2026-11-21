@echo off
REM Double-click to preview this site (and use /cms). Close this window to stop.
cd /d "%~dp0"
where node >nul 2>nul && (node preview-server.mjs 8080 --open & goto :eof)
where python >nul 2>nul && (start "" http://localhost:8080 & python -m http.server 8080 & goto :eof)
echo To preview your site, install Node.js from https://nodejs.org then run this file again.
start "" https://nodejs.org/en/download
pause

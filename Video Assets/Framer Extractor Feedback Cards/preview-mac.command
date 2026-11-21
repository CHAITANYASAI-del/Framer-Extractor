#!/bin/bash
# Double-click to preview this site (and use /cms). Keep the window open; close it to stop.
cd "$(dirname "$0")"
PORT=8080
if command -v node >/dev/null 2>&1; then
  node preview-server.mjs $PORT --open
elif xcode-select -p >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  (sleep 1; open "http://localhost:$PORT") &
  python3 -m http.server $PORT
else
  osascript -e 'display dialog "To preview your site, install Node.js (free) from nodejs.org, then double-click this file again." buttons {"Open nodejs.org"} default button 1' && open "https://nodejs.org/en/download"
fi

#!/bin/bash
# Opens the dashboard as a full-screen window ("app mode").
URL="http://127.0.0.1:8765/"
if [ -d "/Applications/Google Chrome.app" ]; then
  # --app gives a clean window without tabs or an address bar
  open -na "Google Chrome" --args --app="$URL" --start-fullscreen
else
  open -a Safari "$URL"
  echo "Opened in Safari. Press Control-Command-F for full screen."
fi

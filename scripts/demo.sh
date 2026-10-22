#!/bin/bash
# Try the dashboard with sample data — no settings or Google account needed.
# Press Control-C to stop.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT_IN_USE=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/ 2>/dev/null || true)
if [ "$PORT_IN_USE" = "200" ]; then
  echo "The real dashboard is already running at http://127.0.0.1:8765 — no need for the demo."
  exit 0
fi
( sleep 2; open "http://127.0.0.1:8765/" ) &
exec /usr/bin/python3 "$APP_DIR/server/whatsup.py" --demo --config /nonexistent

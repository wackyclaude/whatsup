#!/bin/bash
# Stops the dashboard and removes the login item.
#   scripts/uninstall.sh          keep your settings (so a reinstall picks them up)
#   scripts/uninstall.sh --purge  also delete settings, cache, logs and the .venv
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.whatsup.dashboard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"
echo "Dashboard stopped and removed from login items."

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$HOME/Library/Application Support/whatsup" "$HOME/Library/Caches/whatsup" \
         "$HOME/Library/Logs/whatsup" "$APP_DIR/.venv"
  echo "Settings, cache, logs and the Python environment deleted."
  echo "Tip: in Google Calendar, 'Reset' the secret address so the old one stops working."
fi

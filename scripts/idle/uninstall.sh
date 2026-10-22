#!/bin/bash
# Turns off the idle dashboard on this Mac.
#   bash scripts/idle/uninstall.sh          stop it (keeps the sign-in)
#   bash scripts/idle/uninstall.sh --purge  also delete its settings and Chrome profile (signs out)
set -euo pipefail
LABEL="com.whatsup.idle"
SUPPORT="$HOME/Library/Application Support/whatsup"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
pkill -TERM -f -- "--user-data-dir=$SUPPORT/chrome-profile" >/dev/null 2>&1 || true
echo "Idle dashboard turned off."
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$SUPPORT/chrome-profile" "$SUPPORT/idle.conf" "$HOME/Library/Logs/whatsup/idle.log"
  echo "Its settings and Chrome profile were deleted (signed out)."
fi

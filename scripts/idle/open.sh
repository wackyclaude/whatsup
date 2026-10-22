#!/bin/bash
# Opens the hosted dashboard in its own Chrome profile, as a normal window
# you can click and type in (use this for the first sign-in, or to switch
# cameras). It isn't closed automatically.
set -euo pipefail
SUPPORT="$HOME/Library/Application Support/whatsup"
CONF="$SUPPORT/idle.conf"
PROFILE="$SUPPORT/chrome-profile"
URL="$(grep -E '^URL=' "$CONF" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
[[ "$URL" =~ ^https:// ]] || { echo "Run scripts/idle/install.sh first."; exit 1; }
CHROME=""
for app in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do
  [ -d "$app" ] && CHROME="$app" && break
done
[ -n "$CHROME" ] || { echo "Google Chrome not found."; exit 1; }
mkdir -p "$PROFILE"
chmod 700 "$SUPPORT" "$PROFILE"
open -na "$CHROME" --args --user-data-dir="$PROFILE" --app="$URL" \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble --start-maximized

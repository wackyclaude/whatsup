#!/bin/bash
# Installs (or updates) the family dashboard for the current macOS user.
#  * no sudo / admin rights needed — everything stays in your user account
#  * Python packages go into this folder's own .venv (nothing system-wide)
#  * your private settings live in ~/Library/Application Support/whatsup/
#  * the dashboard starts automatically at login and is only reachable
#    from this Mac (http://127.0.0.1:8765)
#
# Safe to run again any time (e.g. after `git pull`).

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.whatsup.dashboard"
CONFIG_DIR="$HOME/Library/Application Support/whatsup"
CONFIG="$CONFIG_DIR/config.json"
LOG_DIR="$HOME/Library/Logs/whatsup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
VENV="$APP_DIR/.venv"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks
[ "$(uname)" = "Darwin" ] || die "this installer is for macOS."
[ "$(id -u)" -ne 0 ] || die "please don't use sudo. Run it as your normal user: scripts/install.sh"

case "$APP_DIR" in
  "$HOME/Documents"*|"$HOME/Desktop"*|"$HOME/Downloads"*|"$HOME/Library/Mobile Documents"*)
    die "the project is in a protected folder ($APP_DIR).
macOS blocks background apps from Documents, Desktop and Downloads.
Move it first, for example:   mkdir -p ~/Apps && mv \"$APP_DIR\" ~/Apps/whatsup
then run:   ~/Apps/whatsup/scripts/install.sh" ;;
esac

if ! xcode-select -p >/dev/null 2>&1; then
  die "Apple's Command Line Tools aren't installed yet.
Run:   xcode-select --install
click Install in the window that appears, wait for it to finish, then run this script again."
fi

PY=/usr/bin/python3
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || die "Python 3.9 or newer is needed (found $("$PY" --version 2>&1))."

# ---------------------------------------------------------------- python env
say "1/4  Setting up a private Python environment in $VENV"
if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
# --require-hashes: only install the exact package files listed in requirements.txt
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check --require-hashes -r "$APP_DIR/requirements.txt"

# ---------------------------------------------------------------- settings
say "2/4  Settings file"
umask 077
mkdir -p "$CONFIG_DIR" "$LOG_DIR"
if [ ! -f "$CONFIG" ]; then
  cp "$APP_DIR/config/config.example.json" "$CONFIG"
  echo "Created $CONFIG"
else
  echo "Keeping your existing settings: $CONFIG"
fi
chmod 700 "$CONFIG_DIR"
chmod 600 "$CONFIG"
"$VENV/bin/python" "$APP_DIR/server/whatsup.py" --config "$CONFIG" --check >/dev/null 2>&1 || true

# ---------------------------------------------------------------- login item
say "3/4  Starting the dashboard (and at every login)"
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
E_PY="$(printf '%s' "$VENV/bin/python" | xml_escape)"
E_SERVER="$(printf '%s' "$APP_DIR/server/whatsup.py" | xml_escape)"
E_CONFIG="$(printf '%s' "$CONFIG" | xml_escape)"
E_LOG="$(printf '%s' "$LOG_DIR/dashboard.log" | xml_escape)"
E_DIR="$(printf '%s' "$APP_DIR" | xml_escape)"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$E_PY</string>
    <string>$E_SERVER</string>
    <string>--config</string>
    <string>$E_CONFIG</string>
  </array>
  <key>WorkingDirectory</key><string>$E_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$E_LOG</string>
  <key>StandardErrorPath</key><string>$E_LOG</string>
</dict>
</plist>
PLIST
chmod 644 "$PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# ---------------------------------------------------------------- verify
say "4/4  Checking it's running"
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:8765/api/settings" 2>/dev/null; then
    say "Done! Open http://127.0.0.1:8765 in Safari to see the dashboard."
    cat <<NEXT

Next steps:
  • Add your family calendar:   $APP_DIR/scripts/configure.sh add-calendar
  • Add an India live camera:   $APP_DIR/scripts/configure.sh add-camera
  • Full-screen app mode:       $APP_DIR/scripts/open-app.sh
  • Screensaver:                see "Set up the screensaver" in README.md
  • Logs, if something's off:   $LOG_DIR/dashboard.log
NEXT
    exit 0
  fi
  sleep 1
done
die "the dashboard didn't start. Look at the log:  tail -n 30 \"$LOG_DIR/dashboard.log\""

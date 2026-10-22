#!/bin/bash
# Sets up a Mac to show the HOSTED dashboard when it's idle.
# No admin rights, no Python, no developer tools needed — only Google Chrome.
#
#   bash ~/Apps/whatsup/scripts/idle/install.sh
#
# Safe to run again to change the address, idle time or quiet hours.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/../.." && pwd)"
LABEL="com.whatsup.idle"
SUPPORT="$HOME/Library/Application Support/whatsup"
CONF="$SUPPORT/idle.conf"
LOG_DIR="$HOME/Library/Logs/whatsup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || die "this is for macOS."
[ "$(id -u)" -ne 0 ] || die "please don't use sudo."
case "$APP_DIR" in
  "$HOME/Documents"*|"$HOME/Desktop"*|"$HOME/Downloads"*|"$HOME/Library/Mobile Documents"*)
    die "the folder is in Documents, Desktop or Downloads, where macOS blocks background helpers.
Move it first:   mkdir -p ~/Apps && mv \"$APP_DIR\" ~/Apps/whatsup
Then run:        bash ~/Apps/whatsup/scripts/idle/install.sh" ;;
esac
if [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  die "Google Chrome is needed. Download it from https://www.google.com/chrome/ and drag it
to Applications (or to a folder named Applications inside your home folder), then run this again."
fi

current() { grep -E "^$1=" "$CONF" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }

say "Dashboard address"
echo "Paste the address of your hosted dashboard (it looks like https://whatsup.<your-name>.workers.dev)."
OLD_URL="$(current URL)"
read -r -p "Address${OLD_URL:+ [$OLD_URL]}: " URL
URL="${URL:-$OLD_URL}"
URL="${URL%/}/"
[[ "$URL" =~ ^https://[A-Za-z0-9.-]+(/.*)?$ ]] || die "the address must start with https://"

say "When should it appear?"
OLD_MIN="$(current IDLE_MINUTES)"
read -r -p "Minutes of no keyboard/mouse use before it opens [${OLD_MIN:-5}]: " MINUTES
MINUTES="${MINUTES:-${OLD_MIN:-5}}"
[[ "$MINUTES" =~ ^[0-9]+$ ]] || die "minutes must be a whole number, 1 or more"
MINUTES=$((10#$MINUTES))
[ "$MINUTES" -ge 1 ] || die "minutes must be a whole number, 1 or more"

echo "To keep the Mac's normal screen lock working, the dashboard closes after a while"
echo "and lets the display sleep (and lock, if your Lock Screen settings ask for a password)."
OLD_SHOW="$(current SHOW_MINUTES)"
read -r -p "Close it after how many minutes? (0 = never) [${OLD_SHOW:-60}]: " SHOW
SHOW="${SHOW:-${OLD_SHOW:-60}}"
[[ "$SHOW" =~ ^[0-9]+$ ]] || die "minutes must be a whole number"
SHOW=$((10#$SHOW))

echo "Quiet hours: it won't open in this window, so the screen can sleep at night."
OLD_QS="$(current QUIET_START)"; OLD_QE="$(current QUIET_END)"
read -r -p "Quiet from hour (0-23) [${OLD_QS:-22}]: " QS
read -r -p "Quiet until hour (0-23) [${OLD_QE:-7}]: " QE
QS="${QS:-${OLD_QS:-22}}"; QE="${QE:-${OLD_QE:-7}}"
for v in "$QS" "$QE"; do
  [[ "$v" =~ ^[0-9]+$ ]] && [ $((10#$v)) -le 23 ] || die "hours must be between 0 and 23"
done
QS=$((10#$QS)); QE=$((10#$QE))

umask 077
mkdir -p "$SUPPORT" "$LOG_DIR"
chmod 700 "$SUPPORT"
cat > "$CONF" <<CONF
# Whatsup idle launcher settings (edit, or run scripts/idle/install.sh again)
URL=$URL
IDLE_MINUTES=$MINUTES
SHOW_MINUTES=$SHOW
QUIET_START=$QS
QUIET_END=$QE
CONF
chmod 600 "$CONF"

say "Starting the idle helper (and at every login)"
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
E_SCRIPT="$(printf '%s' "$HERE/launcher.sh" | xml_escape)"
E_LOG="$(printf '%s' "$LOG_DIR/idle.log" | xml_escape)"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$E_SCRIPT</string>
  </array>
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
# bootout finishes in the background; retry briefly so re-running works
for i in 1 2 3 4 5 6; do
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break
  [ "$i" -eq 6 ] && die "couldn't start the helper. Log out and back in, then run this again."
  sleep 1
done

say "One-time sign-in"
cat <<NEXT
A Chrome window will open now, in a separate profile used only by the dashboard.
Sign in with your approved email (Cloudflare sends you a code), and you should
see the dashboard. Then just close that window.

The dashboard will now open by itself after $MINUTES idle minutes (not between $QS:00 and $QE:00),
and close when you touch the keyboard or mouse$( [ "$SHOW" -gt 0 ] && printf ', or after %s minutes' "$SHOW").
Note: while it's showing, the Mac is NOT locked — set a password in
System Settings → Lock Screen so it locks once the display sleeps.
To open it yourself any time:   bash "$HERE/open.sh"
To turn it off:                 bash "$HERE/uninstall.sh"
NEXT
sleep 2
bash "$HERE/open.sh"

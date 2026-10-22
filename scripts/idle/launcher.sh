#!/bin/bash
# Background helper (started at login by scripts/idle/install.sh).
#
# When this Mac has been idle for IDLE_MINUTES, it opens the hosted dashboard
# full-screen in a separate Chrome profile. As soon as someone touches the
# keyboard, mouse or trackpad, it closes again — like a screensaver.
#
#  * Uses its own Chrome profile: your normal browsing, passwords and
#    Google sign-ins are never touched, and the dashboard sign-in stays here.
#  * Never opens on a locked screen or during quiet hours (so the display can
#    sleep at night).
#  * Only closes windows it opened itself.

set -u

SUPPORT="$HOME/Library/Application Support/whatsup"
CONF="$SUPPORT/idle.conf"
PROFILE="$SUPPORT/chrome-profile"

# Tool paths (overridable only for the automated test in tests/test_idle.sh)
IOREG="${WHATSUP_IOREG:-/usr/sbin/ioreg}"
PGREP="${WHATSUP_PGREP:-/usr/bin/pgrep}"
PKILL="${WHATSUP_PKILL:-/usr/bin/pkill}"
OPEN="${WHATSUP_OPEN:-/usr/bin/open}"
nap() { sleep "${WHATSUP_TEST_SLEEP:-$1}"; }

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# Read key=value settings without executing the file.
conf() {
  local key="$1" default="$2" value
  value="$(grep -E "^${key}=" "$CONF" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
  printf '%s' "${value:-$default}"
}

is_number() { [[ "$1" =~ ^[0-9]+$ ]]; }

find_chrome() {
  [ -n "${WHATSUP_CHROME:-}" ] && { printf '%s' "$WHATSUP_CHROME"; return 0; }
  for app in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do
    [ -d "$app" ] && { printf '%s' "$app"; return 0; }
  done
  return 1
}

idle_seconds() {
  "$IOREG" -c IOHIDSystem | /usr/bin/awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }'
}

screen_locked() {
  "$IOREG" -n Root -d1 2>/dev/null | /usr/bin/grep -q '"CGSSessionScreenIsLocked" = Yes'
}

in_quiet_hours() {
  local start end hour
  start="$(conf QUIET_START 22)"
  end="$(conf QUIET_END 7)"
  is_number "$start" && is_number "$end" || return 1
  [ "$start" -eq "$end" ] && return 1
  hour=$((10#$(date +%H)))
  if [ "$start" -lt "$end" ]; then
    [ "$hour" -ge "$start" ] && [ "$hour" -lt "$end" ]
  else
    [ "$hour" -ge "$start" ] || [ "$hour" -lt "$end" ]
  fi
}

dashboard_running() {
  "$PGREP" -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1
}

open_dashboard() {
  local url="$1" chrome="$2"
  "$OPEN" -na "$chrome" --args \
    --user-data-dir="$PROFILE" \
    --kiosk --app="$url" \
    --no-first-run --no-default-browser-check \
    --hide-crash-restore-bubble \
    --autoplay-policy=no-user-gesture-required \
    --disable-features=Translate
}

close_dashboard() {
  "$PKILL" -TERM -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1
}

mkdir -p "$PROFILE"
chmod 700 "$SUPPORT" "$PROFILE" 2>/dev/null
opened_by_us=0
log "idle launcher started"

while true; do
  URL="$(conf URL '')"
  MINUTES="$(conf IDLE_MINUTES 5)"
  is_number "$MINUTES" && [ "$MINUTES" -ge 1 ] || MINUTES=5

  if [[ ! "$URL" =~ ^https:// ]]; then
    log "no valid URL in $CONF; waiting"
    nap 60
    continue
  fi
  CHROME="$(find_chrome)" || { log "Google Chrome not found; waiting"; nap 300; continue; }

  idle="$(idle_seconds)"
  is_number "${idle:-}" || idle=0

  if [ "$opened_by_us" -eq 1 ]; then
    if ! dashboard_running; then
      opened_by_us=0                       # someone quit it
    elif [ "$idle" -lt 3 ] || in_quiet_hours || screen_locked; then
      log "closing dashboard"
      close_dashboard
      opened_by_us=0
      nap 5
      continue
    fi
    nap 1
    continue
  fi

  if [ "$idle" -ge $((MINUTES * 60)) ] && ! dashboard_running && ! in_quiet_hours && ! screen_locked; then
    log "idle ${idle}s — opening dashboard"
    case "$URL" in
      *\?*) open_dashboard "$URL&mode=screensaver" "$CHROME" ;;
      *)    open_dashboard "$URL?mode=screensaver" "$CHROME" ;;
    esac
    opened_by_us=1
    nap 5
    continue
  fi
  nap 10
done

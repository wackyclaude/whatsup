#!/bin/bash
# Simulates the idle launcher with fake macOS tools (runs on Mac or Linux).
#   bash tests/test_idle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'kill "$PID" 2>/dev/null || true; rm -rf "$T"' EXIT
mkdir -p "$T/home/Library/Application Support/whatsup" "$T/bin"
STATE="$T/state"; mkdir -p "$STATE"
echo 0 > "$STATE/idle"

cat > "$T/bin/ioreg" <<EOF
#!/bin/bash
if [[ "\$*" == *IOHIDSystem* ]]; then
  echo "    | |   \"HIDIdleTime\" = \$(( \$(cat "$STATE/idle") * 1000000000 ))"
elif [ -f "$STATE/locked" ]; then
  echo '    | |   "IOConsoleUsers" = ({"kCGSSessionOnConsoleKey"=Yes,"CGSSessionScreenIsLocked"=Yes,"kCGSSessionLoginDoneKey"=Yes})'
fi
EOF
cat > "$T/bin/pmset" <<EOF
#!/bin/bash
if [ "\$1" = "displaysleepnow" ]; then echo "sleep" >> "$STATE/actions"; exit 0; fi
echo "Assertion status system-wide:"
echo "   BackgroundTask                 0"
echo "   PreventUserIdleDisplaySleep    \$(cat "$STATE/video" 2>/dev/null || echo 0)"
echo "Listed by owning process:"
EOF
cat > "$T/bin/pgrep" <<EOF
#!/bin/bash
[ -f "$STATE/running" ]
EOF
cat > "$T/bin/open" <<EOF
#!/bin/bash
echo "open \$*" >> "$STATE/actions"
touch "$STATE/running"
EOF
cat > "$T/bin/pkill" <<EOF
#!/bin/bash
echo "close" >> "$STATE/actions"
rm -f "$STATE/running"
EOF
chmod +x "$T/bin/"*
touch "$STATE/actions"

conf() {
  printf 'URL=https://whatsup.example.workers.dev/\nIDLE_MINUTES=05\nSHOW_MINUTES=%s\nQUIET_START=%s\nQUIET_END=%s\n' "${3:-0}" "$1" "$2" \
    > "$T/home/Library/Application Support/whatsup/idle.conf"
}
HOUR=$((10#$(date +%H)))
conf $(( (HOUR + 2) % 24 )) $(( (HOUR + 3) % 24 ))   # quiet hours not now

HOME="$T/home" WHATSUP_IOREG="$T/bin/ioreg" WHATSUP_PGREP="$T/bin/pgrep" WHATSUP_PKILL="$T/bin/pkill" \
  WHATSUP_OPEN="$T/bin/open" WHATSUP_PMSET="$T/bin/pmset" WHATSUP_TEST_MINUTE_SECS=1 WHATSUP_CHROME="/Applications/Google Chrome.app" WHATSUP_TEST_SLEEP=0.05 \
  bash "$ROOT/scripts/idle/launcher.sh" > "$T/log" 2>&1 &
PID=$!

step() { sleep 0.6; }
count() { grep -c "^$1" "$STATE/actions" || true; }
fail() { echo "FAIL: $*"; echo "--- actions:"; cat "$STATE/actions"; echo "--- log:"; cat "$T/log"; exit 1; }

echo 100 > "$STATE/idle"; step
[ "$(count open)" -eq 0 ] || fail "opened before idle time"

echo 400 > "$STATE/idle"; step
[ "$(count open)" -eq 1 ] || fail "did not open after 5 idle minutes"
grep -q -- "--kiosk --app=https://whatsup.example.workers.dev/?mode=screensaver" "$STATE/actions" || fail "wrong launch args"
grep -q -- "--user-data-dir=$T/home/Library/Application Support/whatsup/chrome-profile" "$STATE/actions" || fail "not using its own profile"

echo 420 > "$STATE/idle"; step
[ "$(count close)" -eq 0 ] || fail "closed while still idle"

echo 1 > "$STATE/idle"; step
[ "$(count close)" -eq 1 ] || fail "did not close on activity"

# A window the user opened themselves is left alone
touch "$STATE/running"; echo 1 > "$STATE/idle"; step
[ "$(count close)" -eq 1 ] || fail "closed a window it didn't open"
echo 400 > "$STATE/idle"; step
[ "$(count open)" -eq 1 ] || fail "opened a second window"
rm -f "$STATE/running"

# Locked screen: never opens
touch "$STATE/locked"; echo 400 > "$STATE/idle"; step
[ "$(count open)" -eq 1 ] || fail "opened on a locked screen"
rm -f "$STATE/locked"; step
[ "$(count open)" -eq 2 ] || fail "did not open after unlock + idle"

# Quiet hours: closes and stays closed
conf "$HOUR" $(( (HOUR + 1) % 24 )); step
[ "$(count close)" -eq 2 ] || fail "did not close at start of quiet hours"
step
[ "$(count open)" -eq 2 ] || fail "opened during quiet hours"

# Another app keeping the display on (a film): don't open
conf $(( (HOUR + 2) % 24 )) $(( (HOUR + 3) % 24 ))
echo 1 > "$STATE/video"; echo 400 > "$STATE/idle"; step
[ "$(count open)" -eq 2 ] || fail "opened over a video/presentation"
echo 0 > "$STATE/video"; step
[ "$(count open)" -eq 3 ] || fail "did not open once the video stopped"

# Timed close: after SHOW_MINUTES it closes, sleeps the display, and waits for activity
conf $(( (HOUR + 2) % 24 )) $(( (HOUR + 3) % 24 )) 2   # 2 "minutes" = 2 s in this test
sleep 2.5
[ "$(count close)" -eq 3 ] || fail "did not close after SHOW_MINUTES"
[ "$(count sleep)" -eq 1 ] || fail "did not put the display to sleep"
step; step
[ "$(count open)" -eq 3 ] || fail "reopened without anyone using the Mac"
echo 1 > "$STATE/idle"; step
echo 400 > "$STATE/idle"; step
[ "$(count open)" -eq 4 ] || fail "did not open again after activity + idle"

echo "idle launcher tests passed"

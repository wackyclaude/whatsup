#!/bin/bash
# Change dashboard settings without editing files by hand.
#   scripts/configure.sh list | add-calendar | remove-calendar | add-camera | remove-camera | location | panchang
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(id -u)" -ne 0 ] || { echo "Please don't use sudo."; exit 1; }
[ -x "$APP_DIR/.venv/bin/python" ] || { echo "Run scripts/install.sh first."; exit 1; }
exec "$APP_DIR/.venv/bin/python" "$APP_DIR/server/configure.py" "$@"

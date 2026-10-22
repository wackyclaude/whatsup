#!/bin/bash
# Tests your settings and data sources once, and prints a short summary.
# Never prints your secret calendar address.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -x "$APP_DIR/.venv/bin/python" ] || { echo "Run scripts/install.sh first."; exit 1; }
exec "$APP_DIR/.venv/bin/python" "$APP_DIR/server/whatsup.py" --check

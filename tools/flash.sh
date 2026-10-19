#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON=${PIO_PYTHON:-"$HOME/.platformio/penv/bin/python"}
exec "$PYTHON" "$ROOT/tools/flash.py" "$@"

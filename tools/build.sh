#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PIO=${PIO:-"$HOME/.platformio/penv/bin/pio"}
if [ ! -x "$PIO" ]; then PIO=pio; fi
"$PIO" run -d "$ROOT/firmware"
mkdir -p "$ROOT/dist"
cp "$ROOT/firmware/.pio/build/atoms3-lite/firmware.bin" "$ROOT/dist/"
cp "$ROOT/firmware/.pio/build/atoms3-lite/bootloader.bin" "$ROOT/dist/"
cp "$ROOT/firmware/.pio/build/atoms3-lite/partitions.bin" "$ROOT/dist/"
cp "$HOME/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin" "$ROOT/dist/"
(cd "$ROOT/dist" && shasum -a 256 *.bin > SHA256SUMS)

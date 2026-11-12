#!/usr/bin/env bash
# Vendor the BenchPod sensor definition engine (benchpod-firmware stm32h563/wasm: sensor_def.wasm
# and its wrapper sensor_def.mjs) into src/sensors/engine/, recording the sha256 of each file and
# the firmware commit they came from. src/sensors/engine.test.ts fails when a vendored file does
# not match the record, so the copy only changes through this script.
#
#   scripts/update-sensor-engine.sh [path/to/benchpod-firmware]   (default ../benchpod-firmware)
#
# The embeddedci server vendors the same .wasm (internal/sensordef/wasm, its
# scripts/update-sensordef-wasm.sh); keep the two on the same firmware commit.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
fw="${1:-$here/../benchpod-firmware}"
fw="$(cd "$fw" && pwd)"
make -C "$fw/stm32h563/wasm" test
dst="$here/src/sensors/engine"
cp "$fw/stm32h563/wasm/build/sensor_def.wasm" "$dst/sensor_def.wasm"
cp "$fw/stm32h563/wasm/sensor_def.mjs" "$dst/sensor_def.mjs"
commit="$(git -C "$fw" rev-parse --short=12 HEAD)$(test -n "$(git -C "$fw" status --porcelain -- stm32h563/src stm32h563/wasm)" && echo -dirty || true)"
: > "$dst/SHA256SUMS"
for f in sensor_def.wasm sensor_def.mjs; do
  sum="$(shasum -a 256 "$dst/$f" | awk '{print $1}')"
  printf '%s  %s  benchpod-firmware %s\n' "$sum" "$f" "$commit" >> "$dst/SHA256SUMS"
done
cat "$dst/SHA256SUMS"

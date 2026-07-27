#!/usr/bin/env bash
# Deterministic shot capture: each shot in an isolated headless page (lesson from
# Claude-of-Duty: shared pages leak state between shots).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$DIR/shots}"
mkdir -p "$OUT"
CHROME="${CHROME:-chromium}"
SHOTS=(title serve action burst multiball laser level4 clear hero)
for s in "${SHOTS[@]}"; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1280,720 \
    --virtual-time-budget=8000 \
    --screenshot="$OUT/$s.png" \
    "file://$DIR/index.html?shot=$s" 2>/dev/null
  echo "captured $s"
done

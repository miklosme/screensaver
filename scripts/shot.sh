#!/usr/bin/env bash
# Headless screenshot of one frozen frame. Needs `bun run dev` running on :5173.
#   scripts/shot.sh <scene-id> <t-seconds> <out.png>
set -euo pipefail
google-chrome --headless=new --no-sandbox --hide-scrollbars --window-size=1280,720 \
  --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  --virtual-time-budget=6000 --screenshot="$3" \
  "http://localhost:${PORT:-5173}/?scene=$1&t=$2" >/dev/null 2>&1
echo "$3"

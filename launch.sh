#!/usr/bin/env bash
# coview launcher — boots the bridge + a Chromium that Claude can attach to over
# CDP, with the coview extension loaded.
#
#   ./launch.sh [url]      url defaults to http://localhost:3000
#
# After this runs:
#   1. bridge on http://127.0.0.1:${COVIEW_PORT:-7777}
#   2. Chromium open with the coview extension + remote-debugging on :${COVIEW_CDP_PORT:-9222}
#   3. tell Claude Code "attach" — it connects the Playwright MCP to the same tab
#
# Env:
#   COVIEW_PORT      bridge port            (default 7777)
#   COVIEW_CDP_PORT  Chrome debugging port  (default 9222)
#   COVIEW_DIR       state dir              (default ~/.coview)
#   COVIEW_CHROME    explicit browser binary (overrides auto-discovery)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="${1:-http://localhost:3000}"
CDP_PORT="${COVIEW_CDP_PORT:-9222}"

# --- find a Chromium that honors --load-extension ---------------------------
# Playwright's "Chrome for Testing" works (unlike branded Chrome 137+, which
# disabled --load-extension). Auto-discover it; override with $COVIEW_CHROME.
find_chrome() {
  if [ -n "${COVIEW_CHROME:-}" ]; then echo "$COVIEW_CHROME"; return; fi
  local base
  if [ "$(uname)" = "Darwin" ]; then base="$HOME/Library/Caches/ms-playwright"; else base="$HOME/.cache/ms-playwright"; fi
  local patterns=(
    "$base"/chromium-[0-9]*/chrome-mac-arm64/"Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    "$base"/chromium-[0-9]*/chrome-mac-x64/"Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    "$base"/chromium-[0-9]*/chrome-linux/chrome
  )
  local p
  for p in "${patterns[@]}"; do
    # shellcheck disable=SC2086
    local hit; hit="$(ls -d $p 2>/dev/null | sort -V | tail -1 || true)"
    [ -n "$hit" ] && [ -x "$hit" ] && { echo "$hit"; return; }
  done
}

CHROME="$(find_chrome)"
if [ -z "$CHROME" ]; then
  echo "No Playwright Chromium found. Install it with:  npx playwright install chromium"
  echo "(or set COVIEW_CHROME to a Chromium binary that supports --load-extension)"
  exit 1
fi

# --- 1) bridge (background) --------------------------------------------------
echo "[1/2] starting bridge…"
node "$DIR/bridge.mjs" &
BRIDGE_PID=$!
trap 'kill $BRIDGE_PID 2>/dev/null || true' EXIT
sleep 1

# --- 2) Chromium with the extension + CDP, isolated profile -----------------
echo "[2/2] launching Chromium (CDP :$CDP_PORT) at $URL"
"$CHROME" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$HOME/.cache/coview-chrome" \
  --load-extension="$DIR/extension" \
  --disable-extensions-except="$DIR/extension" \
  --no-first-run --no-default-browser-check \
  --test-type --disable-infobars \
  "$URL"

echo "Chromium closed — stopping bridge."

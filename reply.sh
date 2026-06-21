#!/usr/bin/env bash
# Claude uses this to answer back into the browser panel.
#   ./reply.sh "your reply text"
# Env: COVIEW_PORT (default 7777)
PORT="${COVIEW_PORT:-7777}"
curl -s -X POST "http://127.0.0.1:${PORT}/reply" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1]}))' "$1")" >/dev/null
echo "→ sent to browser"

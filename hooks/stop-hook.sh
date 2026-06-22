#!/usr/bin/env bash
# coview Stop hook — keeps the panel channel alive DURING a turn.
#
# Claude Code runs this every time the assistant tries to END a turn. If it exits
# 2, the assistant is BLOCKED from stopping and this hook's stderr is fed back to
# the model as a new prompt — so the session keeps working. That is exactly the
# "ping" coview's poll-and-exit watch.sh can't give mid-turn: watch.sh only re-arms
# when the session remembers to re-run it, so panel messages that arrive during a
# long turn pile up unread. This hook fires on EVERY stop attempt, so it catches
# them regardless.
#
# Behavior: one-shot, instant, NON-blocking (unlike watch.sh it never waits).
#   - unread panel messages → print them to stderr, advance the cursor, exit 2
#   - none → exit 0 (turn ends normally)
#
# It shares the SAME cursor logic and cursor file as watch.sh, so the two never
# disagree about which lines have been delivered.
#
# GATE: inert unless $COVIEW_DIR/active exists — launch.sh creates that sentinel on
# start and removes it on exit, so this hook does nothing in any non-coview session.
#
# Env: COVIEW_DIR (default ~/.coview)
DIR="${COVIEW_DIR:-$HOME/.coview}"
INBOX="$DIR/inbox.jsonl"
CURSOR="$DIR/cursor"
ACTIVE="$DIR/active"

# Drain stdin (Claude Code passes a JSON object). We don't need any field for the
# core check — the cursor is the natural infinite-loop guard (we advance it when we
# deliver, so a subsequent stop with no NEW lines exits 0) — but read it so the
# producer never blocks on the pipe. Never crash a turn over it.
read -r -d '' _STDIN <<EOF || true
$(cat 2>/dev/null || true)
EOF

# GATE: only an active coview session arms the hook.
[ -f "$ACTIVE" ] || exit 0

# No inbox yet → nothing to deliver.
[ -f "$INBOX" ] || exit 0

# Cursor logic mirrors watch.sh exactly (missing/empty → 0).
N="$(cat "$CURSOR" 2>/dev/null || echo 0)"
N="${N:-0}"
C="$(wc -l < "$INBOX" 2>/dev/null | tr -d ' ')"
C="${C:-0}"

if [ "$C" -gt "$N" ]; then
  tail -n +"$((N + 1))" "$INBOX" >&2   # deliver unread lines to the model
  echo "$C" > "$CURSOR"                 # advance cursor (also the loop guard)
  exit 2
fi

exit 0

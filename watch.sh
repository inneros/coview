#!/usr/bin/env bash
# Blocks until there are unread panel messages, prints ALL of them, then EXITS
# (so the Claude Code harness re-invokes the session). Tracks a cursor file so
# re-running it picks up exactly where it left off — no missed/repeated messages.
#
#   ./watch.sh        # block for the next message(s), print them, exit
#
# Claude's loop: run this as a background task → on wake, read the printed
# messages, act, then run it again. The cursor advances automatically.
#
# Env: COVIEW_DIR (default ~/.coview)
DIR="${COVIEW_DIR:-$HOME/.coview}"
INBOX="$DIR/inbox.jsonl"
CURSOR="$DIR/cursor"
mkdir -p "$DIR"
[ -f "$INBOX" ] || : > "$INBOX"
N="$(cat "$CURSOR" 2>/dev/null || echo 0)"
while :; do
  C="$(wc -l < "$INBOX" 2>/dev/null | tr -d ' ')"
  C="${C:-0}"
  if [ "$C" -gt "$N" ]; then
    tail -n +"$((N + 1))" "$INBOX"   # print every unread line
    echo "$C" > "$CURSOR"            # advance cursor
    exit 0
  fi
  sleep 1
done

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
# SELF-DEDUPE: a PID lock means re-running ALWAYS leaves exactly one watcher —
# a new instance kills any prior one before claiming the lock. (Two live
# watchers would race the cursor and drop/double-process messages.) So you can
# just re-run it; no need to pkill stale ones first.
#
# Env: COVIEW_DIR (default ~/.coview)
DIR="${COVIEW_DIR:-$HOME/.coview}"
INBOX="$DIR/inbox.jsonl"
CURSOR="$DIR/cursor"
LOCK="$DIR/watch.pid"
mkdir -p "$DIR"

# Kill any prior watcher, then wait for it to die (and run its own EXIT trap)
# before claiming the lock — avoids a race where the dying one removes our lock.
if [ -f "$LOCK" ]; then
  OLD="$(cat "$LOCK" 2>/dev/null)"
  if [ -n "$OLD" ] && [ "$OLD" != "$$" ] && kill -0 "$OLD" 2>/dev/null; then
    kill "$OLD" 2>/dev/null
    for _ in 1 2 3 4 5; do kill -0 "$OLD" 2>/dev/null || break; sleep 0.2; done
  fi
fi
echo "$$" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

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

---
name: coview-setup
description: Set up and run coview — a browser chat panel wired to this Claude Code session, attached to the same tab via the Playwright MCP. Trigger when the user says "set up coview", "start coview", "co-view this page", or wants a live browser panel to talk to Claude while editing a page.
---

# coview setup

Goal: the user types in a panel docked in a real browser tab; you (this session) see
that exact tab via the Playwright MCP, act, and reply into the panel. Local only.

Run these steps in order. Assume the repo root is the current directory (it contains
`launch.sh`, `bridge.mjs`, `watch.sh`, `reply.sh`, `install-hooks.sh`, `hooks/`,
`extension/`).

## 0. Register the Stop hook (once)

Run `./install-hooks.sh`. It adds coview's `hooks/stop-hook.sh` as a `Stop` hook in
`~/.claude/settings.json` (idempotent — safe to run every time; it never duplicates
or clobbers other settings). This hook is what keeps the channel alive **during** a
turn: on every attempt to end a turn it checks the inbox and, if there are unread
panel messages, prints them and exits 2 — which makes you keep working on them
instead of stopping. It is **inert** in any session that isn't a live coview session
(it only acts while `$COVIEW_DIR/active` exists, which `launch.sh` creates).

## 1. Ensure the Playwright CDP MCP server exists

Check `.mcp.json` (project) for a server that runs `@playwright/mcp` with
`--cdp-endpoint http://localhost:9222`. If missing, add:

```json
"playwright-cdp": {
  "command": "npx",
  "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
}
```

If you added it, tell the user to run `/mcp` (reconnect) — the new server's tools
won't exist until they do — then continue. If the port differs, keep it consistent
with `COVIEW_CDP_PORT`.

## 2. Launch the browser + bridge

Run as a **background task** (it blocks until the browser closes):

```
./launch.sh <URL>     # URL defaults to http://localhost:3000
```

Then verify:
- `curl -s http://localhost:9222/json/version` → CDP is up
- `curl -s "http://127.0.0.1:7777/poll?after=0"` → bridge is up

If `launch.sh` says no Chromium found, run `npx playwright install chromium` first.

## 3. Attach to the tab

Use the `playwright-cdp` tools: `browser_tabs(list)` (retry once if the first call
says the target closed — it reconnects), then `browser_navigate` to the URL if the
tab isn't already there. Confirm the panel injected:

```
browser_evaluate(() => !!document.getElementById('coview-root'))
```

If it's `false` on a framework page, wait ~2s and re-check (hydration); the panel
self-heals via a MutationObserver.

## 4. Arm the idle bootstrap (watch.sh)

Two mechanisms keep the channel alive; this step arms the second:

- **Mid-turn** is already covered by the Stop hook from step 0 — any message that
  lands while you're working is delivered to you automatically on your next attempt
  to stop. You do **not** need to re-arm anything for those.
- **Fully idle** is what `watch.sh` covers: a Stop hook can't fire on a session
  that has already stopped, so run `./watch.sh` as a **tracked background task** to
  catch a message that arrives while you're idle. It blocks until the user sends a
  panel message, prints it, and exits — which re-invokes you.

On wake (from either path):

1. Read the printed JSON line(s): `{ text, pageUrl, selector, selectors }` —
   `selectors` is the array of pinned elements (`selector` is them joined, for compat).
2. Act — screenshot/inspect the pinned element(s) via the Playwright MCP, edit code,
   etc.
3. Reply into the panel: `./reply.sh "<your reply>"`.
4. Re-run `./watch.sh` (background) so the idle path is armed again for the next time
   you go fully idle.

Send one `./reply.sh "coview is live — point at anything"` so the user sees it.

## Notes

- The Stop hook and `watch.sh` share the same `$COVIEW_DIR/cursor` file, so a message
  is delivered exactly once regardless of which one catches it — no missed, no
  repeated.
- `watch.sh` self-dedupes via a PID lock (`$COVIEW_DIR/watch.pid`) — just re-run it
  as a tracked background task and it kills any prior instance automatically. No
  need to pkill stale ones first.
- State lives in `~/.coview` (`COVIEW_DIR`). The panel state resets on reload — that's
  fine, the real conversation state is in this session.
- Never expose the bridge (7777) or CDP (9222) ports to a network.

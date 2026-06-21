---
name: coview-setup
description: Set up and run coview — a browser chat panel wired to this Claude Code session, attached to the same tab via the Playwright MCP. Trigger when the user says "set up coview", "start coview", "co-view this page", or wants a live browser panel to talk to Claude while editing a page.
---

# coview setup

Goal: the user types in a panel docked in a real browser tab; you (this session) see
that exact tab via the Playwright MCP, act, and reply into the panel. Local only.

Run these steps in order. Assume the repo root is the current directory (it contains
`launch.sh`, `bridge.mjs`, `watch.sh`, `reply.sh`, `extension/`).

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

## 4. Arm the wake loop

Run `./watch.sh` as a **tracked background task**. It blocks until the user sends a
panel message, prints the message(s), and exits — which re-invokes you. On wake:

1. Read the printed JSON line(s): `{ text, pageUrl, selector, selectors }` —
   `selectors` is the array of pinned elements (`selector` is them joined, for compat).
2. Act — screenshot/inspect the pinned element(s) via the Playwright MCP, edit code,
   etc.
3. Reply into the panel: `./reply.sh "<your reply>"`.
4. Re-run `./watch.sh` (background) to wait for the next message.

Send one `./reply.sh "coview is live — point at anything"` so the user sees it.

## Notes

- `watch.sh` self-dedupes via a PID lock (`$COVIEW_DIR/watch.pid`) — just re-run it
  as a tracked background task and it kills any prior instance automatically. No
  need to pkill stale ones first.
- State lives in `~/.coview` (`COVIEW_DIR`). The panel state resets on reload — that's
  fine, the real conversation state is in this session.
- Never expose the bridge (7777) or CDP (9222) ports to a network.

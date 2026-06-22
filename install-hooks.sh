#!/usr/bin/env bash
# Registers coview's Stop hook (hooks/stop-hook.sh) in ~/.claude/settings.json so
# the panel channel stays alive during a turn. Idempotent: running it twice leaves
# exactly one entry, and it never touches other hooks or settings keys.
#
#   ./install-hooks.sh
#
# Env: CLAUDE_SETTINGS (override the settings.json path; default ~/.claude/settings.json)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/hooks/stop-hook.sh"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

[ -f "$HOOK" ] || { echo "hook script not found: $HOOK" >&2; exit 1; }
chmod +x "$HOOK"
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

HOOK="$HOOK" SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os, sys

hook = os.environ["HOOK"]
path = os.environ["SETTINGS"]

with open(path) as f:
    txt = f.read().strip()
data = json.loads(txt) if txt else {}
if not isinstance(data, dict):
    print(f"settings.json is not a JSON object: {path}", file=sys.stderr)
    sys.exit(1)

hooks = data.setdefault("hooks", {})
stop = hooks.setdefault("Stop", [])

# Schema: hooks.Stop is a list of matcher-groups, each {"hooks": [ {type, command} ]}.
already = any(
    isinstance(g, dict)
    and any(
        isinstance(h, dict) and h.get("command") == hook
        for h in g.get("hooks", [])
    )
    for g in stop
)

if already:
    print(f"coview Stop hook already registered → no change ({path})")
    sys.exit(0)

stop.append({"hooks": [{"type": "command", "command": hook}]})
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"registered coview Stop hook → {path}")
print(f"  command: {hook}")
PY

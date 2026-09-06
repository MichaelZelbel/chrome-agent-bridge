#!/usr/bin/env bash
# Runner: headless Claude Code, once, for one Planino browser posting job.
#
# Called by wake.js with the job id as $1 and these in the environment:
#   JOB_ID, JOB_PLATFORM, PLANINO_POSTER_URL, PLANINO_POSTER_TOKEN, BRIDGE_URL
# Knobs (poster.env): HUB_DIR (the hub clone that holds .claude/skills/browser-post
# and the Planino + chrome-bridge MCP servers in its .mcp.json), CLAUDE_BIN,
# CLAUDE_MAX_TURNS.
#
# After the run, the cost Claude reports is written onto the job through the
# poster API, so every row says what it cost even though the AI cannot know
# its own bill while it is still running.
set -uo pipefail

JOB_ID="${1:-${JOB_ID:-}}"
HUB_DIR="${HUB_DIR:-$HOME/hub}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MAX_TURNS="${CLAUDE_MAX_TURNS:-60}"

if [ ! -d "$HUB_DIR/.claude/skills/browser-post" ]; then
  echo "runner: no browser-post skill under $HUB_DIR/.claude/skills; set HUB_DIR in poster.env" >&2
  exit 2
fi
cd "$HUB_DIR" || exit 2

# The hub's secrets layer, so .mcp.json can reach Planino and the bridge.
# shellcheck disable=SC1091
[ -f scripts/secrets.sh ] && { set -a; . scripts/secrets.sh 2>/dev/null || true; set +a; }
export BRIDGE_URL PLANINO_POSTER_URL PLANINO_POSTER_TOKEN

PROMPT="A browser posting job is queued in Planino${JOB_ID:+ (job id $JOB_ID)}${JOB_PLATFORM:+, platform $JOB_PLATFORM}. Use the browser-post skill in .claude/skills/browser-post/SKILL.md: claim that one job, post it through the Chrome Agent Bridge at $BRIDGE_URL following the platform playbook, verify the live result, and report it with report_browser_job. One job only, then stop."

OUT="$(mktemp)"
"$CLAUDE_BIN" -p "$PROMPT" \
  --output-format json \
  --max-turns "$MAX_TURNS" \
  --allowedTools "Read,Grep,Glob,Bash,mcp__planino__*,mcp__chrome-bridge__*" \
  > "$OUT" 2>/tmp/planino-runner-claude.err
CODE=$?

# Put the cost on the job. The JSON carries total_cost_usd, num_turns and
# duration_ms; a job that was never claimed (no id) has nowhere to put it.
if [ -n "$JOB_ID" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$OUT" "$JOB_ID" <<'PY' 2>/dev/null
import json, os, sys, urllib.request
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
m = {}
if isinstance(d.get("total_cost_usd"), (int, float)): m["cost_usd"] = d["total_cost_usd"]
if isinstance(d.get("num_turns"), int): m["tool_calls"] = d["num_turns"]
if isinstance(d.get("duration_ms"), (int, float)): m["seconds"] = round(d["duration_ms"] / 1000)
m["harness"] = "claude-code"
body = json.dumps({"job_id": sys.argv[2], "metrics": m}).encode()
req = urllib.request.Request(os.environ["PLANINO_POSTER_URL"].rstrip("/") + "/metrics", data=body, method="POST",
    headers={"Authorization": "Bearer " + os.environ["PLANINO_POSTER_TOKEN"], "Content-Type": "application/json"})
try:
    urllib.request.urlopen(req, timeout=20).read()
except Exception as e:
    print("metrics not written: %s" % e, file=sys.stderr)
PY
fi

# The AI's last line, for the waker's log.
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(str(d.get("result",""))[:400])' "$OUT" 2>/dev/null || tail -c 400 "$OUT"
rm -f "$OUT"
exit $CODE

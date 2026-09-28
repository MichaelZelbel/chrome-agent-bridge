#!/usr/bin/env bash
# Runner: a Hermes profile, once, for one Planino browser posting job.
#
# Called by wake.js with the job id as $1 and these in the environment:
#   JOB_ID, JOB_PLATFORM, PLANINO_POSTER_URL, PLANINO_POSTER_TOKEN, BRIDGE_URL
# The posting rules and playbooks ship in this kit (poster/skill/SKILL.md, poster/playbooks/).
# Knobs (poster.env): HERMES_PROFILE, HERMES_BIN, HERMES_WORKDIR (the directory
# whose AGENTS.md and skills the profile should load; Hermes reads them from
# the current directory).
#
# A Hermes one-shot run loads no MCP servers, so the skill's HTTP path is the
# one this runner relies on: the poster API with curl, the bridge with curl.
set -uo pipefail

JOB_ID="${1:-${JOB_ID:-}}"
HERMES_BIN="${HERMES_BIN:-hermes}"
HERMES_PROFILE="${HERMES_PROFILE:-default}"
POSTER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="$POSTER_DIR/skill/SKILL.md"
[ -n "${HERMES_WORKDIR:-}" ] && cd "$HERMES_WORKDIR"
export POSTER_DIR BRIDGE_URL PLANINO_POSTER_URL PLANINO_POSTER_TOKEN
[ -n "${BRIDGE_TOKEN:-}" ] && export BRIDGE_TOKEN
[ -n "${SUBSTACK_PUBLICATION:-}" ] && export SUBSTACK_PUBLICATION

PROMPT="A browser posting job is queued in Planino${JOB_ID:+ (job id $JOB_ID)}${JOB_PLATFORM:+, platform $JOB_PLATFORM}. Read $SKILL and follow it: claim that one job through the poster API at $PLANINO_POSTER_URL (bearer token in PLANINO_POSTER_TOKEN), post it through the Chrome Agent Bridge at $BRIDGE_URL following the playbook in $POSTER_DIR/playbooks/, verify the live result, and report it through the poster API's /report. One job only, then stop."

"$HERMES_BIN" -p "$HERMES_PROFILE" -z "$PROMPT"

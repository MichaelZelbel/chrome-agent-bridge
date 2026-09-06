#!/usr/bin/env bash
# Runner: a Hermes profile, once, for one Planino browser posting job.
#
# Called by wake.js with the job id as $1 and these in the environment:
#   JOB_ID, JOB_PLATFORM, PLANINO_POSTER_URL, PLANINO_POSTER_TOKEN, BRIDGE_URL
# Knobs (poster.env): HERMES_PROFILE, HERMES_BIN, HERMES_WORKDIR (the directory
# whose AGENTS.md and skills the profile should load; Hermes reads them from
# the current directory).
#
# A Hermes one-shot run loads no MCP servers, so the skill's REST path is the
# one this runner relies on: the poster API with curl, the bridge with curl.
set -uo pipefail

JOB_ID="${1:-${JOB_ID:-}}"
HERMES_BIN="${HERMES_BIN:-hermes}"
HERMES_PROFILE="${HERMES_PROFILE:-hub}"
[ -n "${HERMES_WORKDIR:-}" ] && cd "$HERMES_WORKDIR"
export BRIDGE_URL PLANINO_POSTER_URL PLANINO_POSTER_TOKEN

PROMPT="A browser posting job is queued in Planino${JOB_ID:+ (job id $JOB_ID)}${JOB_PLATFORM:+, platform $JOB_PLATFORM}. Follow the browser-post skill: claim that one job through the poster API at $PLANINO_POSTER_URL (bearer token in PLANINO_POSTER_TOKEN), post it through the Chrome Agent Bridge at $BRIDGE_URL following the platform playbook, verify the live result, and report it through the poster API's /report. One job only, then stop."

"$HERMES_BIN" -p "$HERMES_PROFILE" -z "$PROMPT"

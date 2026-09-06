# Planino waker

Let your own AI post to platforms that have no API (Substack, Snapchat) through your own
logged-in Chrome, from [Planino](https://planino.studio).

Planino queues a post at its scheduled time. This waker asks Planino every couple of minutes
whether a job is waiting and, only then, starts your AI once. Your AI claims the job, posts it
through the Chrome Agent Bridge on this machine following a written playbook for the platform,
verifies the live result, and reports back with a screenshot and what it cost. The waker itself
never touches the browser and never runs an AI on a timer, so an idle account costs nothing.

```
Planino ──(every 2 min: "anything queued?")──▶ waker ──▶ your AI (Claude Code or Hermes)
                                                              │  browser-post skill + playbook
                                                              ▼
                                                 Chrome Agent Bridge ──▶ your logged-in Chrome
```

## Install

1. Install the [Chrome Agent Bridge](../README.md) on this machine and sign in to Substack
   and Snapchat once in the browser it opens. A dedicated bridge profile for posting is best
   (see `docs/multi-agent.md`), so nothing else types into a post mid-flight.
2. In Planino, Settings, **AI poster**: create a poster, tick its platforms, copy the token.
3. Copy `poster.env.example` to `poster.env` and set `PLANINO_POSTER_TOKEN`, `BRIDGE_URL`
   (the posting profile's port) and `RUNNER`.
4. Install your AI and the skill:
   - **Claude Code**: `RUNNER=./runners/claude.sh`, `HUB_DIR=<a clone of the hub>` holding
     `.claude/skills/browser-post/` and a `.mcp.json` with the Planino and chrome-bridge MCP
     servers. The runner writes Claude's own cost onto the job afterwards.
   - **Hermes**: `RUNNER=./runners/hermes.sh`, `HERMES_PROFILE=<profile>` whose skills
     directory includes `browser-post`. Hermes one-shot runs load no MCP servers, so the skill's
     REST path (curl against the poster API and the bridge) is what this runner relies on.
5. Try it: `node wake.js --checkin` (Planino's card should now say "checked in just now"),
   then `node wake.js --once` with a post scheduled a minute ahead.
6. Keep it running: `bash install-waker-linux.sh`, `bash install-waker-macos.sh` or
   `powershell -ExecutionPolicy Bypass -File install-waker-windows.ps1`. Each installs a user
   service that runs `node wake.js` at login and restarts it on failure. A cron line running
   `node wake.js --once` every two minutes does the same job on a server.

## The poster API the AI uses

All on `Authorization: Bearer pln_poster_...`, all POST, all JSON:

| Call | What it does |
|---|---|
| `/checkin` `{harness, version, bridge_ok}` | Says the poster is alive; Planino shows amber after an hour of silence. |
| `/peek` | `{queued, oldest}` for this account. No side effect. |
| `/claim` `{job_id?}` | Takes the named job, or the oldest queued one. Returns the frozen payload: what to post. 204 when nothing waits. |
| `/report` `{job_id, result, post_url?, error?, screenshot?, snapshot?, metrics?}` | `posted` (with the live URL), `needs_manual` (a person must look; never retried) or `failed` (nothing was published; Planino queues another attempt, up to three). |
| `/metrics` `{job_id, metrics}` | Adds cost and counts onto a finished job. |

An AI holding a Planino MCP token can use the same rules through the MCP tools
`list_browser_jobs`, `claim_browser_job` and `report_browser_job` instead.

## Playbooks

`playbooks/<platform>.md` is the written procedure an AI follows on each site: the page to open,
the controls by their accessible names, the dialogues in order, how to read the live URL back,
and what "already posted" looks like. When a site changes, the AI adapts, finishes the post,
and appends a dated correction. Improvements are welcome as pull requests.

## Rules the AI keeps

The job row is the authorization: it exists only because you set a time on a post in Planino.
The AI posts the frozen payload and nothing else; it never composes new text, never changes a
schedule, never visits another site, does one job per run, and stops at 40 tool calls or ten
minutes. Before publishing it looks for the same post already live from the last hour, in case
an earlier attempt died after the publish click. Only a verified live URL becomes `posted`;
anything unclear is handed back as `needs_manual`.

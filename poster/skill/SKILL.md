---
name: browser-post
description: Use when a Planino browser posting job is queued or named ("post job 12 now", "post the queued browser jobs", the waker's prompt). Posts ONE claimed job to a platform with no API (Substack, Snapchat) through the person's own logged-in Chrome and the Chrome Agent Bridge, following that platform's playbook, verifies the live post, and reports it to Planino with a screenshot. Never composes text, never changes a schedule, never posts anything that is not a claimed job.
---

# Browser post

Planino's browser posting lane. A post on a platform with no API is posted by the person's own AI
through their own logged-in Chrome. Planino froze what to post into a JOB at the time the person
set; this skill takes one job and finishes it. It needs nothing but this folder, a Chrome Agent
Bridge, and the poster token from Planino (Settings, AI poster).

## The envelope, first

- **The job is the authorization.** It exists only because the person set a time on that post in
  Planino. Nothing else is: no job, no post.
- **Only the frozen payload, exactly.** Post what the claim returns. Do not read the post
  anywhere else, do not improve the text, do not add hashtags, do not change the schedule.
  **Media too:** every file in the payload goes in, and nothing that is not in it. The payload is
  what the post's card in Planino shows the person. Deciding that a file does not suit the
  platform is a taste call the person made in Planino, not yours. A file that will not go in is
  `needs_manual`, never a post without it.
- **One job per run.** Claim one, finish it, report it, stop.
- **Only this platform's site** and the poster API. No other site, no other account.
- **Caps:** 40 tool calls, 10 minutes. When either is near, take the screenshot and report
  `needs_manual` with what you saw. A cap that trips is a visible failure, not a stuck job.
- **Verified live URL is the only path to `posted`.** A dialog closing is not a post. Anything
  unclear after the publish click is `needs_manual`, never a retry, because "maybe posted" must
  not be posted twice.
- **If your harness refuses a click** (a safety hook on buttons named Post or Publish, say),
  report `needs_manual` with that sentence. Never route around it.
- **Read pages through the accessibility snapshot**, never the full page text unless the
  snapshot cannot answer, and one screenshot at the end for the report.

## Where things are

- **This folder** is `poster/skill/` in the Chrome Agent Bridge kit. The playbooks are next to
  it: `poster/playbooks/<platform>.md`. The runner passes the kit's path as `POSTER_DIR`.
- **The browser:** the bridge at `$BRIDGE_URL` (bearer `$BRIDGE_TOKEN` when set). With the
  bridge's MCP server loaded, use the `pc_browser_*` tools. Without it, the same calls are HTTP:
  `POST /goto {url}`, `GET /snapshot`, `POST /click-by-role {role,name,exact}`,
  `POST /click {selector}`, `POST /type {selector,text}`, `POST /type-text {text}`,
  `POST /press {key}`, `POST /eval {js}`, `POST /upload-file {url,click|selector,filename}`,
  `GET /screenshot` (a PNG).
- **Planino:** the poster API at `$PLANINO_POSTER_URL`, `Authorization: Bearer
  $PLANINO_POSTER_TOKEN`, all POST with a JSON body: `/claim {job_id?}` returns the job and its
  frozen `payload` (204 when nothing waits); `/report {job_id, result, post_url?, error?,
  screenshot?, metrics?}`. An AI that also has Planino's MCP tools may use
  `claim_browser_job` and `report_browser_job` instead; the rules are the same. Send the report
  through the API when it carries the screenshot: a base64 PNG is too big for a tool argument.

## The steps

1. **Check the browser.** `GET $BRIDGE_URL/health` (or `pc_browser_health`). No answer: report
   nothing, say so, stop. Planino hands an unclaimed job back after thirty minutes with the
   right sentence.
2. **Refresh upload capabilities, then claim.** Read `GET $BRIDGE_URL/capabilities`
   (or `pc_browser_capabilities`) and POST `/checkin` with `bridge_ok: true` and the exact
   response as `upload_capabilities` before claiming. An unavailable capability response
   must be sent as `upload_capabilities: null`; stop instead of attempting media upload.
   Planino validates the actual connected publisher and current media again at claim time.
   A structured incompatibility is final for this file and route: report `needs_manual`,
   include its size, limit, upload method and remedy, and never retry it or omit the media.
   If `/upload-file` rejects with `UPLOAD_TOO_LARGE` or `UPLOAD_URL_REJECTED`, likewise
   report `needs_manual`. After any uncertain publish outcome, never click publish again.
   **Claim.** The job id you were given, or none for the oldest queued one. Nothing back means
   nothing to do: say so and stop. Keep the `payload` and the job `id`.
3. **Open the playbook** for `payload.platform` and read it whole. No playbook for the platform:
   report `needs_manual` with "No playbook for <platform> yet" and stop.
4. **Already live?** Follow the playbook's "Already posted?" section. If the same post is live
   from the last hour, report `posted` with its URL and stop: an earlier attempt may have died
   after the publish click.
5. **Follow the playbook** one step at a time, snapshot after each action. When the page differs
   from the playbook, work it out from the snapshot, finish, and remember the difference for
   step 8.
6. **Publish**, then read the live URL back the way the playbook says and open it: check the
   title, the date and the last paragraph. Take one screenshot of the final page. Say what you
   are about to click before the publish step when a person is watching.
7. **Report:** `posted` with `post_url`, the screenshot and `metrics` {tool_calls, seconds,
   model: the model you are, harness}; or `needs_manual` with one sentence on what you saw; or
   `failed` with one sentence when nothing was published (Planino queues another attempt, up to
   three). A `posted` with no URL (some platforms show none at once) must say so in `error`.
8. **Correct the playbook** if anything differed: fix the step, append a dated line under
   "Corrections", and if you can commit to the kit's repository, commit it with one plain
   sentence. A correction is how the next run avoids rediscovering the page.

## What this skill never does

Compose or rewrite text. Change a schedule or a status by hand. Write the post row directly (the
report does that; two writers would disagree). Post to a platform that has an API route. Retry a
publish click.

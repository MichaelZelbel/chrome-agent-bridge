# Security

Read this before running the bridge against any account you care about.

## Threat model

The gateway gives anyone who can reach `http://host:3007` the ability to:

- Navigate to any URL.
- Read full page HTML, including any logged-in content.
- Click and type into any element on the current page.
- Take screenshots.

In other words: **an attacker on the same private network can do anything
the logged-in user could do in that browser tab.** Treat the gateway with
the same care as the browser sessions it controls.

## Hard rules

1. **Never expose Chrome remote debugging to the network.**
   The launcher uses `--remote-debugging-address=127.0.0.1`. Do not change
   this. CDP grants full browser control with no auth.

2. **Only expose the gateway over a trusted private network.**
   Tailscale, WireGuard, a private VPC, or `localhost`. Never on a public
   IP, never via a port forward on your home router.

3. **Do not run this on a shared or untrusted machine.**
   The bridge has access to whatever Chrome profile you point it at, with no
   per-request authentication.

4. **Use a dedicated Chrome profile.**
   The launcher uses `%LOCALAPPDATA%\ChromeAgentProfile`. Do not point the
   bridge at your daily browsing profile — that profile likely has banking,
   email, password manager, and other sessions you do not want an agent
   touching.

5. **Do not commit secrets.**
   `.env` is gitignored. Cookies and tokens live in the Chrome profile
   directory, which should also stay out of the repo.

6. **Review your agent's permissions.**
   Decide before granting access whether the agent should be able to send
   messages, accept invitations, or change settings — and constrain the
   prompt accordingly. The bridge has no allow-list of its own.

## Defense-in-depth suggestions

- **Bind to the Tailscale interface only** if you do not need localhost
  access. Set `HOST=100.x.y.z` (your Tailscale IP) instead of `0.0.0.0`.
- **Tailscale ACLs:** restrict which tailnet members can reach port 3007.
- **Windows Firewall:** add an inbound rule that allows TCP/3007 only from
  the Tailscale interface.
- **Runtime auth (optional):** if you need defense beyond the network layer,
  put a reverse proxy (Caddy, Nginx) in front of the gateway and add a
  shared-secret header check. The bridge itself is intentionally minimal.
- **Read-only mode:** for less risky use cases, you can fork the gateway and
  remove `/click`, `/type`, and `/press`, leaving only `/goto`, `/content`,
  and `/screenshot`.

## What this project does NOT do

- No request authentication.
- No rate limiting.
- No allow-list of URLs.
- No audit log.
- No multi-user separation.

Add what your environment requires.

## Bearer token (optional, v0.4.0)

Start the gateway with `BRIDGE_TOKEN=<secret>` and every route but `/health` requires
`Authorization: Bearer <secret>`; the MCP proxy sends it when the same variable is set on its
side. Off by default, so an existing install changes nothing. It does not replace the private
network: a token on an internet-exposed port is still an internet-exposed browser.

## /upload-file

`POST /upload-file {url, label | selector | click, filename?}` downloads the URL on the bridge
machine and hands the file to a file input on the current page. The temp copy lives under the
system temp directory for an hour (the page reads it when the form submits) and is then swept.
Size cap: 512 MiB (536870912 bytes). `CAB_UPLOAD_MAX_BYTES` may reduce this hard ceiling.
The bridge streams bytes with backpressure to a mode-0600 temporary file and hands its path to
Chrome through CDP. File contents never pass through MCP or base64. The transfer has a ten-minute
total deadline and a thirty-second idle timeout; partial and rejected downloads are removed.
Successful files are retained for one hour so the page can read them, with startup and periodic
cleanup. Reservations across profiles cap retained and in-flight temporary storage at 2 GiB,
with 256 MiB of free space left in reserve. A single bridge accepts one upload at a time.

Remote media must use public HTTPS on the default port, without URL credentials or fragments.
Every DNS result and every redirect is checked against private, loopback, link-local, CGNAT,
multicast and reserved address ranges, then the validated IP is pinned to the request. Responses
are streamed even when Content-Length is absent, and the byte cap is enforced while streaming.
Request logs omit file URLs, including signed URL query parameters.

`GET /capabilities` (same bearer policy as other actions) is the source for the effective configured
transport limit. The waker forwards that exact object as `upload_capabilities` in each Planino
checkin and immediately before starting a queued runner. An unreachable or old bridge sends null
so Planino can refuse media jobs instead of trusting a stale limit. Destination platform limits
remain separate and may be smaller or undocumented.


Large-file path uploads require the gateway and Chrome to share one local filesystem, with a
loopback CDP endpoint. The pinned Playwright version receives `isLocal:true` only for loopback
CDP hosts so it uses a disk path instead of its remote 50 MiB buffer/base64 fallback. A remote
CDP URL advertises upload unavailable (`available:false`, `maxBytes:0`) and rejects before
fetching any media. Operators must not point a loopback CDP URL at a tunnel to a remote browser.

Controlled verification: `CAB_TEST_VIDEO_URL=<existing-public-https-video> node --test
test/large-transfer.test.mjs` downloads the source read-only, uses a disposable headless Chrome
profile and a plain local input with no submit control, checks HTTP/MCP rejection parity,
compares the streamed checksum, reads the browser File's size/type, and removes the test copy.

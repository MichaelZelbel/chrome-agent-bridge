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

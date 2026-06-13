# Chrome Agent Bridge

> Control a real logged-in Chrome browser from AI agents over a private network.

A small HTTP gateway that runs on **Windows, macOS, or Linux** and exposes
a handful of safe browser actions to remote AI agents. The agents drive a
real Chrome window — with your real, persistent logins — so they can use
sites that block headless browsers or require authentication (LinkedIn,
Discord, internal dashboards, etc.).

**Platform support:**

- **Windows 10 / 11** (x64 and ARM64) — `.bat` launcher + Task Scheduler auto-start
- **macOS 12 (Monterey) or newer** (Intel and Apple Silicon) — POSIX shell launcher + launchd LaunchAgent auto-start
- **Linux** with systemd (Ubuntu 22.04+, Fedora, Arch, Debian 12+, etc.) — POSIX shell launcher + systemd-user auto-start

This is **not** a CDP endpoint exposed to the network. Chrome's remote
debugging port is bound to `127.0.0.1` only. The gateway is the **only**
surface that listens on the private network.

---

## Architecture

```
        AI Agent on VPS
               │
               │   private network (e.g. Tailscale)
               ▼
   Your laptop  (Windows / macOS / Linux)
               │
               │   local HTTP gateway  (0.0.0.0:3007)
               ▼
   Chrome with dedicated user-data-dir
               │
               │   CDP on 127.0.0.1:9222 only
               ▼
       Logged-in websites
```

---

## What this is

- A ~120-line Express + Playwright server.
- A Windows batch launcher that starts Chrome with the right flags and a
  dedicated profile, then starts the gateway.
- An agent prompt that teaches an LLM when and how to use the bridge.

## When to use it

- Your agent needs to read or interact with a site that requires login.
- The site blocks headless / datacenter IP traffic.
- You want a stable, persistent browser session your agent can drive.
- You can run the bridge on a trusted PC reachable over a private network.

## When not to use it

- For public, scrape-friendly sites — use a normal headless tool.
- On a shared, untrusted, or always-internet-exposed machine.
- When you need strong multi-tenant isolation, full audit logging, or
  per-request authentication out of the box. The bridge is intentionally
  minimal.

---

## ⚠️ Security warning — read this first

The gateway grants its caller **full control of whatever Chrome profile you
point it at**. Treat access to port 3007 as equivalent to logging in as
you on every site you've signed into in that profile.

- ❌ **Never expose Chrome remote debugging to the public internet.**
- ✅ Keep `--remote-debugging-address=127.0.0.1`.
- ✅ Only expose the gateway over a trusted private network (Tailscale,
  WireGuard, private VPC, or `localhost`).
- ❌ Do not run this on a shared or untrusted machine.
- ❌ Do not store secrets, cookies, or tokens in the repository.
- ✅ Use a **dedicated** Chrome profile, not your daily personal browser.
- ✅ Review what your agent is allowed to do before giving it access.

See [`docs/security.md`](docs/security.md) for the full threat model.

---

## Easy install (recommended for end users)

If you just want the bridge running on your PC and don't want to think about Node.js, npm, or PowerShell flags — use the easy installer. It checks prerequisites, installs Node.js if missing, runs `npm install`, sets up auto-start, and verifies the gateway is responding. One double-click.

**Stable direct-download links** (always resolve to the newest release):

- Windows: <https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-windows.zip>
- macOS: <https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-macos.tar.gz>
- Linux: <https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-linux.tar.gz>

### Windows

1. Download [`chrome-agent-bridge-windows.zip`](https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-windows.zip).
2. Extract anywhere (right-click → *Extract All…*).
3. Double-click **`setup.bat`** in the extracted folder.
4. If Windows SmartScreen warns ("Windows protected your PC"): click *More info* → *Run anyway*. The script is unsigned — that's expected for a free open-source tool. Inspect the source first if you'd rather.
5. The installer handles everything end-to-end. When it's done a Chrome window opens — log into the sites your agent should use, and you're done.

### macOS

1. Download [`chrome-agent-bridge-macos.tar.gz`](https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-macos.tar.gz).
2. Double-click in Finder to extract.
3. Double-click **`setup.command`** in the extracted folder.
4. Gatekeeper will refuse the first time ("cannot be opened because it is from an unidentified developer"). Open *System Settings → Privacy & Security*, scroll to the security message about `setup.command`, click *Open Anyway*. (Or right-click → *Open* → *Open*.) Apple charges $99/year for a developer ID; the project doesn't have one yet.
5. The installer handles everything end-to-end (Homebrew if missing, Node.js, npm install, launchd setup, health check).

### Linux

Download [`chrome-agent-bridge-linux.tar.gz`](https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-linux.tar.gz), extract, run `bash setup.command`. Or, the manual one-liner:

```bash
git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git
cd chrome-agent-bridge && npm install && bash scripts/install-autostart-linux.sh
```

---

## Reset / uninstall on Windows (one-liner)

To wipe the bridge from a Windows PC so the next `setup.bat` install looks like a fresh machine — task scheduler entry gone, port 3007 + 3008 freed, default bridge folder removed, optional Chrome-profile wipe:

```powershell
irm https://raw.githubusercontent.com/MichaelZelbel/chrome-agent-bridge/main/scripts/reset-bridge.ps1 | iex
```

Runs as your user (no admin needed). Prompts for the Chrome-profile wipe so logged-in sessions aren't lost by accident. Idempotent. Touches nothing outside the bridge (leaves Tailscale, Node.js, Chrome, your shell config alone).

---

## Quick start (manual)

Pick your OS. Each path: clone, install deps, run launcher (manual), then optionally install auto-start so the bridge survives reboots.

### Windows 10 / 11

```powershell
git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git
cd chrome-agent-bridge
npm install
scripts\start-chrome-agent-bridge.bat
```

Auto-start (run once; sets up a Task Scheduler entry triggered at user logon, with restart-on-failure):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart-windows.ps1
```

Profile lives at `%LOCALAPPDATA%\ChromeAgentProfile`.

### macOS 12+

```bash
git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git
cd chrome-agent-bridge
npm install
chmod +x scripts/start-chrome-agent-bridge.sh
./scripts/start-chrome-agent-bridge.sh
```

Auto-start (run once; installs a launchd LaunchAgent with `KeepAlive` for crash recovery):

```bash
bash scripts/install-autostart-macos.sh
```

Profile lives at `~/Library/Application Support/ChromeAgentProfile`.

### Linux (Ubuntu 22.04+, Fedora, Arch, Debian 12+ — anything with systemd)

```bash
git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git
cd chrome-agent-bridge
npm install
chmod +x scripts/start-chrome-agent-bridge.sh
./scripts/start-chrome-agent-bridge.sh
```

Auto-start (run once; installs a systemd user unit with `Restart=on-failure`):

```bash
bash scripts/install-autostart-linux.sh
```

Profile lives at `~/.local/share/chrome-agent-profile`.

The installer asks (via sudo) to enable `loginctl enable-linger` so the gateway survives logout — important for headless laptops, optional for daily-use machines.

---

### Verify (any OS)

The launcher starts Chrome with CDP bound to `127.0.0.1:9222` and a dedicated profile, waits 5 seconds, then starts the gateway on `http://0.0.0.0:3007`. Log into the sites you need inside the dedicated Chrome window **once** — sessions persist across restarts.

From any other machine on the same private network:

```bash
curl http://<YOUR_LAPTOP_TAILSCALE_IP>:3007/health
# => {"status":"ok"}
```

---

## Per-OS setup details

- **Windows:** [`docs/setup-windows.md`](docs/setup-windows.md)
- **macOS / Linux:** the launcher auto-detects Chrome / Chromium in standard install locations. Override with `CHROME_BIN_OVERRIDE=/path/to/chrome` if you have it elsewhere.

### Uninstalling auto-start

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart-windows.ps1
```

```bash
# macOS
bash scripts/uninstall-autostart-macos.sh

# Linux
bash scripts/uninstall-autostart-linux.sh
```

---

## Tailscale setup (recommended private network)

Summary — full instructions in [`docs/tailscale.md`](docs/tailscale.md):

1. Install Tailscale on the Windows PC and on your agent host (e.g. VPS).
2. Sign both into the same tailnet.
3. On Windows: `tailscale ip -4` → that's `<YOUR_WINDOWS_TAILSCALE_IP>`.
4. From the agent host: `curl http://<YOUR_WINDOWS_TAILSCALE_IP>:3007/health`.
5. Point your agent at `http://<YOUR_WINDOWS_TAILSCALE_IP>:3007`.

Other private-network tools (WireGuard, ZeroTier, a private VPC) work the
same way — anything routable that you trust.

---

## Agent prompt

Drop [`prompts/agent-tool-prompt.md`](prompts/agent-tool-prompt.md) into
your agent's system prompt or tool description. It teaches the agent:

- The tool is called **PC Browser**.
- Aliases: "PC browser", "local browser", "my browser".
- The HTTP endpoints and bodies it accepts.
- That this is **not** CDP — never call `/json/version`.
- When to prefer this over the default browser tool.

---

## Test prompt

Use [`prompts/gateway-test-prompt.md`](prompts/gateway-test-prompt.md) to
sanity-check a fresh setup end-to-end. It walks the agent through health,
navigation, content, screenshot, type, press, click, and a stability loop
against neutral public sites (`example.com`, `google.com`).

---

## API reference

Base URL: `http://<host>:3007` (default port; configurable via `PORT`).

| Method | Path          | Body                                              | Returns                              |
|--------|---------------|---------------------------------------------------|--------------------------------------|
| GET    | `/health`     | —                                                 | `{ "status": "ok" }`                 |
| POST   | `/goto`       | `{ "url": "<url>" }`                              | `{ "success": true, "url": "..." }`  |
| GET    | `/content`    | —                                                 | full page HTML (text)                |
| GET    | `/screenshot` | —                                                 | PNG bytes (`image/png`)              |
| POST   | `/click`      | `{ "selector": "<css>" }`                         | `{ "success": true }`                |
| POST   | `/type`       | `{ "selector": "<css>", "text": "<text>" }`       | `{ "success": true }`                |
| POST   | `/press`      | `{ "key": "<key>" }`                              | `{ "success": true }`                |

Errors return HTTP 4xx/5xx with `{ "error": "<message>" }`.

The gateway reconnects to Chrome on every request — there is no global
stale page object — and never calls `browser.close()`, so your real Chrome
session is never killed by an agent action.

### Configuration

All env vars are optional:

| Variable  | Default                  | Notes                                              |
|-----------|--------------------------|----------------------------------------------------|
| `HOST`    | `0.0.0.0`                | Set to `127.0.0.1` for local-only.                 |
| `PORT`    | `3007`                   | Gateway listen port.                               |
| `CDP_URL` | `http://127.0.0.1:9222`  | Where the gateway connects to Chrome. Keep local.  |

---

## MCP server

Prefer giving your agent **first-class browser tools** over teaching it to call
this HTTP API by hand? The [`mcp/`](mcp) folder ships a small Model Context
Protocol server that exposes `pc_browser_open`, `pc_browser_read`,
`pc_browser_screenshot`, `pc_browser_click`, `pc_browser_type`,
`pc_browser_press`, and `pc_browser_health` over stdio. It is a thin, additive
proxy over the API above and does **not** change the gateway. See
[`mcp/README.md`](mcp/README.md).

---

## Multi-agent setup

Run multiple agents on the same PC with isolated profiles, CDP ports, and
gateway ports. See [`docs/multi-agent.md`](docs/multi-agent.md) for a
worked example:

| Agent   | Profile                              | CDP port | Gateway port |
|---------|--------------------------------------|----------|--------------|
| Agent A | `%LOCALAPPDATA%\ChromeAgentProfileA` | 9222     | 3007         |
| Agent B | `%LOCALAPPDATA%\ChromeAgentProfileB` | 9223     | 3008         |

---

## Troubleshooting

Common issues and fixes are in
[`docs/troubleshooting.md`](docs/troubleshooting.md), including:

- 404 on `/json/version` (expected — this is not CDP).
- 404 on `/click` (old gateway still running — restart `node`).
- Gateway up but browser not controlled (Chrome not started with the right
  flags).
- Port already in use.
- Tailscale IP changed.
- Screenshot timeouts.
- Chrome profile locked.
- Windows sleep killing automation.

---

## Support this project

The Chrome Agent Bridge is free and MIT licensed, and it stays that way.

If it's useful to you and you'd like to support the work, you can buy me a
coffee on Ko-fi. Supporters get my personal extended build, the OpenClaw
DevOps Kit. It bundles this bridge into a full hands-off OpenClaw setup: it
installs and onboards OpenClaw and Claude Code, wires the bridge in so an
agent on your server can drive a real logged-in Chrome, and adds a
watchdog, Telegram alerts, safe nightly upgrades, cost monitoring, and a
security audit. You end up with a DevOps assistant living on your server
that you can just ask to do things.

[Support on Ko-fi and get the OpenClaw DevOps Kit](https://ko-fi.com/s/8752f1ccc7)

Either way, thanks for using the bridge.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Michael Zelbel.

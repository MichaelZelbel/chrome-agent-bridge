# Windows 10 / 11 Setup

Two paths: the **easy installer** (recommended -- one double-click) or the
**manual quick start** (useful if you want fine control or are debugging a
broken install).

## Easy installer (recommended)

1. Download
   [`chrome-agent-bridge-windows.zip`](https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-windows.zip)
   from the latest release.
2. Extract anywhere (right-click → *Extract All…*).
3. Double-click **`setup.bat`**.
4. If Windows SmartScreen warns ("Windows protected your PC"): click
   *More info* → *Run anyway*. The script is unsigned -- expected for a
   free open-source tool. Inspect `scripts\windows-easy-install.ps1` first
   if you'd rather.

The installer:

- verifies Windows 10+,
- installs Node.js LTS via `winget` if missing,
- installs Google Chrome via `winget` if missing (with a y/n prompt; falls
  back to a manual install hint if `winget` is unavailable),
- runs `npm install` in the extracted folder,
- registers a Task Scheduler entry **`ChromeAgentBridge`** that starts Chrome
  + the gateway at every logon (with `RestartCount=3`, `RestartInterval=1min`
  as a first line of defense against crashes),
- verifies that `http://127.0.0.1:3007/health` responds within 30 seconds.

When it's done a Chrome window opens. Log into the sites your agent should
be able to use -- those logins persist in
`%LOCALAPPDATA%\ChromeAgentProfile` and survive reboots.

That's it for the easy path. The rest of this document is for the manual
path.

## Manual quick start (advanced)

Skip this section unless the easy installer doesn't fit your workflow.

### 1. Install prerequisites

- **Node.js 18+** -- https://nodejs.org/ -- install with defaults.
  Verify in PowerShell:
  ```powershell
  node -v
  npm -v
  ```
- **Google Chrome** -- https://www.google.com/chrome/ -- standard install
  to `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- **Git** (optional, only needed if you want `git clone` instead of a ZIP
  download) -- https://git-scm.com/.

### 2. Get the bridge

Either download the
[latest release ZIP](https://github.com/MichaelZelbel/chrome-agent-bridge/releases/latest/download/chrome-agent-bridge-windows.zip)
and extract it, or clone:

```powershell
git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git
cd chrome-agent-bridge
```

You can put the repo anywhere; the launcher script resolves paths relative
to itself.

### 3. Install dependencies

```powershell
npm install
```

Playwright would normally pull its own Chromium binary; the bridge
connects to your **real** Chrome over CDP, so the bundled Chromium is
never used at runtime.

### 4. Start the bridge once (interactive)

```powershell
scripts\start-chrome-agent-bridge.bat
```

This:

1. Locates `chrome.exe` under `Program Files`.
2. Launches Chrome with `--remote-debugging-port=9222`,
   `--remote-debugging-address=127.0.0.1`, `--disable-component-update`, and a
   dedicated `user-data-dir` at `%LOCALAPPDATA%\ChromeAgentProfile`.
   (`--disable-component-update` stops mid-session component churn; it does
   **not** stop Chrome upgrading its own binary — see
   [`troubleshooting.md`](troubleshooting.md).)
3. Waits 5 seconds.
4. Starts the gateway on port `3007`.

The gateway's stdout/stderr is redirected to
`%LOCALAPPDATA%\ChromeAgentBridge\gateway-3007.log` (per-port suffix so
multi-agent logs don't interleave). Tail it from another PowerShell when
you want to see what the gateway is doing:

```powershell
Get-Content -Tail 20 -Wait "$env:LOCALAPPDATA\ChromeAgentBridge\gateway-3007.log"
```

Confirm the gateway is up:

```powershell
Invoke-RestMethod http://127.0.0.1:3007/health
# status : ok
```

### 5. Log into the websites you need

Inside the dedicated Chrome window that just opened, log into the sites
you want your agent to access (LinkedIn, Discord, internal dashboards,
etc.). Credentials persist in `%LOCALAPPDATA%\ChromeAgentProfile` and
survive reboots. **Don't sign into your personal accounts here unless you
accept that an agent with access to the gateway can act as you on those
sites.**

### 6. Auto-start at logon (recommended)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart-windows.ps1
```

Registers a Task Scheduler entry `ChromeAgentBridge` that launches the
bat at every logon, with restart-on-failure as a backstop. This is the
same task the easy installer creates. To remove it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart-windows.ps1
```

A Startup-folder shortcut to the bat *also* works but does not restart on
crash, so the Task Scheduler entry is what the rest of the docs assume.

For more than one agent on the same PC, see
[`multi-agent.md`](multi-agent.md).

### 7. Keep the machine awake

The agent can't talk to a sleeping PC. See
[`troubleshooting.md`](troubleshooting.md) for power-plan recommendations.

## Configuration / overrides

The launcher accepts these env vars (used by [`multi-agent.md`](multi-agent.md)
to register additional agents, but useful for ad-hoc runs too):

| Variable           | Default                                  |
|--------------------|------------------------------------------|
| `CAB_PROFILE_DIR`  | `%LOCALAPPDATA%\ChromeAgentProfile`      |
| `CAB_CDP_PORT`     | `9222`                                   |
| `CAB_CDP_ADDRESS`  | `127.0.0.1` (don't change this lightly)  |
| `CAB_GATEWAY_PORT` | `3007`                                   |
| `CAB_GATEWAY_HOST` | `0.0.0.0`                                |

Example -- run the bridge against a different profile on a different port,
just once:

```powershell
$env:CAB_PROFILE_DIR  = "$env:LOCALAPPDATA\ChromeAgentProfile-test"
$env:CAB_GATEWAY_PORT = 3010
scripts\start-chrome-agent-bridge.bat
```

# Windows 11 Setup

Step-by-step setup for the Windows 11 host that will run Chrome and the
gateway.

## 1. Install prerequisites

- **Node.js LTS** — https://nodejs.org/ — install with default options.
  Verify in PowerShell:
  ```powershell
  node -v
  npm -v
  ```
- **Google Chrome** — https://www.google.com/chrome/ — standard install in
  `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- **Git** (optional, for cloning) — https://git-scm.com/.

## 2. Clone the repository

```powershell
cd C:\
git clone https://github.com/<YOUR_GITHUB_USERNAME>/chrome-agent-bridge.git
cd chrome-agent-bridge
```

You can place the repo anywhere; the launcher script resolves paths relative
to itself.

## 3. Install dependencies

```powershell
npm install
```

Playwright pulls in its own Chromium binary by default, but the bridge
connects to your **real** Chrome over CDP, so the bundled Chromium is not
used at runtime.

## 4. Start the bridge

Double-click or run:

```
scripts\start-chrome-agent-bridge.bat
```

This:

1. Locates `chrome.exe` under Program Files.
2. Launches Chrome with `--remote-debugging-port=9222`,
   `--remote-debugging-address=127.0.0.1`, and a dedicated user-data-dir at
   `%LOCALAPPDATA%\ChromeAgentProfile`.
3. Waits 5 seconds.
4. Starts the gateway on port `3007`.

You should see:

```
Chrome Agent Bridge gateway listening on http://0.0.0.0:3007
Connecting to Chrome via CDP at http://127.0.0.1:9222
```

## 5. Log into the websites you need

Inside the dedicated Chrome window that just opened, log into the sites you
want your agent to access (LinkedIn, Discord, internal dashboards, etc.).
These credentials persist in `%LOCALAPPDATA%\ChromeAgentProfile` and survive
restarts. **Do not log into your daily personal accounts here unless you
understand the risk.**

## 6. (Optional) Run on startup

To start the bridge automatically when you log in:

1. Press `Win + R`, type `shell:startup`, press Enter.
2. Right-click in the Startup folder → New → Shortcut.
3. Point the shortcut at `scripts\start-chrome-agent-bridge.bat`.
4. Reboot to confirm it launches.

## 7. Keep the machine awake

The agent cannot talk to a sleeping PC. See
[`troubleshooting.md`](troubleshooting.md) for power-plan recommendations.

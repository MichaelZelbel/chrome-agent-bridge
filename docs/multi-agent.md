# Multi-Agent Setup

You can run several independent agents on the same Windows PC, each with
its own Chrome profile, CDP port, and gateway port. This is useful when
different agents need different logins (e.g., one agent on Account A's
Discord, another on Account B's LinkedIn).

## Per-agent isolation

Each agent gets:

| Resource              | Agent A                            | Agent B                            |
|-----------------------|------------------------------------|------------------------------------|
| Chrome profile dir    | `%LOCALAPPDATA%\ChromeAgentProfileA` | `%LOCALAPPDATA%\ChromeAgentProfileB` |
| Chrome CDP port       | `9222`                             | `9223`                             |
| Gateway port          | `3007`                             | `3008`                             |

Profiles must not be shared — Chrome will refuse to open the same
`user-data-dir` from two processes.

## Recipe

Make a copy of `scripts/start-chrome-agent-bridge.bat` per agent and edit:

### `start-agent-a.bat`

```bat
set "USER_DATA_DIR=%LOCALAPPDATA%\ChromeAgentProfileA"
set "CDP_PORT=9222"
...
start "" "%CHROME_EXE%" ^
    --remote-debugging-port=%CDP_PORT% ^
    --remote-debugging-address=127.0.0.1 ^
    --user-data-dir="%USER_DATA_DIR%"

timeout /t 5 /nobreak >nul

cd /d "%~dp0..\gateway"
set HOST=0.0.0.0
set PORT=3007
set CDP_URL=http://127.0.0.1:9222
node index.js
```

### `start-agent-b.bat`

```bat
set "USER_DATA_DIR=%LOCALAPPDATA%\ChromeAgentProfileB"
set "CDP_PORT=9223"
...
start "" "%CHROME_EXE%" ^
    --remote-debugging-port=%CDP_PORT% ^
    --remote-debugging-address=127.0.0.1 ^
    --user-data-dir="%USER_DATA_DIR%"

timeout /t 5 /nobreak >nul

cd /d "%~dp0..\gateway"
set HOST=0.0.0.0
set PORT=3008
set CDP_URL=http://127.0.0.1:9223
node index.js
```

The gateway reads `HOST`, `PORT`, and `CDP_URL` from the environment, so no
code changes are needed.

## In each agent's prompt

Point each agent at its own gateway URL:

- Agent A: `http://<YOUR_WINDOWS_TAILSCALE_IP>:3007`
- Agent B: `http://<YOUR_WINDOWS_TAILSCALE_IP>:3008`

## Practical notes

- Each Chrome window is a separate visible process; don't be surprised when
  you see multiple Chrome instances running.
- Logging into the same site in two profiles works fine — they're isolated
  cookie jars.
- RAM cost grows with the number of profiles. Two profiles is comfortable
  on 16 GB; more starts to hurt.
- If you reuse the same `<YOUR_WINDOWS_TAILSCALE_IP>` for many gateways,
  Tailscale ACLs can restrict which tailnet members reach which ports.

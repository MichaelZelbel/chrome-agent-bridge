# Multi-Agent Setup

You can run several independent agents on the same PC, each with its own
Chrome profile (= its own cookie jar / set of logged-in sites), its own
CDP port, and its own gateway port. Useful when different agents need
different logins -- e.g., one agent on Account A's Discord, another on
Account B's LinkedIn.

## Per-agent isolation

Each agent needs three distinct things:

| Resource             | Default install         | Agent `B` (example)      |
|----------------------|-------------------------|--------------------------|
| Chrome profile dir   | `ChromeAgentProfile`    | `ChromeAgentProfileB`    |
| Chrome CDP port      | `9222`                  | `9223`                   |
| Gateway listen port  | `3007`                  | `3008`                   |

Profiles must not be shared -- Chrome refuses to open the same
`user-data-dir` from two processes. CDP ports and gateway ports must each
be unique and free on the PC.

The default `setup.bat` install gives you one agent at the "Default" column
above. Use the recipes below to add a second, third, etc.

## Windows -- one-liner per additional agent

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-multi-agent.ps1 -Letter B
```

That's the entire happy path. It:

1. Writes a tiny wrapper `scripts\start-agent-B.bat` that sets the right
   CAB_* env vars and calls the canonical `start-chrome-agent-bridge.bat`.
2. Registers Task Scheduler entry `ChromeAgentBridgeB` (logon trigger,
   restart-on-failure, hidden window) pointed at that wrapper.
3. Starts the task immediately so the new Chrome window opens right away.

Defaults: Agent B uses profile `%LOCALAPPDATA%\ChromeAgentProfileB`,
CDP port `9223`, gateway port `3008`.

For a third, fourth, etc. agent, pass different ports:

```powershell
.\scripts\install-multi-agent.ps1 -Letter C -CdpPort 9224 -GatewayPort 3009
.\scripts\install-multi-agent.ps1 -Letter D -CdpPort 9225 -GatewayPort 3010
```

Pre-flight check: the script warns up front if a requested port is already
in use on this PC, so you don't end up with a registered task whose gateway
fails to bind on every restart.

### Log into the per-agent sites

The new Chrome window is a clean profile -- no cookies, no logins. Sign in
to whatever sites this specific agent should be able to use. Those logins
persist in `%LOCALAPPDATA%\ChromeAgentProfileB` and survive reboots.

### Point the agent at its own gateway

| Agent           | Gateway URL                                   |
|-----------------|-----------------------------------------------|
| Default agent   | `http://<this-PC-tailnet-IP>:3007`            |
| Agent B         | `http://<this-PC-tailnet-IP>:3008`            |
| Agent C         | `http://<this-PC-tailnet-IP>:3009`            |

### Removing an agent

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-multi-agent.ps1 -Letter B -GatewayPort 3008
```

That unregisters the task, stops the running gateway + Chrome for this
agent, and deletes the wrapper bat. The Chrome profile data is
**preserved** -- delete it manually if you want to forget the logins:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\ChromeAgentProfileB"
```

## macOS / Linux -- env vars to the existing launcher

The POSIX launcher (`scripts/start-chrome-agent-bridge.sh`) reads the same
env-var contract directly -- no file duplication needed:

```bash
CAB_PROFILE_DIR="$HOME/.local/share/chrome-agent-profile-b" \
CAB_CDP_PORT=9223 \
CAB_GATEWAY_PORT=3008 \
  ./scripts/start-chrome-agent-bridge.sh
```

For boot-autostart on macOS / Linux, you'd register a second launchd
LaunchAgent or systemd user unit that exports those env vars before
invoking the launcher (mirror of the Windows wrapper-bat approach, just
translated to plist `EnvironmentVariables` or systemd `Environment=`
directives). We don't ship a dedicated multi-agent installer for macOS /
Linux yet -- PRs welcome.

## Env-var contract

The launcher accepts these on every OS:

| Variable           | Default (Windows)                              | Default (macOS)                                                  | Default (Linux)                              |
|--------------------|------------------------------------------------|------------------------------------------------------------------|----------------------------------------------|
| `CAB_PROFILE_DIR`  | `%LOCALAPPDATA%\ChromeAgentProfile`            | `~/Library/Application Support/ChromeAgentProfile`               | `~/.local/share/chrome-agent-profile`        |
| `CAB_CDP_PORT`     | `9222`                                         | `9222`                                                           | `9222`                                       |
| `CAB_CDP_ADDRESS`  | `127.0.0.1`                                    | `127.0.0.1`                                                      | `127.0.0.1`                                  |
| `CAB_GATEWAY_PORT` | `3007`                                         | `3007`                                                           | `3007`                                       |
| `CAB_GATEWAY_HOST` | `0.0.0.0`                                      | `0.0.0.0`                                                        | `0.0.0.0`                                    |

The launcher translates them into the env vars `gateway/index.js` itself
reads (`HOST`, `PORT`, `CDP_URL`). Don't change `CAB_CDP_ADDRESS` away
from `127.0.0.1` unless you fully understand the security model -- see
[`security.md`](security.md).

## Practical notes

- Each agent's Chrome is a separate visible process. Don't be surprised
  to see several Chrome instances running.
- Logging into the same site under two profiles works fine -- they're
  isolated cookie jars.
- RAM cost grows with the number of profiles. Two agents is comfortable
  on 16 GB; more starts to hurt. Watch with Task Manager / `htop`.
- Per-port log files live at
  `%LOCALAPPDATA%\ChromeAgentBridge\gateway-<port>.log` on Windows;
  `journalctl --user -u chrome-agent-bridge` covers all systemd units on
  Linux; macOS logs end up under `~/Library/Logs/chrome-agent-bridge/`
  when the launchd agent is in use.
- If you reuse the same Tailscale IP for many gateways, Tailscale ACLs
  can restrict which tailnet members reach which ports -- useful if you
  want Agent A reachable from the team's VPS but Agent B only from your
  laptop.

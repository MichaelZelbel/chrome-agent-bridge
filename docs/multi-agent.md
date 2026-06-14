# Adding more agents (second, third, ...) on the same PC

You've already installed the bridge with `setup.bat`. You now have **one
agent** running on gateway port 3007, with its own Chrome window and its
own logged-in sites.

This page is about adding a **second agent** -- so one AI can act as
Account A on Discord while another acts as Account B, both on the same
laptop, both surviving reboots, neither stepping on the other.

## Windows -- the easy way

In the folder where you extracted the bridge (the one that contains
`setup.bat`), **double-click `add-agent.bat`**.

A small console window opens and shows:

```
============================================================
 Chrome Agent Bridge -- add another agent
============================================================

Your default agent uses gateway port 3007. This adds a new
agent with its OWN empty Chrome profile and its OWN port.

Pick a letter -- it determines the port automatically:
  B   second agent,  gateway port 3008
  C   third agent,   gateway port 3009
  D   fourth agent,  gateway port 3010   (and so on)

Letter (just press Enter for B):
```

Press Enter. That's the whole interaction. You'll see Windows ask
"Do you want to allow this app to make changes?" -- click Yes.

### What you get afterwards (automatic, no thinking required)

- A new Chrome window opens with an **empty** profile -- no cookies, no
  logins. Sign into the sites THIS agent should be allowed to use
  (your secondary Discord, a different LinkedIn account, etc.). Those
  logins persist in `%LOCALAPPDATA%\ChromeAgentProfileB` across reboots.
- A Windows Task Scheduler entry called `ChromeAgentBridgeB` is registered.
  This starts Agent B every time you log into Windows, and restarts it
  automatically if it crashes. **You don't need to do anything to keep it
  running** -- not after this install, not after a reboot, not ever.
- Your AI agent (the one that drives the browser) should now point at:
  ```
  http://<your-PC's-tailnet-IP>:3008
  ```
  Agent A is still on `:3007` and is unchanged.

That's it.

### Adding a third / fourth agent

Double-click `add-agent.bat` again. Type **C** for the third agent
(gateway 3009), **D** for the fourth (3010), and so on. Each letter is
its own isolated agent.

### Removing an agent

Double-click `remove-agent.bat`. Type the letter (e.g. `B`). It:

- stops the running gateway and Chrome window for Agent B,
- removes the Task Scheduler entry, so it won't start at next logon,
- deletes the wrapper script that `add-agent.bat` had generated.

Your Chrome **profile is preserved on disk**. If you re-add Agent B later,
all your logins are still there. To really wipe the logins, delete the
profile folder by hand:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\ChromeAgentProfileB"
```

`remove-agent.bat` will **never touch** your default agent (port 3007) --
that one is removed by `scripts\uninstall-autostart-windows.ps1`.

## Where things live

For Agent B (and analogously for C, D, ...):

| What                  | Where                                                  |
|-----------------------|--------------------------------------------------------|
| Chrome window/profile | `%LOCALAPPDATA%\ChromeAgentProfileB`                   |
| Auto-start entry      | Task Scheduler -> `ChromeAgentBridgeB`                 |
| Gateway log           | `%LOCALAPPDATA%\ChromeAgentBridge\gateway-3008.log`    |
| Gateway URL           | `http://<your-PC-tailnet-IP>:3008`                     |
| Wrapper script        | `scripts\start-agent-B.bat`  (generated, don't edit)   |
| Chrome's debug port   | `127.0.0.1:9223` (Chrome's CDP -- never network-exposed) |

The default agent's profile (`ChromeAgentProfile`, no letter suffix) and
port 3007 are not touched.

## Practical notes

- Each agent runs its own visible Chrome window. With three agents you'll
  see three Chrome windows at every logon. That's normal.
- Logging into the same site under multiple profiles works fine -- each
  profile is its own isolated cookie jar.
- Memory: a running Chrome with one busy tab costs ~500 MB. Two agents on
  16 GB is comfortable; more starts to hurt -- check Task Manager.
- If you share one PC IP across several agents on Tailscale, you can use
  Tailscale ACLs to control which tailnet members can reach which port.
- The first time you double-click `add-agent.bat`, Windows may show
  "Windows protected your PC" (SmartScreen) because the script isn't
  signed. Click *More info* -> *Run anyway*. Same as `setup.bat`.

## macOS / Linux

On macOS and Linux, the launcher (`scripts/start-chrome-agent-bridge.sh`)
already reads the same configuration knobs from environment variables
directly. You don't need to duplicate any file -- you just run the
launcher with different env values for each agent:

```bash
CAB_PROFILE_DIR="$HOME/.local/share/chrome-agent-profile-b" \
CAB_CDP_PORT=9223 \
CAB_GATEWAY_PORT=3008 \
  ./scripts/start-chrome-agent-bridge.sh
```

For boot-time auto-start, register a second launchd LaunchAgent (macOS) or
systemd user unit (Linux) per agent, each exporting the right env vars
before invoking the launcher. We don't yet ship a dedicated multi-agent
helper for these platforms -- contributions welcome.

## Advanced -- non-letter names and custom ports

The double-click `add-agent.bat` handles 95 % of cases by typing one
letter. If you want a non-letter name (`work`, `personal`, `demo-2`) or
specific ports, open a PowerShell **inside the bridge folder** (the one
containing `setup.bat`) and run the underlying script directly:

```powershell
.\scripts\install-multi-agent.ps1 -Letter work -CdpPort 9230 -GatewayPort 3020
```

To open PowerShell in the right folder: in File Explorer, right-click any
empty area inside the bridge folder and pick *Open in Terminal* (Windows
11) or hold Shift while right-clicking and pick *Open PowerShell window
here* (Windows 10).

Full configuration knobs (used by both the easy and the advanced path):

| Variable           | Default                                  |
|--------------------|------------------------------------------|
| `CAB_PROFILE_DIR`  | `%LOCALAPPDATA%\ChromeAgentProfile`      |
| `CAB_CDP_PORT`     | `9222`                                   |
| `CAB_CDP_ADDRESS`  | `127.0.0.1` -- don't change unless you read [`security.md`](security.md) |
| `CAB_GATEWAY_PORT` | `3007`                                   |
| `CAB_GATEWAY_HOST` | `0.0.0.0`                                |

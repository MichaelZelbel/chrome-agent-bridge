# Troubleshooting

Common failure modes and how to fix them.

---

## "404 on `/json/version`"

**Expected.** The bridge is **not** a CDP endpoint. It does not implement
DevTools Protocol HTTP discovery routes. Make sure your agent is calling
the bridge endpoints (`/health`, `/goto`, etc.) instead of CDP paths.

If your agent insists on calling `/json/version` to "verify the browser",
remove that step from its prompt — see
[`prompts/agent-tool-prompt.md`](../prompts/agent-tool-prompt.md).

---

## `/click` (or another endpoint) returns 404

You're hitting an old `node` process running an older version of the
gateway that didn't have that endpoint.

Fix:

1. Open the terminal window the gateway is running in.
2. `Ctrl+C` to stop it.
3. Re-run `scripts\start-chrome-agent-bridge.bat`.

If the batch window is gone, find and kill the old process:

```powershell
Get-Process node | Stop-Process
```

Then relaunch.

---

## Gateway is reachable but the browser is not controlled

Symptom: `/health` may return 200, but `/goto` returns
`Cannot connect to Chrome at http://127.0.0.1:9222`.

Means: Chrome is running but **without** the CDP flags, or a different
Chrome instance grabbed the user-data-dir first.

Fix:

1. Close all Chrome windows.
2. Confirm no `chrome.exe` is left running:
   ```powershell
   Get-Process chrome -ErrorAction SilentlyContinue
   ```
   If any remain, stop them.
3. Re-run `scripts\start-chrome-agent-bridge.bat`. This guarantees Chrome
   launches with `--remote-debugging-port=9222`.

---

## Chrome updated and the bridge lost its connection

Symptom: everything worked, then after a while `/goto` (and friends) start
returning `Cannot connect to Chrome at http://127.0.0.1:9222` even though both
Chrome and the gateway are clearly still running.

Cause: Chrome upgraded its own binary in the background (via **Google Update** on
Windows, **Keystone** on macOS, or the **package manager** on Linux — none of
which read Chrome's command line) and then **relaunched Chrome with its default
command line**. The new Chrome process no longer has `--remote-debugging-port`,
so its CDP endpoint is gone and the gateway cannot reconnect.

Important: the launcher passes `--disable-component-update`, which stops *Chrome
components* from churning mid-session, but **it does not and cannot stop the
browser binary from being upgraded** — that is a separate OS-level updater.

Fix (immediate): close all Chrome windows for the bridge profile, confirm none
remain (`Get-Process chrome`), and re-run the launcher so Chrome comes back up
*with* the debugging flags. (The gateway auto-reconnects once a flagged Chrome is
running again.)

Prevent it (choose your trade-off):

- **Only ever start Chrome via the launcher**, and don't click Chrome's
  "Relaunch to update" button in the bridge profile — let it relaunch through the
  launcher instead.
- **Disable Chrome auto-update at the OS level.** This is the only way to truly
  stop the binary upgrade. On Windows it is a registry / Group Policy change
  (`HKLM\SOFTWARE\Policies\Google\Update`, `UpdateDefault=0` plus the
  per-app `Update{8A69D345-...}` value); on macOS, disable Keystone; on Linux,
  pin/hold the Chrome package. **Trade-off:** you also stop Chrome *security*
  updates, so only do this on a dedicated, locked-down automation profile and
  update it manually on a schedule.

---

## "Port already in use" / `EADDRINUSE`

Another process is using port `3007` (or `9222`).

```powershell
# What's holding 3007?
netstat -ano | Select-String ":3007"
# Look up the PID
Get-Process -Id <pid>
```

Either stop the offending process or change the gateway port:

```powershell
$env:PORT = "3017"
node gateway\index.js
```

---

## Tailscale IP changed or wrong device selected

Tailscale IPs are stable per device but change if you reinstall or join a
different tailnet.

Recheck on the Windows PC:

```powershell
tailscale ip -4
```

Update your agent prompt with the new value, or pin the IP via the
Tailscale admin console.

---

## Screenshot timeout

Usually means the page is still loading (heavy SPA, redirects, captcha) or
an animation never settles.

- Retry once after a `/goto` and short delay.
- If a captcha is blocking, you'll need to solve it in the visible Chrome
  window manually before the agent can continue.
- For long pages, the bridge intentionally captures the **viewport only**
  (`fullPage: false`) to avoid timeouts.

---

## "Chrome profile is already in use"

Chrome refuses to open the same `user-data-dir` from two processes. This
happens when:

- A previous launcher invocation is still alive, or
- You opened that profile manually and never closed it.

Close all Chrome windows for that profile, confirm with
`Get-Process chrome`, and relaunch.

---

## Windows sleep breaks automation

When the PC sleeps, Chrome and the gateway stop responding to network
requests. The agent will see timeouts.

Mitigations:

- **Power Options → High performance** (or balanced with sleep disabled
  while plugged in).
- `powercfg /change standby-timeout-ac 0` to disable sleep on AC.
- `powercfg /change monitor-timeout-ac 0` if you also want to keep the
  display on.
- Disable "USB selective suspend" if the keyboard / mouse are USB and the
  machine drops the network on idle.

The display **can** turn off — sleep is the problem, not screen-off.

---

## Slow first request after idle

The first `connectOverCDP` on an idle Chrome can take a few seconds. The
gateway has a 15s default timeout per page, which usually absorbs this.
If it does not, retry the request.

---

## Agent keeps using its default browser instead of the bridge

The agent's prompt is not strong enough. Make sure your prompt includes
the wording from
[`prompts/agent-tool-prompt.md`](../prompts/agent-tool-prompt.md),
especially the routing rules (use PC Browser when login required, when the
user says "PC browser", etc.).

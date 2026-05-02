# Tailscale Setup

The gateway is designed to be reached over a **trusted private network**.
Tailscale is the recommended option because it gives you a stable IP per
device, NAT traversal, and ACLs without exposing anything to the public
internet.

> Other options (WireGuard, Twingate, ZeroTier, a private VPC) work the same
> way — anywhere you have a private layer-3 network between the agent host
> and the Windows PC.

## 1. Install Tailscale

- **Windows PC:** https://tailscale.com/download/windows
- **Agent host (e.g. VPS):** https://tailscale.com/download/linux

Sign in to the **same tailnet** on both devices.

## 2. Find the Windows Tailscale IP

On the Windows PC, open PowerShell:

```powershell
tailscale ip -4
```

You'll get something like `100.x.y.z`. This is `<YOUR_WINDOWS_TAILSCALE_IP>`.

## 3. Test reachability from the agent host

From the VPS / agent machine:

```bash
curl http://<YOUR_WINDOWS_TAILSCALE_IP>:3007/health
```

Expected response:

```json
{"status":"ok"}
```

If you get connection refused, verify:

- The bridge is running on the Windows PC.
- The Windows firewall allows inbound connections on port `3007` for the
  Tailscale interface (Tailscale usually creates a firewall rule
  automatically).
- Both devices show as connected in the Tailscale admin console.

## 4. Configure your agent

Point the agent at the Tailscale URL:

```
http://<YOUR_WINDOWS_TAILSCALE_IP>:3007
```

Use this in [`prompts/agent-tool-prompt.md`](../prompts/agent-tool-prompt.md).

## 5. Things NOT to do

- ❌ Do **not** expose port `3007` on a public IP.
- ❌ Do **not** change `--remote-debugging-address=127.0.0.1` to `0.0.0.0`.
  Chrome's CDP gives full control of the browser to anyone who can reach the
  port — never expose CDP, even over Tailscale. The HTTP gateway is the only
  surface that should be reachable.
- ❌ Do **not** rely on the Windows Tailscale IP being stable across
  reinstalls — pin it via the Tailscale admin console if you depend on it.

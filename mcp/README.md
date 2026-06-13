# Chrome Agent Bridge — MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the Chrome Agent Bridge as first-class agent tools (`pc_browser_*`).

It is a **thin, additive proxy**: it only makes HTTP calls to the bridge's
existing REST API (`/goto`, `/content`, …). It does **not** modify the bridge,
Chrome, the CDP connection, or anything on the PC side — the bridge in
[`../gateway`](../gateway) stays exactly as it is. Run this wherever your MCP
**client** lives (e.g. the agent host / VPS) and point it at a running bridge.

## Why this exists

Many agents have built-in web/browser tools, but those run on the agent's own
host (often a datacenter IP) and frequently enforce an **SSRF guard that rejects
private / Tailscale (CGNAT) addresses** — so they can't even reach the bridge,
and they get blocked by login-gated sites anyway. This MCP server makes the HTTP
call to the bridge itself, so the agent gets working browser tools without
relaxing any of its own safety guards, and those tools drive the user's *real*
logged-in Chrome.

## Tools

| Tool | Bridge endpoint | Purpose |
|------|-----------------|---------|
| `pc_browser_open(url)`            | `POST /goto`       | Navigate the user's real Chrome to a URL |
| `pc_browser_read()`               | `GET /content`     | Return the current page's HTML (truncated if large) |
| `pc_browser_screenshot()`         | `GET /screenshot`  | Screenshot the page (returned as an image) |
| `pc_browser_click(selector)`      | `POST /click`      | Click an element |
| `pc_browser_type(selector, text)` | `POST /type`       | Fill text into an element |
| `pc_browser_press(key)`           | `POST /press`      | Press a keyboard key (e.g. `Enter`) |
| `pc_browser_health()`             | `GET /health`      | Check the bridge is reachable |

## Install

```bash
cd mcp
npm install
```

## Configuration

Set `BRIDGE_URL` to a running bridge (see [`.env.example`](.env.example)):

- Bridge on the same machine: `http://127.0.0.1:3007`
- Agent reaches the bridge over Tailscale: `http://<bridge-tailnet-ip>:<port>`

## Register with an MCP client

The server speaks MCP over **stdio**. Register it as a stdio server.

**Hermes Agent:**
```bash
hermes mcp add chrome-bridge \
  --command node \
  --args /path/to/chrome-agent-bridge/mcp/server.js \
  --env BRIDGE_URL=http://<bridge-tailnet-ip>:<port>
# answer the "Enable all tools? [Y/n]" prompt
```

**Claude Desktop / generic MCP config:**
```json
{
  "mcpServers": {
    "chrome-bridge": {
      "command": "node",
      "args": ["/path/to/chrome-agent-bridge/mcp/server.js"],
      "env": { "BRIDGE_URL": "http://127.0.0.1:3007" }
    }
  }
}
```

## Notes

- Run it on the host where the MCP **client** runs (the agent), not necessarily
  on the PC running Chrome — point `BRIDGE_URL` across the private network.
- Output goes to the client; diagnostics go to **stderr** (stdout is the MCP
  JSON-RPC channel and is kept clean).
- This package is self-contained (its own `package.json`); installing it does
  not change the bridge's runtime dependencies.

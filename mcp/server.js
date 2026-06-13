#!/usr/bin/env node
/**
 * Chrome Agent Bridge — MCP server (stdio)
 * =========================================
 * Exposes the Chrome Agent Bridge's browser actions as Model Context Protocol
 * tools so any MCP-capable agent (Hermes, Claude Desktop, etc.) gets
 * first-class `pc_browser_*` tools instead of having to hand-craft HTTP calls.
 *
 * This is a THIN PROXY. It only makes HTTP requests to the bridge's existing
 * REST API (the `/goto`, `/content`, … endpoints in ../gateway/index.js). It
 * does NOT modify the bridge, Chrome, the CDP connection, or anything on the
 * PC side. Point it at a running bridge with the BRIDGE_URL env var.
 *
 * Why a proxy and not direct CDP: the bridge already owns the single Chrome
 * page, login tabs, screenshot determinism, and CDP-reconnect logic. The MCP
 * server stays dumb on purpose so the bridge remains the single source of
 * truth for browser behaviour.
 *
 * Why this matters for remote agents: an agent on a VPS reaching the bridge
 * over a private network (Tailscale) cannot use its own web/browser tools —
 * those enforce an SSRF guard that rejects private/CGNAT addresses. This MCP
 * server makes the HTTP call itself, so the agent gets working tools without
 * relaxing any of its own safety guards.
 *
 * Run on the host where the MCP client lives (e.g. the agent/VPS), pointed at
 * the bridge over the private network:
 *   BRIDGE_URL=http://<bridge-tailnet-ip>:<port> node server.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = (process.env.BRIDGE_URL || "http://127.0.0.1:3007").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = parseInt(process.env.BRIDGE_TIMEOUT_MS || "30000", 10);
const MAX_CONTENT_CHARS = parseInt(process.env.BRIDGE_MAX_CONTENT_CHARS || "60000", 10);

const OFFLINE_HINT =
  "Could not reach the Chrome Agent Bridge at " + BRIDGE_URL + ". " +
  "The machine running the bridge (and its Chrome) is probably offline, " +
  "asleep, or off the private network. Tell the user; do not retry in a loop.";

function textResult(text, isError = false) {
  return { content: [{ type: "text", text: String(text) }], isError };
}

async function bridgeFetch(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(BRIDGE_URL + path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callJson(method, path, body) {
  let res;
  try {
    res = await bridgeFetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return textResult(OFFLINE_HINT + " (" + err.message + ")", true);
  }
  const text = await res.text();
  return textResult(text, !res.ok);
}

const server = new McpServer({ name: "chrome-agent-bridge", version: "0.1.0" });

server.registerTool(
  "pc_browser_open",
  {
    title: "Open URL in the user's real Chrome",
    description:
      "Navigate the user's REAL logged-in Google Chrome (running on their own " +
      "machine, residential IP — looks human) to a URL. USE THIS for any site " +
      "that requires login or blocks bots/headless/datacenter IPs (LinkedIn, " +
      "X/Twitter, Discord, Gmail, banking, paywalls, internal dashboards, " +
      "Cloudflare 'verify you are human'). After opening, call pc_browser_read.",
    inputSchema: { url: z.string().describe("Absolute URL to open, e.g. https://example.com") },
  },
  async ({ url }) => callJson("POST", "/goto", { url })
);

server.registerTool(
  "pc_browser_read",
  {
    title: "Read current page HTML",
    description:
      "Return the current page's HTML from the user's Chrome (use after " +
      "pc_browser_open or an interaction). Truncated if very large.",
    inputSchema: {},
  },
  async () => {
    let res;
    try {
      res = await bridgeFetch("/content", { method: "GET" });
    } catch (err) {
      return textResult(OFFLINE_HINT + " (" + err.message + ")", true);
    }
    let text = await res.text();
    if (!res.ok) return textResult(text, true);
    if (text.length > MAX_CONTENT_CHARS) {
      text = text.slice(0, MAX_CONTENT_CHARS) + "\n<!-- [truncated by MCP server] -->";
    }
    return textResult(text);
  }
);

server.registerTool(
  "pc_browser_screenshot",
  {
    title: "Screenshot the current page",
    description:
      "Screenshot the current page in the user's Chrome and return it as an " +
      "image. Useful when the HTML is hard to interpret or to confirm a view.",
    inputSchema: {},
  },
  async () => {
    let res;
    try {
      res = await bridgeFetch("/screenshot", { method: "GET" });
    } catch (err) {
      return textResult(OFFLINE_HINT + " (" + err.message + ")", true);
    }
    if (!res.ok) return textResult(await res.text(), true);
    const buf = Buffer.from(await res.arrayBuffer());
    return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }] };
  }
);

server.registerTool(
  "pc_browser_click",
  {
    title: "Click an element",
    description: "Click an element (CSS selector) in the user's Chrome.",
    inputSchema: { selector: z.string().describe("CSS selector of the element to click") },
  },
  async ({ selector }) => callJson("POST", "/click", { selector })
);

server.registerTool(
  "pc_browser_type",
  {
    title: "Type into an element",
    description: "Fill text into an element (CSS selector) in the user's Chrome.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the input/textarea"),
      text: z.string().describe("Text to fill in"),
    },
  },
  async ({ selector, text }) => callJson("POST", "/type", { selector, text })
);

server.registerTool(
  "pc_browser_press",
  {
    title: "Press a keyboard key",
    description: "Press a keyboard key (e.g. 'Enter') in the user's Chrome.",
    inputSchema: { key: z.string().describe("Key name, e.g. 'Enter', 'Tab', 'ArrowDown'") },
  },
  async ({ key }) => callJson("POST", "/press", { key })
);

server.registerTool(
  "pc_browser_health",
  {
    title: "Check the bridge is reachable",
    description:
      "Check whether the user's Chrome Agent Bridge is reachable. Returns the " +
      "bridge status, or an offline notice if the machine is unreachable.",
    inputSchema: {},
  },
  async () => callJson("GET", "/health")
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP JSON-RPC channel and must stay clean.
  console.error(`[chrome-agent-bridge-mcp] ready; proxying ${BRIDGE_URL}`);
}

main().catch((err) => {
  console.error("[chrome-agent-bridge-mcp] fatal:", err);
  process.exit(1);
});

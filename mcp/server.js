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

const server = new McpServer({ name: "chrome-agent-bridge", version: "0.3.0" });

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
    title: "Type into an element (frame-aware, trusted keystrokes)",
    description:
      "Type text into an element (CSS selector) in the user's Chrome. Frame-aware " +
      "and, by default, sends TRUSTED keystrokes (real key events) so rich editors " +
      "that ignore programmatic value sets (Monaco, SAP UI5, contenteditable) " +
      "accept it. Use `frame` to reach a field nested in an iframe. Returns the " +
      "element's resulting value so you can verify what landed. Calling with just " +
      "{ selector, text } behaves like before (clears, then enters the text).",
    inputSchema: {
      selector: z.string().describe("CSS selector of the input/textarea, resolved inside `frame`"),
      text: z.string().describe("Text to enter"),
      frame: z.string().optional().describe("URL substring selecting a child iframe (default main frame)"),
      mode: z.enum(["sequential", "fill"]).optional().describe(
        "'sequential' = trusted per-key events (default); 'fill' = fast value set"),
      clear: z.boolean().optional().describe("Select-all + Delete before typing (default true)"),
    },
  },
  async ({ selector, text, frame, mode, clear }) =>
    callJson("POST", "/type", { selector, text, frame, mode, clear })
);

server.registerTool(
  "pc_browser_type_text",
  {
    title: "Type a string into the focused element (trusted keystrokes)",
    description:
      "Type a whole string as TRUSTED keystrokes into whatever element currently " +
      "has focus — no selector. Pairs with a focusing click (pc_browser_click, " +
      "pc_browser_click_by_text): click to focus, then send the entire string in " +
      "ONE call instead of one pc_browser_press per character. Real key events, so " +
      "Monaco / UI5 / contenteditable accept it. Optionally press Enter afterwards.",
    inputSchema: {
      text: z.string().describe("String to type into the focused element"),
      pressEnterAfter: z.boolean().optional().describe("Press Enter when done (submit / accept a suggestion)"),
    },
  },
  async ({ text, pressEnterAfter }) => callJson("POST", "/type-text", { text, pressEnterAfter })
);

server.registerTool(
  "pc_browser_fill_monaco",
  {
    title: "Fill a Monaco code editor in one call",
    description:
      "Fill a Monaco code editor (VS Code's editor, embedded by SAP Build and many " +
      "low-code tools) in ONE call. The text lives in a Monaco model, not a " +
      "<textarea>, so pc_browser_type can't address it. mode 'api' (default) sets " +
      "the model value directly (fast, exact); mode 'keystroke' clicks into the " +
      "editor and types trusted keystrokes (use when the app only reacts to real " +
      "key events, e.g. to trigger completion/token insertion). Use `frame` for an " +
      "editor inside an iframe. Returns the value read back from the Monaco model.",
    inputSchema: {
      text: z.string().describe("Text to put in the editor"),
      frame: z.string().optional().describe("URL substring selecting the editor's iframe (default main frame)"),
      replace: z.boolean().optional().describe("Replace the whole document (default true); false appends"),
      mode: z.enum(["api", "keystroke"]).optional().describe(
        "'api' = setValue on the model (default); 'keystroke' = click + trusted typing"),
    },
  },
  async ({ text, frame, replace, mode }) =>
    callJson("POST", "/fill-monaco", { text, frame, replace, mode })
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

server.registerTool(
  "pc_browser_tabs",
  {
    title: "List open browser tabs",
    description:
      "List every open tab in the user's Chrome (index, url, title, and which " +
      "one is active). Use before pc_browser_switch_tab to find the tab you want.",
    inputSchema: {},
  },
  async () => callJson("GET", "/tabs")
);

server.registerTool(
  "pc_browser_switch_tab",
  {
    title: "Switch the active tab",
    description:
      "Make a different tab the active one for subsequent actions. Select it by " +
      "its numeric index (from pc_browser_tabs) or by a URL substring. After " +
      "switching, the other pc_browser_* tools act on this tab.",
    inputSchema: {
      index: z.number().int().optional().describe("Tab index from pc_browser_tabs"),
      url: z.string().optional().describe("URL substring to match a tab (alternative to index)"),
    },
  },
  async ({ index, url }) => callJson("POST", "/tab", { index, url })
);

server.registerTool(
  "pc_browser_wait",
  {
    title: "Wait for an element to appear",
    description:
      "Wait until a CSS selector appears on the page before continuing. Use this " +
      "instead of guessing on SPAs (SAP Fiori, etc.) that render asynchronously " +
      "after a click or navigation. Returns once found or errors on timeout.",
    inputSchema: {
      selector: z.string().describe("CSS selector to wait for"),
      timeout: z.number().int().optional().describe("Timeout in ms (default 15000)"),
    },
  },
  async ({ selector, timeout }) => callJson("POST", "/wait", { selector, timeout })
);

server.registerTool(
  "pc_browser_snapshot",
  {
    title: "Accessibility snapshot (crosses shadow DOM & iframes)",
    description:
      "Return a YAML accessibility tree of the page: each node's role, name, and " +
      "value, across shadow-DOM and iframe boundaries. pc_browser_read only sees " +
      "the light DOM, so use this to locate shadow-DOM form fields (SAP Fiori / " +
      "UI5) — then act with pc_browser_fill_by_label or pc_browser_click_by_role.",
    inputSchema: {},
  },
  async () => callJson("GET", "/snapshot")
);

server.registerTool(
  "pc_browser_fill_by_label",
  {
    title: "Fill a field by its accessible label",
    description:
      "Fill an input by its accessible label/name rather than a CSS selector. " +
      "Crosses shadow-DOM and iframe boundaries, so it reaches fields that have " +
      "no light-DOM selector (use pc_browser_snapshot to find the label). Tries " +
      "label association first, then a textbox with that accessible name.",
    inputSchema: {
      label: z.string().describe("Accessible label/name of the field"),
      text: z.string().describe("Text to fill in"),
      exact: z.boolean().optional().describe("Exact match vs case-insensitive substring (default false)"),
      role: z.string().optional().describe("ARIA role to match if label lookup fails (default 'textbox')"),
    },
  },
  async ({ label, text, exact, role }) => callJson("POST", "/fill-by-label", { label, text, exact, role })
);

server.registerTool(
  "pc_browser_click_by_role",
  {
    title: "Click a control by ARIA role + name",
    description:
      "Click a control by its ARIA role and accessible name (e.g. role 'link', " +
      "name 'Invoice Reader'). Accessibility-aware and crosses shadow-DOM/iframe " +
      "boundaries, so it reaches controls that pc_browser_click (CSS) cannot.",
    inputSchema: {
      role: z.string().describe("ARIA role, e.g. 'link', 'button', 'menuitem'"),
      name: z.string().optional().describe("Accessible name of the control"),
      exact: z.boolean().optional().describe("Exact name match vs substring (default false)"),
      force: z.boolean().optional().describe("Force the click past actionability checks (default false)"),
    },
  },
  async ({ role, name, exact, force }) => callJson("POST", "/click-by-role", { role, name, exact, force })
);

server.registerTool(
  "pc_browser_click_by_text",
  {
    title: "Click an element by its visible text",
    description:
      "Click an element by its VISIBLE TEXT, regardless of ARIA role. Needed for " +
      "role-less SPA controls (e.g. SAP Build lobby project tiles) that are " +
      "invisible to pc_browser_click_by_role and the snapshot. Walks the real " +
      "DOM (piercing shadow roots) in every frame and clicks the smallest match.",
    inputSchema: {
      text: z.string().describe("Visible text to match"),
      exact: z.boolean().optional().describe("Full-text equality vs substring (default false)"),
      tag: z.string().optional().describe("Optional tag filter, e.g. 'a', 'button'"),
      nth: z.number().int().optional().describe("Pick the nth equally-specific match (default 0)"),
    },
  },
  async ({ text, exact, tag, nth }) => callJson("POST", "/click-by-text", { text, exact, tag, nth })
);

server.registerTool(
  "pc_browser_eval",
  {
    title: "Run JavaScript in the page",
    description:
      "Escape hatch: evaluate a JS expression in the page (or a named child " +
      "frame) and return its JSON result. Use for SPAs the role/label/text " +
      "helpers can't reach — inspecting shadow-DOM structure, reading state, " +
      "dispatching events, or confirming an effect. Wrap multi-statement logic " +
      "in an IIFE, e.g. (() => Array.from(document.querySelectorAll('a')).length).",
    inputSchema: {
      js: z.string().describe("JS expression to evaluate (wrap statements in an IIFE)"),
      frame: z.string().optional().describe("URL substring selecting which frame to run in (default main frame)"),
    },
  },
  async ({ js, frame }) => callJson("POST", "/eval", { js, frame })
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

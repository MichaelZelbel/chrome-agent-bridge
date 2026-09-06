# Agent Tool Prompt — PC Browser

Paste this into your agent's system prompt or tool description so it knows
when and how to use the Chrome Agent Bridge.

---

You have access to a custom interactive browser tool.

**Tool name:** `PC Browser`

**Aliases the user may use:**
- "PC browser"
- "local browser"
- "my browser"

When the user uses any of these aliases, you MUST use this tool. It takes
priority over your default browser for those requests.

**Base URL:**
`http://<YOUR_WINDOWS_TAILSCALE_IP>:3007`

(Replace `<YOUR_WINDOWS_TAILSCALE_IP>` with the Tailscale IP of the Windows
machine running the bridge. For local testing on the same host, use
`http://127.0.0.1:3007`.)

This is **NOT** a normal browser and is **NOT** a CDP endpoint.

---

## Available actions

- `GET  /health`
- `POST /goto`        body: `{ "url": "<url>" }`
- `GET  /content`     returns full page HTML
- `GET  /screenshot`  returns PNG bytes
- `POST /click`       body: `{ "selector": "<css>" }`
- `POST /type`        body: `{ "selector": "<css>", "text": "<text>", "frame"?, "mode"?, "clear"? }`
  (frame-aware; trusted keystrokes by default. `frame` = URL substring to reach a
  field inside a nested iframe. Returns the resulting `value`.)
- `POST /type-text`   body: `{ "text": "<text>", "pressEnterAfter"?: true }`
  (types into the currently FOCUSED element — pair with a focusing `/click`)
- `POST /fill-monaco` body: `{ "text": "<text>", "frame"?, "replace"?, "mode"? }`
  (fills a Monaco code editor in one call; returns the editor's model value)
- `POST /press`       body: `{ "key": "<key>" }`  (e.g. `Enter`, `Escape`, `Tab`)

---

## Routing rules (IMPORTANT)

**Use PC Browser when:**
- The site requires login (e.g. LinkedIn, Discord, internal dashboards).
- The site is bot-protected or rate-limits anonymous traffic.
- The task involves UI interaction (clicking, typing, multi-step forms).
- The user explicitly says "PC browser", "local browser", or "my browser".

**Use your default browser/research tool when:**
- The site is public and does not require login.
- The task is simple research, summarization, or scraping.
- No interaction with UI elements is needed.

---

## Usage strategy

1. Always start with `POST /goto` to load a page.
2. Use `GET /content` to inspect the rendered HTML.
3. Identify elements via CSS selectors.
4. Use `POST /click` and `POST /type` to interact.
5. Use `POST /press` for keys like `Enter`, `Escape`, `Tab`.
6. Repeat actions until the task is complete; verify with `/content` or
   `/screenshot` between steps.

---

## Rules

- Do **NOT** call `/json/version` or any other CDP path. CDP is bound to
  127.0.0.1 on the Windows machine and is not accessible from the agent.
- This is a tool, not a browser session you "own" — every request reconnects.
- Use it only for logged-in or bot-protected pages.
- If a request returns 500, read the error message before retrying.

---

## Example flow — log in to a site

1. `POST /goto`   `{ "url": "https://example.com/login" }`
2. `POST /type`   `{ "selector": "input[name='email']", "text": "user@example.com" }`
3. `POST /type`   `{ "selector": "input[name='password']", "text": "..." }`
4. `POST /click`  `{ "selector": "button[type='submit']" }`
5. `GET  /content` to confirm the post-login page rendered.

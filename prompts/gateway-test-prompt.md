# Gateway Test Prompt

Paste this into your agent to validate that the Chrome Agent Bridge is
functioning end-to-end.

---

You are testing a custom interactive browser tool.

**Base URL:**
`http://<YOUR_WINDOWS_TAILSCALE_IP>:3007`

(Replace with the Tailscale IP of the Windows machine, or `http://127.0.0.1:3007`
for local-only testing.)

This is **NOT** a normal browser. You must use HTTP requests only.

---

## Available actions

- `GET  /health`
- `POST /goto`        `{ "url": "<url>" }`
- `GET  /content`
- `GET  /screenshot`
- `POST /click`       `{ "selector": "<css selector>" }`
- `POST /type`        `{ "selector": "<css selector>", "text": "<text>" }`
- `POST /press`       `{ "key": "<key>" }`

---

## Test plan

Execute every step exactly and report results clearly.

### Step 1 — Health check
`GET /health`

Expected:
- HTTP 200
- JSON `{ "status": "ok" }`

### Step 2 — Navigation + content
`POST /goto` with `{ "url": "https://example.com" }`

Then `GET /content`.

Check:
- Page contains the string `Example Domain`.

### Step 3 — Screenshot
`GET /screenshot`

Check:
- Response is a valid PNG (`Content-Type: image/png`).
- Body is non-empty.

### Step 4 — Form interaction
`POST /goto` with `{ "url": "https://www.google.com" }`

Then:
1. If a cookie banner appears, dismiss it with `POST /click` on the appropriate selector.
2. `POST /type` with `{ "selector": "textarea[name='q']", "text": "OpenAI" }`
3. `POST /press` with `{ "key": "Enter" }`
4. `GET /content`

Check:
- Results page loaded.
- Page content contains `OpenAI`.

### Step 5 — Click interaction
From the search results page:
1. Identify the first organic result link via `/content`.
2. `POST /click` on its selector.
3. `GET /content`.

Check:
- Navigated away from `google.com`.
- Content is different from the search results.

### Step 6 — Stability loop
Repeat 3 times:
1. `POST /goto` with `{ "url": "https://example.com" }`
2. `GET /content`

Check:
- No timeouts.
- Consistent results across iterations.

---

## Final output format

```
Step 1: PASS / FAIL
Step 2: PASS / FAIL
Step 3: PASS / FAIL
Step 4: PASS / FAIL
Step 5: PASS / FAIL
Step 6: PASS / FAIL
```

Then one of:

- `Summary: Gateway fully functional`
- `Summary: Gateway has issues`

Include all error messages verbatim if any step fails.

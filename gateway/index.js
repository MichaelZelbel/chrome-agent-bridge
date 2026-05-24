const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '1mb' }));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3007', 10);
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

// Request logging middleware. Without this, an agent that reports
// "/goto timed out" gives us nothing to correlate against -- we don't know
// what the bridge actually saw, when, or how long Playwright took before
// failing. With this, every request produces a single line:
//   2026-05-15T14:55:30.123Z POST /goto {"url":"..."} -> 200 4630ms
// Errors get the response body too:
//   2026-05-15T14:55:35.456Z POST /goto -> 500 8021ms {"error":"timeout..."}
// The .bat launcher under Task Scheduler redirects stdout/stderr to
// %LOCALAPPDATA%\ChromeAgentBridge\gateway.log -- tail that file when
// diagnosing.
app.use((req, res, next) => {
  const start = Date.now();
  const reqBody = req.method !== 'GET' && req.body && Object.keys(req.body).length
    ? ' ' + JSON.stringify(req.body).slice(0, 200)
    : '';
  const origJson = res.json.bind(res);
  res.json = (body) => {
    const elapsed = Date.now() - start;
    const line = `${new Date().toISOString()} ${req.method} ${req.path}${reqBody} -> ${res.statusCode} ${elapsed}ms`;
    if (res.statusCode >= 400) {
      console.error(line, JSON.stringify(body).slice(0, 300));
    } else {
      console.log(line);
    }
    return origJson(body);
  };
  res.on('finish', () => {
    // Catches paths that use res.send (e.g. /content, /screenshot success)
    // where res.json wasn't called.
    if (!res.headersSent || res.getHeader('Content-Type') === 'application/json') return;
    const elapsed = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}${reqBody} -> ${res.statusCode} ${elapsed}ms`);
  });
  next();
});

// The bridge owns exactly one Chrome page. /goto creates it (and closes
// the previous one). /content, /screenshot, /click, /type, /press all
// operate on this page. The user's manual login tabs (Discord, LinkedIn,
// etc.) stay untouched -- we never reach into them.
//
// Why this matters: an earlier version used context.pages()[0] which
// returned whichever tab the user opened first. If that was Discord
// (or any other site with continuous worker activity / never-resolving
// font promises), Playwright's page.screenshot() would hang waiting for
// fonts to load and time out after 15s. Tracking our own page makes
// /screenshot deterministic.
let bridgePage = null;

// Cache one CDP connection for the gateway's lifetime and reuse it across
// every request. An earlier version called chromium.connectOverCDP() on each
// request and never released the browser object, so every call -- including
// each /health poll from the agent -- leaked one CDP WebSocket. Over days the
// V8 heap grew until the process hit Node's ~4 GB limit and died with
// "Reached heap limit Allocation failed - JavaScript heap out of memory".
// Reusing a single connection keeps memory flat. We still never call
// browser.close(), so the real Chrome session is never killed.
let cdpBrowser = null;

async function getContext() {
  if (!cdpBrowser || !cdpBrowser.isConnected()) {
    try {
      cdpBrowser = await chromium.connectOverCDP(CDP_URL);
    } catch (err) {
      cdpBrowser = null;
      throw new Error(
        `Cannot connect to Chrome at ${CDP_URL}. ` +
        `Make sure Chrome is running with --remote-debugging-port=9222 ` +
        `--remote-debugging-address=127.0.0.1. Original error: ${err.message}`
      );
    }
    // If Chrome quits or the connection drops, discard the cached handle (and
    // the now-stale bridge page) so the next request transparently reconnects.
    cdpBrowser.on('disconnected', () => {
      cdpBrowser = null;
      bridgePage = null;
    });
  }
  const context = cdpBrowser.contexts()[0];
  if (!context) {
    throw new Error('No browser context found. Open at least one tab in Chrome.');
  }
  return context;
}

async function getBridgePage() {
  if (bridgePage && !bridgePage.isClosed()) return bridgePage;
  return null;
}

async function newBridgePage(url) {
  const context = await getContext();
  // Reuse the existing bridge page if it's still alive -- this navigates
  // in place and avoids creating a new tab. Creating a new tab each /goto
  // pops the Chrome window to front on Windows/macOS and steals keyboard
  // focus from whatever the user is currently typing in. Only create a
  // new tab on the very first /goto after the gateway starts (or after
  // the user manually closes the bridge tab).
  if (!bridgePage || bridgePage.isClosed()) {
    bridgePage = await context.newPage();
    bridgePage.setDefaultTimeout(15000);
  }
  await bridgePage.goto(url, { waitUntil: 'domcontentloaded' });
  return bridgePage;
}

const NO_PAGE_ERR = { error: 'No bridge page open yet. Call POST /goto first.' };

app.get('/health', async (req, res) => {
  try {
    await getContext();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/goto', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const page = await newBridgePage(url);
    res.json({ success: true, url: page.url() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/content', async (req, res) => {
  try {
    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    res.send(await page.content());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/screenshot', async (req, res) => {
  try {
    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    // Minimal screenshot config -- newer Playwright (1.50+) is strict
    // about page-stability when `animations: 'disabled'` is set and hangs
    // indefinitely on sites with continuous JS animations (LinkedIn feed,
    // Discord realtime, etc). Default behaviour without these options
    // returns immediately on the current viewport state.
    const buffer = await page.screenshot({
      fullPage: false,
      timeout: 8000
    });

    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/click', async (req, res) => {
  try {
    const { selector } = req.body || {};
    if (!selector) return res.status(400).json({ error: 'Missing selector' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    await page.click(selector);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/type', async (req, res) => {
  try {
    const { selector, text } = req.body || {};
    if (!selector) return res.status(400).json({ error: 'Missing selector' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    await page.fill(selector, text || '');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/press', async (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    await page.keyboard.press(key);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Chrome Agent Bridge gateway listening on http://${HOST}:${PORT}`);
  console.log(`Connecting to Chrome via CDP at ${CDP_URL}`);
});

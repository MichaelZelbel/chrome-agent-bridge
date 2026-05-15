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

async function getPage() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    throw new Error(
      `Cannot connect to Chrome at ${CDP_URL}. ` +
      `Make sure Chrome is running with --remote-debugging-port=9222 ` +
      `--remote-debugging-address=127.0.0.1. Original error: ${err.message}`
    );
  }

  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context found. Open at least one tab in Chrome.');
  }

  const pages = context.pages().filter(p => !p.isClosed());
  const page = pages[0] || await context.newPage();

  page.setDefaultTimeout(15000);

  return page;
}

app.get('/health', async (req, res) => {
  try {
    await getPage();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/goto', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const page = await getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    res.json({ success: true, url: page.url() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/content', async (req, res) => {
  try {
    const page = await getPage();
    res.send(await page.content());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/screenshot', async (req, res) => {
  try {
    const page = await getPage();

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

    const page = await getPage();
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

    const page = await getPage();
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

    const page = await getPage();
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

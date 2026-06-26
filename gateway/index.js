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

// Resolve which frame a command targets. `frame` is a URL substring; when it
// matches a child iframe we return that frame, otherwise (or when omitted) we
// fall back to the main frame. This is the exact resolution /eval has always
// used, factored out so the frame-aware typing primitives can reach fields
// nested in iframes (SAP opens its editors inside process-builder ->
// design-studio iframes) the same way the existing helpers do.
function resolveFrame(page, frame) {
  if (!frame) return page.mainFrame();
  return page.frames().find((f) => f.url().includes(frame)) || page.mainFrame();
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

    // Capture via a raw CDP session instead of page.screenshot(). Playwright's
    // page.screenshot() waits for fonts to load and for the page to reach a
    // stable state before snapping; on SPAs with a perpetual spinner or a
    // never-resolving font promise (SAP Fiori, Discord, LinkedIn) that wait
    // never completes and the call times out -- leaving the agent blind
    // exactly when it most needs to see. Page.captureScreenshot grabs the
    // current viewport pixels immediately, regardless of animation state.
    let buffer;
    try {
      const context = await getContext();
      const session = await context.newCDPSession(page);
      try {
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        buffer = Buffer.from(data, 'base64');
      } finally {
        await session.detach().catch(() => {});
      }
    } catch (cdpErr) {
      // Fall back to Playwright's own screenshot if the CDP path is unavailable.
      buffer = await page.screenshot({ fullPage: false, timeout: 8000 });
    }

    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/click', async (req, res) => {
  try {
    const { selector, force } = req.body || {};
    if (!selector) return res.status(400).json({ error: 'Missing selector' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    // force:true skips actionability checks (visible/enabled/stable/uncovered).
    // Needed for controls a parent element covers -- e.g. a link inside a UI5
    // table cell, where the cell intercepts pointer events.
    // Frame-aware: a CSS/text selector's target may live in a child iframe
    // (SAP opens editors / lobby widgets in iframes), so try every frame, not
    // just the top one. Playwright's CSS and text= engines already pierce
    // shadow DOM within a frame.
    for (const f of page.frames()) {
      const loc = f.locator(selector);
      if ((await loc.count()) > 0) {
        await loc.first().click(force === true ? { force: true } : undefined);
        return res.json({ success: true });
      }
    }
    return res.status(404).json({ error: `No element matched selector "${selector}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Type text into a field -- frame-aware and, by default, with TRUSTED
// keystrokes. The original /type did page.fill(selector) on the top frame
// only, which breaks two ways: (1) the field may live in a nested iframe (a
// Monaco / UI5 editor inside SAP's process-builder -> design-studio frames),
// which a top-frame selector can't reach; (2) fill() sets .value and fires a
// single input event, which rich editors ignore because they listen for real
// keydown/keypress events. This version resolves the frame, focuses the
// element, optionally clears it, then replays the text. Params:
//   selector (required)            CSS/text selector, resolved inside `frame`
//   text                           text to enter (default "")
//   frame   (string)               URL substring selecting a child frame (default main)
//   mode    ("sequential"|"fill")  trusted keystrokes (default) vs fast value set
//   clear   (bool)                 select-all + Delete before typing (default true)
// Backward compatible: { selector, text } alone clears the field and ends with
// exactly `text` in it -- the same observable result as the old page.fill --
// now also returning the element's resulting value so callers can verify.
app.post('/type', async (req, res) => {
  try {
    const { selector, text, frame, mode, clear } = req.body || {};
    if (!selector) return res.status(400).json({ error: 'Missing selector' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    const f = resolveFrame(page, frame);
    const loc = f.locator(selector).first();
    const value = text || '';

    await loc.click();
    if (clear !== false) {
      await loc.press('Control+a');
      await loc.press('Delete');
    }
    if (mode === 'fill') {
      await loc.fill(value);
    } else {
      // pressSequentially sends real per-key events (delay lets UI5/Monaco
      // keep up) -- the trusted-keystroke path editors actually accept.
      await loc.pressSequentially(value, { delay: 10 });
    }

    // Read back what actually landed, without a second round-trip. Plain
    // inputs/textareas expose .value; contenteditable / rich widgets expose
    // their text via innerText.
    let result = '';
    try {
      result = await loc.evaluate((el) => (el.value != null ? el.value : el.innerText));
    } catch (_) { /* element detached after typing -- leave blank */ }

    res.json({ success: true, value: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Type a whole string as TRUSTED keystrokes into whatever element currently
// has focus -- no selector. Pairs with a focusing click (/click,
// /click-by-text, or a /type that left the caret in place): focus once, then
// send the entire string in a single call instead of one /press per character
// (which turned a 30-char expression into ~60 round-trips). page.keyboard.type
// dispatches real keydown/keypress/input events, so editors that ignore
// programmatic value sets (Monaco, UI5, contenteditable) accept it. Params:
//   text                   string to type (default "")
//   pressEnterAfter (bool) press Enter when done (submit / accept a suggestion)
app.post('/type-text', async (req, res) => {
  try {
    const { text, pressEnterAfter } = req.body || {};

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    await page.keyboard.type(text || '', { delay: 10 });
    if (pressEnterAfter === true) await page.keyboard.press('Enter');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fill a Monaco code editor (VS Code's editor, embedded by SAP Build and many
// low-code tools) in ONE call. The editor's text lives in a Monaco "model",
// not a normal <textarea>, so /type can't address it by selector. Two
// strategies, selectable via `mode`:
//   mode "api" (default): inside the frame, grab the Monaco editor instance
//     (window.monaco.editor.getEditors()[0], else the first registered model
//     behind a .monaco-editor node) and setValue(text). Fast and exact.
//   mode "keystroke": click a .view-line to focus, Ctrl+A, Delete, then type
//     the text as trusted keystrokes -- needed when the app only reacts to
//     real key events (e.g. to drive its completion / token machinery).
// Params:
//   text                        text to put in the editor (default "")
//   frame   (string)            URL substring selecting the editor's frame (default main)
//   replace (bool)              replace the whole document (default true); false appends
//   mode    ("api"|"keystroke") default "api"
// Returns the editor's resulting value read back FROM THE MONACO MODEL, so the
// caller verifies exactly what landed rather than trusting what we sent.
app.post('/fill-monaco', async (req, res) => {
  try {
    const { text, frame, replace, mode } = req.body || {};

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    const f = resolveFrame(page, frame);
    const value = text || '';
    const doReplace = replace !== false;

    if (mode === 'keystroke') {
      const line = f.locator('.monaco-editor .view-line').first();
      if ((await line.count()) === 0) {
        return res.status(404).json({ error: 'No Monaco editor (.monaco-editor .view-line) found in this frame' });
      }
      await line.click();
      if (doReplace) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
      } else {
        await page.keyboard.press('Control+End');
      }
      await page.keyboard.type(value, { delay: 10 });
    } else {
      // API fast path: set the model value directly.
      const setRes = await f.evaluate((args) => {
        const ed = window.monaco && window.monaco.editor;
        let model = null;
        const eds = ed && ed.getEditors ? ed.getEditors() : [];
        if (eds && eds.length) {
          model = eds[0].getModel();
        } else if (ed && ed.getModels) {
          // Fallback: the model registered for the first .monaco-editor node.
          const node = document.querySelector('.monaco-editor');
          const models = ed.getModels();
          if (node && models && models.length) model = models[0];
        }
        if (!model) return { ok: false, error: 'No Monaco editor/model found in this frame' };
        if (args.replace) {
          model.setValue(args.text);
        } else {
          const lastLine = model.getLineCount();
          const lastCol = model.getLineMaxColumn(lastLine);
          model.applyEdits([{
            range: { startLineNumber: lastLine, startColumn: lastCol, endLineNumber: lastLine, endColumn: lastCol },
            text: args.text,
          }]);
        }
        return { ok: true };
      }, { text: value, replace: doReplace });

      if (!setRes.ok) return res.status(404).json({ error: setRes.error });
    }

    // Read the resulting value straight from the model so the caller sees
    // exactly what the editor holds.
    const result = await f.evaluate(() => {
      const ed = window.monaco && window.monaco.editor;
      const eds = ed && ed.getEditors ? ed.getEditors() : [];
      if (eds && eds.length) return eds[0].getModel().getValue();
      const models = ed && ed.getModels ? ed.getModels() : [];
      return models && models.length ? models[0].getValue() : null;
    });

    res.json({ success: true, value: result });
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

// --- Multi-tab support -------------------------------------------------
// The bridge normally drives a single page (see newBridgePage). But some
// apps open a NEW tab in response to a click -- e.g. SAP Build launches its
// project editor in a separate tab. When that happens the bridge is left
// pointing at the old page and /content + /screenshot keep showing the wrong
// thing. /tabs lists every tab in the controlled context; /tab switches the
// bridge to one of them by index or url substring. Switching is explicit --
// the bridge never auto-follows a new tab, so the user's own login tabs
// (Discord, LinkedIn, ...) are never hijacked.

app.get('/tabs', async (req, res) => {
  try {
    const context = await getContext();
    const pages = context.pages();
    const tabs = [];
    for (let i = 0; i < pages.length; i++) {
      let title = '';
      try {
        title = await Promise.race([
          pages[i].title(),
          new Promise((resolve) => setTimeout(() => resolve(''), 1500)),
        ]);
      } catch (_) { /* title read failed -- leave blank */ }
      tabs.push({ index: i, url: pages[i].url(), title, active: pages[i] === bridgePage });
    }
    res.json({ tabs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tab', async (req, res) => {
  try {
    const { index, url } = req.body || {};
    const context = await getContext();
    const pages = context.pages();

    let target = null;
    if (typeof index === 'number') target = pages[index];
    else if (url) target = pages.find((p) => p.url().includes(url));

    if (!target) {
      return res.status(404).json({
        error: 'No matching tab',
        tabs: pages.map((p, i) => ({ index: i, url: p.url() })),
      });
    }

    bridgePage = target;
    bridgePage.setDefaultTimeout(15000);
    await target.bringToFront().catch(() => {});
    res.json({ success: true, url: target.url() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wait for a selector to appear before acting -- avoids sleep-and-pray on
// SPAs that render asynchronously after a click or navigation.
app.post('/wait', async (req, res) => {
  try {
    const { selector, timeout } = req.body || {};
    if (!selector) return res.status(400).json({ error: 'Missing selector' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    await page.waitForSelector(selector, { timeout: timeout || 15000 });
    res.json({ success: true, found: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dump the accessibility tree of the current page. /content only serializes
// the light DOM, so fields rendered inside a web component's shadow root
// (SAP Fiori / UI5 forms, etc.) are invisible to it. The accessibility
// snapshot crosses shadow boundaries and reports each node's role, name, and
// value -- enough to locate a "textbox" named "Instructions" and then act on
// it with /fill-by-label. Pass ?interestingOnly=false to include every node.
app.get('/snapshot', async (req, res) => {
  try {
    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);
    // ariaSnapshot is the current API (page.accessibility was removed in
    // Playwright 1.49+). It returns a YAML tree of roles + accessible names
    // and crosses shadow boundaries, so shadow-DOM form fields show up.
    // Snapshot the main frame AND every child iframe. SAP renders the agent
    // editor form inside an iframe, and ariaSnapshot / getBy* locators do not
    // cross iframe boundaries the way they cross shadow DOM.
    let aria = '';
    for (const f of page.frames()) {
      try {
        const part = await f.locator('body').ariaSnapshot();
        if (part && part.trim()) aria += `# frame ${f.url().slice(0, 100)}\n${part}\n\n`;
      } catch (_) { /* frame detached or cross-origin -- skip */ }
    }
    res.json({ aria });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fill a field by its accessible label/name rather than a CSS selector. This
// is the companion to /snapshot: shadow-DOM form fields have no reachable CSS
// selector in the light DOM, but Playwright's accessibility-aware locators
// (getByLabel / getByRole) cross shadow boundaries. Tries label association
// first, then a textbox with that accessible name. `exact` defaults to false
// (case-insensitive substring) so "Instructions" matches "Instructions:".
app.post('/fill-by-label', async (req, res) => {
  try {
    const { label, text, exact, role } = req.body || {};
    if (!label) return res.status(400).json({ error: 'Missing label' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    const exactOpt = exact === true;
    // Search the main frame and every iframe (the agent form is in an iframe).
    for (const f of page.frames()) {
      let loc = f.getByLabel(label, { exact: exactOpt });
      if ((await loc.count()) === 0) {
        loc = f.getByRole(role || 'textbox', { name: label, exact: exactOpt });
      }
      if ((await loc.count()) > 0) {
        await loc.first().fill(text || '');
        return res.json({ success: true });
      }
    }
    return res.status(404).json({ error: `No field found for label "${label}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Click a control by ARIA role + accessible name. The /click endpoint takes a
// CSS/text selector, which can't reach controls that only exist inside a web
// component's shadow root (SAP Fiori grids, links, buttons). getByRole is
// accessibility-aware and crosses shadow boundaries -- the click counterpart
// to /fill-by-label. Example: { "role": "link", "name": "Invoice Reader" }.
app.post('/click-by-role', async (req, res) => {
  try {
    const { role, name, exact, force } = req.body || {};
    if (!role) return res.status(400).json({ error: 'Missing role' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    const exactOpt = exact === true;
    // Search the main frame and every iframe.
    for (const f of page.frames()) {
      const loc = name ? f.getByRole(role, { name, exact: exactOpt }) : f.getByRole(role);
      if ((await loc.count()) > 0) {
        await loc.first().click(force === true ? { force: true } : undefined);
        return res.json({ success: true });
      }
    }
    return res.status(404).json({ error: `No ${role} found${name ? ` named "${name}"` : ''}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Click an element by its VISIBLE TEXT, regardless of ARIA role. Needed for
// SPA controls that are role-less -- e.g. the SAP Build lobby renders each
// project tile as `<a class="project-title">` with NO href, so it has no
// implicit "link" role and is invisible to /click-by-role and to the
// accessibility snapshot. This walks the real DOM (piercing shadow roots) in
// every frame, picks the smallest element whose text matches, and dispatches a
// native click so the SPA's own handler fires. Params:
//   text  (required)  visible text to match
//   exact (bool)      full-text equality vs. substring (default substring)
//   tag   (string)    optional tag filter, e.g. "a", "button"
//   nth   (number)    pick the nth match among equally-specific hits (default 0)
app.post('/click-by-text', async (req, res) => {
  try {
    const { text, exact, tag, nth } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    const args = { text, exact: exact === true, tag: tag || null, nth: nth || 0 };
    const finder = (a) => {
      const matches = [];
      const walk = (root) => {
        const kids = root.children ? Array.from(root.children) : [];
        for (const el of kids) {
          const full = (el.textContent || '').trim();
          const hit = a.exact ? full === a.text : full.includes(a.text);
          if (hit && (!a.tag || el.tagName.toLowerCase() === a.tag)) matches.push({ el, len: full.length });
          if (el.shadowRoot) walk(el.shadowRoot);
          walk(el);
        }
      };
      walk(document.body);
      if (!matches.length) return { clicked: false, count: 0 };
      // smallest text length = most specific (the leaf, not a wrapping container)
      matches.sort((x, y) => x.len - y.len);
      const target = (matches[a.nth] || matches[0]).el;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return { clicked: true, count: matches.length, tag: target.tagName.toLowerCase() };
    };

    for (const f of page.frames()) {
      try {
        const r = await f.evaluate(finder, args);
        if (r && r.clicked) return res.json({ success: true, ...r, frame: f.url().slice(0, 80) });
      } catch (_) { /* frame detached / cross-origin -- skip */ }
    }
    return res.status(404).json({ error: `No element found with text "${text}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// General escape hatch: run a JS expression in the page (or a named child
// frame) and return its JSON result. Indispensable for SPAs the role/label
// helpers can't reach -- inspecting shadow-DOM structure, reading state,
// dispatching custom events, or confirming an action's effect. `js` is
// evaluated as an expression; wrap multi-statement logic in an IIFE:
//   { "js": "(() => Array.from(document.querySelectorAll('a.project-title')).map(a=>a.textContent))" }
// Optional `frame` is a URL substring selecting which frame to run in (default
// main frame). Localhost-only bridge, so arbitrary eval is acceptable here.
app.post('/eval', async (req, res) => {
  try {
    const { js, frame } = req.body || {};
    if (!js) return res.status(400).json({ error: 'Missing js' });

    const page = await getBridgePage();
    if (!page) return res.status(409).json(NO_PAGE_ERR);

    const f = resolveFrame(page, frame);
    const result = await f.evaluate(js);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Chrome Agent Bridge gateway listening on http://${HOST}:${PORT}`);
  console.log(`Connecting to Chrome via CDP at ${CDP_URL}`);
});

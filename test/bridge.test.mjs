// End-to-end tests for the frame-aware trusted-typing + Monaco primitives,
// exercised through BOTH surfaces (the HTTP API and the MCP server) to prove
// parity, plus a smoke test that the pre-existing tools still behave.
//
// The harness stands up the real thing:
//   1. a static http server for the nested-iframe + Monaco harness pages,
//   2. a real Chromium (the Playwright-bundled binary) started exactly like the
//      production launcher -- CDP on 127.0.0.1, dedicated user-data-dir,
//   3. the actual gateway (gateway/index.js) as a child process, connected to
//      that Chromium over CDP,
//   4. the actual MCP server (mcp/server.js) as a child process, pointed at the
//      gateway.
//
// Run with:  node --test test/
// Requires the Playwright Chromium browser to be installed
// (npx playwright install chromium) and outbound access to the Monaco CDN.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort, startStaticServer, poll, McpStdioClient, killTree, findInstalledChrome } from './lib/util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INNER = 'inner.html'; // URL substring selecting the innermost frame

let staticSrv;     // { url, close }
let chromeProc;    // raw chromium process
let userDataDir;
let gateway;       // gateway child process
let mcp;           // McpStdioClient
let GW;            // gateway base URL, e.g. http://127.0.0.1:NNNN
let HARNESS_URL;   // outer.html URL

async function api(method, p, body) {
  const res = await fetch(GW + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  let json = null;
  if (ct.includes('application/json')) {
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* leave null */ }
  }
  return { status: res.status, json, buf, text: buf.toString('utf8'), ct };
}

// Read a value out of the inner frame via the (pre-existing) /eval endpoint --
// an independent channel from the primitive under test, so a readback proves
// the page actually changed rather than trusting the primitive's own report.
async function evalInner(js) {
  const r = await api('POST', '/eval', { js, frame: INNER });
  assert.equal(r.status, 200, `/eval failed: ${r.text}`);
  return r.json.result;
}

before(async () => {
  // 1. Static server for the harness pages.
  staticSrv = await startStaticServer(path.join(__dirname, 'harness'));
  HARNESS_URL = staticSrv.url + '/outer.html';

  // 2. Real Chrome/Chromium with CDP, mimicking the production launcher.
  const chromeExe = findInstalledChrome();
  assert.ok(chromeExe, 'No Chrome/Chromium binary found. Install Chrome or run `npx playwright install chromium`.');
  const cdpPort = await getFreePort();
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-test-profile-'));
  chromeProc = spawn(chromeExe, [
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--disable-component-update', // mirror the production launcher's flag set
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    'about:blank',
  ], { stdio: 'ignore' });
  // Without this, a spawn failure surfaces as an uncaughtException that crashes
  // the runner instead of a clean hook timeout.
  chromeProc.on('error', () => {});

  // Wait for the CDP endpoint to answer.
  await poll(async () => {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    return res.ok;
  }, { label: 'Chromium CDP endpoint', timeout: 30000 });

  // 3. The actual gateway, connected to that Chromium.
  const gwPort = await getFreePort();
  GW = `http://127.0.0.1:${gwPort}`;
  gateway = spawn(process.execPath, [path.join(ROOT, 'gateway', 'index.js')], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(gwPort),
      CDP_URL: `http://127.0.0.1:${cdpPort}`,
    },
    stdio: 'ignore',
  });

  await poll(async () => {
    const r = await api('GET', '/health');
    return r.status === 200 && r.json && r.json.status === 'ok';
  }, { label: 'gateway /health', timeout: 30000 });

  // 4. The actual MCP server, pointed at the gateway.
  mcp = new McpStdioClient(path.join(ROOT, 'mcp', 'server.js'), { BRIDGE_URL: GW });
  await mcp.initialize();

  // Open the harness and wait for the nested frames + Monaco to be ready.
  const goto = await api('POST', '/goto', { url: HARNESS_URL });
  assert.equal(goto.status, 200, `/goto failed: ${goto.text}`);

  await poll(async () => {
    const r = await api('POST', '/eval', { js: 'window.__monacoReady === true', frame: INNER });
    if (r.status !== 200) return false;
    return r.json.result === true;
  }, { label: 'Monaco ready in inner frame', timeout: 45000 });
});

after(async () => {
  if (mcp) mcp.close();
  killTree(gateway);
  killTree(chromeProc);
  if (staticSrv) await staticSrv.close();
  if (userDataDir) {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ---------------------------------------------------------------------------
// 1. Frame-aware trusted /type fills #deep (two iframes deep) in ONE call.
// ---------------------------------------------------------------------------
test('HTTP /type is frame-aware: fills #deep in one call, reads back equal', async () => {
  const r = await api('POST', '/type', { selector: '#deep', text: 'hello world', frame: INNER });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);
  assert.equal(r.json.value, 'hello world', 'returned value should be what landed');

  const readback = await evalInner("document.getElementById('deep').value");
  assert.equal(readback, 'hello world', 'independent readback must match');
});

test('MCP pc_browser_type drives the same field (parity) and clears first', async () => {
  const r = await mcp.callTool('pc_browser_type', { selector: '#deep', text: 'mcp typed this', frame: INNER });
  assert.equal(r.isError, false, r.text);
  const payload = JSON.parse(r.text);
  assert.equal(payload.success, true);
  assert.equal(payload.value, 'mcp typed this', 'MCP path returns the resulting value too');

  const readback = await evalInner("document.getElementById('deep').value");
  assert.equal(readback, 'mcp typed this', 'MCP call must have changed the field (clear replaced prior text)');
});

// ---------------------------------------------------------------------------
// 2. fill_monaco sets StringToNumber(netVarianceAbs) in ONE call; model reads
//    back EXACTLY that, via both surfaces and both modes.
// ---------------------------------------------------------------------------
const EXPR = 'StringToNumber(netVarianceAbs)';

test('HTTP /fill-monaco (api mode) sets the editor and the model reads back exactly', async () => {
  const r = await api('POST', '/fill-monaco', { frame: INNER, text: EXPR });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);
  assert.equal(r.json.value, EXPR, 'returned model value must equal what we set');

  const readback = await evalInner('window.__editor.getModel().getValue()');
  assert.equal(readback, EXPR, 'independent model readback must match');
});

test('MCP pc_browser_fill_monaco (api mode) parity', async () => {
  // First scribble something else so we can prove the MCP call replaced it.
  await api('POST', '/fill-monaco', { frame: INNER, text: 'PLACEHOLDER' });
  const r = await mcp.callTool('pc_browser_fill_monaco', { frame: INNER, text: EXPR });
  assert.equal(r.isError, false, r.text);
  const payload = JSON.parse(r.text);
  assert.equal(payload.success, true);
  assert.equal(payload.value, EXPR);
});

test('HTTP /fill-monaco (keystroke mode) types trusted keys into Monaco, reads back exactly', async () => {
  // Clear via api first, then drive the keystroke path.
  await api('POST', '/fill-monaco', { frame: INNER, text: '' });
  const r = await api('POST', '/fill-monaco', { frame: INNER, text: EXPR, mode: 'keystroke' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);
  assert.equal(r.json.value, EXPR, 'keystroke path must land exactly the expression');

  const readback = await evalInner('window.__editor.getModel().getValue()');
  assert.equal(readback, EXPR);
});

// Honesty probe: does setValue resolve a typed reference into a recognized
// "token", or is that only reachable via the editor's completion machinery?
// We set a partial identifier, then drive the documented accept-suggestion
// recipe (existing /press Control+Space to open the widget, /press Enter to
// accept) and confirm the completion provider resolved it.
test('fill-monaco api setValue is literal; autocomplete (Ctrl+Space, Enter) resolves a completion', async () => {
  // setValue is literal: a partial identifier stays exactly as written, the
  // completion provider is NOT consulted.
  await api('POST', '/fill-monaco', { frame: INNER, text: 'netVar' });
  assert.equal(await evalInner('window.__editor.getModel().getValue()'), 'netVar',
    'setValue must store the literal text, not auto-resolve it to netVarianceAbs');

  // Now reach the completion via real key events: focus the editor at the end
  // of "netVar", open the suggest widget, accept the top item.
  await api('POST', '/fill-monaco', { frame: INNER, text: 'netVar', mode: 'keystroke' });
  await api('POST', '/press', { key: 'Control+Space' });
  // Wait for the suggest widget to actually render before accepting.
  await poll(async () => evalInner("!!document.querySelector('.monaco-editor .suggest-widget.visible')"),
    { label: 'Monaco suggest widget', timeout: 8000, interval: 150 });
  // The provider's item is focused in the widget; Enter accepts it.
  const focused = await evalInner("(document.querySelector('.monaco-editor .suggest-widget .monaco-list-row.focused')||{}).textContent || ''");
  assert.ok(focused.includes('netVarianceAbs'), `expected the completion focused, got "${focused}"`);

  await api('POST', '/press', { key: 'Enter' });
  await poll(async () => (await evalInner('window.__editor.getModel().getValue()')) === 'netVarianceAbs',
    { label: 'completion accepted', timeout: 5000, interval: 150 });
  assert.equal(await evalInner('window.__editor.getModel().getValue()'), 'netVarianceAbs',
    'accept-suggestion recipe (Ctrl+Space, Enter) must resolve the partial into the full identifier');
});

// ---------------------------------------------------------------------------
// 3. type-focused-text: type a whole string into the focused element; Enter works.
// ---------------------------------------------------------------------------
test('HTTP /type-text types into the focused element and pressEnterAfter delivers Enter', async () => {
  // Clear #deep and reset the Enter marker, then focus it with /click.
  await api('POST', '/type', { selector: '#deep', text: '', frame: INNER, mode: 'fill' });
  await evalInner('window.__lastEnter = null');
  const click = await api('POST', '/click', { selector: '#deep' });
  assert.equal(click.status, 200, click.text);

  const r = await api('POST', '/type-text', { text: 'abc', pressEnterAfter: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);

  assert.equal(await evalInner("document.getElementById('deep').value"), 'abc', 'typed string must land');
  assert.equal(await evalInner('window.__lastEnter'), 'abc', 'Enter keydown must have fired with the typed value');
});

test('MCP pc_browser_type_text parity (focus via MCP click, then type + Enter)', async () => {
  await api('POST', '/type', { selector: '#deep', text: '', frame: INNER, mode: 'fill' });
  await evalInner('window.__lastEnter = null');
  const click = await mcp.callTool('pc_browser_click', { selector: '#deep' });
  assert.equal(click.isError, false, click.text);

  const r = await mcp.callTool('pc_browser_type_text', { text: 'xyz', pressEnterAfter: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(JSON.parse(r.text).success, true);

  assert.equal(await evalInner("document.getElementById('deep').value"), 'xyz');
  assert.equal(await evalInner('window.__lastEnter'), 'xyz');
});

// ---------------------------------------------------------------------------
// 4. Smoke test: pre-existing tools still behave unchanged.
// ---------------------------------------------------------------------------
test('smoke: open returns the harness url', async () => {
  const r = await api('POST', '/goto', { url: HARNESS_URL });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);
  assert.ok(r.json.url.includes('outer.html'), r.json.url);
  // Re-wait for Monaco since we just reloaded.
  await poll(async () => (await api('POST', '/eval', { js: 'window.__monacoReady === true', frame: INNER })).json.result === true,
    { label: 'Monaco ready after reload', timeout: 45000 });
});

test('smoke: eval still returns a JSON result (main + child frame)', async () => {
  const main = await api('POST', '/eval', { js: '1 + 2' });
  assert.equal(main.status, 200, main.text);
  assert.equal(main.json.result, 3);

  const inner = await api('POST', '/eval', { js: "document.getElementById('inner-marker').textContent", frame: INNER });
  assert.equal(inner.json.result, 'inner document');
});

test('smoke: click_by_role still finds a control in a nested frame', async () => {
  const r = await api('POST', '/click-by-role', { role: 'textbox', name: 'deep input' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);
});

test('smoke: press still works', async () => {
  const r = await api('POST', '/press', { key: 'Tab' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.success, true);
});

test('smoke: screenshot still returns PNG bytes', async () => {
  const r = await api('GET', '/screenshot');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.ct.includes('image/png'), `content-type was ${r.ct}`);
  // PNG magic number.
  assert.equal(r.buf.slice(0, 4).toString('hex'), '89504e47');
  assert.ok(r.buf.length > 1000, `screenshot suspiciously small: ${r.buf.length} bytes`);
});

test('smoke: snapshot still returns an aria tree across frames', async () => {
  const r = await api('GET', '/snapshot');
  assert.equal(r.status, 200, r.text);
  assert.ok(typeof r.json.aria === 'string' && r.json.aria.length > 0, 'aria snapshot should be non-empty');
});

test('smoke: tabs still lists at least one tab with one active', async () => {
  const r = await api('GET', '/tabs');
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.json.tabs) && r.json.tabs.length >= 1);
  assert.equal(r.json.tabs.filter((t) => t.active).length, 1, 'exactly one active tab');
});

test('smoke: MCP exposes the new tools alongside the originals', async () => {
  const tools = await mcp.listTools();
  const names = tools.map((t) => t.name);
  for (const expected of [
    'pc_browser_open', 'pc_browser_type', 'pc_browser_press', 'pc_browser_eval',
    'pc_browser_type_text', 'pc_browser_fill_monaco',
  ]) {
    assert.ok(names.includes(expected), `MCP should expose ${expected}; got ${names.join(', ')}`);
  }
});

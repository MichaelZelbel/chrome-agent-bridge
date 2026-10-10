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
import { getFreePort, startStaticServer, poll, McpStdioClient, killTree, killChromeByProfile, findInstalledChrome } from './lib/util.mjs';
import { decodePng, pngSize, jpegSize } from './lib/png.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INNER = 'inner.html'; // URL substring selecting the innermost frame

let staticSrv;     // { url, close }
let chromeExe;     // resolved Chrome/Chromium binary
let chromeProc;    // raw chromium process
let userDataDir;
let CDP_PORT;      // Chrome CDP port (shared with the gateway watchdog)
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
  return { status: res.status, json, buf, text: buf.toString('utf8'), ct, headers: res.headers };
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
  chromeExe = findInstalledChrome();
  assert.ok(chromeExe, 'No Chrome/Chromium binary found. Install Chrome or run `npx playwright install chromium`.');
  CDP_PORT = await getFreePort();
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-test-profile-'));
  chromeProc = spawn(chromeExe, [
    `--remote-debugging-port=${CDP_PORT}`,
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
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return res.ok;
  }, { label: 'Chromium CDP endpoint', timeout: 30000 });

  // 3. The actual gateway, connected to that Chromium. We also hand it the
  // watchdog knobs (binary + profile + headless extra arg) so the recovery
  // test can verify the gateway relaunches Chrome on its own.
  const gwPort = await getFreePort();
  GW = `http://127.0.0.1:${gwPort}`;
  gateway = spawn(process.execPath, [path.join(ROOT, 'gateway', 'index.js')], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(gwPort),
      CDP_URL: `http://127.0.0.1:${CDP_PORT}`,
      CAB_CHROME_BIN: chromeExe,
      CAB_PROFILE_DIR: userDataDir,
      CAB_CHROME_EXTRA_ARGS: '--headless=new --no-first-run --no-default-browser-check',
      CAB_WATCHDOG_COOLDOWN_MS: '2000',
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
  // The watchdog may have relaunched a Chrome we hold no handle to; kill any
  // Chrome still on the temp profile so nothing leaks.
  if (userDataDir) await killChromeByProfile(userDataDir);
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

// ---------------------------------------------------------------------------
// 5. Screenshots beyond the viewport (v0.5.0): ?full=1 and ?selector=..., opt-in only.
// ---------------------------------------------------------------------------
const near = (rgb, want, tol = 12) => rgb.every((v, i) => Math.abs(v - want[i]) <= tol);
const evalMain = async (js) => (await api('POST', '/eval', { js })).json.result;

test('screenshot without options is still the window, PNG, marked viewport', async () => {
  const goto = await api('POST', '/goto', { url: staticSrv.url + '/long.html' });
  assert.equal(goto.status, 200, goto.text);
  const r = await api('GET', '/screenshot');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.ct.includes('image/png'));
  assert.equal(r.buf.slice(0, 4).toString('hex'), '89504e47');
  const inner = await evalMain('[window.innerWidth * devicePixelRatio, window.innerHeight * devicePixelRatio]');
  const size = pngSize(r.buf);
  assert.equal(size.width, Math.round(inner[0]));
  assert.equal(size.height, Math.round(inner[1]), 'default capture stays the viewport, not the 3000 px page');
});

test('screenshot ?full=1 takes the whole 3000 px page and puts the scroll position back', async () => {
  await api('POST', '/eval', { js: "document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 1000); document.documentElement.style.scrollBehavior = ''; window.scrollY" });
  assert.equal(await evalMain('window.scrollY'), 1000);
  const r = await api('GET', '/screenshot?full=1');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('x-capture'), 'full');
  const dpr = await evalMain('devicePixelRatio');
  const img = decodePng(r.buf);
  assert.equal(img.height, Math.round(3000 * dpr), `full page height, got ${img.height}`);
  assert.ok(near(img.pixel(10, 5), [255, 0, 0]), `top stripe red, got ${img.pixel(10, 5)}`);
  assert.ok(near(img.pixel(10, img.height - 5), [0, 0, 255]), `bottom stripe blue, got ${img.pixel(10, img.height - 5)}`);
  assert.equal(await evalMain('window.scrollY'), 1000, 'scroll position restored');
  assert.equal(await evalMain('window.__cabShot === undefined'), true, 'nothing left behind in the page');
});

test('screenshot ?full=1&max=500 cuts a long page there and says so', async () => {
  const r = await api('GET', '/screenshot?full=1&max=500');
  assert.equal(r.status, 200, r.text);
  const dpr = await evalMain('devicePixelRatio');
  assert.equal(pngSize(r.buf).height, Math.round(500 * dpr));
  assert.equal(r.headers.get('x-capture-truncated'), '1');
});

test('screenshot ?selector= takes a whole element inside an inner scroll box and restores the box', async () => {
  const goto = await api('POST', '/goto', { url: staticSrv.url + '/inner-scroll.html' });
  assert.equal(goto.status, 200, goto.text);
  await api('POST', '/eval', { js: "document.getElementById('app').scrollTop = 500" });
  const r = await api('GET', '/screenshot?selector=%23card');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get('x-capture'), 'element');
  assert.ok(Number(r.headers.get('x-capture-expanded')) >= 1, 'the scroll box was let out');
  const dpr = await evalMain('devicePixelRatio');
  const img = decodePng(r.buf);
  assert.equal(img.width, Math.round(400 * dpr));
  assert.equal(img.height, Math.round(2400 * dpr), `whole card, got ${img.height}`);
  assert.ok(near(img.pixel(20, 5), [0, 255, 0]), `card top green, got ${img.pixel(20, 5)}`);
  assert.ok(near(img.pixel(20, img.height - 5), [255, 0, 255]), `card end magenta, got ${img.pixel(20, img.height - 5)}`);
  assert.equal(await evalMain("getComputedStyle(document.getElementById('app')).overflowY"), 'auto', 'box scrolls again');
  assert.equal(await evalMain("document.getElementById('app').scrollTop"), 500, 'box scroll position restored');
  assert.equal(await evalMain("document.getElementById('app').getAttribute('style')"), null, 'no inline style left');
});

test('screenshot ?full=1 on a page that scrolls inside a box shows the whole box', async () => {
  const r = await api('GET', '/screenshot?full=1');
  assert.equal(r.status, 200, r.text);
  const dpr = await evalMain('devicePixelRatio');
  const img = decodePng(r.buf);
  assert.ok(img.height >= Math.round(2400 * dpr), `page as tall as the card, got ${img.height}`);
  const x = Math.round(img.width / 2);
  let magenta = false;
  for (let y = img.height - 1; y > img.height - Math.round(400 * dpr) && !magenta; y -= 3) magenta = near(img.pixel(x, y), [255, 0, 255]);
  assert.ok(magenta, 'the end of the card is in the picture');
  assert.equal(await evalMain("getComputedStyle(document.body).overflow"), 'hidden', 'page layout restored');
});

test('screenshot ?selector=...&pad=8&format=jpeg answers a JPEG of the element with room around it', async () => {
  const r = await api('GET', '/screenshot?selector=%23card&pad=8&format=jpeg&quality=70');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.ct.includes('image/jpeg'), r.ct);
  const dpr = await evalMain('devicePixelRatio');
  const size = jpegSize(r.buf);
  assert.equal(size.width, Math.round(416 * dpr));
  assert.equal(size.height, Math.round(2416 * dpr));
});

test('screenshot ?selector= that matches nothing is a 404, a bad format a 400', async () => {
  const r = await api('GET', '/screenshot?selector=%23nothing-here');
  assert.equal(r.status, 404, r.text);
  assert.match(r.json.error, /No element matched/);
  const bad = await api('GET', '/screenshot?format=gif');
  assert.equal(bad.status, 400, bad.text);
  assert.equal(await evalMain('window.__cabShot === undefined'), true);
});

test('screenshot ?selector= paints a frame from another site that lies below the window', async () => {
  const goto = await api('POST', '/goto', { url: staticSrv.url + '/frame-card.html' });
  assert.equal(goto.status, 200, goto.text);
  await poll(async () => (await api('POST', '/eval', { js: '!!window.__painted', frame: 'cyan.html' })).json?.result === true,
    { label: 'cross-site frame loaded', timeout: 15000 });
  const inner = await evalMain('[innerWidth, innerHeight]');
  const r = await api('GET', '/screenshot?selector=%23card');
  assert.equal(r.status, 200, r.text);
  const dpr = await evalMain('devicePixelRatio');
  const img = decodePng(r.buf);
  assert.equal(img.height, Math.round(1900 * dpr));
  const mid = img.pixel(Math.round(200 * dpr), Math.round(1650 * dpr));
  assert.ok(near(mid, [0, 255, 255]), `the frame is painted (cyan), got ${mid}`);
  assert.ok(near(img.pixel(20, img.height - 5), [255, 0, 255]), 'and the end of the card is there');
  assert.deepEqual(await evalMain('[innerWidth, innerHeight]'), inner, 'the window is its own size again');
});

test('MCP pc_browser_screenshot passes full and selector through and reports the format', async () => {
  const goto = await api('POST', '/goto', { url: staticSrv.url + '/inner-scroll.html' });
  assert.equal(goto.status, 200, goto.text);
  const r = await mcp._send('tools/call', { name: 'pc_browser_screenshot', arguments: { selector: '#card', format: 'jpeg' } });
  const part = (r.content || []).find((c) => c.type === 'image');
  assert.ok(part, JSON.stringify(r).slice(0, 300));
  assert.equal(part.mimeType, 'image/jpeg');
  const dpr = await evalMain('devicePixelRatio');
  assert.equal(jpegSize(Buffer.from(part.data, 'base64')).height, Math.round(2400 * dpr));
  const plain = await mcp._send('tools/call', { name: 'pc_browser_screenshot', arguments: {} });
  assert.equal(plain.content.find((c) => c.type === 'image').mimeType, 'image/png');
});

// ---------------------------------------------------------------------------
// 6. Watchdog: the gateway self-heals when Chrome's CDP endpoint disappears
//    (crash / closed / relaunched-without-flags after a background update).
//    Kept LAST because it kills and relaunches the shared Chrome.
// ---------------------------------------------------------------------------
test('watchdog: relaunches Chrome and recovers after the CDP endpoint vanishes', async () => {
  // Healthy to start.
  assert.equal((await api('GET', '/health')).json.status, 'ok');

  // Simulate Chrome vanishing (e.g. relaunched without --remote-debugging-port).
  killTree(chromeProc);
  await poll(async () => {
    const up = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false);
    return up === false;
  }, { label: 'CDP endpoint actually down', timeout: 20000, interval: 300 });

  // The next requests drive the watchdog: it relaunches Chrome with the right
  // flags on the dedicated profile, and the bridge reconnects on its own.
  await poll(async () => (await api('GET', '/health')).json?.status === 'ok',
    { label: 'gateway self-heals via watchdog', timeout: 45000, interval: 1000 });

  // CDP is genuinely back, and the bridge can drive a page again.
  assert.ok(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false),
    'CDP endpoint should be reachable again after watchdog relaunch');
  const goto = await api('POST', '/goto', { url: HARNESS_URL });
  assert.equal(goto.status, 200, goto.text);
  assert.equal(goto.json.success, true);
});

test('watchdog: recovers even when a flag-less Chrome is holding the profile', async () => {
  // Make sure we are healthy after the previous test, then take Chrome down so
  // we control the starting state.
  await poll(async () => (await api('GET', '/health')).json?.status === 'ok',
    { label: 'healthy before flag-less test', timeout: 30000, interval: 500 });
  await killChromeByProfile(userDataDir);
  await poll(async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false)) === false,
    { label: 'CDP down before flag-less holder', timeout: 20000, interval: 300 });

  // Start a Chrome on the dedicated profile WITHOUT a debug port -- exactly the
  // state after Chrome relaunches itself post-update. A naive relaunch would
  // hand off to this instance (profile SingletonLock) and never open the port;
  // the watchdog must kill it first.
  const flagless = spawn(chromeExe, [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank',
  ], { stdio: 'ignore' });
  flagless.on('error', () => {});
  await new Promise((r) => setTimeout(r, 2500)); // let it grab the profile lock
  assert.equal(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false), false,
    'flag-less Chrome must not expose a CDP port');

  // Watchdog kills the flag-less holder and relaunches with flags.
  await poll(async () => (await api('GET', '/health')).json?.status === 'ok',
    { label: 'watchdog recovers past a flag-less holder', timeout: 45000, interval: 1000 });
  assert.ok(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false),
    'CDP endpoint should be reachable again after the watchdog cleared the holder');
});

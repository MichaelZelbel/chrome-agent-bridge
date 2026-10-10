// Opt-in controlled transfer. Uses a disposable Chrome profile and a local file-input
// page with no submit button, scripts, network request or social platform.
// CAB_TEST_VIDEO_URL must be an existing public HTTPS video, read only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getFreePort, poll, findInstalledChrome, McpStdioClient } from './lib/util.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upload = createRequire(import.meta.url)('../gateway/lib/upload');
const VIDEO_URL = process.env.CAB_TEST_VIDEO_URL;

test('large video crosses real HTTP/MCP gateway and local CDP input without social publication', { skip: !VIDEO_URL, timeout: 240000 }, async t => {
  const cdpPort = await getFreePort();
  const gatewayPort = await getFreePort();
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-large-isolated-profile-'));
  const chrome = spawn(findInstalledChrome(), [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1', 'about:blank',
  ], { stdio: 'ignore' });
  let gateway;
  let mcp;
  let completedFile;
  t.after(async () => {
    mcp?.proc.kill(); gateway?.kill(); chrome.kill();
    if (completedFile) await fs.promises.unlink(completedFile).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  });
  await poll(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok);
  const api = async (route, body) => {
    const res = await fetch(origin + route, { method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const startGateway = async max => {
    gateway = spawn(process.execPath, [path.join(ROOT, 'gateway/index.js')], { env: {
      ...process.env, HOST: '127.0.0.1', PORT: String(gatewayPort), CDP_URL: `http://127.0.0.1:${cdpPort}`,
      CAB_UPLOAD_MAX_BYTES: String(max),
    }, stdio: 'ignore' });
    await poll(async () => (await api('/health')).status === 200);
    assert.equal((await api('/goto', { url: 'data:text/html,<title>Isolated transfer fixture</title><input type=file id=video>' })).status, 200);
  };
  await startGateway(1024);
  const reject = await api('/upload-file', { url: VIDEO_URL, selector: '#video', filename: 'controlled-video.mp4' });
  assert.equal(reject.status, 413);
  assert.equal(reject.body.limitBytes, 1024);
  assert.equal(reject.body.uploadMethod, 'browser_bridge');
  assert.equal(reject.body.retryable, false);
  assert.ok(reject.body.fileSizeBytes > 50 * 1024 * 1024);
  mcp = new McpStdioClient(path.join(ROOT, 'mcp/server.js'), { BRIDGE_URL: origin });
  await mcp.initialize();
  const mcpRejected = await mcp.callTool('pc_browser_upload_file', { url: VIDEO_URL, selector: '#video' });
  assert.equal(mcpRejected.isError, true);
  const parsed = JSON.parse(mcpRejected.text);
  assert.equal(parsed.code, reject.body.code);
  assert.equal(parsed.limitBytes, reject.body.limitBytes);
  assert.equal(parsed.fileSizeBytes, reject.body.fileSizeBytes);
  mcp.proc.kill();
  gateway.kill(); await new Promise(r => gateway.once('exit', r));
  await startGateway(536870912);
  const caps = await api('/capabilities');
  assert.equal(caps.body.upload.maxBytes, 536870912);
  assert.equal(caps.body.upload.available, true);
  // Sample gateway RSS while it transfers so a whole-video allocation is visible.
  let peakRss = 0;
  const sample = () => {
    try {
      const m = fs.readFileSync(`/proc/${gateway.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m);
      if (m) peakRss = Math.max(peakRss, Number(m[1]) * 1024);
    } catch {}
  };
  sample(); const baselineRss = peakRss; const sampler = setInterval(sample, 50);
  const result = await api('/upload-file', { url: VIDEO_URL, selector: '#video', filename: 'controlled-video.mp4' });
  clearInterval(sampler);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.body.bytes > 193000000);
  completedFile = path.join(upload.tempDir(), result.body.file);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(completedFile)) hash.update(chunk);
  assert.equal(hash.digest('hex'), result.body.sha256);
  const readback = await api('/eval', { js: `(() => { const f = document.querySelector('#video').files[0]; return { name: f.name, size: f.size, type: f.type, requests: performance.getEntriesByType('resource').length, buttons: document.querySelectorAll('button,input[type=submit]').length }; })()` });
  assert.equal(readback.body.result.size, result.body.bytes);
  assert.equal(readback.body.result.name, result.body.file);
  assert.equal(readback.body.result.type, 'video/mp4');
  assert.equal(readback.body.result.requests, 0);
  assert.equal(readback.body.result.buttons, 0);
  if (baselineRss) assert.ok(peakRss - baselineRss < 128 * 1024 * 1024, `Unexpected whole-video memory growth: ${peakRss - baselineRss}`);
  t.diagnostic(JSON.stringify({ bytes: result.body.bytes, sha256: result.body.sha256, inputType: readback.body.result.type, networkRequests: 0, baselineRss, peakRss, fileRemovedAfterTest: true }));
});


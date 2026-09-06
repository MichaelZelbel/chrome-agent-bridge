// Shared helpers for the bridge test harness: a free-port finder, a tiny
// static file server (frames + the Monaco CDN need real http, not file://),
// and a minimal MCP stdio client so the tests can exercise the MCP surface
// for real without pulling in the SDK. Zero dependencies beyond Node core.

import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Locate a Chrome/Chromium binary to drive over CDP. We try, in order, any
// Playwright-downloaded Chromium (so CI that ran `playwright install` works)
// then the system Google Chrome (the faithful production case -- the bridge
// connects to the user's real Chrome over CDP). Returns a path or null.
export function findInstalledChrome() {
  const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
  const home = os.homedir();
  const out = [];

  const pwRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(home, 'AppData', 'Local', 'ms-playwright'),    // Windows
    path.join(home, 'Library', 'Caches', 'ms-playwright'),   // macOS
    path.join(home, '.cache', 'ms-playwright'),              // Linux
  ].filter(Boolean);
  for (const root of pwRoots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) {
      if (!/^chromium-\d+$/.test(e)) continue;
      out.push(
        path.join(root, e, 'chrome-win64', 'chrome.exe'),
        path.join(root, e, 'chrome-linux', 'chrome'),
        path.join(root, e, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      );
    }
  }

  out.push(
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  );

  return out.find(exists) || null;
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export async function startStaticServer(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.join(root, rel === '/' ? '/index.html' : rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  const port = await getFreePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

export async function poll(fn, { timeout = 30000, interval = 250, label = 'condition' } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${label}` + (lastErr ? ` (last error: ${lastErr.message})` : ''));
}

// Minimal Model Context Protocol client over stdio. The MCP stdio transport
// frames each JSON-RPC message as one newline-terminated line, so we can drive
// it with a line reader instead of the SDK -- which keeps the test honest
// (it talks the real wire protocol the gateway's MCP server speaks).
export class McpStdioClient {
  constructor(serverPath, env) {
    this.proc = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', () => {}); // ready banner / logs -- ignore
  }

  _onData(chunk) {
    this.buf += chunk.toString('utf8');
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  }

  _send(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(payload);
    });
  }

  _notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async initialize() {
    const res = await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bridge-harness-test', version: '0.0.0' },
    });
    this._notify('notifications/initialized', {});
    return res;
  }

  async listTools() {
    const res = await this._send('tools/list', {});
    return res.tools || [];
  }

  async callTool(name, args) {
    const result = await this._send('tools/call', { name, arguments: args || {} });
    const textPart = (result.content || []).find((c) => c.type === 'text');
    return { isError: !!result.isError, text: textPart ? textPart.text : '', raw: result };
  }

  close() {
    try { this.proc.stdin.end(); } catch { /* already closed */ }
    try { this.proc.kill(); } catch { /* already gone */ }
  }
}

// Kill every Chrome process whose command line references a profile dir. Used
// to clean up Chrome instances the gateway watchdog relaunched (which the test
// does not hold a handle to). Scoped to the given profile path only.
export async function killChromeByProfile(profileDir) {
  try {
    if (process.platform === 'win32') {
      const psLiteral = "'" + profileDir.replace(/'/g, "''") + "'";
      const ps =
        `$p=${psLiteral}; ` +
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like "*$p*" } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 10000 });
    } else {
      await execFileAsync('pkill', ['-f', `--user-data-dir=${profileDir}`], { timeout: 10000 }).catch(() => {});
    }
  } catch { /* nothing matched -- fine */ }
}

// Kill a process tree. On Windows child.kill() leaves Chrome's child processes
// orphaned, so use taskkill /T. Elsewhere a plain kill is enough for our
// directly-spawned chromium.
export function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* fall through */ }
  } else {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

#!/usr/bin/env node
'use strict';
/*
 * Planino waker
 * =============
 * The small, dumb half of Planino's browser posting lane. Every couple of
 * minutes it asks Planino whether a browser posting job is queued for this
 * account and, only when one is, starts the user's AI once (a runner script)
 * to post it. It never claims a job, never touches the browser, and never
 * runs an AI on a timer, so an idle account costs nothing.
 *
 * Config: poster.env next to this file (KEY=value lines), overridden by the
 * environment. See poster.env.example and README.md.
 *
 * Modes:
 *   node wake.js            run for ever (a service)
 *   node wake.js --once     one peek; run the AI if a job is queued; exit (cron)
 *   node wake.js --checkin  check in and exit (a health tick)
 *
 * Node 18 or newer, no dependencies.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadConfig(env = process.env, file = path.join(HERE, 'poster.env')) {
  const fileVars = readEnvFile(file);
  const get = (k, d) => (env[k] !== undefined && env[k] !== '' ? env[k] : fileVars[k] !== undefined && fileVars[k] !== '' ? fileVars[k] : d);
  const runner = get('RUNNER', path.join(HERE, 'runners', process.platform === 'win32' ? 'claude.cmd' : 'claude.sh'));
  const cfg = {
    posterUrl: String(get('PLANINO_POSTER_URL', 'https://suzqnyvfjbmnoipnlobk.supabase.co/functions/v1/browser-poster')).replace(/\/+$/, ''),
    token: String(get('PLANINO_POSTER_TOKEN', '')),
    runner,
    bridgeUrl: String(get('BRIDGE_URL', 'http://127.0.0.1:3007')).replace(/\/+$/, ''),
    pollSec: Number(get('POLL_SEC', 120)),
    checkinSec: Number(get('CHECKIN_SEC', 300)),
    runTimeoutSec: Number(get('RUN_TIMEOUT_SEC', 900)),
    harness: String(get('HARNESS', path.basename(runner).replace(/\.(sh|cmd|ps1|js)$/i, ''))),
    lockFile: String(get('LOCK_FILE', path.join(os.tmpdir(), 'planino-waker.lock'))),
    extraEnv: {},
  };
  // Everything else in the file is handed to the runner, so a runner's own
  // knobs (HUB_DIR, HERMES_PROFILE, CLAUDE_BIN) live in the same one place.
  for (const [k, v] of Object.entries(fileVars)) {
    if (!(k in env)) cfg.extraEnv[k] = v;
  }
  return cfg;
}

function validateConfig(cfg) {
  const problems = [];
  if (!cfg.token) problems.push('PLANINO_POSTER_TOKEN is missing (create one in Planino, Settings, AI poster)');
  else if (!/^pln_poster_[A-Za-z0-9_-]{43}$/.test(cfg.token)) problems.push('PLANINO_POSTER_TOKEN does not look like a poster token');
  if (!/^https?:\/\//.test(cfg.posterUrl)) problems.push('PLANINO_POSTER_URL must be http(s)');
  if (!cfg.runner) problems.push('RUNNER is missing');
  if (!(cfg.pollSec >= 15)) problems.push('POLL_SEC must be at least 15');
  return problems;
}

// ---------------------------------------------------------------------------
// Talking to Planino
// ---------------------------------------------------------------------------

async function planino(cfg, action, body, fetchFn = fetch) {
  const res = await fetchFn(`${cfg.posterUrl}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  if (!res.ok) {
    const msg = (json && json.error) || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`${action}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function bridgeHealthy(cfg, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${cfg.bridgeUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The lock: one AI per browser. A stale lock (its process gone, or older than
// the run timeout) is taken over, so a crashed runner cannot block for ever.
// ---------------------------------------------------------------------------

function acquireLock(lockFile, runTimeoutSec, now = Date.now()) {
  try {
    const st = fs.statSync(lockFile);
    if (now - st.mtimeMs < runTimeoutSec * 1000) return false;
    fs.unlinkSync(lockFile);
  } catch (_) { /* no lock */ }
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (_) {
    return false;
  }
}

function releaseLock(lockFile) {
  try { fs.unlinkSync(lockFile); } catch (_) { /* gone */ }
}

// ---------------------------------------------------------------------------
// Running the AI once
// ---------------------------------------------------------------------------

function runRunner(cfg, job, log = console.log) {
  return new Promise((resolve) => {
    const env = {
      ...cfg.extraEnv,
      ...process.env,
      JOB_ID: job.id || '',
      JOB_PLATFORM: job.platform || '',
      PLANINO_POSTER_URL: cfg.posterUrl,
      PLANINO_POSTER_TOKEN: cfg.token,
      BRIDGE_URL: cfg.bridgeUrl,
    };
    const isWin = process.platform === 'win32';
    const cmd = /\.js$/i.test(cfg.runner) ? process.execPath : cfg.runner;
    const args = /\.js$/i.test(cfg.runner) ? [cfg.runner, job.id || ''] : [job.id || ''];
    const started = Date.now();
    log(`runner start: ${path.basename(cfg.runner)} job=${job.id || '?'} platform=${job.platform || '?'}`);
    let child;
    try {
      child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin && /\.(cmd|bat|ps1)$/i.test(cfg.runner), windowsHide: true });
    } catch (err) {
      log(`runner failed to start: ${err.message}`);
      return resolve({ code: -1, seconds: 0 });
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    child.stderr.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    const timer = setTimeout(() => {
      log(`runner exceeded ${cfg.runTimeoutSec}s; killing it`);
      try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
    }, cfg.runTimeoutSec * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 1000);
      log(`runner exit ${code} after ${seconds}s`);
      resolve({ code, seconds, output: out });
    });
  });
}

// ---------------------------------------------------------------------------
// One tick: peek, and when a job waits, run the AI once under the lock.
// Returns what happened, for the log and for tests.
// ---------------------------------------------------------------------------

async function tick(cfg, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const log = deps.log || console.log;
  const run = deps.runRunner || runRunner;
  let peek;
  try {
    peek = await planino(cfg, 'peek', {}, fetchFn);
  } catch (err) {
    return { action: 'peek_failed', error: err.message };
  }
  const queued = Number(peek && peek.queued) || 0;
  if (queued === 0) return { action: 'idle' };
  if (!acquireLock(cfg.lockFile, cfg.runTimeoutSec)) return { action: 'busy', queued };
  try {
    const job = (peek && peek.oldest) || {};
    const result = await run(cfg, job, log);
    return { action: 'ran', queued, job, code: result.code, seconds: result.seconds };
  } finally {
    releaseLock(cfg.lockFile);
  }
}

async function checkin(cfg, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const bridgeOk = await bridgeHealthy(cfg, fetchFn);
  const pkg = safeVersion();
  const body = { harness: cfg.harness, version: pkg, bridge_ok: bridgeOk };
  const res = await planino(cfg, 'checkin', body, fetchFn);
  return { bridgeOk, poster: res && res.poster };
}

function safeVersion() {
  try {
    return require(path.join(HERE, '..', 'package.json')).version || '';
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(argv = process.argv.slice(2)) {
  const cfg = loadConfig();
  const problems = validateConfig(cfg);
  if (problems.length) {
    for (const p of problems) console.error(`waker: ${p}`);
    process.exit(2);
  }
  const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

  if (argv.includes('--checkin')) {
    const r = await checkin(cfg).catch((e) => ({ error: e.message }));
    log(r.error ? `checkin failed: ${r.error}` : `checked in as "${r.poster && r.poster.name}", bridge ${r.bridgeOk ? 'ok' : 'unreachable'}`);
    process.exit(r.error ? 1 : 0);
  }

  if (argv.includes('--once')) {
    // A cron-driven waker checks in on every run: five-minute cron lines are
    // the norm and that is the check-in cadence anyway.
    await checkin(cfg).catch((e) => log(`checkin failed: ${e.message}`));
    const r = await tick(cfg, { log });
    log(JSON.stringify(r));
    process.exit(r.action === 'peek_failed' ? 1 : 0);
  }

  log(`waker up: poll ${cfg.pollSec}s, checkin ${cfg.checkinSec}s, runner ${cfg.runner}, bridge ${cfg.bridgeUrl}`);
  let lastCheckin = 0;
  let failures = 0;
  for (;;) {
    if (Date.now() - lastCheckin >= cfg.checkinSec * 1000) {
      const r = await checkin(cfg).catch((e) => ({ error: e.message }));
      if (r.error) log(`checkin failed: ${r.error}`);
      else if (!r.bridgeOk) log('checked in; the bridge is unreachable');
      lastCheckin = Date.now();
    }
    const r = await tick(cfg, { log });
    if (r.action === 'peek_failed') {
      failures++;
      log(`peek failed (${failures}): ${r.error}`);
    } else {
      failures = 0;
      if (r.action !== 'idle') log(JSON.stringify(r));
    }
    // After three failed peeks, slow down to five minutes until one works.
    const wait = failures >= 3 ? Math.max(cfg.pollSec, 300) : cfg.pollSec;
    await sleep(wait * 1000);
  }
}

module.exports = { loadConfig, validateConfig, readEnvFile, planino, bridgeHealthy, acquireLock, releaseLock, runRunner, tick, checkin };

if (require.main === module) {
  main().catch((err) => {
    console.error(`waker: ${err.message}`);
    process.exit(1);
  });
}

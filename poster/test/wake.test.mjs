// The waker, against a fake Planino and a fake runner. No browser, no AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const waker = require('../wake.js');

const TOKEN = 'pln_poster_' + 'a'.repeat(43);

function fakePlanino(state) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const action = req.url.split('/').filter(Boolean).pop();
      calls.push({ action, auth: req.headers.authorization, body: body ? JSON.parse(body) : {} });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unknown or revoked poster token.' }));
      }
      if (action === 'peek') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ queued: state.queued, oldest: state.queued ? { id: 'job-1', platform: 'substack' } : null }));
      }
      if (action === 'checkin') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, poster: { name: 'the hub' } }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'nope' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/browser-poster`;
      resolve({ server, url, calls, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function cfgFor(url, extra = {}) {
  return {
    posterUrl: url,
    token: TOKEN,
    runner: path.join(os.tmpdir(), 'no-such-runner.js'),
    bridgeUrl: 'http://127.0.0.1:1',
    pollSec: 120,
    checkinSec: 300,
    runTimeoutSec: 30,
    harness: 'test',
    lockFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'waker-')), 'lock'),
    extraEnv: {},
    ...extra,
  };
}

test('readEnvFile and loadConfig read poster.env and let the environment win', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waker-cfg-'));
  const file = path.join(dir, 'poster.env');
  fs.writeFileSync(file, `# comment\nPLANINO_POSTER_TOKEN="${TOKEN}"\nPOLL_SEC=45\nHUB_DIR=/srv/hub\n`);
  const cfg = waker.loadConfig({ POLL_SEC: '60' }, file);
  assert.equal(cfg.token, TOKEN);
  assert.equal(cfg.pollSec, 60);
  assert.equal(cfg.extraEnv.HUB_DIR, '/srv/hub');
  assert.deepEqual(waker.validateConfig(cfg), []);
  const bad = waker.loadConfig({}, path.join(dir, 'missing.env'));
  assert.ok(waker.validateConfig(bad).some((p) => /PLANINO_POSTER_TOKEN/.test(p)));
});

test('an idle account never starts the runner', async () => {
  const p = await fakePlanino({ queued: 0 });
  let runs = 0;
  const r = await waker.tick(cfgFor(p.url), { runRunner: async () => { runs++; return { code: 0, seconds: 1 }; }, log: () => {} });
  await p.close();
  assert.deepEqual(r, { action: 'idle' });
  assert.equal(runs, 0);
  assert.deepEqual(p.calls.map((c) => c.action), ['peek']);
});

test('a queued job starts the runner once, under the lock, and never claims', async () => {
  const p = await fakePlanino({ queued: 2 });
  const seen = [];
  const cfg = cfgFor(p.url);
  const r = await waker.tick(cfg, { runRunner: async (_c, job) => { seen.push(job); return { code: 0, seconds: 3 }; }, log: () => {} });
  await p.close();
  assert.equal(r.action, 'ran');
  assert.equal(r.queued, 2);
  assert.deepEqual(seen, [{ id: 'job-1', platform: 'substack' }]);
  assert.ok(!p.calls.some((c) => c.action === 'claim'));
  assert.ok(!fs.existsSync(cfg.lockFile), 'lock released after the run');
});

test('a second waker sees the lock and stays out', async () => {
  const p = await fakePlanino({ queued: 1 });
  const cfg = cfgFor(p.url);
  assert.equal(waker.acquireLock(cfg.lockFile, cfg.runTimeoutSec), true);
  const r = await waker.tick(cfg, { runRunner: async () => { throw new Error('must not run'); }, log: () => {} });
  waker.releaseLock(cfg.lockFile);
  await p.close();
  assert.deepEqual(r, { action: 'busy', queued: 1 });
});

test('a stale lock from a dead run is taken over', () => {
  const cfg = cfgFor('http://127.0.0.1:1');
  fs.writeFileSync(cfg.lockFile, '999999');
  const old = Date.now() - (cfg.runTimeoutSec + 5) * 1000;
  fs.utimesSync(cfg.lockFile, new Date(old), new Date(old));
  assert.equal(waker.acquireLock(cfg.lockFile, cfg.runTimeoutSec), true);
  waker.releaseLock(cfg.lockFile);
});

test('a wrong token comes back as peek_failed with Planino\'s sentence', async () => {
  const p = await fakePlanino({ queued: 0 });
  const r = await waker.tick(cfgFor(p.url, { token: 'pln_poster_' + 'b'.repeat(43) }), { log: () => {} });
  await p.close();
  assert.equal(r.action, 'peek_failed');
  assert.match(r.error, /revoked poster token/);
});

test('checkin reports the harness and whether the bridge answers', async () => {
  const p = await fakePlanino({ queued: 0 });
  const r = await waker.checkin(cfgFor(p.url));
  await p.close();
  assert.equal(r.bridgeOk, false);
  assert.equal(r.poster.name, 'the hub');
  const c = p.calls.find((x) => x.action === 'checkin');
  assert.equal(c.body.harness, 'test');
  assert.equal(c.body.bridge_ok, false);
});

test('the real runner spawns a script with the job in its environment and kills a run that overstays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waker-run-'));
  const marker = path.join(dir, 'marker.txt');
  const script = path.join(dir, 'runner.js');
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.JOB_ID + ' ' + process.argv[2] + ' ' + process.env.BRIDGE_URL);`);
  const cfg = cfgFor('http://127.0.0.1:1', { runner: script, runTimeoutSec: 30, bridgeUrl: 'http://127.0.0.1:3011' });
  const r = await waker.runRunner(cfg, { id: 'job-7', platform: 'snapchat' }, () => {});
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'job-7 job-7 http://127.0.0.1:3011');

  const slow = path.join(dir, 'slow.js');
  fs.writeFileSync(slow, 'setTimeout(() => {}, 60000);');
  const started = Date.now();
  const k = await waker.runRunner({ ...cfg, runner: slow, runTimeoutSec: 1 }, { id: 'job-8' }, () => {});
  assert.notEqual(k.code, 0);
  assert.ok(Date.now() - started < 10000, 'killed within the timeout');
});

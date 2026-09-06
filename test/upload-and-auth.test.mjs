// Unit tests for the pieces of /upload-file and the bearer guard that need
// no browser: temp-file naming and cleanup, request validation, and the
// token check. The end-to-end harness in bridge.test.mjs covers the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const upload = require('../gateway/lib/upload.js');
const auth = require('../gateway/lib/auth.js');

test('tempPathFor keeps the extension the site checks and never a path separator', () => {
  const p = upload.tempPathFor('https://cdn.example/videos/2026/clip%20one.mp4', null, 1000);
  assert.ok(p.startsWith(upload.tempDir()));
  assert.ok(path.basename(p).startsWith('cab-upload-1000-'));
  assert.ok(p.endsWith('-clip one.mp4'));
  const named = upload.tempPathFor('https://cdn.example/x', 'a/b\\c:d.png', 1000);
  assert.ok(named.endsWith('-a_b_c_d.png'));
  const bare = upload.tempPathFor('https://cdn.example/', null, 1000);
  assert.ok(bare.endsWith('-upload'));
});

test('cleanOldTemp removes only old files with the bridge prefix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-test-'));
  const old = path.join(dir, 'cab-upload-1-old.mp4');
  const fresh = path.join(dir, 'cab-upload-2-fresh.mp4');
  const other = path.join(dir, 'keep.txt');
  for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
  const now = Date.now();
  fs.utimesSync(old, new Date(now - 2 * upload.TEMP_MAX_AGE_MS), new Date(now - 2 * upload.TEMP_MAX_AGE_MS));
  const removed = upload.cleanOldTemp(dir, upload.TEMP_MAX_AGE_MS, now);
  assert.equal(removed, 1);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(fresh));
  assert.ok(fs.existsSync(other));
  assert.equal(upload.cleanOldTemp(path.join(dir, 'missing')), 0);
});

test('parseUploadRequest wants a URL and one way to find the input', () => {
  assert.deepEqual(upload.parseUploadRequest({}), { ok: false, error: 'Missing or invalid url (http/https only)' });
  assert.equal(upload.parseUploadRequest({ url: 'ftp://x/y' }).ok, false);
  const noTarget = upload.parseUploadRequest({ url: 'https://x/y.mp4' });
  assert.equal(noTarget.ok, false);
  assert.match(noTarget.error, /label, selector, or click/);
  const byLabel = upload.parseUploadRequest({ url: 'https://x/y.mp4', label: 'Choose video', exact: true });
  assert.deepEqual(byLabel, {
    ok: true,
    target: { url: 'https://x/y.mp4', filename: null, label: 'Choose video', selector: null, click: null, exact: true },
  });
  const byClick = upload.parseUploadRequest({ url: 'https://x/y.mp4', click: { role: 'button', name: 'Upload' }, filename: 'clip.mp4' });
  assert.equal(byClick.ok, true);
  assert.deepEqual(byClick.target.click, { role: 'button', name: 'Upload' });
  assert.equal(byClick.target.filename, 'clip.mp4');
  const bySelector = upload.parseUploadRequest({ url: 'https://x/y.mp4', selector: 'input[type=file]' });
  assert.equal(bySelector.target.selector, 'input[type=file]');
});

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test('the token guard is off with no token, and otherwise lets /health and the right bearer through', () => {
  let passed = 0;
  const next = () => { passed++; };
  auth.makeTokenGuard('')({ path: '/goto', headers: {} }, fakeRes(), next);
  assert.equal(passed, 1);

  const guard = auth.makeTokenGuard('s3cret');
  guard({ path: '/health', headers: {} }, fakeRes(), next);
  assert.equal(passed, 2);

  const denied = fakeRes();
  guard({ path: '/goto', headers: {} }, denied, next);
  assert.equal(denied.statusCode, 401);
  assert.match(denied.body.error, /bridge token/);

  const wrong = fakeRes();
  guard({ path: '/goto', headers: { authorization: 'Bearer nope' } }, wrong, next);
  assert.equal(wrong.statusCode, 401);

  guard({ path: '/goto', headers: { authorization: 'Bearer s3cret' } }, fakeRes(), next);
  assert.equal(passed, 3);
});

test('readToken prefers BRIDGE_TOKEN and falls back to CAB_BRIDGE_TOKEN', () => {
  assert.equal(auth.readToken({}), '');
  assert.equal(auth.readToken({ CAB_BRIDGE_TOKEN: 'a' }), 'a');
  assert.equal(auth.readToken({ BRIDGE_TOKEN: 'b', CAB_BRIDGE_TOKEN: 'a' }), 'b');
});

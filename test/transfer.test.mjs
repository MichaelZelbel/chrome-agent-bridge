import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const transfer = createRequire(import.meta.url)('../gateway/lib/transfer');

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-transfer-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin + '/file.mp4', destination: path.join(dir, 'file.mp4'), options: { allowedOrigins: [origin] } };
}
test('configured cap can only reduce the 512 MiB hard ceiling', () => {
  assert.equal(transfer.maxBytes({}), 536870912);
  assert.equal(transfer.maxBytes({ CAB_UPLOAD_MAX_BYTES: '999999999999' }), 536870912);
  assert.equal(transfer.maxBytes({ CAB_UPLOAD_MAX_BYTES: '1024' }), 1024);
  assert.equal(transfer.maxBytes({ CAB_UPLOAD_MAX_BYTES: '0' }), 536870912);
});
test('public HTTPS policy rejects credentials, private DNS/IP and unsafe protocols', async () => {
  for (const url of ['http://example.com/file', 'https://a:b@example.com/file', 'https://127.0.0.1/file', 'https://[::1]/file', 'file:///tmp/a', 'https://example.com:81/file']) {
    await assert.rejects(transfer.resolveUrl(url), e => e.code === 'UPLOAD_URL_REJECTED');
  }
  await assert.rejects(transfer.resolveUrl('https://cdn.example/file', { lookup: async () => [{ address: '10.1.2.3', family: 4 }] }), e => e.code === 'UPLOAD_URL_REJECTED');
  const result = await transfer.resolveUrl('https://cdn.example/file', { lookup: async () => [{ address: '8.8.8.8', family: 4 }] });
  assert.equal(result.address.address, '8.8.8.8');
});
test('exact boundary streams bytes and checksum without buffering whole file', async t => {
  const data = Buffer.alloc(65536, 42);
  const f = await fixture(t, (_req,res) => { res.setHeader('Content-Length', data.length); res.end(data); });
  const r = await transfer.download(f.url, f.destination, { ...f.options, limit: data.length });
  assert.equal(r.bytes, data.length);
  assert.equal(r.sha256, crypto.createHash('sha256').update(data).digest('hex'));
  assert.equal(fs.statSync(f.destination).size, data.length);
});
test('one byte over declared boundary returns structured deterministic error and leaves no file', async t => {
  const f = await fixture(t, (_req,res) => { res.setHeader('Content-Length', 11); res.end('abcdefghijk'); });
  await assert.rejects(transfer.download(f.url, f.destination, { ...f.options, limit: 10 }), e => {
    assert.equal(e.status, 413);
    const error = transfer.failure(e);
    assert.equal(error.retryable, false); assert.equal(error.fileSizeBytes, 11); assert.equal(error.limitBytes, 10);
    assert.equal(error.uploadMethod, 'browser_bridge'); assert.match(error.remedy, /smaller/); return true;
  });
  assert.equal(fs.existsSync(f.destination), false);
});
test('missing content-length is bounded while streaming', async t => {
  const f = await fixture(t, (_req,res) => { res.write('12345'); res.end('678901'); });
  await assert.rejects(transfer.download(f.url, f.destination, { ...f.options, limit: 10 }), e => e.code === 'UPLOAD_TOO_LARGE');
  assert.equal(fs.existsSync(f.destination), false);
});
test('interrupted response removes a partial download', async t => {
  const f = await fixture(t, (_req,res) => { res.setHeader('Content-Length', 1000); res.write('partial'); setTimeout(() => res.destroy(), 25); });
  await assert.rejects(transfer.download(f.url, f.destination, f.options), e => e.code === 'UPLOAD_DOWNLOAD_FAILED');
  assert.equal(fs.existsSync(f.destination), false);
});
test('idle and total timeouts cancel and remove partial files', async t => {
  const f = await fixture(t, (_req,res) => { res.write('partial'); });
  await assert.rejects(transfer.download(f.url, f.destination, { ...f.options, idleTimeoutMs: 30 }), e => e.code === 'UPLOAD_DOWNLOAD_FAILED');
  assert.equal(fs.existsSync(f.destination), false);
  await assert.rejects(transfer.download(f.url, f.destination, { ...f.options, timeoutMs: 30 }), e => e.code === 'UPLOAD_DOWNLOAD_FAILED');
  assert.equal(fs.existsSync(f.destination), false);
});
test('a redirect to a private network is checked again', async t => {
  const f = await fixture(t, (_req,res) => { res.writeHead(302, { Location: 'https://127.0.0.1/private' }); res.end(); });
  await assert.rejects(transfer.download(f.url, f.destination, f.options), e => e.code === 'UPLOAD_URL_REJECTED');
  assert.equal(fs.existsSync(f.destination), false);
});
test('caller cancellation stops download and cleans partial files', async t => {
  const controller = new AbortController();
  const f = await fixture(t, (_req,res) => { res.write('partial'); setTimeout(() => controller.abort(), 25); });
  await assert.rejects(transfer.download(f.url, f.destination, { ...f.options, signal: controller.signal }), e => e.code === 'UPLOAD_DOWNLOAD_FAILED');
  assert.equal(fs.existsSync(f.destination), false);
});

test('a hanging DNS resolver is cancelled by the total deadline', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-dns-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'file.mp4');
  await assert.rejects(transfer.download('https://cdn.example/file', destination, {
    lookup: () => new Promise(() => {}), timeoutMs: 25,
  }), e => e.code === 'UPLOAD_DOWNLOAD_FAILED');
  assert.equal(fs.existsSync(destination), false);
});
test('shared disk reservations include simultaneous transfers and release their budget', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-budget-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const releases = [];
  for (let i = 0; i < 4; i++) releases.push(transfer.checkDisk(dir));
  assert.throws(() => transfer.checkDisk(dir), e => e.code === 'UPLOAD_STORAGE_BUSY');
  releases.shift()();
  releases.push(transfer.checkDisk(dir));
  releases.forEach(r => r());
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a crashed budget lock is recovered after its short lease', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-budget-lock-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, '.budget-lock');
  fs.mkdirSync(lock);
  fs.utimesSync(lock, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  const release = transfer.checkDisk(dir);
  release();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('only local CDP advertises path upload support', () => {
  assert.equal(transfer.isLocalCdp({ CDP_URL: 'http://127.0.0.1:9226' }), true);
  assert.equal(transfer.isLocalCdp({ CDP_URL: 'http://100.86.49.3:9226' }), false);
  assert.equal(transfer.maxBytes({ CDP_URL: 'http://remote.example:9222' }), 0);
});

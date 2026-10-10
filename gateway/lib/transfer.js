const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');

const HARD_MAX_BYTES = 512 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30000;
const MAX_RETAINED_BYTES = 2 * 1024 * 1024 * 1024;

class UploadError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
function isLocalCdp(env = process.env) {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.CDP_URL || 'http://127.0.0.1:9222').hostname); }
  catch { return false; }
}
function maxBytes(env = process.env) {
  if (!isLocalCdp(env)) return 0;
  const n = Number(env.CAB_UPLOAD_MAX_BYTES);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, HARD_MAX_BYTES) : HARD_MAX_BYTES;
}
function capabilities() {
  return { schemaVersion: 1, version: require('../../package.json').version, upload: {
    method: 'browser_bridge', available: isLocalCdp(), maxBytes: maxBytes(), transfer: 'stream_to_disk',
    timeoutMs: TIMEOUT_MS, idleTimeoutMs: IDLE_TIMEOUT_MS, tempRetentionMs: 3600000,
    maxRetainedBytes: MAX_RETAINED_BYTES, allowedProtocols: ['https:'], privateNetworkUrls: false,
  } };
}
function failure(err) {
  return { error: err.message, code: err.code || 'UPLOAD_FAILED', retryable: !['UPLOAD_TOO_LARGE', 'UPLOAD_URL_REJECTED'].includes(err.code),
    uploadMethod: 'browser_bridge', limitBytes: maxBytes(), ...err.details,
    remedy: err.code === 'UPLOAD_TOO_LARGE' ? 'Attach a smaller or otherwise compatible file.' : 'Check the file URL and upload method before trying again.' };
}
function tooLarge(bytes, limit) {
  return new UploadError('UPLOAD_TOO_LARGE', `File is ${bytes} bytes; browser_bridge permits at most ${limit} bytes. Attach a smaller or otherwise compatible file.`, 413, { fileSizeBytes: bytes, limitBytes: limit });
}
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast IPv6; exclude documentation and transition addresses.
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(db8|0):/i.test(address) && !/^2002:/i.test(address);
}
async function resolveUrl(value, { lookup = dns.lookup, allowedOrigins = [] } = {}) {
  let u;
  try { u = new URL(value); } catch { throw new UploadError('UPLOAD_URL_REJECTED', 'Invalid file URL.', 400); }
  const allowed = allowedOrigins.includes(u.origin); // operator-only exception, never request controlled
  if (u.username || u.password || u.hash || (!allowed && (u.protocol !== 'https:' || (u.port && u.port !== '443'))) || !['https:', 'http:'].includes(u.protocol)) {
    throw new UploadError('UPLOAD_URL_REJECTED', 'File URL must use public HTTPS without credentials, fragments or a custom port.', 400);
  }
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || (!allowed && addresses.some(a => !publicAddress(a.address)))) {
    throw new UploadError('UPLOAD_URL_REJECTED', 'File URL resolves to a non-public network address.', 400);
  }
  return { u, address: addresses[0] };
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new Error('File transfer interrupted.'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
async function download(url, destination, options = {}) {
  const limit = options.limit || maxBytes();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('File transfer exceeded its time limit.')), options.timeoutMs || TIMEOUT_MS);
  const onAbort = () => controller.abort(new Error('File transfer was interrupted.'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  let activeResponse;
  try {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      const { u, address } = await abortable(resolveUrl(current, options), controller.signal);
      const response = await new Promise((resolve, reject) => {
        const req = (u.protocol === 'https:' ? https : http).get(u, {
          signal: controller.signal,
          // Pin the validated resolution to this connection (DNS rebinding protection).
          lookup: (_host, opts, cb) => opts.all ? cb(null, [address]) : cb(null, address.address, address.family),
          headers: { 'Accept-Encoding': 'identity' },
        }, resolve);
        req.setTimeout(options.idleTimeoutMs || IDLE_TIMEOUT_MS, () => req.destroy(new Error('File transfer stalled.')));
        req.on('error', reject);
      });
      activeResponse = response;
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.destroy();
        if (hop === 5 || !response.headers.location) throw new UploadError('UPLOAD_DOWNLOAD_FAILED', 'File URL redirected too many times.', 502);
        current = new URL(response.headers.location, u).href;
        continue;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new UploadError('UPLOAD_DOWNLOAD_FAILED', 'File server returned an unsupported content encoding.', 502);
      if (response.statusCode < 200 || response.statusCode >= 300) throw new UploadError('UPLOAD_DOWNLOAD_FAILED', `File download returned HTTP ${response.statusCode}.`, 502);
      const length = response.headers['content-length'];
      const declared = length === undefined ? null : Number(length);
      if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) throw new UploadError('UPLOAD_DOWNLOAD_FAILED', 'Invalid file Content-Length.', 502);
      if (declared > limit) throw tooLarge(declared, limit);
      let bytes = 0;
      const hash = crypto.createHash('sha256');
      const counter = new Transform({ transform(chunk, _encoding, cb) {
        bytes += chunk.length;
        if (bytes > limit) return cb(tooLarge(bytes, limit));
        hash.update(chunk); cb(null, chunk);
      } });
      await pipeline(response, counter, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
      if (declared !== null && bytes !== declared) throw new UploadError('UPLOAD_DOWNLOAD_FAILED', 'File transfer ended before the complete file arrived.', 502);
      return { bytes, sha256: hash.digest('hex') };
    }
  } catch (err) {
    activeResponse?.destroy();
    await fs.promises.unlink(destination).catch(() => {});
    if (err instanceof UploadError) throw err;
    throw new UploadError('UPLOAD_DOWNLOAD_FAILED', controller.signal.aborted ? controller.signal.reason.message : 'File transfer failed or was interrupted.', 502);
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', onAbort);
  }
}
function checkDisk(dir, limit = maxBytes()) {
  // Reserve the worst-case transfer size across all bridge profiles sharing temp storage.
  const lock = require('node:path').join(dir, '.budget-lock');
  try {
    // The critical section has no asynchronous work. Recover a crashed owner's directory.
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmdirSync(lock);
    fs.mkdirSync(lock, { mode: 0o700 });
  }
  catch { throw new UploadError('UPLOAD_STORAGE_BUSY', 'Temporary upload storage is busy. Try again shortly.', 409); }
  try {
    const names = fs.readdirSync(dir);
    let total = 0;
    for (const name of names) {
      const file = require('node:path').join(dir, name);
      if (name.startsWith('.reservation-')) {
        const st = fs.statSync(file);
        if (Date.now() - st.mtimeMs > TIMEOUT_MS + 60000) { fs.unlinkSync(file); continue; }
        total += Number(fs.readFileSync(file, 'utf8')) || 0;
      } else if (name.startsWith('cab-upload-')) {
        total += fs.statSync(file).size;
      }
    }
    const disk = fs.statfsSync(dir);
    if (total + limit > MAX_RETAINED_BYTES || Number(disk.bavail) * Number(disk.bsize) < limit + 256 * 1024 * 1024) {
      throw new UploadError('UPLOAD_STORAGE_BUSY', 'Temporary upload storage is full. Wait for retained files to expire before trying again.', 507);
    }
    const reservation = require('node:path').join(dir, `.reservation-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
    fs.writeFileSync(reservation, String(limit), { flag: 'wx', mode: 0o600 });
    return () => { try { fs.unlinkSync(reservation); } catch {} };
  } finally { fs.rmdirSync(lock); }
}

module.exports = { isLocalCdp, HARD_MAX_BYTES, TIMEOUT_MS, IDLE_TIMEOUT_MS, MAX_RETAINED_BYTES, UploadError, maxBytes, capabilities, failure, publicAddress, resolveUrl, download, checkDisk };

// Unit tests for gateway/lib/recover.js: what the gateway does after Chrome,
// its page or its connection went away (see the cases at the top of that file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaunchArgs, isCrashError, isClosedError, cdpAnswers } = require('../gateway/lib/recover.js');

const base = { port: 9224, address: '127.0.0.1', profileDir: '/home/u/.local/share/chrome-agent-profile-c' };

test('a relaunch on Linux starts Chrome like the launcher: no first-run window, no keyring wait', () => {
  const args = relaunchArgs({ ...base, platform: 'linux' });
  for (const flag of ['--remote-debugging-port=9224', '--remote-debugging-address=127.0.0.1',
    '--disable-component-update', '--no-first-run', '--password-store=basic',
    '--user-data-dir=/home/u/.local/share/chrome-agent-profile-c']) {
    assert.ok(args.includes(flag), `missing ${flag}: ${args.join(' ')}`);
  }
});

test('the keyring flag is Linux only; --no-first-run is everywhere', () => {
  for (const platform of ['win32', 'darwin']) {
    const args = relaunchArgs({ ...base, platform });
    assert.ok(args.includes('--no-first-run'));
    assert.ok(!args.some((a) => a.startsWith('--password-store')), platform);
  }
});

test('extra args are appended once, never doubled', () => {
  const args = relaunchArgs({ ...base, platform: 'linux', extraArgs: ['--headless=new', '--no-first-run', 'about:blank'] });
  assert.equal(args.filter((a) => a === '--no-first-run').length, 1);
  assert.equal(args.at(-1), 'about:blank');
  assert.ok(args.includes('--headless=new'));
});

test('crash and closed errors are told apart from the rest', () => {
  assert.ok(isCrashError(new Error('page.goto: Page crashed\nCall log:\n  - navigating to "https://x"')));
  assert.ok(isClosedError(new Error('browserContext.newPage: Target page, context or browser has been closed')));
  assert.ok(!isCrashError(new Error('page.goto: Timeout 15000ms exceeded.')));
  assert.ok(!isClosedError(new Error('page.goto: Timeout 15000ms exceeded.')));
  assert.ok(!isClosedError(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED')));
});

test('a refused debug port is "not answering"; a slow one is left alone', async () => {
  const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const slow = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  const up = async () => ({ ok: true });
  assert.equal(await cdpAnswers('http://127.0.0.1:9224', { fetchImpl: refused }), false);
  assert.equal(await cdpAnswers('http://127.0.0.1:9224', { fetchImpl: slow }), true);
  assert.equal(await cdpAnswers('http://127.0.0.1:9224/', { fetchImpl: up }), true);
});

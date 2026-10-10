// Unit tests for the /screenshot options (v0.5.0) that need no browser: what a query asks for,
// and how a capture is cut to the height limit and to what Chrome can paint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shot = require('../gateway/lib/screenshot.js');

test('no options is the old screenshot: the viewport as PNG', () => {
  const o = shot.parseScreenshotQuery({});
  assert.equal(o.mode, 'viewport');
  assert.equal(o.format, 'png');
  assert.equal(o.contentType, 'image/png');
  assert.equal(o.quality, undefined, 'PNG carries no quality');
});

test('full=1 asks for the page, a selector for one element (it wins over full)', () => {
  assert.equal(shot.parseScreenshotQuery({ full: '1' }).mode, 'full');
  assert.equal(shot.parseScreenshotQuery({ full: 'true' }).mode, 'full');
  assert.equal(shot.parseScreenshotQuery({ full: '0' }).mode, 'viewport');
  const el = shot.parseScreenshotQuery({ selector: ' [data-mask] ', full: '1' });
  assert.equal(el.mode, 'element');
  assert.equal(el.selector, '[data-mask]');
});

test('jpeg and its quality, pad and max are read and kept in range', () => {
  const o = shot.parseScreenshotQuery({ format: 'jpeg', quality: '85', pad: '16', max: '9000' });
  assert.deepEqual([o.format, o.quality, o.pad, o.max, o.contentType], ['jpeg', 85, 16, 9000, 'image/jpeg']);
  assert.equal(shot.parseScreenshotQuery({ format: 'jpg' }).quality, 80, 'default quality');
  assert.equal(shot.parseScreenshotQuery({ pad: '999' }).pad, 200);
  assert.equal(shot.parseScreenshotQuery({ quality: '0', format: 'jpeg' }).quality, 1);
  assert.equal(shot.parseScreenshotQuery({}).max, shot.DEFAULT_MAX);
});

test('a bad format, number or overlong selector is refused', () => {
  assert.match(shot.parseScreenshotQuery({ format: 'gif' }).error, /format/);
  assert.match(shot.parseScreenshotQuery({ pad: 'lots' }).error, /pad/);
  assert.match(shot.parseScreenshotQuery({ max: 'x' }).error, /max/);
  assert.match(shot.parseScreenshotQuery({ selector: 'a'.repeat(501) }).error, /selector/);
});

test('fitClip cuts at max and says so, and never asks Chrome for more than it can paint', () => {
  const a = shot.fitClip({ x: 10.6, y: 20.2, width: 512.4, height: 3000.2 }, { max: 12000, dpr: 1.25 });
  assert.deepEqual(a.clip, { x: 10, y: 20, width: 513, height: 3001, scale: 1 });
  assert.equal(a.cut, false);
  const b = shot.fitClip({ x: 0, y: 0, width: 800, height: 20000 }, { max: 12000, dpr: 1 });
  assert.equal(b.clip.height, 12000);
  assert.equal(b.cut, true);
  const c = shot.fitClip({ x: 0, y: 0, width: 800, height: 15000 }, { max: 15000, dpr: 2 });
  assert.equal(c.clip.height, shot.DEVICE_LIMIT / 2, 'device pixel limit at a ratio of 2');
  assert.equal(c.cut, true);
});

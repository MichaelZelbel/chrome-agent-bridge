'use strict';
// Helpers for GET /screenshot beyond the viewport (v0.5.0).
//
//   GET /screenshot                    what the window shows, as PNG, at once (unchanged)
//   GET /screenshot?full=1             the whole page, top to bottom
//   GET /screenshot?selector=<css>     one element, whole, also the part below the window
//     pad=<css px>      room around the element (default 0, at most 200)
//     max=<css px>      the tallest picture taken (default 12000); a longer page is cut there
//     format=jpeg       JPEG instead of PNG, with quality=<1-100> (default 80)
//
// Without full or selector nothing changes: the viewport is grabbed immediately, so no caller of
// the old /screenshot sees a difference. parseScreenshotQuery is pure and tested without a
// browser; the in-page functions run inside the page through page.evaluate.

const DEFAULT_MAX = 12000;
// Chrome refuses or garbles a capture taller or wider than about 16384 device pixels.
const DEVICE_LIMIT = 16000;

const truthy = (v) => v === true || ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());

function intIn(v, lo, hi, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// Express query object in, options or { error } out.
function parseScreenshotQuery(q = {}) {
  const selector = typeof q.selector === 'string' ? q.selector.trim() : '';
  if (selector.length > 500) return { error: 'selector is longer than 500 characters' };
  const full = truthy(q.full);
  const format = String(q.format || 'png').toLowerCase();
  if (!['png', 'jpeg', 'jpg'].includes(format)) return { error: `format must be png or jpeg, not "${q.format}"` };
  const pad = intIn(q.pad, 0, 200, 0);
  const max = intIn(q.max, 100, 50000, DEFAULT_MAX);
  const quality = intIn(q.quality, 1, 100, 80);
  if (pad === null) return { error: 'pad must be a number' };
  if (max === null) return { error: 'max must be a number' };
  if (quality === null) return { error: 'quality must be a number' };
  const jpeg = format !== 'png';
  return {
    mode: selector ? 'element' : full ? 'full' : 'viewport',
    selector: selector || null,
    pad,
    max,
    format: jpeg ? 'jpeg' : 'png',
    quality: jpeg ? quality : undefined,
    contentType: jpeg ? 'image/jpeg' : 'image/png',
  };
}

// The capture rectangle in CSS pixels, cut to `max` and to what Chrome can paint at this device
// pixel ratio. Returns { clip, cut }.
function fitClip(rect, { max = DEFAULT_MAX, dpr = 1 } = {}) {
  const ratio = dpr > 0 ? dpr : 1;
  const limit = Math.floor(DEVICE_LIMIT / ratio);
  const width = Math.max(1, Math.min(Math.ceil(rect.width), limit));
  const tallest = Math.min(max, limit);
  const height = Math.max(1, Math.min(Math.ceil(rect.height), tallest));
  return {
    clip: { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width, height, scale: 1 },
    cut: Math.ceil(rect.height) > tallest,
  };
}

// --- runs inside the page -------------------------------------------------------------------
// Gets the page ready for a picture beyond the window and measures what to take. A part of the
// page that scrolls on its own (an inner scroll box, the usual single-page-app layout) would show
// only its visible slice, so that box and every box around it is let out to its full height for
// the moment of the picture. Everything changed is kept in window.__cabShot and put back by
// restoreAfterCapture, together with the scroll position.
function prepareCapture(args) {
  const done = window.__cabShot;
  if (done) {
    // A previous capture that never restored (its request died): put that back first.
    for (const [el, css, top] of done.styles.slice().reverse()) {
      el.getAttribute('style');
      if (css === null) el.removeAttribute('style'); else el.setAttribute('style', css);
      el.scrollTop = top;
    }
    window.scrollTo({ left: done.scrollX, top: done.scrollY, behavior: 'instant' });
  }
  const st = { scrollX: window.scrollX, scrollY: window.scrollY, styles: [], lifted: 0 };
  window.__cabShot = st;
  const root = document.documentElement;
  const scrolls = (el) => {
    const cs = getComputedStyle(el);
    const clipped = /(auto|scroll|hidden|overlay|clip)/.test(cs.overflowY);
    return clipped && el.scrollHeight > el.clientHeight + 1;
  };
  const lift = (el) => {
    st.styles.push([el, el.getAttribute('style'), el.scrollTop]);
    el.style.setProperty('overflow', 'visible', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    st.lifted++;
  };
  // From the first box that hides part of `from`, every box up to the page itself.
  const liftFrom = (from) => {
    let el = from;
    while (el && !scrolls(el)) el = el.parentElement;
    for (; el; el = el.parentElement) lift(el);
  };

  let target = null;
  if (args.selector) {
    try { target = document.querySelector(args.selector); } catch (e) { return { found: false, error: `bad selector: ${e.message}` }; }
    if (!target) return { found: false };
    if (target !== root && target !== document.body) liftFrom(target);
  } else {
    const docScrolls = (document.scrollingElement || root).scrollHeight > window.innerHeight + 1;
    if (!docScrolls) {
      // The page itself does not scroll: the biggest box that does holds the page.
      let best = null, area = 0;
      for (const el of document.body ? document.body.querySelectorAll('*') : []) {
        if (!scrolls(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height > area) { area = r.width * r.height; best = el; }
      }
      if (best) liftFrom(best);
    }
  }
  // 'instant', because a page with smooth scrolling would still be on its way up when measured.
  window.scrollTo({ left: 0, top: 0, behavior: 'instant' });

  // Kept with the rest, so the gateway can measure again after it made the window taller.
  st.measure = () => {
    const dpr = window.devicePixelRatio || 1;
    const scope = target || document;
    // Frames that show something: Chrome paints one from another site only inside the window.
    const frames = [...scope.querySelectorAll('iframe, frame')].filter((f) => {
      const r = f.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
    if (target) {
      const r = target.getBoundingClientRect();
      const pad = args.pad || 0;
      const x = Math.max(0, r.left + window.scrollX - pad);
      const y = Math.max(0, r.top + window.scrollY - pad);
      return { found: true, dpr, frames, lifted: st.lifted, rect: { x, y, width: r.width + 2 * pad, height: r.height + 2 * pad } };
    }
    const width = Math.max(root.clientWidth, Math.min(root.scrollWidth, root.clientWidth * 2));
    const height = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);
    return { found: true, dpr, frames, lifted: st.lifted, rect: { x: 0, y: 0, width, height } };
  };
  return st.measure();
}

// The same measurement again, on a page prepareCapture has already made ready.
function measureCapture() {
  const st = window.__cabShot;
  return st && st.measure ? st.measure() : { found: false };
}

function restoreAfterCapture() {
  const st = window.__cabShot;
  if (!st) return false;
  // Outermost first, so each inner box scrolls again by the time its scroll position is set.
  // Chrome writes a style changed through el.style into the attribute only when the attribute is
  // read, and a removeAttribute before that read leaves an empty style="" behind: read it first.
  for (const [el, css, top] of st.styles.slice().reverse()) {
    el.getAttribute('style');
    if (css === null) el.removeAttribute('style'); else el.setAttribute('style', css);
    el.scrollTop = top;
  }
  window.scrollTo({ left: st.scrollX, top: st.scrollY, behavior: 'instant' });
  delete window.__cabShot;
  return true;
}

// How long frames get to paint the part of the page that the taller window now shows.
const FRAME_SETTLE_MS = 1200;

module.exports = { parseScreenshotQuery, fitClip, prepareCapture, measureCapture, restoreAfterCapture, DEFAULT_MAX, DEVICE_LIMIT, FRAME_SETTLE_MS };

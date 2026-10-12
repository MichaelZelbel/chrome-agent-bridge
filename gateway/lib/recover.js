'use strict';
// How the gateway gets back to a working page after Chrome, its page or its
// connection went away. Three things stopped a Linux host's bridge for days
// (2026-10-07 to 10-12) while /health kept answering "ok":
//
//  1. The page the bridge drives crashed (the renderer ran out of memory). A
//     crashed page is not "closed", so every later /goto reused it and failed
//     with "page.goto: Page crashed".
//  2. Chrome lost its debug port, but the gateway's cached connection still
//     said it was connected. /health answered "ok" from that stale handle and
//     every /goto failed with "Target page, context or browser has been closed".
//  3. When the watchdog did relaunch Chrome, it left out the flags the launcher
//     starts Chrome with. Without --password-store=basic, Chrome on a Linux
//     autologin waits for a keyring that never unlocks and never opens its
//     debug port; without --no-first-run it can stop on a first-run or terms
//     window. Either way the relaunch never came back.

// The flags the launchers start Chrome with. A relaunch must use the same ones,
// or it starts a different Chrome than the one the launcher set up.
function relaunchArgs({ port, address, profileDir, extraArgs = [], platform = process.platform }) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=${address}`,
    '--disable-component-update',
    '--no-first-run',
    // Same reason as the POSIX launcher: no keyring prompt on an unattended Linux login.
    ...(platform === 'linux' ? ['--password-store=basic'] : []),
    `--user-data-dir=${profileDir}`,
  ];
  for (const a of extraArgs) {
    if (!args.includes(a)) args.push(a);
  }
  return args;
}

function message(err) {
  return String((err && err.message) || err || '');
}

// The renderer behind the page died. The page object stays "open" but is useless.
function isCrashError(err) {
  return /Page crashed|Target crashed/i.test(message(err));
}

// The page, its context or the whole browser is gone from under a cached handle.
function isClosedError(err) {
  return /has been closed|Target closed|Browser closed|browser has disconnected/i.test(message(err));
}

// Is Chrome's debug endpoint taking connections right now? Only a refused or
// failed connection counts as "no": a busy Chrome that answers slowly is left
// alone, so a slow page never gets its browser killed and relaunched.
async function cdpAnswers(cdpUrl, { timeoutMs = 3000, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${cdpUrl.replace(/\/$/, '')}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch (err) {
    const name = err && err.name;
    if (name === 'TimeoutError' || name === 'AbortError') return true;
    return false;
  }
}

module.exports = { relaunchArgs, isCrashError, isClosedError, cdpAnswers };

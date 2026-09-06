'use strict';
// Optional bearer token for the gateway. Off unless BRIDGE_TOKEN (or
// CAB_BRIDGE_TOKEN) is set, so nothing changes for an existing install. When
// set, every route but /health must carry `Authorization: Bearer <token>`.
// The private network stays the real boundary; this is for a bridge on a
// network someone else can reach, or a caller on a different machine.

function readToken(env = process.env) {
  return env.BRIDGE_TOKEN || env.CAB_BRIDGE_TOKEN || '';
}

// Express middleware. Exported as a factory so a test can hand in a token
// without touching the environment.
function makeTokenGuard(token) {
  return function tokenGuard(req, res, next) {
    if (!token) return next();
    if (req.path === '/health') return next();
    const header = req.headers && req.headers.authorization ? String(req.headers.authorization) : '';
    const presented = header.replace(/^Bearer\s+/i, '').trim();
    if (presented && timingSafeEqual(presented, token)) return next();
    return res.status(401).json({ error: 'Missing or wrong bridge token. Send Authorization: Bearer <BRIDGE_TOKEN>.' });
  };
}

function timingSafeEqual(a, b) {
  const crypto = require('crypto');
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { readToken, makeTokenGuard };

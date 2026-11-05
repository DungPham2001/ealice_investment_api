/**
 * Request context. The API is open: no login, no install id, no attestation.
 * `ctx.actor` (client IP) only scopes Idempotency-Key. There are no rate limits.
 * `createdBy` is a free-text display name (X-Display-Name or body.createdBy), "Anonymous" by default. Not an identity.
 */
const { check } = require('../lib/guard');

function displayName(raw) {
  if (typeof raw !== 'string') return 'Anonymous';
  let s = raw;
  if (s.includes('%')) {
    try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  }
  s = s.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s && !check(s) ? s : 'Anonymous';
}

function context(req, _res, next) {
  req.ctx = { actor: `ip:${req.ip}`, ip: req.ip, by: displayName(req.headers['x-display-name']) };
  next();
}

module.exports = { context, displayName };

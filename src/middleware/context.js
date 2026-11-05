/**
 * Identity of a request (handoff §2): no user accounts, only the installation.
 *  - every /v1 call needs X-Install-Id (16 hex characters, created by the app on first launch)
 *  - writes also need X-Attestation (Play Integrity token) when ATTESTATION_REQUIRED=true
 * `createdBy` is a free-text display name (X-Display-Name or body.createdBy), "Anonymous" by default. Not an identity.
 */
const config = require('../config');
const { forbidden } = require('../utils/AppError');
const { check } = require('../lib/guard');

const INSTALL_ID = /^[0-9a-f]{16}$/i;
const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Hook for the real Play Integrity verification (decode the token with Google's API, check package name and verdict).
 * Today only the header's presence is enforced.
 */
// eslint-disable-next-line no-unused-vars
async function verifyAttestation(_token, _req) {
  return true;
}

function displayName(raw) {
  if (typeof raw !== 'string') return 'Anonymous';
  let s = raw;
  if (s.includes('%')) {
    try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  }
  s = s.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s && !check(s) ? s : 'Anonymous';
}

async function context(req, _res, next) {
  try {
    const installId = req.headers['x-install-id'];
    if (typeof installId !== 'string' || !INSTALL_ID.test(installId)) throw forbidden('A valid X-Install-Id header is required.');
    if (config.attestationRequired && WRITES.has(req.method)) {
      const token = req.headers['x-attestation'];
      if (typeof token !== 'string' || !token || !(await verifyAttestation(token, req))) throw forbidden('A valid X-Attestation header is required for writes.');
    }
    req.ctx = { installId: installId.toLowerCase(), ip: req.ip, by: displayName(req.headers['x-display-name']) };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { context, displayName };

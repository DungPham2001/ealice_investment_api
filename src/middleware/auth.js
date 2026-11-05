const crypto = require('crypto');
const config = require('../config');
const { forbidden } = require('../utils/AppError');

const equal = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const bearer = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];

/** /v1/admin/*: X-Admin-Key must match ADMIN_KEY; disabled while ADMIN_KEY is empty. */
function adminOnly(req, _res, next) {
  if (!config.adminKey) return next(forbidden('Admin features are not enabled on the server (ADMIN_KEY).'));
  const key = req.headers['x-admin-key'];
  return key && equal(key, config.adminKey) ? next() : next(forbidden());
}

/** Daily job: Vercel Cron (Bearer CRON_SECRET) or an admin. Open only when neither secret is configured. */
function cronOrAdmin(req, _res, next) {
  if (!config.cronSecret && !config.adminKey) return next();
  const b = bearer(req);
  if (config.cronSecret && b && equal(b, config.cronSecret)) return next();
  const k = req.headers['x-admin-key'];
  if (config.adminKey && k && equal(k, config.adminKey)) return next();
  return next(forbidden());
}

module.exports = { adminOnly, cronOrAdmin };

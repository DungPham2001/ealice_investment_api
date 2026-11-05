/**
 * Rate limits per install id and per IP (handoff §2), counted in MongoDB so they hold across serverless instances:
 *   writes   WRITE_LIMIT_PER_MIN per minute      deletes  DELETE_LIMIT per DELETE_WINDOW_MIN minutes
 *   creates  CREATE_LIMIT_PER_DAY per day (record cap per install)
 * Reads are not limited. Over the limit -> 429 rate_limited + Retry-After.
 */
const config = require('../config');
const { RateLimit } = require('../models/system');
const { AppError } = require('../utils/AppError');

async function hit(key, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const filter = { _id: `${key}:${bucket}` };
  const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(((bucket + 1) * windowSec + 60) * 1000) } };
  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate(filter, update, { upsert: true, new: true }).lean();
  } catch (err) {
    if (err.code !== 11000) throw err;
    doc = await RateLimit.findOneAndUpdate(filter, update, { new: true }).lean(); // lost the upsert race
  }
  return { count: doc.count, retryAfter: Math.max(1, (bucket + 1) * windowSec - now) };
}

async function enforce(key, max, windowSec) {
  const { count, retryAfter } = await hit(key, windowSec);
  if (count > max) throw new AppError(429, 'rate_limited', 'Too many requests. Please try again later.', { retryAfter });
}

async function limits(req, _res, next) {
  try {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
    const { installId, ip } = req.ctx;
    await enforce(`w:i:${installId}`, config.writeLimitPerMin, 60);
    await enforce(`w:p:${ip}`, config.writeLimitPerMin, 60);
    if (req.method === 'DELETE') {
      const win = config.deleteWindowMin * 60;
      await enforce(`d:i:${installId}`, config.deleteLimit, win);
      await enforce(`d:p:${ip}`, config.deleteLimit, win);
    }
    if (req.method === 'POST') await enforce(`c:i:${installId}`, config.createLimitPerDay, 86400);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { limits };

const express = require('express');
const { createRecord, updateRecord, deleteRecord } = require('./record');
const { present } = require('./present');
const { list } = require('./list');
const { withTx } = require('./tx');
const { AppError, asyncHandler, notFound } = require('../utils/AppError');

/** JSON object body. */
function bodyOf(req) {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new AppError(400, 'bad_request', 'A JSON object body is required.');
  return b;
}

/** If-Match: 3 | "3" | W/"3"; `version` in the body is accepted as a fallback. */
function versionOf(req) {
  const h = req.headers['if-match'];
  const m = typeof h === 'string' && /^(?:W\/)?"?(\d+)"?$/.exec(h.trim());
  if (m) return Number(m[1]);
  if (Number.isInteger(req.body?.version)) return req.body.version;
  throw new AppError(428, 'precondition_required', 'Send the version you read: If-Match header or "version" in the body.');
}

const withEtag = (res, record) => res.set('ETag', `"${record.version}"`).json(record);
const one = async (cfg, doc) => (await present(cfg, [doc]))[0];

/** Standard REST router of a resource (handoff §2.1). */
function createRouter(cfg) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => res.json(await list(cfg, req.query))));

  router.post('/', asyncHandler(async (req, res) => {
    const doc = await withTx((session) => createRecord(cfg, bodyOf(req), req.ctx, { session }));
    res.status(201).set('Location', `/v1/${cfg.path}/${doc._id}`);
    withEtag(res, await one(cfg, doc));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const doc = await cfg.Model.findById(req.params.id).lean();
    if (!doc) throw notFound(cfg.noun);
    withEtag(res, await one(cfg, doc));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const body = bodyOf(req);
    const expectVersion = versionOf(req);
    const { doc } = await withTx((session) => updateRecord(cfg, req.params.id, body, { session, expectVersion }));
    withEtag(res, await one(cfg, doc));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await withTx((session) => deleteRecord(cfg, req.params.id, { session }));
    res.status(204).end();
  }));

  return router;
}

module.exports = { createRouter };

/**
 * create / update / delete of any registered resource. Pipeline:
 * validate body -> foreign keys exist -> closed-period lock -> save -> queue sync.
 * Every function takes an optional Mongo `session` so a cascade delete runs in ONE transaction.
 */
const registry = require('./registry');
const cascade = require('./cascade');
const { normalize } = require('./validate');
const { present, fromStore } = require('./present');
const { nextId } = require('./ids');
const { AppError, notFound, invalid, conflict } = require('../utils/AppError');
const { closedBefore } = require('../services/settings');
const queue = require('../services/queue');
const { check } = require('../lib/guard');

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** API values -> stored values (money in cents). */
function toStore(cfg, values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) out[k] = v !== null && cfg.fields[k].kind === 'money' ? Math.round(v * 100) : v;
  return out;
}

async function checkRefs(cfg, values, names, session) {
  const errors = {};
  for (const r of cfg.refs) {
    const id = values[r.name];
    if (!names.includes(r.name) || id == null) continue;
    if (r.to === cfg.path && id === values.__self) {
      errors[r.name] = 'cannot reference the record itself';
      continue;
    }
    if (!(await registry.get(r.to).Model.exists({ _id: id }).session(session))) errors[r.name] = `no ${registry.get(r.to).noun} with this id`;
  }
  if (Object.keys(errors).length) throw invalid(errors);
}

async function lockCheck(cfg, lockDate, session) {
  if (!cfg.lockDate || !lockDate) return;
  const cutoff = await closedBefore(session);
  if (cutoff && lockDate < cutoff) throw new AppError(423, 'locked', 'This period is closed: records in it cannot be created, edited or deleted.', { closedBefore: cutoff });
}

const lockOf = (cfg, values) => (cfg.lockDate ? cfg.lockDate(values) : null);

function authorOf(ctx, body) {
  const raw = typeof body.createdBy === 'string' ? body.createdBy.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return raw && !check(raw) ? raw : ctx.by;
}

async function createRecord(cfg, body, ctx, { session = null } = {}) {
  const { values, errors } = normalize(cfg, body, null);
  if (Object.keys(errors).length) throw invalid(errors);
  await checkRefs(cfg, values, cfg.writable, session);
  await lockCheck(cfg, lockOf(cfg, values), session);
  const _id = await nextId(cfg.prefix);
  const [doc] = await cfg.Model.create([{ _id, ...toStore(cfg, values), createdBy: authorOf(ctx, body) }], { session });
  const lean = doc.toObject();
  if (cfg.afterSave) await cfg.afterSave(lean, { session });
  return lean;
}

const conflictError = async (cfg, doc) =>
  new AppError(409, 'conflict', 'This record was changed by someone else. Reopen it to see the latest version.', { current: (await present(cfg, [doc]))[0] });

/** PATCH: only fields present in `body` change; version / updatedAt move only when a value really changed. */
async function updateRecord(cfg, id, body, { session = null, expectVersion }) {
  const doc = await cfg.Model.findById(id).session(session).lean();
  if (!doc) throw notFound(cfg.noun);
  if (doc.version !== expectVersion) throw await conflictError(cfg, doc);

  const current = fromStore(cfg, doc);
  await lockCheck(cfg, lockOf(cfg, current), session);
  const { values, errors } = normalize(cfg, body, current);
  if (Object.keys(errors).length) throw invalid(errors);
  const touched = cfg.writable.filter((n) => body[n] !== undefined);
  await checkRefs(cfg, { ...values, __self: id }, touched, session);
  await lockCheck(cfg, lockOf(cfg, values), session); // cannot move a record into a closed period either

  const stored = toStore(cfg, values);
  const $set = {};
  for (const n of cfg.writable) if (!same(stored[n], doc[n])) $set[n] = stored[n];
  if (!Object.keys($set).length) return { doc, changed: false };

  const saved = await cfg.Model.findOneAndUpdate({ _id: id, version: doc.version }, { $set, $inc: { version: 1 } }, { new: true, session }).lean();
  if (!saved) throw await conflictError(cfg, await cfg.Model.findById(id).session(session).lean());
  if (cfg.afterSave) await cfg.afterSave(saved, { session });
  return { doc: saved, changed: true };
}

/** Permanent delete + cascade (handoff §2). */
async function deleteRecord(cfg, id, { session = null } = {}) {
  const doc = await cfg.Model.findById(id).session(session).lean();
  if (!doc) throw notFound(cfg.noun);
  await lockCheck(cfg, lockOf(cfg, fromStore(cfg, doc)), session);
  const p = await cascade.plan(cfg.path, [id], session);
  for (const [path, ids] of p.removed) {
    const c = registry.get(path);
    if (c.lockDate && path !== cfg.path) {
      const rows = await c.Model.find({ _id: { $in: [...ids] } }).session(session).lean();
      for (const r of rows) await lockCheck(c, lockOf(c, fromStore(c, r)), session);
    }
  }
  await cascade.execute(p, session);
  await queue.sourcesDeleted(p.removed, session);
  return { cascaded: [...p.removed].reduce((n, [path, s]) => n + (path === cfg.path ? 0 : s.size), 0) };
}

module.exports = { createRecord, updateRecord, deleteRecord, toStore };

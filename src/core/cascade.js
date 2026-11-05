/**
 * Delete rules, driven by each ref field's `onDelete`:
 *   cascade  -> the child is deleted too (and its own children)
 *   unlink   -> the child's field becomes null
 *   restrict -> deletion is refused (409) while children exist
 */
const registry = require('./registry');
const { conflict } = require('../utils/AppError');

const childLinks = (path) => registry.all().flatMap((cfg) => cfg.refs.filter((r) => r.to === path).map((r) => ({ cfg, ...r })));

/** What deleting `ids` of `path` does: { removed: Map(path -> Set(ids)) incl. the roots, unlinks: [{ cfg, field, ids }] }. */
async function plan(path, ids, session) {
  const removed = new Map([[path, new Set(ids)]]);
  const unlinks = [];
  const queue = [[path, ids]];
  while (queue.length) {
    const [p, batch] = queue.shift();
    for (const link of childLinks(p)) {
      const rows = await link.cfg.Model.find({ [link.name]: { $in: batch } }, '_id').session(session).lean();
      const gone = removed.get(link.cfg.path);
      const fresh = rows.map((r) => String(r._id)).filter((id) => !gone?.has(id));
      if (!fresh.length) continue;
      if (link.onDelete === 'restrict') {
        throw conflict(`Cannot delete: ${fresh.length} ${link.cfg.noun} record(s) still reference it.`, { references: { resource: link.cfg.path, field: link.name, count: fresh.length } });
      }
      if (link.onDelete === 'unlink') {
        unlinks.push({ cfg: link.cfg, field: link.name, ids: fresh });
        continue;
      }
      if (!removed.has(link.cfg.path)) removed.set(link.cfg.path, new Set());
      for (const id of fresh) removed.get(link.cfg.path).add(id);
      queue.push([link.cfg.path, fresh]);
    }
  }
  return { removed, unlinks };
}

async function execute({ removed, unlinks }, session) {
  for (const { cfg, field, ids } of unlinks) {
    const live = ids.filter((id) => !removed.get(cfg.path)?.has(id));
    if (live.length) await cfg.Model.updateMany({ _id: { $in: live } }, { $set: { [field]: null }, $inc: { version: 1 } }, { session });
  }
  for (const [path, ids] of removed) await registry.get(path).Model.deleteMany({ _id: { $in: [...ids] } }, { session });
}

module.exports = { plan, execute };

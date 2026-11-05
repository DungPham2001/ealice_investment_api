/**
 * GET /v1/{resource}?q=&status=&sort=&order=&limit=&cursor=  (handoff §2.1)
 *   q            case-insensitive search over the display title + subtitle fields
 *   status       filter on the status field, several values separated by commas
 *   {field}=a,b  equality on any other field ("null" = no value), e.g. property=PRO-0003
 *   sort, order  any field (or createdAt / updatedAt); order asc|desc (asc when sort is given). Default createdAt desc
 *   limit        default 20, max 100;  cursor: opaque, from the previous page
 * -> { items, nextCursor, total }
 * Server-computed fields (occupancy, bucket, state ...) can be sorted / filtered too: that path works in memory.
 */
const registry = require('./registry');
const { present } = require('./present');
const { invalid } = require('../utils/AppError');
const { escapeRegex } = require('../lib/util');

const RESERVED = new Set(['q', 'status', 'sort', 'order', 'limit', 'cursor']);
const NUMERIC = new Set(['int', 'dec', 'pct', 'money']);
const SYSTEM_SORT = new Set(['createdAt', 'updatedAt', 'version']);

const encodeCursor = (offset) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
function decodeCursor(raw) {
  if (!raw) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (Number.isInteger(o) && o >= 0) return o;
  } catch { /* invalid */ }
  throw invalid({ cursor: 'invalid cursor, reload the list from the start' });
}

function one(query, key) {
  const v = query[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw invalid({ [key]: 'only a single value is accepted' });
  return v;
}

function cast(cfg, name, raw) {
  if (raw === 'null' || raw === '') return null;
  const f = cfg.fields[name];
  if (NUMERIC.has(f.kind)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw invalid({ [name]: 'must be a number' });
    return f.kind === 'money' ? Math.round(n * 100) : n;
  }
  if (f.kind === 'bool') return raw === 'true';
  return raw.normalize('NFC');
}

async function buildFilter(cfg, query, { skipStatus = false } = {}) {
  const and = [];
  const q = one(query, 'q')?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.normalize('NFC').slice(0, 80)), 'i');
    const or = cfg.searchFields.map((p) => ({ [p]: rx }));
    for (const name of cfg.searchRefs) {
      const target = registry.get(cfg.refMap[name].to);
      const ids = await target.Model.find({ [target.title]: rx }, '_id').limit(1000).lean();
      if (ids.length) or.push({ [name]: { $in: ids.map((r) => r._id) } });
    }
    and.push(or.length ? { $or: or } : { _id: null });
  }
  const status = one(query, 'status');
  if (status !== undefined && !skipStatus) {
    if (!cfg.statusField) throw invalid({ status: 'this resource has no status field' });
    and.push({ [cfg.statusField]: { $in: status.split(',').map((s) => s.trim()) } });
  }
  for (const key of Object.keys(query)) {
    if (RESERVED.has(key) || !cfg.fields[key] || cfg.fields[key].kind === 'obj') continue; // unknown keys are ignored
    const values = one(query, key).split(',').map((s) => cast(cfg, key, s.trim()));
    and.push({ [key]: values.length > 1 ? { $in: values } : values[0] });
  }
  return and.length ? { $and: and } : {};
}

function sortSpec(cfg, query) {
  const key = one(query, 'sort');
  const order = one(query, 'order');
  if (order !== undefined && !['asc', 'desc'].includes(order)) throw invalid({ order: 'must be asc or desc' });
  if (!key) return { key: 'createdAt', dir: -1 };
  const known = cfg.fields[key] || cfg.computed[key] !== undefined || SYSTEM_SORT.has(key) || key === 'id';
  if (!known) throw invalid({ sort: `cannot sort by "${key}"` });
  return { key, dir: order === 'desc' ? -1 : 1 };
}

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // nulls last
  if (b === null || b === undefined) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
};

async function list(cfg, query) {
  const limit = Math.min(100, Math.max(1, parseInt(one(query, 'limit'), 10) || 20));
  const offset = decodeCursor(one(query, 'cursor'));
  const { key, dir } = sortSpec(cfg, query);
  const inMemory = cfg.computed[key] !== undefined || (one(query, 'status') !== undefined && cfg.computed[cfg.statusField] !== undefined);

  let rows;
  let total;
  if (inMemory) {
    const filter = await buildFilter(cfg, query, { skipStatus: true });
    const all = await present(cfg, await cfg.Model.find(filter).lean());
    const status = one(query, 'status');
    const wanted = status === undefined ? null : new Set(status.split(',').map((s) => s.trim()));
    const kept = wanted ? all.filter((i) => wanted.has(i[cfg.statusField])) : all;
    kept.sort((a, b) => dir * compare(a[key], b[key]) || compare(a.id, b.id));
    total = kept.length;
    rows = kept.slice(offset, offset + limit);
  } else {
    const filter = await buildFilter(cfg, query);
    const dbKey = key === 'id' ? '_id' : key;
    const [docs, count] = await Promise.all([
      cfg.Model.find(filter).sort({ [dbKey]: dir, _id: 1 }).skip(offset).limit(limit).lean(),
      cfg.Model.countDocuments(filter),
    ]);
    total = count;
    rows = await present(cfg, docs);
  }
  const next = offset + rows.length;
  return { items: rows, nextCursor: next < total && rows.length === limit ? encodeCursor(next) : null, total };
}

module.exports = { list };

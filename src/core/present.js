/**
 * Stored record -> API record (handoff §2.2): id, version, timestamps, createdBy, business fields (money in dollars),
 * server-computed fields, and `<refField>Label` = display title of the referenced record.
 */
const registry = require('./registry');
const { iso } = require('../lib/util');

const cents = (v) => (v === null || v === undefined ? null : Math.round(v) / 100);

/** Stored (lean) doc -> plain API fields, no computed values and no labels. */
function fromStore(cfg, doc) {
  const out = {};
  for (const n of cfg.names) {
    const f = cfg.fields[n];
    const v = doc[n] ?? null;
    out[n] = f.kind === 'money' ? cents(v) : f.kind === 'bool' ? !!v : v;
  }
  return out;
}

/** Display titles by id for records of `path`. A title that is itself a reference (reserves.entity) resolves one level. */
async function titlesFor(path, ids) {
  const cfg = registry.get(path);
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  if (!cfg || !uniq.length) return out;
  const docs = await cfg.Model.find({ _id: { $in: uniq } }, { [cfg.title]: 1 }).lean();
  const titleRef = cfg.refMap[cfg.title];
  const nested = titleRef ? await titlesFor(titleRef.to, docs.map((d) => d[cfg.title])) : null;
  for (const d of docs) out.set(String(d._id), (nested ? nested.get(d[cfg.title]) : d[cfg.title]) ?? null);
  return out;
}

async function present(cfg, docs, { labels = true } = {}) {
  const ctx = cfg.context ? await cfg.context() : {};
  const items = docs.map((d) => {
    const item = {
      id: String(d._id),
      version: d.version ?? 1,
      createdAt: iso(d.createdAt),
      updatedAt: iso(d.updatedAt),
      createdBy: d.createdBy ?? 'Anonymous',
      ...fromStore(cfg, d),
    };
    for (const [k, fn] of Object.entries(cfg.computed)) item[k] = fn(item, ctx);
    if (cfg.decorate) cfg.decorate(item);
    return item;
  });
  if (labels) {
    for (const r of cfg.refs) {
      const map = await titlesFor(r.to, items.map((i) => i[r.name]));
      for (const i of items) i[`${r.name}Label`] = i[r.name] ? map.get(i[r.name]) ?? null : null;
    }
  }
  return items;
}

/** Subtitle shown under the title (calendar `info`): the subtitle fields joined with " · ". */
const subtitleOf = (cfg, item) => cfg.subtitle.map((k) => item[k]).filter((v) => v !== null && v !== undefined && v !== '').join(' · ');
const titleOf = (cfg, item) => (cfg.refMap[cfg.title] ? item[`${cfg.title}Label`] : item[cfg.title]) ?? '';

module.exports = { present, fromStore, titlesFor, subtitleOf, titleOf, cents };

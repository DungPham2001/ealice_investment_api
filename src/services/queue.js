/**
 * Server-generated Queue items (handoff §6). For each source record: condition holds and no auto item exists for
 * (source id, type) -> create one (Waiting); one exists as Done and the condition still holds -> reopen to Waiting;
 * condition no longer holds -> matching auto items become Done. Runs after every write to a source record
 * (and from the daily job for the time-driven conditions).
 */
const registry = require('../core/registry');
const { nextId } = require('../core/ids');
const { today, addDays, diffDays } = require('../lib/dates');

const cut = (s) => String(s).slice(0, 120);

/** source resource -> { type, rule(record, today) -> { title, priority, target } | null } */
const RULES = {
  leases: {
    type: 'Lease renewal',
    rule: (d, t) => {
      if (!d.end || ['Renewed', 'Terminated'].includes(d.status)) return null;
      const left = diffDays(t, d.end);
      return left >= 0 && left <= 60 ? { title: `Renew lease ${d.unit}`, priority: 'Normal', target: addDays(d.end, -20) } : null;
    },
  },
  'work-orders': {
    type: 'Maintenance',
    rule: (d) => (d.status === 'New' ? { title: `Assign contractor: ${d.desc}`, priority: d.severity, target: d.due || null } : null),
  },
  units: {
    type: 'Vacant unit',
    rule: (d, t) => (d.status === 'Vacant' ? { title: `Leasing plan for ${d.label}`, priority: 'Normal', target: addDays(t, 7) } : null),
  },
  loans: {
    type: 'Loan',
    rule: (d, t) => (d.maturity && d.status !== 'Paid off' && !d.refi && diffDays(t, d.maturity) <= 365
      ? { title: `Refinancing plan — ${d.lender}`, priority: 'High', target: addDays(d.maturity, -90) } : null),
  },
  'service-providers': {
    type: 'Service provider',
    rule: (d, t) => (d.end && d.status !== 'Expired' && diffDays(t, d.end) <= 45
      ? { title: `Renew service contract — ${d.company}`, priority: 'Normal', target: d.end } : null),
  },
  deals: {
    type: 'Due diligence',
    rule: (d, t) => (['Due diligence', 'Analysis'].includes(d.stage) ? { title: `Due diligence on ${d.name}`, priority: 'High', target: addDays(t, 7) } : null),
  },
};

const sources = () => Object.keys(RULES);
const queueCfg = () => registry.get('queue-items');

/** Re-evaluates the auto item of one source record (`doc` = lean stored record). */
async function syncOne(path, doc, { session = null, t = today() } = {}) {
  const spec = RULES[path];
  const Queue = queueCfg().Model;
  const want = spec.rule(doc, t);
  const existing = await Queue.findOne({ auto: true, source: String(doc._id), type: spec.type }).session(session).lean();

  if (want && !existing) {
    const _id = await nextId(queueCfg().prefix);
    await Queue.create([{ _id, ...want, title: cut(want.title), type: spec.type, source: String(doc._id), assignee: null, status: 'Waiting', note: null, auto: true, createdBy: 'System' }], { session });
  } else if (want && existing.status === 'Done') {
    await Queue.updateOne({ _id: existing._id }, { $set: { status: 'Waiting' }, $inc: { version: 1 } }, { session });
  } else if (!want && existing && existing.status !== 'Done') {
    await Queue.updateOne({ _id: existing._id }, { $set: { status: 'Done' }, $inc: { version: 1 } }, { session });
  }
}

/** `afterSave` hook of the source resources. */
const hookFor = (path) => (doc, opts) => syncOne(path, doc, opts);

/** Source records were deleted (directly or by cascade): their open auto items are closed. removed = Map(path -> Set(ids)). */
async function sourcesDeleted(removed, session) {
  for (const [path, ids] of removed) {
    if (!RULES[path]) continue;
    await queueCfg().Model.updateMany(
      { auto: true, type: RULES[path].type, source: { $in: [...ids] }, status: { $ne: 'Done' } },
      { $set: { status: 'Done' }, $inc: { version: 1 } },
      { session }
    );
  }
}

/** Daily job: re-evaluate every source record (time-driven conditions) and close items whose source is gone. */
async function syncAll() {
  const t = today();
  let n = 0;
  for (const path of sources()) {
    const docs = await registry.get(path).Model.find({}).lean();
    for (const d of docs) {
      await syncOne(path, d, { t });
      n++;
    }
    const ids = new Set(docs.map((d) => String(d._id)));
    const open = await queueCfg().Model.find({ auto: true, type: RULES[path].type, status: { $ne: 'Done' } }, 'source').lean();
    const orphans = open.filter((q) => !ids.has(q.source)).map((q) => q._id);
    if (orphans.length) await queueCfg().Model.updateMany({ _id: { $in: orphans } }, { $set: { status: 'Done' }, $inc: { version: 1 } });
  }
  return n;
}

module.exports = { RULES, sources, hookFor, syncOne, sourcesDeleted, syncAll };

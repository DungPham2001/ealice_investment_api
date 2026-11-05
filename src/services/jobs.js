const registry = require('../core/registry');
const { Snapshot } = require('../models/system');
const queue = require('./queue');
const { liveMetrics } = require('./reports');
const { today, monthStart } = require('../lib/dates');

/**
 * Things that change because time passed. Safe to run any number of times a day (Vercel Cron: /v1/jobs/daily):
 *  - re-evaluates the auto Queue items (lease/loan/contract dates move relative to "today")
 *  - writes the current month's snapshot (all entities + each entity) so past months keep the figure they had
 */
async function runDailyJobs() {
  const t = today();
  const queueSources = await queue.syncAll();
  const month = monthStart(t);
  const entities = await registry.get('entities').Model.find({}, '_id').lean();
  const keys = [null, ...entities.map((e) => String(e._id))];
  for (const entity of keys) {
    const m = await liveMetrics(entity);
    await Snapshot.updateOne({ _id: `${month}:${entity || 'all'}` }, { $set: { month, entity: entity || 'all', ...m, at: new Date() } }, { upsert: true });
  }
  return { date: t, queueSourcesChecked: queueSources, snapshots: keys.length };
}

module.exports = { runDailyJobs };

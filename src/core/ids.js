const { Counter } = require('../models/system');

/** Next code of a resource: PRO-0003, LSE-0012, Q-0001. Allocated outside any transaction: gaps are harmless, hot-spot conflicts are not. */
async function nextId(prefix) {
  const c = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
  return `${prefix}-${String(c.seq).padStart(4, '0')}`;
}

module.exports = { nextId };

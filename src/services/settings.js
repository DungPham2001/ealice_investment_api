const { Setting } = require('../models/system');

const ID = 'main';

/** Records dated before this day (YYYY-MM-DD) are read-only; null = nothing closed. */
async function closedBefore(session = null) {
  const s = await Setting.findById(ID).session(session).lean();
  return s?.closedBefore ?? null;
}

async function setClosedBefore(value) {
  const s = await Setting.findOneAndUpdate({ _id: ID }, { $set: { closedBefore: value, updatedAt: new Date() } }, { upsert: true, new: true }).lean();
  return s.closedBefore;
}

module.exports = { closedBefore, setClosedBefore };

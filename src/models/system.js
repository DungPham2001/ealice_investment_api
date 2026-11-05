const mongoose = require('mongoose');
const { Schema } = mongoose;

const make = (name, collection, def, indexes = []) => {
  const s = new Schema(def, { collection, versionKey: false, minimize: false });
  for (const [spec, opts] of indexes) s.index(spec, opts);
  return mongoose.model(name, s);
};

/** Per-resource counters behind PRO-0001, LSE-0012 ... */
const Counter = make('Counter', 'counters', { _id: String, seq: { type: Number, default: 0 } });

/** Idempotency-Key replays (24 h). */
const Idempotency = make('Idempotency', 'idempotency_keys', {
  key: String,
  scope: String,
  state: { type: String, default: 'pending' },
  status: Number,
  body: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, expires: 86400 },
}, [[{ key: 1, scope: 1 }, { unique: true }]]);

/** Public company / team content, edited from the admin site. _id = company | team. */
const Content = make('Content', 'contents', { _id: String, data: Schema.Types.Mixed, updatedAt: { type: Date, default: Date.now } });

/** Singleton settings: closedBefore = records dated before it are read-only (423). */
const Setting = make('Setting', 'settings', { _id: String, closedBefore: { type: String, default: null }, updatedAt: Date });

/** Monthly figures written by the daily job, for /reports/series. _id = `${YYYY-MM-01}:${entityId|all}`. */
const Snapshot = make('Snapshot', 'metric_snapshots', {
  _id: String,
  month: String,
  entity: String,
  occupancy: Number,
  noiMargin: Number,
  revenue: Number,
  lossRate: Number,
  at: { type: Date, default: Date.now },
}, [[{ month: 1, entity: 1 }]]);

module.exports = { Counter, Idempotency, Content, Setting, Snapshot };

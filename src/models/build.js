const mongoose = require('mongoose');
const { Schema } = mongoose;

const TYPES = { str: String, enum: String, ref: String, date: String, int: Number, dec: Number, pct: Number, money: Number, bool: Boolean, obj: Schema.Types.Mixed };

/**
 * One collection per resource. _id is the human-readable code (PRO-0003). Money fields hold integer cents
 * (`currency` = USD), everything else is stored as the API returns it. Optional values are null.
 */
function buildModel(cfg) {
  const def = {
    _id: { type: String },
    ...Object.fromEntries(cfg.names.map((n) => {
      const f = cfg.fields[n];
      return [n, { type: TYPES[f.kind], default: f.kind === 'bool' ? false : null }];
    })),
    createdBy: { type: String, default: 'Anonymous' },
    version: { type: Number, default: 1 },
  };
  if (cfg.names.some((n) => cfg.fields[n].kind === 'money')) def.currency = { type: String, default: 'USD' };

  const schema = new Schema(def, { collection: cfg.collection, timestamps: true, versionKey: false, minimize: false, id: false });
  schema.index({ createdAt: -1 });
  if (cfg.statusField && cfg.fields[cfg.statusField]) schema.index({ [cfg.statusField]: 1 });
  for (const r of cfg.refs) schema.index({ [r.name]: 1 });
  for (const [spec, opts] of cfg.indexes || []) schema.index(spec, opts);
  return mongoose.model(cfg.collection, schema);
}

module.exports = { buildModel };

/** Every resource by path. `define` derives writable fields, refs, search fields and the Mongoose model from the descriptors. */
const { buildModel } = require('../models/build');

const registry = new Map();

function define(cfg) {
  const names = Object.keys(cfg.fields);
  const full = {
    subtitle: [],
    computed: {},
    ...cfg,
    collection: cfg.path.replace(/-/g, '_'),
    names,
    writable: names.filter((n) => !cfg.fields[n].readOnly),
    refs: names.filter((n) => cfg.fields[n].kind === 'ref').map((name) => {
      const f = cfg.fields[name];
      return { name, to: f.to, required: !!f.required, onDelete: f.onDelete || (f.required ? 'restrict' : 'unlink') };
    }),
  };
  full.refMap = Object.fromEntries(full.refs.map((r) => [r.name, r]));

  // `q` searches the display title and subtitle fields (own text/enum fields directly, refs through their title).
  full.searchFields = [];
  full.searchRefs = [];
  for (const k of [cfg.title, ...full.subtitle]) {
    const base = k.endsWith('Label') ? k.slice(0, -5) : k;
    if (full.refMap[base]) full.searchRefs.push(base);
    else if (['str', 'enum'].includes(cfg.fields[k]?.kind)) full.searchFields.push(k);
  }
  full.Model = buildModel(full);
  registry.set(full.path, full);
  return full;
}

const get = (path) => registry.get(path);
const all = () => [...registry.values()];

module.exports = { define, get, all };

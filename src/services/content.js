/** Public company content (handoff §8): read-only for the app, edited from the admin site. Fields without data are omitted. */
const { Content } = require('../models/system');
const { invalid } = require('../utils/AppError');

const DEFAULTS = {
  company: {
    name: "EALICEA'S INVESTMENTS LLC",
    address: '2385 Home Again Rd, Apopka, FL 32712-6458',
    phone: '+1 730 283 6523',
    email: 'surveybasic@gmail.com',
    website: 'https://ealiceainvestmentllc.vercel.app/',
  },
  team: { items: [] },
};

const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(omitEmpty(v)).length);
function omitEmpty(v) {
  if (Array.isArray(v)) return v.map(omitEmpty).filter((x) => !empty(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, omitEmpty(x)]).filter(([, x]) => !empty(x)));
  return v;
}

async function getContent(key) {
  const row = await Content.findById(key).lean();
  const data = omitEmpty(row?.data ?? DEFAULTS[key]);
  return key === 'team' ? { ...data, items: data.items ?? [] } : data; // the team list is always an array
}

async function putContent(key, data) {
  if (!DEFAULTS[key]) throw invalid({ key: 'must be company or team' });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid({ body: 'must be a JSON object' });
  await Content.findOneAndUpdate({ _id: key }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
  return getContent(key);
}

/** Writes the default company profile once (db:init); never overwrites edits. */
async function seedDefaults() {
  for (const [key, data] of Object.entries(DEFAULTS)) await Content.updateOne({ _id: key }, { $setOnInsert: { data, updatedAt: new Date() } }, { upsert: true });
}

module.exports = { getContent, putContent, seedDefaults };

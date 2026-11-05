/**
 * The 30 resources of handoff §4: field tables (names, enums, required flags, limits), delete rules,
 * server-computed fields and display titles. Field names and enum strings are exactly the app's.
 */
const { define } = require('../core/registry');
const f = require('../core/fields');
const E = require('../models/enums');
const queue = require('../services/queue');
const { round, ratio } = require('../lib/util');
const { today } = require('../lib/dates');

const { R } = f;
const S = (o) => f.str(120, o);
const N = () => f.str(600);
const DATE = () => f.date();
const USD = () => f.money();
const PCT = () => f.pct();

/** later >= earlier for two optional date fields. */
const notBefore = (later, earlier) => (v) => (v[later] && v[earlier] && v[later] < v[earlier] ? { [later]: `must be on or after ${earlier}` } : null);

const currentYear = () => Number(today().slice(0, 4));

// ---- Structure & portfolio ----------------------------------------------------------------------
define({
  path: 'entities', prefix: 'ENT', noun: 'entity', title: 'label', subtitle: ['type', 'state'], statusField: 'status',
  fields: {
    label: S(R), type: f.en(E.ENTITY_TYPE, R), state: S(), purpose: f.en(E.ENTITY_PURPOSE), founded: DATE(),
    status: f.en(E.ENTITY_STATUS, R), parent: f.ref('entities', { onDelete: 'unlink' }), ownPct: PCT(), note: N(),
  },
});

const assetClasses = define({
  path: 'asset-classes', prefix: 'ACL', noun: 'asset class', title: 'group', subtitle: ['entityLabel'], statusField: 'drift',
  fields: {
    group: f.en(E.ASSET_GROUP, R), entity: f.ref('entities'), value: f.money(R), valueDate: DATE(), target: f.pct(R), band: PCT(),
  },
  // actual = value / sum of ALL asset-class values; drift depends on it, so the total is read once per request
  async context() {
    const [r] = await assetClasses.Model.aggregate([{ $group: { _id: null, cents: { $sum: '$value' } } }]);
    return { total: (r?.cents ?? 0) / 100 };
  },
  computed: {
    actual: (r, ctx) => ratio(r.value, ctx.total),
    drift: (r, ctx) => {
      const actual = ratio(r.value, ctx.total) ?? 0;
      return Math.abs(actual - (r.target ?? 0)) <= (r.band ?? 0) ? 'In range' : 'Off target';
    },
  },
});

define({
  path: 'investments', prefix: 'INV', noun: 'investment', title: 'name', subtitle: ['type'], statusField: 'status',
  fields: {
    name: S(R), type: f.en(E.INVESTMENT_TYPE, R), entity: f.ref('entities'), invested: USD(), value: USD(), income: USD(),
    date: DATE(), maturity: DATE(), status: f.en(E.INVESTMENT_STATUS, R), note: N(),
  },
  computed: { yield: (r) => (r.invested > 0 ? round((r.income / r.invested) * 100) : null) },
});

// ---- Real estate --------------------------------------------------------------------------------
define({
  path: 'properties', prefix: 'PRO', noun: 'property', title: 'name', subtitle: ['type', 'area'], statusField: 'status',
  fields: {
    name: S(R), type: f.en(E.PROPERTY_TYPE, R), entity: f.ref('entities'), area: S(R), year: f.year(), sqft: f.int(), units: f.int(R),
    occupied: f.int(), price: USD(), buyDate: DATE(), value: USD(), rev: USD(), opex: USD(), status: f.en(E.PROPERTY_STATUS, R), note: N(),
  },
  computed: {
    occupancy: (r) => ratio(r.occupied ?? 0, r.units),
    noiMargin: (r) => (r.rev > 0 ? round(((r.rev - (r.opex ?? 0)) / r.rev) * 100) : null),
    opexRatio: (r) => ratio(r.opex ?? 0, r.rev),
  },
});

define({
  path: 'units', prefix: 'UNT', noun: 'rental unit', title: 'label', subtitle: ['propertyLabel', 'type'], statusField: 'status',
  fields: {
    label: S(R), property: f.ref('properties', { required: true, onDelete: 'cascade' }), type: f.en(E.UNIT_TYPE), sqft: f.int(), beds: f.int(),
    baths: f.int(), listRent: USD(), vacantSince: DATE(), status: f.en(E.UNIT_STATUS, R),
  },
  afterSave: queue.hookFor('units'),
});

define({
  path: 'leases', prefix: 'LSE', noun: 'lease', title: 'unit', subtitle: ['propertyLabel'], statusField: 'status',
  fields: {
    unit: S(R), property: f.ref('properties', { required: true, onDelete: 'cascade' }), start: f.date(R), end: f.date(R), rent: USD(), deposit: USD(),
    renewal: N(), status: f.en(E.LEASE_STATUS, R),
  },
  validate: notBefore('end', 'start'),
  afterSave: queue.hookFor('leases'),
});

define({
  path: 'rent-collections', prefix: 'RNT', noun: 'rent record', title: 'unit', subtitle: ['month'], statusField: 'status',
  fields: {
    month: S(R), unit: S(R), due: USD(), collected: USD(), lastDate: DATE(), status: f.en(E.RENT_STATUS, R), note: N(),
  },
  validate: (v) => (v.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) ? { month: 'must be a month in YYYY-MM format' } : null),
  lockDate: (r) => (r.month && /^\d{4}-\d{2}$/.test(r.month) ? `${r.month}-01` : null),
  computed: { rate: (r) => (r.due > 0 ? round(Math.min(100, Math.max(0, ((r.collected ?? 0) / r.due) * 100))) : null) },
});

define({
  path: 'work-orders', prefix: 'WO', noun: 'work order', title: 'desc', subtitle: ['propertyLabel', 'category'], statusField: 'status',
  fields: {
    desc: S(R), property: f.ref('properties', { required: true, onDelete: 'cascade' }), unit: S(), category: f.en(E.WO_CATEGORY, R),
    severity: f.en(E.PRIORITY, R), vendor: f.ref('vendors'), est: USD(), actual: USD(), due: DATE(), done: DATE(), status: f.en(E.WO_STATUS, R),
  },
  afterSave: queue.hookFor('work-orders'),
});

define({
  path: 'vendors', prefix: 'VND', noun: 'contractor', title: 'company', subtitle: ['service'], statusField: 'status',
  fields: {
    company: S(R), service: f.en(E.VENDOR_SERVICE, R), license: S(), licenseExp: DATE(), insExp: DATE(), email: S({ contact: true }), phone: S({ contact: true }),
    rating: f.rating({ required: false }), status: f.en(E.VENDOR_STATUS, R),
  },
});

define({
  path: 'renovation-projects', prefix: 'REN', noun: 'renovation project', title: 'name', subtitle: ['propertyLabel'], statusField: 'status',
  fields: {
    name: S(R), property: f.ref('properties', { required: true, onDelete: 'cascade' }), scope: N(), budget: USD(), actual: USD(), vendor: f.ref('vendors'),
    start: DATE(), end: DATE(), percent: PCT(), permit: S(), permitExp: DATE(), status: f.en(E.RENO_STATUS, R),
  },
  validate: notBefore('end', 'start'),
});

define({
  path: 'inspections', prefix: 'INS', noun: 'inspection', title: 'category', subtitle: ['propertyLabel'], statusField: 'result',
  fields: {
    category: f.en(E.INSPECTION_CATEGORY, R), property: f.ref('properties', { required: true, onDelete: 'cascade' }), date: f.date(R), inspector: S(),
    result: f.en(E.INSPECTION_RESULT, R), note: N(),
  },
});

define({
  path: 'capex-items', prefix: 'CPX', noun: 'capital item', title: 'item', subtitle: ['propertyLabel'], statusField: 'bucket',
  fields: {
    item: f.en(E.CAPEX_ITEM, R), property: f.ref('properties', { required: true, onDelete: 'cascade' }), lastYear: f.year(R), life: f.int(R), cost: USD(),
  },
  computed: {
    dueYear: (r) => (r.lastYear ?? 0) + (r.life ?? 0),
    bucket: (r) => {
      const left = (r.lastYear ?? 0) + (r.life ?? 0) - currentYear();
      return left <= 1 ? E.CAPEX_BUCKET[0] : left <= 3 ? E.CAPEX_BUCKET[1] : left <= 5 ? E.CAPEX_BUCKET[2] : E.CAPEX_BUCKET[3];
    },
  },
});

define({
  path: 'reserves', prefix: 'RES', noun: 'reserve fund', title: 'entity', subtitle: [],
  fields: { entity: f.ref('entities', R), fund: f.money(R), need: f.money(R) },
  computed: { coverage: (r) => ratio(r.fund, r.need) },
});

// ---- Financials ---------------------------------------------------------------------------------
define({
  path: 'cash-flows', prefix: 'CF', noun: 'cash flow', title: 'category', subtitle: ['entityLabel'], statusField: 'dir',
  fields: {
    dir: f.en(E.CF_DIR, R), category: f.en(E.CF_CATEGORY, R), entity: f.ref('entities', R), amount: f.money(R), date: f.date(R), note: N(),
  },
  lockDate: (r) => r.date,
});

define({
  path: 'budgets', prefix: 'BUD', noun: 'budget line', title: 'category', subtitle: ['entityLabel', 'year'],
  fields: { category: f.en(E.EXPENSE_CATEGORY, R), entity: f.ref('entities', R), year: f.year({ required: true }), budget: f.money(R), actual: USD() },
  computed: { usage: (r) => ratio(r.actual ?? 0, r.budget) },
});

define({
  path: 'loans', prefix: 'LN', noun: 'loan', title: 'lender', subtitle: ['propertyLabel'], statusField: 'status',
  fields: {
    lender: S(R), property: f.ref('properties'), entity: f.ref('entities'), principal: USD(), balance: f.money(R), collateral: USD(), noi: USD(), payment: USD(),
    rate: f.pct(R), rateType: f.en(E.RATE_TYPE), term: f.int(), start: DATE(), maturity: f.date(R), refi: N(), status: f.en(E.LOAN_STATUS, R),
  },
  computed: {
    ltv: (r) => ratio(r.balance, r.collateral),
    dscr: (r) => (r.payment > 0 && r.noi !== null ? round(r.noi / (r.payment * 12), 2) : null),
  },
  afterSave: queue.hookFor('loans'),
});

define({
  path: 'goals', prefix: 'GL', noun: 'financial goal', title: 'name', subtitle: ['metric'], statusField: 'state',
  fields: { name: S(R), metric: f.en(E.GOAL_METRIC, R), target: f.dec(R), current: f.dec(R), due: DATE(), state: f.en(E.GOAL_STATE), note: N() },
});

// ---- Investing ----------------------------------------------------------------------------------
const DD = f.obj((raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw 'must be an object';
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!E.DD_ITEMS.includes(k)) throw `unknown checklist item "${k}"`;
    if (!E.DD_STATUS.includes(raw[k])) throw `"${k}" must be one of: ${E.DD_STATUS.join(', ')}`;
    out[k] = raw[k];
  }
  return out;
});

define({
  path: 'deals', prefix: 'DL', noun: 'deal', title: 'name', subtitle: ['area', 'type'], statusField: 'stage',
  fields: {
    name: S(R), side: f.en(E.DEAL_SIDE), area: S(), type: f.en(E.DEAL_TYPE), ask: USD(), offer: USD(), noi: USD(), cap: PCT(), source: S(), owner: S(),
    stage: f.en(E.DEAL_STAGE, R), note: N(), dd: DD,
  },
  // missing checklist keys read as "To do"
  decorate: (item) => { item.dd = Object.fromEntries(E.DD_ITEMS.map((k) => [k, item.dd?.[k] ?? 'To do'])); },
  afterSave: queue.hookFor('deals'),
});

define({
  path: 'buy-boxes', prefix: 'BB', noun: 'buy box', title: 'name', subtitle: ['type', 'area'],
  fields: {
    name: S(R), type: f.en(E.PROPERTY_TYPE), area: S(), unitsMin: f.int(), unitsMax: f.int(), capMin: PCT(), ltvMax: PCT(), dscrMin: f.dec(), other: N(),
  },
});

define({
  path: 'watchlist', prefix: 'WL', noun: 'watchlist item', title: 'name', subtitle: [], statusField: 'status',
  fields: { name: S(R), note: N(), added: DATE(), status: f.en(E.WATCH_STATUS, R) },
});

define({
  path: 'decision-notes', prefix: 'DEC', noun: 'decision note', title: 'title', subtitle: ['type', 'related'], statusField: 'status',
  fields: {
    title: S(R), type: f.en(E.DECISION_TYPE, R), date: f.date(R), related: S(), thesis: N(), assumption: PCT(), expected: PCT(), review: DATE(), actual: PCT(),
    lesson: N(), status: f.en(E.DECISION_STATUS, R),
  },
});

define({
  path: 'scenarios', prefix: 'SCN', noun: 'scenario', title: 'name', subtitle: ['tool', 'result'],
  fields: { name: S(R), tool: f.en(E.SCENARIO_TOOL), rate: PCT(), vacancy: PCT(), growth: PCT(), result: S(), link: S() },
});

// ---- Strategy & risk ----------------------------------------------------------------------------
define({
  path: 'policies', prefix: 'POL', noun: 'policy', title: 'name', subtitle: ['scope'], statusField: 'state',
  fields: { name: S(R), kind: f.en(E.POLICY_KIND, R), limit: f.dec(R), unit: f.en(E.POLICY_UNIT), scope: S(), usage: f.dec(R), note: N() },
  computed: {
    state: (r) => ((r.kind === 'Maximum' ? r.usage <= r.limit : r.usage >= r.limit) ? 'Within limit' : 'Over limit'),
  },
});

define({
  path: 'risks', prefix: 'RSK', noun: 'risk', title: 'desc', subtitle: ['category'], statusField: 'status',
  fields: {
    desc: S(R), category: f.en(E.RISK_CATEGORY, R), related: S(), likelihood: f.rating({ required: true }), impact: f.rating({ required: true }),
    mitigation: N(), owner: S(), review: DATE(), status: f.en(E.RISK_STATUS, R),
  },
  computed: {
    score: (r) => (r.likelihood ?? 0) * (r.impact ?? 0),
    level: (r) => { const s = (r.likelihood ?? 0) * (r.impact ?? 0); return s >= 15 ? 'High' : s >= 8 ? 'Medium' : 'Low'; },
  },
});

define({
  path: 'portfolio-reviews', prefix: 'PRV', noun: 'portfolio review', title: 'name', subtitle: ['period'], statusField: 'status',
  fields: { name: S(R), period: f.en(E.REVIEW_PERIOD, R), date: DATE(), ok: f.int(), watch: f.int(), act: f.int(), note: N(), status: f.en(E.REVIEW_STATUS, R) },
});

// ---- Work ---------------------------------------------------------------------------------------
define({
  path: 'queue-items', prefix: 'Q', noun: 'queue item', title: 'title', subtitle: ['type', 'source'], statusField: 'status',
  fields: {
    title: S(R), type: f.en(E.QUEUE_TYPE, R), source: S(), priority: f.en(E.PRIORITY, R), target: DATE(), assignee: S(), status: f.en(E.QUEUE_STATUS, R), note: N(),
    auto: f.bool({ readOnly: true }),
  },
  indexes: [[{ auto: 1, source: 1, type: 1 }]],
});

define({
  path: 'tasks', prefix: 'TK', noun: 'to-do', title: 'title', subtitle: ['related'], statusField: 'status',
  fields: { title: S(R), related: S(), owner: S(), due: f.date(R), priority: f.en(E.PRIORITY, R), status: f.en(E.TASK_STATUS, R) },
});

// ---- Reference data -----------------------------------------------------------------------------
define({
  path: 'service-providers', prefix: 'SP', noun: 'service provider', title: 'company', subtitle: ['type'], statusField: 'status',
  fields: {
    company: S(R), type: f.en(E.SP_TYPE, R), scope: N(), start: DATE(), end: DATE(), fee: USD(), rating: f.rating({ required: false }), status: f.en(E.SP_STATUS, R),
  },
  validate: notBefore('end', 'start'),
  afterSave: queue.hookFor('service-providers'),
});

define({
  path: 'partners', prefix: 'PT', noun: 'partner', title: 'company', subtitle: ['type', 'city'],
  fields: {
    company: S(R), type: f.en(E.PARTNER_TYPE, R), city: S(), website: S({ contact: true }), email: S({ contact: true }), phone: S({ contact: true }), note: N(),
  },
});

// ---- Asset analysis -----------------------------------------------------------------------------
define({
  path: 'comparisons', prefix: 'CMP', noun: 'comparison', title: 'name', subtitle: ['codes'],
  fields: { name: S(R), codes: S(R) },
});

module.exports = require('../core/registry');

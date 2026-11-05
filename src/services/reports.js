/** Dashboard & report endpoints computed server-side (handoff §7). All percentages 1 dp; no nulls in the dashboard (0 when there is no data). */
const registry = require('../core/registry');
const { present, subtitleOf, titleOf } = require('../core/present');
const { Snapshot } = require('../models/system');
const E = require('../models/enums');
const { round, ratio, sum, mean, clamp, iso } = require('../lib/util');
const D = require('../lib/dates');
const { notFound, invalid } = require('../utils/AppError');

/** All records of a resource in API shape (computed fields included, no labels). */
async function load(path, filter = {}) {
  const cfg = registry.get(path);
  return present(cfg, await cfg.Model.find(filter).lean(), { labels: false });
}

async function entityFilter(entity) {
  if (entity === undefined) return {};
  if (typeof entity !== 'string' || !(await registry.get('entities').Model.exists({ _id: entity }))) throw notFound('entity');
  return { entity };
}

const dayOf = (d) => D.dateInTz(d);
const r1 = (n) => round(n, 1) ?? 0;

// ---- 7.1 dashboard ------------------------------------------------------------------------------
async function dashboard({ entity } = {}) {
  const ef = await entityFilter(entity);
  const t = D.today();
  const [entities, propsAll, acls, budgets, flows, loansAll, reserves, policies, risksAll, wos, leases, capex, queueAll, deals, tasks, goals] = await Promise.all([
    load('entities', { status: 'Active' }), load('properties', ef), load('asset-classes', ef), load('budgets', ef), load('cash-flows', ef),
    load('loans', ef), load('reserves', ef), load('policies'), load('risks'), load('work-orders'), load('leases'), load('capex-items'),
    load('queue-items'), load('deals'), load('tasks'), load('goals'),
  ]);

  const props = propsAll.filter((p) => p.status !== 'Sold');
  const units = sum(props, (p) => p.units);
  const occupied = sum(props, (p) => p.occupied);
  const rev = sum(props, (p) => p.rev);
  const opex = sum(props, (p) => p.opex);

  const aclTotal = sum(acls, (a) => a.value);
  const income = flows.filter((c) => c.dir === 'Income');
  const incomeTotal = sum(income, (c) => c.amount);
  const expenseTotal = sum(flows.filter((c) => c.dir === 'Expense'), (c) => c.amount);
  const byCategory = {};
  for (const c of income) {
    const k = ['Rent', 'Dividends', 'Interest'].includes(c.category) ? c.category : 'Other income';
    byCategory[k] = (byCategory[k] || 0) + c.amount;
  }
  const cash = sum(acls.filter((a) => a.group === 'Cash equivalents'), (a) => a.value);
  const liquidityPolicy = policies.find((p) => /liquidity/i.test(p.name));

  const loans = loansAll.filter((l) => l.status !== 'Paid off');
  const ladder = {};
  for (const l of loans) {
    const y = Number(l.maturity.slice(0, 4));
    ladder[y] = (ladder[y] || 0) + 1;
  }
  const dscrs = loans.map((l) => l.dscr).filter((v) => v !== null);

  const risks = risksAll.filter((r) => r.status !== 'Closed');
  const heat = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const r of risks) heat[r.impact - 1][r.likelihood - 1]++;

  const openWo = wos.filter((w) => !['Completed', 'Cancelled'].includes(w.status));
  const closed = wos.filter((w) => w.status === 'Completed');
  const closeDays = closed.map((w) => clamp(D.diffDays(dayOf(w.createdAt), w.done || dayOf(w.updatedAt)), 1, 30));

  const within = (c, years) => capex.filter((x) => x.dueYear - Number(t.slice(0, 4)) <= years).length;
  const renewed = leases.filter((l) => l.status === 'Renewed').length;
  const ended = renewed + leases.filter((l) => ['Expired', 'Terminated'].includes(l.status)).length;

  const open = queueAll.filter((q) => q.status !== 'Done');
  const overdue = open.filter((q) => q.target && q.target < t);
  const byType = {};
  for (const q of open) byType[q.type] = (byType[q.type] || 0) + 1;

  const tasksOpen = tasks.filter((x) => x.status !== 'Done');
  const yesterday = D.addDays(t, -1);

  return {
    entities: entities.length,
    properties: props.length,
    units,
    vacantUnits: units - occupied,
    occupancy: r1(ratio(occupied, units)),
    noiMargin: r1(ratio(rev - opex, rev)),
    opexRatio: r1(ratio(opex, rev)),
    budgetUsage: r1(ratio(sum(budgets, (b) => b.actual), sum(budgets, (b) => b.budget))),
    allocation: acls.map((a) => ({ group: a.group, actual: r1(a.actual), target: a.target })),
    income: ['Rent', 'Dividends', 'Interest', 'Other income'].filter((k) => byCategory[k]).map((k) => ({ category: k, share: r1(ratio(byCategory[k], incomeTotal)) })),
    cashFlow: { positive: incomeTotal >= expenseTotal, netPct: r1(ratio(incomeTotal - expenseTotal, incomeTotal)) },
    liquidity: { months: expenseTotal > 0 ? round(cash / expenseTotal, 1) : 0, minimum: liquidityPolicy?.limit ?? 9 },
    debt: {
      avgLtv: r1(mean(loans.map((l) => l.ltv).filter((v) => v !== null))),
      minDscr: dscrs.length ? round(Math.min(...dscrs), 2) : 0,
      maturingWithin12Months: loans.filter((l) => D.diffDays(t, l.maturity) <= 365).length,
      ladder: Object.keys(ladder).sort().map((y) => ({ year: Number(y), count: ladder[y] })),
    },
    policies: { within: policies.filter((p) => p.state === 'Within limit').length, over: policies.filter((p) => p.state === 'Over limit').length },
    risks: {
      high: risks.filter((r) => r.level === 'High').length,
      medium: risks.filter((r) => r.level === 'Medium').length,
      low: risks.filter((r) => r.level === 'Low').length,
      heat,
    },
    workOrders: {
      open: openWo.length,
      overdue: openWo.filter((w) => w.due && w.due < t).length,
      avgDaysToClose: Math.round(mean(closeDays)),
    },
    leases: {
      expiringIn60Days: leases.filter((l) => !['Renewed', 'Terminated'].includes(l.status) && D.diffDays(t, l.end) >= 0 && D.diffDays(t, l.end) <= 60).length,
      renewalRate: ended ? r1(ratio(renewed, ended)) : 72,
    },
    capex: { within1y: within(capex, 1), within3y: within(capex, 3), within5y: within(capex, 5), reserveCoverage: r1(ratio(sum(reserves, (x) => x.fund), sum(reserves, (x) => x.need))) },
    queue: {
      byType,
      overdue: overdue.length,
      avgWaitDays: r1(mean(open.map((q) => Math.max(0, D.diffDays(dayOf(q.createdAt), t))))),
      onTimePct: open.length ? r1(ratio(open.length - overdue.length, open.length)) : 100,
    },
    deals: Object.fromEntries(E.DEAL_STAGE.map((s) => [s, deals.filter((d) => d.stage === s).length])),
    tasks: {
      dueWithin7Days: tasksOpen.filter((x) => D.diffDays(t, x.due) >= 0 && D.diffDays(t, x.due) <= 7).length,
      overdue: tasksOpen.filter((x) => x.due < yesterday).length,
    },
    goalsProgress: r1(mean(goals.map((g) => (g.target > 0 ? Math.min(g.current / g.target, 1) : 1) * 100))),
    updatedAt: iso(new Date()),
  };
}

// ---- 7.2 series ---------------------------------------------------------------------------------
const METRICS = ['occupancy', 'noiMargin', 'revenue', 'lossRate'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Current value of every series metric. Revenue = monthly revenue of the properties; loss rate = vacancy + under-collection (current month). */
async function liveMetrics(entity) {
  const ef = entity ? { entity } : {};
  const t = D.today();
  const [propsAll, rents] = await Promise.all([load('properties', ef), load('rent-collections', { month: t.slice(0, 7) })]);
  const props = propsAll.filter((p) => p.status !== 'Sold');
  const units = sum(props, (p) => p.units);
  const rev = sum(props, (p) => p.rev);
  const occupancy = units ? ratio(sum(props, (p) => p.occupied), units) : 0;
  const due = sum(rents, (x) => x.due);
  const underCollection = due > 0 ? 100 - ratio(sum(rents, (x) => x.collected), due) : 0;
  return { occupancy, noiMargin: r1(ratio(rev - sum(props, (p) => p.opex), rev)), revenue: round(rev, 2), lossRate: r1(100 - occupancy + Math.max(0, underCollection)) };
}

async function series({ metric, period = 'month', entity } = {}) {
  if (!METRICS.includes(metric)) throw invalid({ metric: `must be one of: ${METRICS.join(', ')}` });
  if (!D.PERIODS.includes(period)) throw invalid({ period: `must be one of: ${D.PERIODS.join(', ')}` });
  await entityFilter(entity);
  const t = D.today();
  const thisMonth = D.monthStart(t);
  const key = entity || 'all';
  const [live, snaps] = await Promise.all([liveMetrics(entity), Snapshot.find({ entity: key }).lean()]);
  const byMonth = new Map(snaps.map((s) => [s.month, s]));
  const at = (month) => (month >= thisMonth ? live[metric] : byMonth.get(month)?.[metric] ?? null);

  const labels = [];
  const values = [];
  if (period === 'month') {
    for (let i = 11; i >= 0; i--) {
      const m = D.addMonths(thisMonth, -i);
      labels.push(MONTHS[Number(m.slice(5, 7)) - 1]);
      values.push(at(m));
    }
  } else if (period === 'quarter') {
    const q0 = Math.floor((Number(thisMonth.slice(5, 7)) - 1) / 3) * 3 + 1;
    const start = `${thisMonth.slice(0, 4)}-${String(q0).padStart(2, '0')}-01`;
    for (let i = 7; i >= 0; i--) {
      const first = D.addMonths(start, -3 * i);
      labels.push(`Q${Math.floor((Number(first.slice(5, 7)) - 1) / 3) + 1} ${first.slice(0, 4)}`);
      values.push(at(D.addMonths(first, 2))); // value at quarter end (live for the running quarter)
    }
  } else {
    const y0 = Number(thisMonth.slice(0, 4));
    for (let i = 4; i >= 0; i--) {
      labels.push(String(y0 - i));
      values.push(at(`${y0 - i}-12-01`));
    }
  }
  return { metric, period, labels, values };
}

// ---- 7.3 highlights -----------------------------------------------------------------------------
async function highlights({ period = 'month' } = {}) {
  if (!D.PERIODS.includes(period)) throw invalid({ period: `must be one of: ${D.PERIODS.join(', ')}` });
  const t = D.today();
  const range = D.periodRange(period, t);
  const [propsAll, units, leases, wos, deals, renos, goals] = await Promise.all([
    load('properties'), load('units'), load('leases'), load('work-orders'), load('deals'), load('renovation-projects'), load('goals'),
  ]);
  const props = propsAll.filter((p) => p.status !== 'Sold');
  const scored = props.map((p) => ({ id: p.id, name: p.name, occupancy: p.occupancy ?? 0, noiMargin: p.noiMargin ?? 0, opexRatio: p.opexRatio ?? 0 }));
  const vacant = units.filter((u) => u.status === 'Vacant' && u.vacantSince).map((u) => Math.max(0, D.diffDays(u.vacantSince, t)));
  const events = await calendar({ from: t, to: D.addDays(t, 365) });

  return {
    period, from: range.from, to: range.to,
    topProperties: [...scored].sort((a, b) => b.occupancy + b.noiMargin - (a.occupancy + a.noiMargin)).slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, occupancy: p.occupancy, noiMargin: p.noiMargin, score: r1(p.occupancy + p.noiMargin) })),
    needAttention: [...scored].sort((a, b) => a.occupancy - a.opexRatio / 4 - (b.occupancy - b.opexRatio / 4)).slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, occupancy: p.occupancy, opexRatio: p.opexRatio, score: r1(p.occupancy - p.opexRatio / 4) })),
    leases: {
      new: leases.filter((l) => D.inRange(dayOf(l.createdAt), range)).length,
      renewed: leases.filter((l) => l.status === 'Renewed' && D.inRange(dayOf(l.updatedAt), range)).length,
    },
    avgVacancyDays: Math.round(mean(vacant)),
    workOrdersClosed: wos.filter((w) => w.status === 'Completed' && D.inRange(w.done || dayOf(w.updatedAt), range)).length,
    dealsCreated: deals.filter((d) => D.inRange(dayOf(d.createdAt), range)).length,
    renovations: renos.filter((r) => ['In construction', 'Final inspection'].includes(r.status)).map((r) => ({ id: r.id, name: r.name, status: r.status, percent: r.percent ?? 0 })),
    goals: goals.map((g) => ({ id: g.id, name: g.name, progress: r1((g.target > 0 ? Math.min(g.current / g.target, 1) : 1) * 100) })),
    milestones: events.items.slice(0, 5),
  };
}

// ---- 7.4 property metrics -----------------------------------------------------------------------
async function propertyMetrics({ ids } = {}) {
  if (ids !== undefined && typeof ids !== 'string') throw invalid({ ids: 'must be a comma separated list of property ids' });
  const wanted = ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const [props, loans, units, wos, capex] = await Promise.all([
    load('properties', wanted ? { _id: { $in: wanted } } : {}), load('loans'), load('units'), load('work-orders'), load('capex-items'),
  ]);
  const year = Number(D.today().slice(0, 4));
  const t = D.today();
  const items = props.map((p) => {
    const myLoans = loans.filter((l) => l.property === p.id && l.status !== 'Paid off');
    const ltvs = myLoans.map((l) => l.ltv).filter((v) => v !== null);
    const dscrs = myLoans.map((l) => l.dscr).filter((v) => v !== null);
    const vacancy = units.filter((u) => u.property === p.id && u.status === 'Vacant' && u.vacantSince).map((u) => Math.max(0, D.diffDays(u.vacantSince, t)));
    const openWo = wos.filter((w) => w.property === p.id && !['Completed', 'Cancelled'].includes(w.status)).length;
    const capexSoon = capex.filter((c) => c.property === p.id && c.dueYear - year <= 3).length;
    const occupancy = p.occupancy ?? 0;
    const noiMargin = p.noiMargin ?? 0;
    const opexRatio = p.opexRatio ?? 0;
    const dscr = dscrs.length ? Math.min(...dscrs) : null;
    const scores = {
      occupancy: r1(clamp(occupancy, 0, 100)),
      noi: r1(Math.min(noiMargin / 70, 1) * 100),
      expenses: r1(clamp(100 - opexRatio * 1.4, 0, 100)),
      maintenance: r1(clamp(100 - openWo * 25, 0, 100)),
      capex: r1(clamp(100 - capexSoon * 25, 0, 100)),
      dscr: dscr === null ? 60 : r1(clamp(Math.min(dscr / 1.6, 1) * 100, 0, 100)),
    };
    return {
      id: p.id, name: p.name, occupancy, noiMargin, opexRatio,
      ltv: ltvs.length ? r1(mean(ltvs)) : null, dscr: dscr === null ? null : round(dscr, 2),
      avgVacancyDays: Math.round(mean(vacancy)), openWorkOrders: openWo, capexWithin3y: capexSoon,
      scores, score: r1(mean(Object.values(scores))),
    };
  });
  return { items };
}

// ---- 7.5 map ------------------------------------------------------------------------------------
/** Per city only (from `area` "City, ZIP"): never addresses or coordinates. */
async function map() {
  const props = (await load('properties')).filter((p) => p.status !== 'Sold');
  const cities = new Map();
  for (const p of props) {
    const city = (p.area || '').split(',')[0].trim() || 'Unknown';
    if (!cities.has(city)) cities.set(city, []);
    cities.get(city).push(p);
  }
  return {
    items: [...cities].map(([city, list]) => ({
      city, properties: list.length, units: sum(list, (p) => p.units),
      occupancy: r1(ratio(sum(list, (p) => p.occupied), sum(list, (p) => p.units))),
      share: r1(ratio(list.length, props.length)),
    })).sort((a, b) => b.properties - a.properties || a.city.localeCompare(b.city)),
  };
}

// ---- 7.6 calendar -------------------------------------------------------------------------------
const CAL = [
  { kind: 'lease-end', path: 'leases', field: 'end', keep: (r) => !['Renewed', 'Terminated'].includes(r.status) },
  { kind: 'loan-maturity', path: 'loans', field: 'maturity', keep: (r) => r.status !== 'Paid off' },
  { kind: 'work-order-due', path: 'work-orders', field: 'due', keep: (r) => !['Completed', 'Cancelled'].includes(r.status) },
  { kind: 'renovation-end', path: 'renovation-projects', field: 'end', keep: (r) => r.status !== 'Finished' },
  { kind: 'service-provider-end', path: 'service-providers', field: 'end', keep: () => true },
  { kind: 'queue-target', path: 'queue-items', field: 'target', keep: (r) => r.status !== 'Done' },
  { kind: 'task-due', path: 'tasks', field: 'due', keep: (r) => r.status !== 'Done' },
  { kind: 'risk-review', path: 'risks', field: 'review', keep: (r) => r.status !== 'Closed' },
  { kind: 'decision-review', path: 'decision-notes', field: 'review', keep: (r) => r.status !== 'Reviewed' },
];

async function calendar({ from, to } = {}) {
  from = from ?? D.today();
  if (!D.isDate(from)) throw invalid({ from: 'must be a date in YYYY-MM-DD format' });
  to = to ?? D.addDays(from, 90);
  if (!D.isDate(to)) throw invalid({ to: 'must be a date in YYYY-MM-DD format' });
  if (to < from) throw invalid({ to: 'must be on or after from' });
  const items = [];
  for (const c of CAL) {
    const cfg = registry.get(c.path);
    const rows = await present(cfg, await cfg.Model.find({ [c.field]: { $gte: from, $lte: to } }).lean());
    for (const r of rows.filter(c.keep)) items.push({ kind: c.kind, resource: c.path, id: r.id, title: titleOf(cfg, r), info: subtitleOf(cfg, r), date: r[c.field] });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { from, to, items };
}

module.exports = { dashboard, series, highlights, propertyMetrics, map, calendar, liveMetrics, METRICS };

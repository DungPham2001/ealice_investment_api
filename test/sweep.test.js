/** Every one of the 30 resources: create -> read -> list -> search -> patch (If-Match) -> delete, with no headers at all. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, reset, api, create } = require('./helpers');

before(start);
after(stop);
beforeEach(reset);

test('full CRUD cycle on all 30 resources', async () => {
  const e = (await create('entities', { label: 'Entity A', type: 'LLC', status: 'Active' })).id;
  const p = (await create('properties', { name: 'Orchid Court', type: 'Multifamily', area: 'Orlando, 32801', units: 10, status: 'Owned' })).id;
  const v = (await create('vendors', { company: 'Pipes Inc', service: 'Plumbing', status: 'Active' })).id;

  // path -> [create body, patch body]
  const cases = {
    entities: [{ label: 'Entity B', type: 'LLC', status: 'Active' }, { status: 'Suspended' }],
    'asset-classes': [{ group: 'Bonds', entity: e, value: 100, target: 10 }, { value: 200 }],
    investments: [{ name: 'Fund', type: 'Stock', status: 'Holding', invested: 10, income: 1 }, { value: 50 }],
    properties: [{ name: 'Palm Plaza', type: 'Land', area: 'Ocala, 34470', units: 0, status: 'Owned' }, { status: 'Sold' }],
    units: [{ label: 'A-1', property: p, status: 'Vacant' }, { status: 'Occupied' }],
    leases: [{ unit: 'A-1', property: p, start: '2026-01-01', end: '2027-01-01', status: 'In force' }, { rent: 1500 }],
    'rent-collections': [{ month: '2026-11', unit: 'A-1', status: 'Unpaid', due: 100 }, { collected: 100, status: 'Paid in full' }],
    'work-orders': [{ desc: 'Leak', property: p, category: 'Plumbing', severity: 'High', vendor: v, status: 'Assigned' }, { status: 'Completed' }],
    vendors: [{ company: 'Cool Air', service: 'HVAC', status: 'Active' }, { rating: 5 }],
    'renovation-projects': [{ name: 'Lobby', property: p, status: 'Planned' }, { percent: 40 }],
    inspections: [{ category: 'Roof', property: p, date: '2026-03-01', result: 'Good' }, { result: 'Watch' }],
    'capex-items': [{ item: 'Roof', property: p, lastYear: 2015, life: 20 }, { cost: 5000 }],
    reserves: [{ entity: e, fund: 10, need: 40 }, { fund: 20 }],
    'cash-flows': [{ dir: 'Income', category: 'Rent', entity: e, amount: 5, date: '2026-05-01' }, { amount: 6 }],
    budgets: [{ category: 'Insurance', entity: e, year: 2026, budget: 100 }, { actual: 40 }],
    loans: [{ lender: 'Bank', balance: 5, rate: 5, maturity: '2035-01-01', status: 'Active loan' }, { status: 'Paid off' }],
    goals: [{ name: 'Goal', metric: 'LTV (%)', target: 50, current: 40 }, { state: 'Met' }],
    deals: [{ name: 'Deal', stage: 'Screening' }, { stage: 'Offer', dd: { Tax: 'Done' } }],
    'buy-boxes': [{ name: 'Box' }, { capMin: 6.5 }],
    watchlist: [{ name: 'Watch', status: 'Watching' }, { status: 'Priority' }],
    'decision-notes': [{ title: 'Note', type: 'Buy', date: '2026-02-01', status: 'Decided' }, { status: 'Reviewed' }],
    scenarios: [{ name: 'Scenario' }, { result: 'Cap rate 6.8%, DSCR 1.31x' }],
    policies: [{ name: 'Policy', kind: 'Maximum', limit: 60, usage: 50 }, { usage: 70 }],
    risks: [{ desc: 'Risk', category: 'Market', likelihood: 2, impact: 3, status: 'Open' }, { impact: 5 }],
    'portfolio-reviews': [{ name: 'Review', period: 'Quarter', status: 'In review' }, { status: 'Completed' }],
    'queue-items': [{ title: 'Item', type: 'Manual', priority: 'Normal', status: 'Waiting' }, { status: 'Claimed', assignee: 'Ops' }],
    tasks: [{ title: 'Task', due: '2026-12-01', priority: 'Normal', status: 'To do' }, { status: 'Done' }],
    'service-providers': [{ company: 'CPA', type: 'Accounting', status: 'Active' }, { status: 'Expired' }],
    partners: [{ company: 'Bank', type: 'Lender' }, { city: 'Miami' }],
    comparisons: [{ name: 'Cmp', codes: 'PRO-0001, PRO-0002' }, { name: 'Cmp 2' }],
  };
  assert.equal(Object.keys(cases).length, 30);

  for (const [path, [body, patch]] of Object.entries(cases)) {
    const c = await api.post(path, body).expect(201);
    const id = c.body.id;
    assert.equal(c.body.version, 1, `${path} create`);
    assert.equal((await api.get(`${path}/${id}`).expect(200)).body.id, id, `${path} get`);
    const l = (await api.get(path).expect(200)).body;
    assert.ok(l.items.some((i) => i.id === id) && l.total >= 1, `${path} list`);
    await api.get(`${path}?q=zzzz-no-match`).expect(200);
    await api.get(`${path}?limit=1&sort=createdAt&order=desc`).expect(200);
    const u = await api.patch(`${path}/${id}`, patch, 1).expect(200);
    assert.equal(u.body.version, 2, `${path} patch`);
    for (const [k, val] of Object.entries(patch)) if (typeof val !== 'object') assert.equal(u.body[k], val, `${path}.${k}`);
    await api.del(`${path}/${id}`).expect(204);
    await api.get(`${path}/${id}`).expect(404);
  }
});

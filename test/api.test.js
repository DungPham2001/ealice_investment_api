const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { start, stop, reset, api, admin, create, app } = require('./helpers');
const { today, addDays } = require('../src/lib/dates');
const { Setting } = require('../src/models/system');

before(start);
after(stop);
beforeEach(reset);

const T = today();
const YEAR = Number(T.slice(0, 4));

const entity = (o = {}) => create('entities', { label: 'Entity A', type: 'LLC', status: 'Active', ...o });
const property = (o = {}) => create('properties', { name: 'Orchid Court', type: 'Multifamily', area: 'Orlando, 32801', units: 24, occupied: 22, status: 'Owned', price: 6200000, rev: 100000, opex: 39500, ...o });

test('open API: no identity headers needed, unknown routes use the error shape', async () => {
  await request(app).get('/health').expect(200);
  assert.equal((await request(app).get('/v1/entities').expect(200)).body.total, 0);
  await request(app).post('/v1/watchlist').send({ name: 'no headers', status: 'Watching' }).expect(201);
  const nf = await api.get('nothing-here').expect(404);
  assert.equal(nf.body.error.code, 'not_found');
});

test('create: ids, defaults, validation, enums, limits, unknown + computed fields ignored', async () => {
  const bad = (await api.post('properties', { name: '', type: 'Castle', units: -1, price: 1e13, year: 1700, buyDate: '1980-01-01' }).expect(422)).body.error;
  assert.equal(bad.code, 'validation_failed');
  assert.equal(bad.fields.name, 'is required');
  assert.match(bad.fields.type, /^must be one of/);
  assert.equal(bad.fields.area, 'is required');
  assert.equal(bad.fields.units, 'must be between 0 and 100000000');
  assert.equal(bad.fields.price, 'must be ≤ 1000000000000');
  assert.match(bad.fields.year, /1800 and 2200/);
  assert.match(bad.fields.buyDate, /1990-01-01/);

  const res = await api.post('properties', { name: ' Orchid Court ', type: 'Multifamily', area: 'Orlando, 32801', units: '24', status: 'Owned', price: 6200000.456, occupancy: 5, id: 'X', version: 9, note: '' }).expect(201);
  const p = res.body;
  assert.equal(p.id, 'PRO-0001');
  assert.equal(p.name, 'Orchid Court');
  assert.equal(p.units, 24);
  assert.equal(p.price, 6200000.46);
  assert.equal(p.version, 1);
  assert.equal(p.createdBy, 'Anonymous');
  assert.equal(p.note, null);
  assert.equal(p.occupancy, 0, 'computed value is never taken from the body');
  assert.equal(res.headers.etag, '"1"');
  assert.match(p.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal((await property()).id, 'PRO-0002');
  assert.equal((await create('queue-items', { title: 'x', type: 'Manual', priority: 'Normal', status: 'Waiting' })).id, 'Q-0001');
  assert.equal((await api.post('leases', { unit: 'A-1', property: p.id, start: '2026-05-01', end: '2026-01-01', status: 'In force' }).expect(422)).body.error.fields.end, 'must be on or after start');
  assert.equal((await api.post('risks', { desc: 'r', category: 'Market', likelihood: 6, impact: 1, status: 'Open' }).expect(422)).body.error.fields.likelihood.startsWith('must be between 1 and 5'), true);
});

test('sensitive-data filter', async () => {
  const base = { name: 'W', type: 'Multifamily', area: 'Orlando, 32801', units: 1, status: 'Owned' };
  for (const [note, re] of [['ssn 123-45-6789', /Social Security/], ['ein 12-3456789', /EIN/], ['card 4242 4242 4242 4242', /card/], ['acct 123456789012', /account/], ['a@b.com', /Email/], ['call (305) 555-1234', /Phone/]]) {
    const r = (await api.post('properties', { ...base, note }).expect(422)).body.error;
    assert.equal(r.code, 'validation_failed');
    assert.match(r.fields.note, re);
  }
  await api.post('partners', { company: 'Bank', type: 'Lender', email: 'x@bank.com', phone: '(305) 555-1234', website: 'https://bank.com' }).expect(201);
  assert.match((await api.post('partners', { company: 'Bank', type: 'Lender', phone: '123-45-6789' }).expect(422)).body.error.fields.phone, /Social/);
  await api.post('vendors', { company: 'Cool Air', service: 'HVAC', status: 'Active', email: 'a@cool.com', phone: '+1 305 555 1234' }).expect(201);
  assert.match((await api.post('vendors', { company: 'a@b.com', service: 'HVAC', status: 'Active' }).expect(422)).body.error.fields.company, /Email/);
});

test('If-Match, no-op patch, conflict with latest record, PATCH keeps other fields', async () => {
  const p = await property();
  assert.equal((await api.patch(`properties/${p.id}`, { note: 'x' }).expect(428)).body.error.code, 'precondition_required');
  const same = (await api.patch(`properties/${p.id}`, { name: 'Orchid Court' }, 1).expect(200)).body;
  assert.equal(same.version, 1);
  const upd = (await api.patch(`properties/${p.id}`, { status: 'For sale', note: 'listing' }, 1).expect(200)).body;
  assert.equal(upd.version, 2);
  assert.equal(upd.units, 24);
  assert.equal(upd.status, 'For sale');
  const stale = (await api.patch(`properties/${p.id}`, { note: 'old' }, 1).expect(409)).body.error;
  assert.equal(stale.code, 'conflict');
  assert.equal(stale.current.version, 2);
  assert.equal((await api.patch(`properties/${p.id}`, { note: 'via body', version: 2 }).expect(200)).body.note, 'via body');
  const cleared = (await api.patch(`properties/${p.id}`, { note: null }, 3).expect(200)).body;
  assert.equal(cleared.note, null);
  assert.equal((await api.patch(`properties/${p.id}`, { name: '' }, 4).expect(422)).body.error.fields.name, 'is required');
  await api.patch('properties/PRO-9999', { name: 'x' }, 1).expect(404);
});

test('references: ids validated, <field>Label returned, self-parent refused', async () => {
  const e = await entity();
  const bad = (await api.post('properties', { name: 'P', type: 'Land', area: 'Ocala, 34470', units: 0, status: 'Owned', entity: 'ENT-9999' }).expect(422)).body.error;
  assert.equal(bad.fields.entity, 'no entity with this id');
  const p = await property({ entity: e.id });
  assert.equal(p.entity, e.id);
  assert.equal(p.entityLabel, 'Entity A');
  const unit = await create('units', { label: 'A-101', property: p.id, status: 'Vacant' });
  assert.equal(unit.propertyLabel, 'Orchid Court');
  assert.equal((await api.patch(`entities/${e.id}`, { parent: e.id }, 1).expect(422)).body.error.fields.parent, 'cannot reference the record itself');
  const res = await create('reserves', { entity: e.id, fund: 100, need: 400 });
  assert.equal(res.entityLabel, 'Entity A');
  assert.equal(res.coverage, 25);
  assert.equal((await api.get('reserves?q=Entity').expect(200)).body.total, 1, 'search follows the title reference');
});

test('list: search, status, filter, sort/order, cursor pagination', async () => {
  for (const [name, status] of [['Alpha Tower', 'Owned'], ['Beta Plaza', 'Sold'], ['Gamma Court', 'Owned'], ['Delta Alpha', 'For sale']]) await property({ name, status });
  const all = (await api.get('properties').expect(200)).body;
  assert.equal(all.total, 4);
  assert.deepEqual(all.items.map((i) => i.name), ['Delta Alpha', 'Gamma Court', 'Beta Plaza', 'Alpha Tower'], 'createdAt desc by default');
  assert.deepEqual((await api.get('properties?q=alpha&sort=name').expect(200)).body.items.map((i) => i.name), ['Alpha Tower', 'Delta Alpha']);
  assert.equal((await api.get('properties?q=Orlando').expect(200)).body.total, 4, 'q also searches the subtitle fields');
  assert.equal((await api.get('properties?status=Owned,Sold').expect(200)).body.total, 3);
  assert.deepEqual((await api.get('properties?sort=name&order=desc&limit=2').expect(200)).body.items.map((i) => i.name), ['Gamma Court', 'Delta Alpha']);
  const p1 = (await api.get('properties?sort=name&limit=3').expect(200)).body;
  assert.equal(p1.items.length, 3);
  assert.ok(p1.nextCursor);
  const p2 = (await api.get(`properties?sort=name&limit=3&cursor=${p1.nextCursor}`).expect(200)).body;
  assert.deepEqual(p2.items.map((i) => i.name), ['Gamma Court']);
  assert.equal(p2.nextCursor, null);
  assert.equal((await api.get('properties?sort=nope').expect(422)).body.error.fields.sort.startsWith('cannot sort'), true);
  assert.equal((await api.get('properties?cursor=zzz').expect(422)).body.error.code, 'validation_failed');
  assert.equal((await api.get('properties?limit=1000').expect(200)).body.items.length, 4);
  assert.equal((await api.get('properties?sort=occupancy&order=desc').expect(200)).body.total, 4, 'computed fields sort in memory');
  assert.equal((await api.get('entities?status=Active').expect(200)).body.total, 0);
});

test('computed fields', async () => {
  const p = await property({ units: 24, occupied: 22, rev: 100000, opex: 39500 });
  assert.equal(p.occupancy, 91.7);
  assert.equal(p.noiMargin, 60.5);
  assert.equal(p.opexRatio, 39.5);
  assert.equal((await property({ units: 0, rev: 0, opex: null, occupied: null })).occupancy, null);

  const inv = await create('investments', { name: 'Fund', type: 'Bonds', invested: 1000, income: 65, status: 'Holding' });
  assert.equal(inv.yield, 6.5);
  assert.equal((await create('investments', { name: 'F2', type: 'Bonds', invested: 0, income: 5, status: 'Holding' })).yield, null);

  const a = await create('asset-classes', { group: 'Real estate', value: 600, target: 55, band: 5 });
  const b = await create('asset-classes', { group: 'Cash equivalents', value: 400, target: 40, band: 2 });
  const list = (await api.get('asset-classes').expect(200)).body.items;
  const A = list.find((x) => x.id === a.id);
  const B = list.find((x) => x.id === b.id);
  assert.equal(A.actual, 60);
  assert.equal(A.drift, 'In range');
  assert.equal(B.actual, 40);
  assert.equal(B.drift, 'In range');
  await api.patch(`asset-classes/${b.id}`, { target: 30 }, 1).expect(200);
  assert.equal((await api.get(`asset-classes/${b.id}`).expect(200)).body.drift, 'Off target');
  assert.equal((await api.get('asset-classes?status=Off target').expect(200)).body.total, 1);

  const rent = await create('rent-collections', { month: '2026-11', unit: 'A-101', due: 1000, collected: 1500, status: 'Paid in full' });
  assert.equal(rent.rate, 100);
  assert.equal((await api.post('rent-collections', { month: '11/2026', unit: 'A', status: 'Unpaid' }).expect(422)).body.error.fields.month, 'must be a month in YYYY-MM format');

  const prop = await property();
  const cx = await create('capex-items', { item: 'Roof', property: prop.id, lastYear: YEAR - 10, life: 11, cost: 1 });
  assert.equal(cx.dueYear, YEAR + 1);
  assert.equal(cx.bucket, 'Within 1 year');
  assert.equal((await create('capex-items', { item: 'HVAC', property: prop.id, lastYear: YEAR, life: 20 })).bucket, 'After 5 years');
  assert.equal((await create('capex-items', { item: 'Pavement', property: prop.id, lastYear: YEAR, life: 4 })).bucket, 'Within 5 years');

  assert.equal((await create('budgets', { category: 'Insurance', entity: (await entity()).id, year: YEAR, budget: 200, actual: 50 })).usage, 25);
  const loan = await create('loans', { lender: 'Bank', balance: 500, collateral: 1000, noi: 240, payment: 10, rate: 6.5, maturity: '2030-01-01', status: 'Active loan' });
  assert.equal(loan.ltv, 50);
  assert.equal(loan.dscr, 2);
  assert.equal((await create('policies', { name: 'Max LTV', kind: 'Maximum', limit: 60, usage: 49 })).state, 'Within limit');
  assert.equal((await create('policies', { name: 'Min cash', kind: 'Minimum', limit: 9, usage: 4 })).state, 'Over limit');
  assert.equal((await api.get('policies?status=Over limit').expect(200)).body.total, 1);
  const risk = await create('risks', { desc: 'Rates', category: 'Interest rate', likelihood: 4, impact: 4, status: 'Open' });
  assert.equal(risk.score, 16);
  assert.equal(risk.level, 'High');
  assert.equal((await create('risks', { desc: 'x', category: 'Market', likelihood: 2, impact: 4, status: 'Open' })).level, 'Medium');
  assert.equal((await create('risks', { desc: 'y', category: 'Market', likelihood: 1, impact: 2, status: 'Open' })).level, 'Low');
});

test('deals: due-diligence checklist object', async () => {
  const d = await create('deals', { name: 'Oak Deal', stage: 'Screening', dd: { Tax: 'Done' } });
  assert.equal(d.dd.Tax, 'Done');
  assert.equal(d.dd['Legal & title'], 'To do');
  assert.equal(Object.keys(d.dd).length, 7);
  assert.match((await api.post('deals', { name: 'x', stage: 'Offer', dd: { Tax: 'Maybe' } }).expect(422)).body.error.fields.dd, /must be one of/);
  assert.match((await api.post('deals', { name: 'x', stage: 'Offer', dd: { Foo: 'Done' } }).expect(422)).body.error.fields.dd, /unknown checklist item/);
  const u = (await api.patch(`deals/${d.id}`, { dd: { Tax: 'Done', Insurance: 'In progress' } }, 1).expect(200)).body;
  assert.equal(u.dd.Insurance, 'In progress');
});

test('delete: cascade from property, unlink optional refs, restrict required refs, 204', async () => {
  const e = await entity();
  const p = await property({ entity: e.id });
  const v = await create('vendors', { company: 'Pipes Inc', service: 'Plumbing', status: 'Active' });
  await create('units', { label: 'A-1', property: p.id, status: 'Occupied' });
  await create('leases', { unit: 'A-1', property: p.id, start: T, end: addDays(T, 400), status: 'In force' });
  const wo = await create('work-orders', { desc: 'Leak', property: p.id, category: 'Plumbing', severity: 'High', vendor: v.id, status: 'Assigned' });
  await create('renovation-projects', { name: 'Lobby', property: p.id, status: 'Planned' });
  await create('inspections', { category: 'Roof', property: p.id, date: T, result: 'Good' });
  await create('capex-items', { item: 'Roof', property: p.id, lastYear: 2020, life: 20 });
  const loan = await create('loans', { lender: 'Bank', property: p.id, entity: e.id, balance: 1, rate: 5, maturity: '2035-01-01', status: 'Active loan' });
  const other = await property({ name: 'Other' });
  await create('units', { label: 'B-1', property: other.id, status: 'Occupied' });

  // entity still used by required references -> 409; optional refs would unlink
  await create('cash-flows', { dir: 'Income', category: 'Rent', entity: e.id, amount: 5, date: T });
  const blocked = (await api.del(`entities/${e.id}`).expect(409)).body.error;
  assert.equal(blocked.code, 'conflict');
  assert.equal(blocked.references.resource, 'cash-flows');

  await api.del(`properties/${p.id}`).expect(204);
  assert.equal((await api.get('units').expect(200)).body.total, 1);
  for (const r of ['leases', 'work-orders', 'renovation-projects', 'inspections', 'capex-items']) assert.equal((await api.get(r).expect(200)).body.total, 0, r);
  const l = (await api.get(`loans/${loan.id}`).expect(200)).body;
  assert.equal(l.property, null, 'loans only unlink');
  assert.equal(l.propertyLabel, null);
  await api.get(`properties/${p.id}`).expect(404);
  await api.del(`properties/${p.id}`).expect(404);

  await api.del(`vendors/${v.id}`).expect(204);
  assert.equal(wo.vendor, v.id);
});

test('delete: unlink optional refs of an entity', async () => {
  const e = await entity();
  const p = await property({ entity: e.id });
  await api.del(`entities/${e.id}`).expect(204);
  const after = (await api.get(`properties/${p.id}`).expect(200)).body;
  assert.equal(after.entity, null);
  assert.equal(after.version, 2);
});

test('idempotency: same key returns the original response, no duplicate', async () => {
  const a = await api.post('tasks', { title: 'Call', due: T, priority: 'Normal', status: 'To do' }, 'key-1').expect(201);
  const b = await api.post('tasks', { title: 'Call', due: T, priority: 'Normal', status: 'To do' }, 'key-1').expect(201);
  assert.equal(b.headers['idempotent-replay'], 'true');
  assert.equal(b.body.id, a.body.id);
  assert.equal((await api.get('tasks').expect(200)).body.total, 1);
  await api.post('tasks', { title: '' }, 'key-2').expect(422);
  await api.post('tasks', { title: 'ok', due: T, priority: 'Normal', status: 'To do' }, 'key-2').expect(201);
});

test('auto queue items (handoff §6)', async () => {
  const q = async () => (await api.get('queue-items?limit=100').expect(200)).body.items;
  const p = await property();

  const wo = await create('work-orders', { desc: 'Broken pump', property: p.id, category: 'Plumbing', severity: 'Urgent', due: addDays(T, 3), status: 'New' });
  let items = await q();
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].title, items[0].type, items[0].priority, items[0].target, items[0].status, items[0].auto, items[0].source], ['Assign contractor: Broken pump', 'Maintenance', 'Urgent', addDays(T, 3), 'Waiting', true, wo.id]);

  await api.patch(`work-orders/${wo.id}`, { status: 'Assigned' }, 1).expect(200);
  assert.equal((await q())[0].status, 'Done', 'condition no longer holds');
  await api.patch(`work-orders/${wo.id}`, { status: 'New' }, 2).expect(200);
  items = await q();
  assert.equal(items.length, 1, 'reopened, not duplicated');
  assert.equal(items[0].status, 'Waiting');

  await create('units', { label: 'A-101', property: p.id, status: 'Vacant' });
  const lease = await create('leases', { unit: 'A-102', property: p.id, start: addDays(T, -300), end: addDays(T, 40), status: 'In force' });
  await create('leases', { unit: 'A-103', property: p.id, start: addDays(T, -300), end: addDays(T, 200), status: 'In force' });
  await create('loans', { lender: 'First Bank', property: p.id, balance: 1, rate: 5, maturity: addDays(T, 200), status: 'Active loan' });
  await create('loans', { lender: 'Refi Bank', balance: 1, rate: 5, maturity: addDays(T, 200), refi: 'in talks', status: 'Active loan' });
  await create('service-providers', { company: 'CPA Co', type: 'Accounting', end: addDays(T, 30), status: 'Active' });
  await create('deals', { name: 'Elm St', stage: 'Analysis' });
  await create('deals', { name: 'Pine St', stage: 'Screening' });
  items = await q();
  const by = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.deepEqual(Object.keys(by).sort(), [
    'Assign contractor: Broken pump', 'Due diligence on Elm St', 'Leasing plan for A-101', 'Refinancing plan — First Bank', 'Renew lease A-102', 'Renew service contract — CPA Co',
  ]);
  assert.equal(by['Renew lease A-102'].target, addDays(lease.end, -20));
  assert.equal(by['Leasing plan for A-101'].target, addDays(T, 7));
  assert.equal(by['Refinancing plan — First Bank'].target, addDays(T, 110));
  assert.equal(by['Refinancing plan — First Bank'].priority, 'High');
  assert.equal(by['Due diligence on Elm St'].target, addDays(T, 7));

  // user finishes an auto item; editing the source re-opens it while the condition holds
  const lq = by['Renew lease A-102'];
  assert.equal((await api.patch(`queue-items/${lq.id}`, { status: 'Done', auto: false }, 1).expect(200)).body.auto, true, 'auto is server-set');
  await api.patch(`leases/${lease.id}`, { renewal: 'talking' }, 1).expect(200);
  assert.equal((await api.get(`queue-items/${lq.id}`).expect(200)).body.status, 'Waiting');

  // deleting the source closes its item; a property cascade closes the children's items
  await api.patch(`leases/${lease.id}`, { status: 'Renewed' }, 2).expect(200);
  assert.equal((await api.get(`queue-items/${lq.id}`).expect(200)).body.status, 'Done');
  await api.del(`properties/${p.id}`).expect(204);
  const after = await q();
  assert.ok(after.filter((i) => i.source !== 'x' && ['Assign contractor: Broken pump', 'Leasing plan for A-101'].includes(i.title)).every((i) => i.status === 'Done'));
});

test('period lock (423) on cash flows and rent collections', async () => {
  const e = await entity();
  const old = await create('cash-flows', { dir: 'Expense', category: 'Insurance', entity: e.id, amount: 10, date: '2026-01-15' });
  const rent = await create('rent-collections', { month: '2026-01', unit: 'A-1', status: 'Unpaid' });
  const fresh = await create('cash-flows', { dir: 'Income', category: 'Rent', entity: e.id, amount: 10, date: '2026-09-15' });
  assert.equal((await admin.put('admin/closed-before', { closedBefore: '2026-06-01' }).expect(200)).body.closedBefore, '2026-06-01');
  const locked = (await api.patch(`cash-flows/${old.id}`, { amount: 11 }, 1).expect(423)).body.error;
  assert.equal(locked.code, 'locked');
  await api.del(`cash-flows/${old.id}`).expect(423);
  await api.patch(`rent-collections/${rent.id}`, { status: 'Paid in full' }, 1).expect(423);
  await api.post('cash-flows', { dir: 'Income', category: 'Rent', entity: e.id, amount: 1, date: '2026-02-01' }).expect(423);
  await api.patch(`cash-flows/${fresh.id}`, { date: '2026-02-01' }, 1).expect(423);
  await api.patch(`cash-flows/${fresh.id}`, { amount: 12 }, 1).expect(200);
  await Setting.deleteMany({});
  await api.patch(`cash-flows/${old.id}`, { amount: 11 }, 1).expect(200);
});

test('dashboard', async () => {
  const empty = (await api.get('reports/dashboard').expect(200)).body;
  assert.equal(empty.properties, 0);
  assert.equal(empty.liquidity.minimum, 9);
  assert.equal(empty.leases.renewalRate, 72);
  assert.equal(empty.risks.heat.length, 5);

  const e1 = await entity();
  const e2 = await entity({ label: 'Entity B' });
  await entity({ label: 'Old', status: 'Dissolved' });
  const p1 = await property({ entity: e1.id, units: 24, occupied: 22, rev: 100000, opex: 40000 });
  await property({ entity: e2.id, name: 'Two', units: 10, occupied: 5, rev: 50000, opex: 30000 });
  await property({ entity: e2.id, name: 'Sold one', units: 100, occupied: 0, rev: 1, opex: 1, status: 'Sold' });
  await create('asset-classes', { group: 'Real estate', entity: e1.id, value: 750, target: 70 });
  await create('asset-classes', { group: 'Cash equivalents', entity: e1.id, value: 250, target: 30 });
  await create('cash-flows', { dir: 'Income', category: 'Rent', entity: e1.id, amount: 300, date: T });
  await create('cash-flows', { dir: 'Income', category: 'Asset sale', entity: e1.id, amount: 100, date: T });
  await create('cash-flows', { dir: 'Expense', category: 'Insurance', entity: e1.id, amount: 20, date: T });
  await create('policies', { name: 'Minimum liquidity', kind: 'Minimum', limit: 12, usage: 15 });
  await create('policies', { name: 'Max LTV', kind: 'Maximum', limit: 60, usage: 70 });
  await create('loans', { lender: 'A', property: p1.id, entity: e1.id, balance: 500, collateral: 1000, noi: 120, payment: 10, rate: 5, maturity: addDays(T, 100), status: 'Active loan' });
  await create('loans', { lender: 'B', entity: e1.id, balance: 300, collateral: 1000, noi: 240, payment: 10, rate: 5, maturity: `${YEAR + 3}-06-01`, status: 'Active loan' });
  await create('loans', { lender: 'C', entity: e1.id, balance: 1, collateral: 1, noi: 1, payment: 1, rate: 5, maturity: addDays(T, 5), status: 'Paid off' });
  await create('risks', { desc: 'a', category: 'Market', likelihood: 5, impact: 5, status: 'Open' });
  await create('risks', { desc: 'b', category: 'Market', likelihood: 5, impact: 5, status: 'Closed' });
  await create('work-orders', { desc: 'w1', property: p1.id, category: 'HVAC', severity: 'High', due: addDays(T, -2), status: 'In progress' });
  await create('work-orders', { desc: 'w2', property: p1.id, category: 'HVAC', severity: 'High', done: T, status: 'Completed' });
  await create('leases', { unit: 'U1', property: p1.id, start: T, end: addDays(T, 30), status: 'In force' });
  await create('leases', { unit: 'U2', property: p1.id, start: T, end: addDays(T, 90), status: 'Renewed' });
  await create('leases', { unit: 'U3', property: p1.id, start: T, end: addDays(T, 90), status: 'Expired' });
  await create('capex-items', { item: 'Roof', property: p1.id, lastYear: YEAR - 10, life: 11 });
  await create('capex-items', { item: 'HVAC', property: p1.id, lastYear: YEAR, life: 3 });
  await create('capex-items', { item: 'Pavement', property: p1.id, lastYear: YEAR, life: 5 });
  await create('reserves', { entity: e1.id, fund: 64, need: 100 });
  await create('deals', { name: 'd1', stage: 'Offer' });
  await create('tasks', { title: 't1', due: addDays(T, 3), priority: 'Normal', status: 'To do' });
  await create('tasks', { title: 't2', due: addDays(T, -5), priority: 'Normal', status: 'To do' });
  await create('tasks', { title: 't3', due: addDays(T, 1), priority: 'Normal', status: 'Done' });
  await create('goals', { name: 'g1', metric: 'LTV (%)', target: 100, current: 50 });
  await create('goals', { name: 'g2', metric: 'LTV (%)', target: 10, current: 50 });
  await create('budgets', { category: 'Insurance', entity: e1.id, year: YEAR, budget: 200, actual: 100 });

  const d = (await api.get('reports/dashboard').expect(200)).body;
  assert.equal(d.entities, 2);
  assert.equal(d.properties, 2);
  assert.equal(d.units, 34);
  assert.equal(d.vacantUnits, 7);
  assert.equal(d.occupancy, 79.4);
  assert.equal(d.noiMargin, 53.3);
  assert.equal(d.opexRatio, 46.7);
  assert.equal(d.budgetUsage, 50);
  assert.deepEqual(d.allocation, [{ group: 'Real estate', actual: 75, target: 70 }, { group: 'Cash equivalents', actual: 25, target: 30 }]);
  assert.deepEqual(d.income, [{ category: 'Rent', share: 75 }, { category: 'Other income', share: 25 }]);
  assert.deepEqual(d.cashFlow, { positive: true, netPct: 95 });
  assert.deepEqual(d.liquidity, { months: 12.5, minimum: 12 });
  assert.equal(d.debt.avgLtv, 40);
  assert.equal(d.debt.minDscr, 1.0);
  assert.equal(d.debt.maturingWithin12Months, 1);
  assert.deepEqual(d.debt.ladder, [{ year: Number(addDays(T, 100).slice(0, 4)), count: 1 }, { year: YEAR + 3, count: 1 }]);
  assert.deepEqual(d.policies, { within: 1, over: 1 });
  assert.deepEqual([d.risks.high, d.risks.medium, d.risks.low, d.risks.heat[4][4]], [1, 0, 0, 1]);
  assert.deepEqual(d.workOrders, { open: 1, overdue: 1, avgDaysToClose: 1 });
  assert.deepEqual(d.leases, { expiringIn60Days: 1, renewalRate: 50 });
  assert.deepEqual(d.capex, { within1y: 1, within3y: 2, within5y: 3, reserveCoverage: 64 });
  assert.deepEqual(d.queue.byType, { 'Lease renewal': 1, Loan: 1 });
  assert.equal(d.queue.onTimePct, 100);
  assert.equal(d.deals.Offer, 1);
  assert.equal(d.deals.Rejected, 0);
  assert.deepEqual(d.tasks, { dueWithin7Days: 1, overdue: 1 });
  assert.equal(d.goalsProgress, 75);
  assert.ok(d.updatedAt);

  const f = (await api.get(`reports/dashboard?entity=${e2.id}`).expect(200)).body;
  assert.equal(f.properties, 1);
  assert.equal(f.occupancy, 50);
  assert.equal(f.allocation.length, 0);
  assert.equal(f.debt.ladder.length, 0);
  await api.get('reports/dashboard?entity=ENT-9999').expect(404);
});

test('series, highlights, property metrics, map, calendar', async () => {
  const e = await entity();
  const p1 = await property({ entity: e.id, name: 'Orchid Court', area: 'Orlando, 32801', units: 20, occupied: 18, rev: 100000, opex: 40000 });
  await property({ name: 'Palm Plaza', area: 'Orlando, 32803', units: 10, occupied: 5, rev: 20000, opex: 18000 });
  await property({ name: 'Bay House', area: 'Tampa, 33602', units: 10, occupied: 10, rev: 30000, opex: 10000 });
  await create('units', { label: 'A-1', property: p1.id, status: 'Vacant', vacantSince: addDays(T, -10) });
  await create('work-orders', { desc: 'Leak', property: p1.id, category: 'Plumbing', severity: 'High', due: addDays(T, 5), status: 'New' });
  await create('loans', { lender: 'Bank', property: p1.id, balance: 500, collateral: 1000, noi: 120, payment: 10, rate: 5, maturity: addDays(T, 30), status: 'Active loan' });
  await create('capex-items', { item: 'Roof', property: p1.id, lastYear: YEAR - 10, life: 11 });
  await create('tasks', { title: 'Call lender', due: addDays(T, 2), priority: 'Normal', status: 'To do' });

  const s = (await api.get('reports/series?metric=occupancy&period=month').expect(200)).body;
  assert.equal(s.labels.length, 12);
  assert.equal(s.values.length, 12);
  assert.equal(s.values[11], 82.5);
  assert.equal(s.values[0], null, 'no history yet');
  assert.equal((await api.get('reports/series?metric=occupancy&period=quarter').expect(200)).body.labels.length, 8);
  assert.equal((await api.get('reports/series?metric=noiMargin&period=year').expect(200)).body.labels.at(-1), String(YEAR));
  assert.equal((await api.get('reports/series?metric=revenue').expect(200)).body.values[11], 150000);
  assert.equal((await api.get(`reports/series?metric=occupancy&entity=${e.id}`).expect(200)).body.values[11], 90);
  const rev = (await api.get('reports/revenue?period=quarter').expect(200)).body;
  assert.deepEqual([rev.metric, rev.period, rev.labels.length, rev.values.at(-1)], ['revenue', 'quarter', 8, 150000]);
  assert.equal((await api.get('reports/revenue').expect(200)).body.values.length, 12);
  assert.equal((await api.get(`reports/revenue?entity=${e.id}`).expect(200)).body.values[11], 100000);
  await api.get('reports/series?metric=x').expect(422);
  assert.equal((await api.get('reports/series').expect(200)).body.metric, 'occupancy', 'metric defaults to occupancy');

  // the daily job freezes the month: a later change does not rewrite the stored figure
  await request(app).get('/v1/jobs/daily').expect(200);
  const snap = (await api.get('reports/series?metric=occupancy').expect(200)).body;
  assert.equal(snap.values[11], 82.5);

  const h = (await api.get('reports/highlights?period=month').expect(200)).body;
  assert.equal(h.topProperties[0].name, 'Bay House');
  assert.equal(h.needAttention[0].name, 'Palm Plaza');
  assert.equal(h.leases.new, 0);
  assert.equal(h.avgVacancyDays, 10);
  assert.ok(h.milestones.length >= 3);

  const m = (await api.get(`reports/properties/metrics?ids=${p1.id}`).expect(200)).body.items;
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].occupancy, m[0].noiMargin, m[0].opexRatio, m[0].ltv, m[0].dscr, m[0].openWorkOrders, m[0].capexWithin3y, m[0].avgVacancyDays], [90, 60, 40, 50, 1, 1, 1, 10]);
  assert.deepEqual(m[0].scores, { occupancy: 90, noi: 85.7, expenses: 44, maintenance: 75, capex: 75, dscr: 62.5 });
  assert.equal((await api.get('reports/properties/metrics').expect(200)).body.items.length, 3);

  const map = (await api.get('reports/map').expect(200)).body.items;
  assert.deepEqual(map.map((c) => [c.city, c.properties, c.occupancy, c.share]), [['Orlando', 2, 76.7, 66.7], ['Tampa', 1, 100, 33.3]]);
  assert.ok(!JSON.stringify(map).includes('3280'));

  const cal = (await api.get(`calendar?from=${T}&to=${addDays(T, 60)}`).expect(200)).body;
  assert.deepEqual(cal.items.map((i) => i.kind), ['task-due', 'queue-target', 'work-order-due', 'queue-target', 'loan-maturity']);
  assert.deepEqual(cal.items.map((i) => i.date), [...cal.items.map((i) => i.date)].sort());
  const wo = cal.items.find((i) => i.kind === 'work-order-due');
  assert.deepEqual([wo.resource, wo.title, wo.info, wo.date], ['work-orders', 'Leak', 'Orchid Court · Plumbing', addDays(T, 5)]);
  await api.get('calendar?from=nope').expect(422);
});

test('public content: omit empty fields, admin edit', async () => {
  const c = (await api.get('public/company').expect(200)).body;
  assert.equal(c.name, "EALICEA'S INVESTMENTS LLC");
  assert.equal(c.phone, '+1 730 283 6523');
  assert.equal(c.employees, undefined);
  await admin.put('admin/public/company', { name: "EALICEA'S INVESTMENTS LLC", founded: 2015, hours: '', departments: [], values: ['Integrity'] }).expect(200);
  const c2 = (await api.get('public/company').expect(200)).body;
  assert.deepEqual(Object.keys(c2).sort(), ['founded', 'name', 'values']);
  assert.deepEqual((await api.get('public/team').expect(200)).body, {});
  await admin.put('admin/public/nope', {}).expect(422);
});

test('index lists the endpoints and every GET answers with data', async () => {
  const idx = (await api.get('').expect(200)).body;
  assert.equal(idx.resources.length, 30);
  for (const p of [...idx.resources, ...idx.reports, ...idx.public, '/v1/admin/closed-before', '/v1/jobs/daily']) {
    const url = p.replace('/v1/', '');
    const res = await api.get(url).expect(200);
    assert.ok(res.body && typeof res.body === 'object', url);
  }
});

test('body problems use the error shape', async () => {
  const res = await api.post('tasks').set('Content-Type', 'application/json').send('{bad').expect(400);
  assert.equal(res.body.error.code, 'bad_request');
  assert.equal((await api.post('tasks', [1]).expect(400)).body.error.code, 'bad_request');
});

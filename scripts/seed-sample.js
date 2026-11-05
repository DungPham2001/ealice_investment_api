/**
 * Loads demo data THROUGH THE API (validation, ids, computed fields and auto queue items all apply).
 * Every record gets createdBy = "Sample Data". DEMO ONLY: handoff §10.9 says never load it in production
 * unless you want a demo; remove with `npm run seed:sample -- --remove` (deletes records created by "Sample Data").
 *
 *   BASE_URL=https://ealice-investment-api.vercel.app npm run seed:sample
 *   BASE_URL=... npm run seed:sample -- --remove
 * Dates are relative to today.
 */
const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const Y = new Date().getUTCFullYear();

async function call(method, path, body, headers = {}) {
  {
    const res = await fetch(`${BASE}/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Display-Name': 'Sample Data', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }
}
const post = (path, body) => call('POST', path, body, { 'Idempotency-Key': `seed-${path}-${Math.random().toString(36).slice(2)}` });

async function remove() {
  let n = 0;
  for (const r of ['queue-items', 'comparisons', 'partners', 'service-providers', 'tasks', 'portfolio-reviews', 'risks', 'policies', 'scenarios', 'decision-notes', 'watchlist',
    'buy-boxes', 'deals', 'goals', 'loans', 'budgets', 'cash-flows', 'reserves', 'capex-items', 'inspections', 'renovation-projects', 'work-orders', 'vendors',
    'rent-collections', 'leases', 'units', 'properties', 'investments', 'asset-classes', 'entities']) {
    for (;;) {
      const page = await call('GET', `${r}?limit=100`);
      const mine = page.items.filter((i) => i.createdBy === 'Sample Data' && (r !== 'queue-items' || true));
      if (!mine.length) break;
      for (const i of mine) {
        await call('DELETE', `${r}/${i.id}`).catch((e) => console.log('skip', r, i.id, e.message.slice(0, 80)));
        n++;
      }
      if (mine.length < page.items.length) break;
    }
  }
  console.log(`removed ${n} sample records`);
}

async function main() {
  if (process.argv.includes('--remove')) return remove();
  const existing = await call('GET', 'properties?limit=1');
  if (existing.total > 0 && !process.argv.includes('--force')) throw new Error('properties already exist; refusing to seed (use --force)');

  const id = async (path, body) => (await post(path, body)).id;

  const eA = await id('entities', { label: 'Entity A', type: 'LLC', state: 'FL', purpose: 'Hold real estate', founded: '2016-03-01', status: 'Active', ownPct: 100, note: 'Main property holding company' });
  const eB = await id('entities', { label: 'Entity B', type: 'LLC', state: 'FL', purpose: 'Operating', founded: '2018-07-15', status: 'Active', parent: eA, ownPct: 80 });
  const eC = await id('entities', { label: 'Entity C', type: 'Inc.', state: 'DE', purpose: 'Investing', founded: '2020-01-10', status: 'Active', parent: eA, ownPct: 60 });
  await post('entities', { label: 'Legacy Holdings', type: 'Other', state: 'FL', status: 'Dissolved' });

  for (const [group, entity, value, target, band] of [
    ['Real estate', eA, 14200000, 55, 5], ['Stocks & funds', eC, 4300000, 20, 3], ['Bonds', eC, 1900000, 8, 2],
    ['Private equity', eC, 1500000, 7, 2], ['Cash equivalents', eA, 2400000, 8, 2], ['Owned businesses', eB, 600000, 2, 1],
  ]) await post('asset-classes', { group, entity, value, valueDate: day(-10), target, band });

  await post('investments', { name: 'Broad Market Index Fund', type: 'Funds & ETFs', entity: eC, invested: 2000000, value: 2350000, income: 70000, date: '2022-02-01', status: 'Holding' });
  await post('investments', { name: 'Treasury Ladder', type: 'Bonds', entity: eC, invested: 1800000, value: 1850000, income: 81000, date: '2023-05-10', maturity: `${Y + 2}-05-10`, status: 'Holding' });
  await post('investments', { name: 'Growth Equity Fund II', type: 'Private equity', entity: eC, invested: 1200000, value: 1500000, income: 0, date: '2021-09-01', status: 'Holding', note: 'Ten-year lock-up' });

  const P = {};
  for (const [k, body] of Object.entries({
    orchid: { name: 'Orchid Court', type: 'Multifamily', entity: eA, area: 'Orlando, 32801', year: 2008, sqft: 28000, units: 24, occupied: 22, price: 6200000, buyDate: '2019-06-14', value: 7400000, rev: 98000, opex: 38000, status: 'Owned' },
    palm: { name: 'Palm Plaza', type: 'Commercial', entity: eA, area: 'Orlando, 32803', year: 1999, sqft: 42000, units: 12, occupied: 8, price: 4100000, buyDate: '2017-02-20', value: 4600000, rev: 52000, opex: 31000, status: 'Managed' },
    bay: { name: 'Bay House', type: 'Single-family', entity: eB, area: 'Tampa, 33602', year: 2015, sqft: 3200, units: 1, occupied: 1, price: 720000, buyDate: '2021-11-03', value: 810000, rev: 5200, opex: 1900, status: 'Owned' },
    cedar: { name: 'Cedar Lofts', type: 'Mixed use', entity: eB, area: 'Miami, 33130', year: 2012, sqft: 36000, units: 18, occupied: 15, price: 5300000, buyDate: '2020-08-30', value: 6100000, rev: 76000, opex: 33000, status: 'Owned' },
    sold: { name: 'Maple Row', type: 'Multifamily', entity: eA, area: 'Ocala, 34470', units: 8, occupied: 0, price: 1500000, buyDate: '2016-04-01', status: 'Sold', note: 'Sold last year' },
  })) P[k] = await id('properties', body);

  for (const [label, property, type, listRent, status, vacantSince] of [
    ['A-101', P.orchid, '1 bedroom', 1850, 'Occupied'], ['A-102', P.orchid, '2 bedrooms', 2300, 'Vacant', day(-21)], ['A-103', P.orchid, '2 bedrooms', 2250, 'Vacating soon'],
    ['S-1', P.palm, 'Commercial', 4200, 'Vacant', day(-60)], ['S-2', P.palm, 'Commercial', 3900, 'Occupied'],
    ['L-201', P.cedar, 'Studio', 1600, 'Occupied'], ['L-202', P.cedar, '1 bedroom', 1950, 'Under repair'], ['H-1', P.bay, '3 bedrooms', 3400, 'Occupied'],
  ]) await post('units', { label, property, type, listRent, status, vacantSince, beds: type === 'Studio' ? 0 : 2, baths: 1 });

  const lease = async (unit, property, start, end, rent, status) => post('leases', { unit, property, start, end, rent, deposit: rent, status });
  await lease('A-101', P.orchid, day(-300), day(45), 1850, 'Expiring soon');
  await lease('A-103', P.orchid, day(-330), day(25), 2250, 'Expiring soon');
  await lease('S-2', P.palm, day(-700), day(380), 3900, 'In force');
  await lease('L-201', P.cedar, day(-200), day(165), 1600, 'In force');
  await lease('H-1', P.bay, day(-900), day(-30), 3300, 'Renewed');
  await lease('L-202', P.cedar, day(-1000), day(-100), 1900, 'Expired');

  const month = new Date().toISOString().slice(0, 7);
  for (const [unit, due, collected, status] of [['A-101', 1850, 1850, 'Paid in full'], ['A-103', 2250, 1000, 'Partial'], ['S-2', 3900, 0, 'Overdue'], ['L-201', 1600, 1600, 'Paid in full'], ['H-1', 3400, 3400, 'Paid in full']])
    await post('rent-collections', { month, unit, due, collected, lastDate: collected ? day(-3) : null, status });

  const v1 = await id('vendors', { company: 'Sunshine Plumbing', service: 'Plumbing', license: 'CFC-1426', licenseExp: day(300), insExp: day(200), rating: 4, status: 'Active' });
  const v2 = await id('vendors', { company: 'CoolBreeze HVAC', service: 'HVAC', license: 'CAC-1816', licenseExp: day(25), insExp: day(90), rating: 5, status: 'Active', email: 'service@coolbreeze.example.com', phone: '(407) 555-0142' });
  await post('vendors', { company: 'Apex Roofing', service: 'Roof', rating: 3, status: 'Suspended' });

  await post('work-orders', { desc: 'Water heater leaking in A-102', property: P.orchid, unit: 'A-102', category: 'Plumbing', severity: 'Urgent', est: 1800, due: day(-2), status: 'New' });
  await post('work-orders', { desc: 'Replace rooftop AC unit', property: P.palm, unit: 'Common area', category: 'HVAC', severity: 'High', vendor: v2, est: 14500, due: day(10), status: 'In progress' });
  await post('work-orders', { desc: 'Repaint stairwell', property: P.cedar, category: 'Other', severity: 'Normal', est: 2200, actual: 2050, due: day(-20), done: day(-18), status: 'Completed', vendor: v1 });
  await post('work-orders', { desc: 'Parking lot lighting', property: P.palm, category: 'Electrical', severity: 'Normal', est: 3200, due: day(30), status: 'Awaiting parts' });

  await post('renovation-projects', { name: 'Lobby and corridor refresh', property: P.orchid, scope: 'Flooring, paint, lighting', budget: 180000, actual: 74000, vendor: v1, start: day(-40), end: day(60), percent: 42, permit: 'BP-2026-118', permitExp: day(120), status: 'In construction' });
  await post('renovation-projects', { name: 'Storefront facade', property: P.palm, budget: 95000, start: day(30), end: day(120), percent: 0, status: 'Permitting' });

  for (const [category, property, result, date] of [['Roof', P.orchid, 'Good', day(-90)], ['Fire safety', P.palm, 'Watch', day(-45)], ['HVAC', P.cedar, 'Urgent repair', day(-12)]])
    await post('inspections', { category, property, date, inspector: 'Licensed inspector', result });

  await post('capex-items', { item: 'Roof', property: P.orchid, lastYear: Y - 18, life: 20, cost: 320000 });
  await post('capex-items', { item: 'HVAC', property: P.palm, lastYear: Y - 12, life: 15, cost: 140000 });
  await post('capex-items', { item: 'Pavement', property: P.palm, lastYear: Y - 4, life: 8, cost: 85000 });
  await post('capex-items', { item: 'Elevator', property: P.cedar, lastYear: Y - 2, life: 25, cost: 210000 });

  await post('reserves', { entity: eA, fund: 640000, need: 1000000 });
  await post('reserves', { entity: eB, fund: 150000, need: 300000 });

  for (const [dir, category, entity, amount, d] of [
    ['Income', 'Rent', eA, 148000, -5], ['Income', 'Rent', eB, 81000, -5], ['Income', 'Dividends', eC, 22000, -20], ['Income', 'Interest', eC, 14000, -20],
    ['Income', 'Asset sale', eA, 35000, -60], ['Expense', 'Property tax', eA, 21000, -30], ['Expense', 'Insurance', eA, 9500, -30],
    ['Expense', 'Utilities', eB, 6400, -10], ['Expense', 'Repairs & maintenance', eA, 12800, -15], ['Expense', 'Loan interest', eA, 24000, -8],
  ]) await post('cash-flows', { dir, category, entity, amount, date: day(d) });

  for (const [category, entity, budget, actual] of [['Property tax', eA, 250000, 210000], ['Insurance', eA, 120000, 118000], ['Utilities', eB, 80000, 61000], ['Repairs & maintenance', eA, 150000, 172000]])
    await post('budgets', { category, entity, year: Y, budget, actual });

  await post('loans', { lender: 'First Coast Bank', property: P.orchid, entity: eA, principal: 4200000, balance: 3650000, collateral: 7400000, noi: 720000, payment: 24500, rate: 5.75, rateType: 'Fixed', term: 25, start: '2019-07-01', maturity: day(250), status: 'Maturing soon' });
  await post('loans', { lender: 'Gulf Capital', property: P.cedar, entity: eB, principal: 3900000, balance: 3700000, collateral: 6100000, noi: 590000, payment: 23800, rate: 6.4, rateType: 'Floating', term: 30, start: '2020-09-15', maturity: `${Y + 6}-09-15`, refi: 'Review rate cap in Q3', status: 'Active loan' });
  await post('loans', { lender: 'Heritage Savings', property: P.palm, entity: eA, principal: 2500000, balance: 0, collateral: 4600000, rate: 4.9, maturity: day(-200), status: 'Paid off' });

  await post('goals', { name: 'Reach 90% occupancy', metric: 'Occupancy rate (%)', target: 90, current: 80, due: day(180), state: 'Tracking' });
  await post('goals', { name: 'Six months of liquidity', metric: 'Months of liquidity', target: 6, current: 6.5, state: 'Met' });
  await post('goals', { name: 'Keep LTV under 55%', metric: 'LTV (%)', target: 55, current: 60, due: day(-10), state: 'Late' });

  await post('deals', { name: 'Harbor View Apartments', side: 'Buy', area: 'Tampa, 33605', type: 'Multifamily', ask: 8900000, offer: 8300000, noi: 560000, cap: 6.7, source: 'Broker', owner: 'Acquisitions', stage: 'Due diligence', dd: { 'Legal & title': 'Done', 'Building inspection': 'In progress' } });
  await post('deals', { name: 'Lake Mary Office', side: 'Buy', area: 'Lake Mary, 32746', type: 'Commercial', ask: 5200000, noi: 340000, cap: 6.5, stage: 'Analysis' });
  await post('deals', { name: 'Maple Row', side: 'Sell', area: 'Ocala, 34470', type: 'Multifamily', ask: 1900000, offer: 1850000, stage: 'Closed deal' });
  await post('deals', { name: 'Pine Street Lots', side: 'Buy', area: 'Kissimmee, 34741', type: 'Land', ask: 900000, stage: 'Screening' });

  await post('buy-boxes', { name: 'Central Florida multifamily', type: 'Multifamily', area: 'Orlando, Tampa', unitsMin: 20, unitsMax: 120, capMin: 6.5, ltvMax: 65, dscrMin: 1.25 });
  await post('buy-boxes', { name: 'Small commercial', type: 'Commercial', area: 'Orlando', capMin: 7, ltvMax: 60, dscrMin: 1.3 });
  await post('watchlist', { name: 'Winter Garden multifamily', note: 'New permits issued', added: day(-30), status: 'Priority' });
  await post('watchlist', { name: 'Daytona Beach retail', added: day(-90), status: 'Watching' });

  await post('decision-notes', { title: 'Buy Cedar Lofts', type: 'Buy', date: '2020-08-01', related: 'Cedar Lofts', thesis: 'Mixed use in a growing district', assumption: 6.2, expected: 7, review: day(-5), actual: 6.4, lesson: 'Lease-up took longer than planned', status: 'Pending review' });
  await post('decision-notes', { title: 'Sell Maple Row', type: 'Sell', date: day(-120), related: 'Maple Row', thesis: 'Capital to redeploy in Tampa', expected: 12, actual: 13.1, status: 'Reviewed' });

  await post('scenarios', { name: 'Harbor View base case', tool: 'Purchase analysis', rate: 6.5, vacancy: 6, growth: 3, result: 'Cap rate 6.8%, DSCR 1.31x' });
  await post('scenarios', { name: 'Orchid refinance', tool: 'Loan', rate: 6.1, vacancy: 5, growth: 2.5, result: 'Payment drops 9%' });

  await post('policies', { name: 'Minimum liquidity', kind: 'Minimum', limit: 9, unit: 'months', scope: 'Portfolio', usage: 12.4 });
  await post('policies', { name: 'Maximum LTV', kind: 'Maximum', limit: 60, unit: '%', scope: 'Portfolio', usage: 58 });
  await post('policies', { name: 'Maximum single-asset share', kind: 'Maximum', limit: 30, unit: '%', scope: 'Portfolio', usage: 34 });
  await post('policies', { name: 'Minimum DSCR', kind: 'Minimum', limit: 1.25, unit: 'x', scope: 'Loans', usage: 1.31 });

  for (const [desc, category, likelihood, impact, status] of [
    ['Rates stay high through refinancing', 'Interest rate', 4, 4, 'Mitigating'], ['Hurricane damage to Tampa and Miami assets', 'Natural disaster', 3, 5, 'Open'],
    ['Single tenant concentration at Palm Plaza', 'Concentration', 3, 3, 'Open'], ['Roof age at Orchid Court', 'Property condition', 2, 4, 'Accepted'], ['Lender covenant breach', 'Counterparty', 1, 5, 'Closed'],
  ]) await post('risks', { desc, category, likelihood, impact, mitigation: 'Tracked in quarterly review', owner: 'Asset management', review: day(30), status });

  await post('portfolio-reviews', { name: 'Q3 portfolio review', period: 'Quarter', date: day(-15), ok: 18, watch: 5, act: 2, status: 'Completed' });
  await post('portfolio-reviews', { name: 'Annual review', period: 'Year', date: day(60), status: 'In review' });

  await post('queue-items', { title: 'Call insurance broker about renewal', type: 'Manual', priority: 'High', target: day(7), status: 'Waiting' });
  await post('queue-items', { title: 'Collect Q4 rent roll', type: 'Manual', priority: 'Normal', target: day(14), assignee: 'Operations', status: 'Claimed' });

  await post('tasks', { title: 'Send lease renewal offers', related: 'Orchid Court', owner: 'Leasing', due: day(5), priority: 'High', status: 'To do' });
  await post('tasks', { title: 'Review vendor insurance certificates', owner: 'Operations', due: day(-3), priority: 'Normal', status: 'In progress' });
  await post('tasks', { title: 'File annual report', related: 'Entity C', due: day(40), priority: 'Normal', status: 'Done' });

  await post('service-providers', { company: 'Harbor Accounting Group', type: 'Accounting', scope: 'Bookkeeping and tax prep', start: '2023-01-01', end: day(30), fee: 42000, rating: 4, status: 'Expiring soon' });
  await post('service-providers', { company: 'Keller and Voss LLP', type: 'Attorney', scope: 'Real estate counsel', start: '2022-06-01', end: day(400), fee: 60000, rating: 5, status: 'Active' });
  await post('service-providers', { company: 'Atlantic Insurance Brokers', type: 'Insurance', start: '2024-01-01', end: day(200), fee: 18000, rating: 4, status: 'Active' });

  await post('partners', { company: 'First Coast Bank', type: 'Lender', city: 'Jacksonville', website: 'https://firstcoast.example.com', email: 'loans@firstcoast.example.com', phone: '(904) 555-0100' });
  await post('partners', { company: 'Sunrise Realty', type: 'Broker', city: 'Orlando', website: 'https://sunrise-realty.example.com' });
  await post('partners', { company: 'Blue Harbor Title', type: 'Title insurer', city: 'Tampa' });

  await post('comparisons', { name: 'Orlando assets', codes: `${P.orchid}, ${P.palm}` });

  console.log('seed done');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

const express = require('express');
const registry = require('../resources');
const { createRouter } = require('../core/router');
const reports = require('../services/reports');
const { getContent, putContent } = require('../services/content');
const { setClosedBefore, closedBefore } = require('../services/settings');
const { runDailyJobs } = require('../services/jobs');
const { asyncHandler, invalid } = require('../utils/AppError');
const { isDate } = require('../lib/dates');

const ok = (fn) => asyncHandler(async (req, res) => res.json(await fn(req)));

const api = express.Router();

// the whole API is open: no keys, no identity headers
api.all('/jobs/daily', ok(() => runDailyJobs()));
api.get('/', ok(() => ({
  name: "EALICEA'S LLC API",
  version: 'v1',
  resources: registry.all().map((c) => `/v1/${c.path}`),
  reports: ['/v1/reports/dashboard', '/v1/reports/series', '/v1/reports/highlights', '/v1/reports/properties/metrics', '/v1/reports/map', '/v1/calendar'],
  public: ['/v1/public/company', '/v1/public/team'],
  admin: ['/v1/admin/closed-before', '/v1/admin/public/{company|team}'],
  jobs: ['/v1/jobs/daily'],
})));

// reports (handoff §7), calendar, public content (§8), admin (§9)
api.get('/reports/dashboard', ok((req) => reports.dashboard(req.query)));
api.get('/reports/series', ok((req) => reports.series(req.query)));
api.get('/reports/highlights', ok((req) => reports.highlights(req.query)));
api.get('/reports/properties/metrics', ok((req) => reports.propertyMetrics(req.query)));
api.get('/reports/map', ok(() => reports.map()));
api.get('/calendar', ok((req) => reports.calendar(req.query)));
api.get('/public/company', ok(() => getContent('company')));
api.get('/public/team', ok(() => getContent('team')));

api.put('/admin/public/:key', ok((req) => putContent(req.params.key, req.body)));
api.get('/admin/closed-before', ok(async () => ({ closedBefore: await closedBefore() })));
api.put('/admin/closed-before', ok(async (req) => {
  const v = req.body?.closedBefore;
  if (v !== null && !isDate(v)) throw invalid({ closedBefore: 'must be a date (YYYY-MM-DD) or null' });
  return { closedBefore: await setClosedBefore(v) };
}));

for (const cfg of registry.all()) api.use(`/${cfg.path}`, createRouter(cfg));

module.exports = api;

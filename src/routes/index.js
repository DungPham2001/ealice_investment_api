const express = require('express');
const registry = require('../resources');
const { createRouter } = require('../core/router');
const reports = require('../services/reports');
const { getContent, putContent } = require('../services/content');
const { setClosedBefore, closedBefore } = require('../services/settings');
const { runDailyJobs } = require('../services/jobs');
const { adminOnly, cronOrAdmin } = require('../middleware/auth');
const { asyncHandler, invalid } = require('../utils/AppError');
const { isDate } = require('../lib/dates');

const ok = (fn) => asyncHandler(async (req, res) => res.json(await fn(req)));

/** Cron: no install id (Vercel Cron does not send one). */
const jobs = express.Router();
jobs.all('/jobs/daily', cronOrAdmin, ok(() => runDailyJobs()));

const api = express.Router();

// reports (handoff §7), calendar, public content (§8), admin (§9)
api.get('/reports/dashboard', ok((req) => reports.dashboard(req.query)));
api.get('/reports/series', ok((req) => reports.series(req.query)));
api.get('/reports/highlights', ok((req) => reports.highlights(req.query)));
api.get('/reports/properties/metrics', ok((req) => reports.propertyMetrics(req.query)));
api.get('/reports/map', ok(() => reports.map()));
api.get('/calendar', ok((req) => reports.calendar(req.query)));
api.get('/public/company', ok(() => getContent('company')));
api.get('/public/team', ok(() => getContent('team')));

api.put('/admin/public/:key', adminOnly, ok((req) => putContent(req.params.key, req.body)));
api.get('/admin/closed-before', adminOnly, ok(async () => ({ closedBefore: await closedBefore() })));
api.put('/admin/closed-before', adminOnly, ok(async (req) => {
  const v = req.body?.closedBefore;
  if (v !== null && !isDate(v)) throw invalid({ closedBefore: 'must be a date (YYYY-MM-DD) or null' });
  return { closedBefore: await setClosedBefore(v) };
}));

for (const cfg of registry.all()) api.use(`/${cfg.path}`, createRouter(cfg));

module.exports = { api, jobs };

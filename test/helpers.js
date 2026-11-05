process.env.NODE_ENV = 'test';
process.env.ADMIN_KEY = 'test-admin';
const fs = require('fs');
// Offline machines: reuse a locally installed mongod instead of downloading one.
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync('/opt/homebrew/bin/mongod')) {
  process.env.MONGOMS_SYSTEM_BINARY = '/opt/homebrew/bin/mongod';
  process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '9.0.4';
}

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { randomUUID } = require('crypto');

const app = require('../src/app');

let rs;
const INSTALL = 'a1b2c3d4e5f60718';

async function start() {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, configSettings: { electionTimeoutMillis: 10000 } } });
  await mongoose.connect(rs.getUri());
  for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
}
async function stop() {
  await mongoose.disconnect();
  await rs.stop();
}
async function reset() {
  for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});
}

const h = (r, install = INSTALL) => r.set('X-Install-Id', install).set('X-Forwarded-For', '10.0.0.1');
const api = {
  get: (p, install) => h(request(app).get(`/v1/${p}`), install),
  post: (p, body, key) => { const r = h(request(app).post(`/v1/${p}`)).send(body || {}); return key ? r.set('Idempotency-Key', key) : r; },
  patch: (p, body, version) => { const r = h(request(app).patch(`/v1/${p}`)).send(body); return version === undefined ? r : r.set('If-Match', `"${version}"`); },
  put: (p, body) => h(request(app).put(`/v1/${p}`)).send(body),
  del: (p) => h(request(app).delete(`/v1/${p}`)),
};
const admin = {
  put: (p, body) => api.put(p, body).set('X-Admin-Key', 'test-admin'),
};

/** POST that must succeed; returns the body. */
async function create(path, body) {
  const res = await api.post(path, body, randomUUID());
  if (res.status !== 201) throw new Error(`POST ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

module.exports = { start, stop, reset, api, admin, create, app, INSTALL };

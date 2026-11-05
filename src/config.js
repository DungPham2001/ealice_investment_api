require('dotenv').config();

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ealicea_investment',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  timezone: process.env.TIMEZONE || 'America/New_York',
  attestationRequired: process.env.ATTESTATION_REQUIRED === 'true',
  deleteLimit: num(process.env.DELETE_LIMIT, 12),
  deleteWindowMin: num(process.env.DELETE_WINDOW_MIN, 10),
  writeLimitPerMin: num(process.env.WRITE_LIMIT_PER_MIN, 120),
  createLimitPerDay: num(process.env.CREATE_LIMIT_PER_DAY, 500),
  adminKey: process.env.ADMIN_KEY || '',
  cronSecret: process.env.CRON_SECRET || '',
};

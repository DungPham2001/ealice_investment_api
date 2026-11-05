require('dotenv').config();

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ealicea_investment',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  timezone: process.env.TIMEZONE || 'America/New_York',
};

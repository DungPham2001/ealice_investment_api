const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const { context } = require('./middleware/context');
const { idempotency } = require('./middleware/idempotency');
const { notFound, errorHandler } = require('./middleware/errors');
const api = require('./routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Vercel/Nginx: Idempotency-Key scope needs the real client IP
app.set('etag', false); // ETag carries the record version (If-Match), not a body hash
app.use(helmet());
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['ETag', 'Location', 'Idempotent-Replay'] }));
app.use(compression());
if (config.env !== 'test') app.use(morgan('tiny')); // method, url, status, time only: no IP / user agent
app.use(express.json({ limit: '50mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/v1', context, idempotency, api);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

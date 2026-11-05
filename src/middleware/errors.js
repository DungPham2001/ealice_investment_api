const config = require('../config');
const { AppError } = require('../utils/AppError');

const notFound = (req, _res, next) => next(new AppError(404, 'not_found', `No such endpoint: ${req.method} ${req.path}`));

/** Body: { error: { code, message, fields?, ...extra } } — never leaks internals. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = typeof err.code === 'string' ? err.code : null;
  let message = err.message;
  let extra = err.extra || {};

  if (err.code === 11000) {
    status = 409;
    code = 'conflict';
    message = 'The record already exists.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'bad_request';
    message = 'The request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
    message = 'The request is too large.';
  }

  const known = err instanceof AppError || err.type || err.code === 11000;
  if (!known) status = 500;
  if (status >= 500) {
    console.error(err);
    code = 'internal_error';
    message = config.env === 'production' ? 'Something went wrong on our side. Please try again in a few minutes.' : err.message;
    extra = {};
  }
  res.status(status).json({ error: { code: code || 'error', message, ...extra } });
}

module.exports = { notFound, errorHandler };

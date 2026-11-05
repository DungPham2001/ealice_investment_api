/**
 * Error body of the API (handoff §2): { error: { code, message, fields? } }.
 * codes: validation_failed 422, conflict 409, not_found 404, forbidden 403
 * (+ locked 423, precondition_required 428, bad_request 400, payload_too_large 413).
 */
class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (noun = 'record') => new AppError(404, 'not_found', `${noun} not found.`);
const forbidden = (message = 'You are not allowed to perform this action.') => new AppError(403, 'forbidden', message);
const conflict = (message, extra) => new AppError(409, 'conflict', message, extra);
/** `fields` is { field: message }; the top-level message is the first one. */
const invalid = (fields, message) =>
  new AppError(422, 'validation_failed', message || Object.entries(fields).map(([k, v]) => `${k}: ${v}`)[0] || 'The data is not valid.', { fields });

module.exports = { AppError, asyncHandler, notFound, forbidden, conflict, invalid };

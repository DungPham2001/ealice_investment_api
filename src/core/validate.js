/**
 * Body -> validated values (handoff §5). Strings are trimmed ('' = null), numbers may arrive as numeric strings,
 * enums must match exactly, dates are real YYYY-MM-DD within 1990-01-01 … 2100-12-31, free text goes through the Guard.
 * Unknown, computed and system fields in the body are ignored.
 */
const { isDate } = require('../lib/dates');
const { check } = require('../lib/guard');

const MIN_DATE = '1990-01-01';
const MAX_DATE = '2100-12-31';

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const FAIL = Symbol('fail');

function number(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : FAIL;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return FAIL;
}

/** Returns the cleaned value or throws a message string. */
function clean(f, raw) {
  switch (f.kind) {
    case 'str': {
      if (typeof raw !== 'string') throw 'must be text';
      const s = raw.normalize('NFC').trim();
      if (s.length > f.max) throw `must be at most ${f.max} characters`;
      return s;
    }
    case 'enum': {
      if (typeof raw !== 'string' || !f.values.includes(raw.trim())) throw `must be one of: ${f.values.join(', ')}`;
      return raw.trim();
    }
    case 'int': {
      const n = number(raw);
      if (n === FAIL || !Number.isInteger(n)) throw 'must be a whole number';
      if (f.allowZero && n === 0) return 0;
      if (n < f.min || n > f.max) throw `must be between ${f.min} and ${f.max}${f.allowZero ? ' (or 0)' : ''}`;
      return n;
    }
    case 'dec':
    case 'pct':
    case 'money': {
      const n = number(raw);
      if (n === FAIL) throw 'must be a number';
      if (n < f.min) throw `must be ≥ ${f.min}`;
      if (n > f.max) throw `must be ≤ ${f.max}`;
      return f.kind === 'money' ? Math.round(n * 100) / 100 : n;
    }
    case 'date': {
      if (!isDate(raw)) throw 'must be a date in YYYY-MM-DD format';
      if (raw < MIN_DATE || raw > MAX_DATE) throw `must be between ${MIN_DATE} and ${MAX_DATE}`;
      return raw;
    }
    case 'ref': {
      if (typeof raw !== 'string' || raw.trim().length > 64) throw 'must be a record id';
      return raw.trim();
    }
    case 'obj':
      return f.validate(raw);
    default:
      throw 'unsupported field';
  }
}

/**
 * `current` = the stored record in API shape (PATCH) or null (POST).
 * Returns { values, errors }: values hold every writable field (API units: dollars), errors = { field: message }.
 */
function normalize(cfg, body, current) {
  const values = {};
  const errors = {};
  for (const name of cfg.writable) {
    const f = cfg.fields[name];
    const provided = body[name] !== undefined;
    const raw = provided ? body[name] : current ? current[name] : undefined;
    if (isBlank(raw) || (f.kind === 'obj' && raw === null)) {
      values[name] = null;
      if (f.required) errors[name] = 'is required';
      continue;
    }
    try {
      const v = clean(f, raw);
      if (provided && f.kind === 'str') {
        const why = check(v, { contact: !!f.contact });
        if (why) throw why;
      }
      values[name] = v;
    } catch (msg) {
      if (typeof msg !== 'string') throw msg;
      errors[name] = msg;
    }
  }
  if (!Object.keys(errors).length && cfg.validate) Object.assign(errors, cfg.validate(values) || {});
  return { values, errors };
}

module.exports = { normalize };

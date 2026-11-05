/**
 * Field descriptors of a resource. The same description drives validation, the Mongoose schema,
 * list filters and the cascade rules.
 *   kinds: str(max) enum int dec money pct date ref obj bool
 * Options: required, readOnly (server-set, never accepted on write), contact (email/phone allowed in a free-text field).
 */
const R = { required: true };

const str = (max = 120, o = {}) => ({ kind: 'str', max, ...o });
const en = (values, o = {}) => ({ kind: 'enum', values, ...o });
/** Integer 0 … 100,000,000 unless min/max given. allowZero: 0 is allowed even below `min` ("n/a" years). */
const int = (o = {}) => ({ kind: 'int', min: 0, max: 100000000, ...o });
const year = (o = {}) => int({ min: 1800, max: 2200, allowZero: true, ...o });
const rating = (o = {}) => int({ min: 1, max: 5, ...o });
/** Plain decimal ≥ 0. */
const dec = (o = {}) => ({ kind: 'dec', min: 0, max: 1e12, ...o });
/** USD, ≥ 0, 2 decimals; stored as integer cents. */
const money = (o = {}) => ({ kind: 'money', min: 0, max: 1e12, ...o });
/** Percent, 6.5 = 6.5 %, 0 … 1000. */
const pct = (o = {}) => ({ kind: 'pct', min: 0, max: 1000, ...o });
const date = (o = {}) => ({ kind: 'date', ...o });
/** Foreign key (by id). onDelete: cascade | unlink | restrict. Default: restrict when required, unlink otherwise. */
const ref = (to, o = {}) => ({ kind: 'ref', to, ...o });
const obj = (validate, o = {}) => ({ kind: 'obj', validate, ...o });
const bool = (o = {}) => ({ kind: 'bool', ...o });

module.exports = { R, str, en, int, year, rating, dec, money, pct, date, ref, obj, bool };

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Rounds to `d` decimals; non-finite -> null. */
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
/** a / b * 100, null when b is not positive. */
const ratio = (a, b, d = 1) => (b > 0 ? round((a / b) * 100, d) : null);
const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const iso = (d) => (d ? new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

module.exports = { escapeRegex, round, ratio, sum, mean, clamp, iso };

/**
 * Sensitive-data filter (handoff §5), applied to every free-text field:
 * SSN, EIN, payment-card-like, long account-like numbers, email and phone.
 * Fields flagged `contact` (vendor email/phone, partner website/email/phone) may hold an email / phone,
 * but still refuse SSN, EIN, card and account-like numbers.
 */
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const EIN = /\b\d{2}-\d{7}\b/;
const CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const LONG_DIGITS = /\d{9,}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?<![\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;

const MSG = {
  ssn: 'Looks like a Social Security number, which is not allowed.',
  ein: 'Looks like a tax ID (EIN), which is not allowed.',
  card: 'Looks like a payment card number, which is not allowed.',
  account: 'Contains a long number that looks like an account number, which is not allowed.',
  email: 'Email addresses are not allowed in this field.',
  phone: 'Phone numbers are not allowed in this field.',
};

const luhn = (digits) => {
  let total = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
    alt = !alt;
  }
  return total % 10 === 0;
};

/** The message of the first rule `text` breaks, or null. */
function check(text, { contact = false } = {}) {
  if (typeof text !== 'string' || !text) return null;
  if (SSN.test(text)) return MSG.ssn;
  if (EIN.test(text)) return MSG.ein;
  for (const m of text.match(CARD) || []) {
    const d = m.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return MSG.card;
  }
  if (LONG_DIGITS.test(text)) return MSG.account;
  if (contact) return null;
  if (EMAIL.test(text)) return MSG.email;
  if (PHONE.test(text)) return MSG.phone;
  return null;
}

module.exports = { check, MSG };

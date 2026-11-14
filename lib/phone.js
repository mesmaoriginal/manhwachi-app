const IRAN_MOBILE_RE = /^989\d{9}$/;

function toEnglishDigits(input) {
  return String(input ?? "").replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632));
}

function normalizeIranPhone(raw) {
  if (!raw) return null;
  let digits = toEnglishDigits(raw).replace(/[\s\-().\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  digits = digits.replace(/^\+/, "");
  digits = digits.replace(/^0098/, "98");
  digits = digits.replace(/^98/, "98");
  digits = digits.replace(/^0/, "98");
  if (/^9\d{9}$/.test(digits)) {
    digits = `98${digits}`;
  }
  return IRAN_MOBILE_RE.test(digits) ? digits : null;
}

module.exports = {
  normalizeIranPhone: normalizeIranPhone,
  toEnglishDigits: toEnglishDigits,
  IRAN_MOBILE_RE: IRAN_MOBILE_RE
};
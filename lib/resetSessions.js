// lib/resetSessions.js
// نشست‌های کوتاه‌مدت فلوی «فراموشی رمز عبور» (در حافظه، مثل otpStore).
// هر نشست مرحله‌های تاییدشده را نگه می‌دارد تا مرحله‌ی آخر (تغییر رمز)
// فقط وقتی مجاز شود که همه‌ی مراحل لازم واقعاً طی شده باشند.
const crypto = require("crypto");

const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map(); // sessionId -> { userId, phone, email, needsPhoneStep, emailVerified, phoneVerified, expiresAt }

function create({ userId, phone, email, needsPhoneStep }) {
  const id = crypto.randomBytes(32).toString("base64url");
  sessions.set(id, {
    userId,
    phone,
    email,
    needsPhoneStep,
    emailVerified: false,
    phoneVerified: false,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return id;
}

function get(id) {
  if (typeof id !== "string" || !id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function remove(id) {
  sessions.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) if (s.expiresAt < now) sessions.delete(id);
}, 5 * 60 * 1000).unref();

module.exports = { create, get, remove };

const crypto = require("crypto");

const SESSION_TTL_MS = 15 * 60 * 1e3;

const sessions = new Map;

function create({userId: userId, phone: phone, email: email, needsPhoneStep: needsPhoneStep}) {
  const id = crypto.randomBytes(32).toString("base64url");
  sessions.set(id, {
    userId: userId,
    phone: phone,
    email: email,
    needsPhoneStep: needsPhoneStep,
    emailVerified: false,
    phoneVerified: false,
    expiresAt: Date.now() + SESSION_TTL_MS
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
}, 5 * 60 * 1e3).unref();

module.exports = {
  create: create,
  get: get,
  remove: remove
};
const crypto = require("crypto");

const {requireSecret: requireSecret} = require("./requireSecret");

const SECRET = requireSecret("LOCAL_IMAGE_TOKEN_SECRET", "[localImageToken]", "با هر ری‌استارت سرور، لینک‌های عکسِ قبلاً صادرشده باطل می‌شن (کاربر باید صفحه رو رفرش کنه).");

function sign(key, expires) {
  return crypto.createHmac("sha256", SECRET).update(key + expires).digest("hex");
}

function buildLocalImageUrl(key, ttlSeconds) {
  const expires = Math.floor(Date.now() / 1e3) + ttlSeconds;
  const token = sign(key, expires);
  const encodedPath = key.split("/").map(encodeURIComponent).join("/");
  return `/chapter-image/${encodedPath}?token=${token}&expires=${expires}`;
}

function isValidToken(key, expires, token) {
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum) || Math.floor(Date.now() / 1e3) > expiresNum) {
    return false;
  }
  const expected = sign(key, expiresNum);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(token || ""), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  buildLocalImageUrl: buildLocalImageUrl,
  isValidToken: isValidToken
};
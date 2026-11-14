const crypto = require("crypto");

const BUNNY_CDN_HOSTNAME = (process.env.BUNNY_CDN_HOSTNAME || "").replace(/\/+$/, "");

const BUNNY_TOKEN_SECURITY_KEY = process.env.BUNNY_TOKEN_SECURITY_KEY || "";

function isBunnyConfigured() {
  return Boolean(BUNNY_CDN_HOSTNAME && BUNNY_TOKEN_SECURITY_KEY);
}

function toBunnyBase64(buffer) {
  return buffer.toString("base64").replace(/\n/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildBunnySignedUrl(objectKey, ttlSeconds) {
  if (!isBunnyConfigured()) {
    throw new Error("BUNNY_CDN_HOSTNAME یا BUNNY_TOKEN_SECURITY_KEY در .env تنظیم نشده - Bunny هنوز آماده نیست.");
  }
  const path = "/" + objectKey.split("/").map(encodeURIComponent).join("/");
  const expires = Math.floor(Date.now() / 1e3) + ttlSeconds;
  const hashableBase = BUNNY_TOKEN_SECURITY_KEY + path + expires;
  const hash = crypto.createHash("sha256").update(hashableBase).digest();
  const token = toBunnyBase64(hash);
  return `${BUNNY_CDN_HOSTNAME}${path}?token=${token}&expires=${expires}`;
}

async function buildBunnySignedUrls(objectKeys, ttlSeconds) {
  return objectKeys.map(key => buildBunnySignedUrl(key, ttlSeconds));
}

module.exports = {
  isBunnyConfigured: isBunnyConfigured,
  buildBunnySignedUrl: buildBunnySignedUrl,
  buildBunnySignedUrls: buildBunnySignedUrls
};
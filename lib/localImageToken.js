// lib/localImageToken.js
//
// جایگزین موقتِ presigned URL مستقیم S3، تا زمانی که BunnyCDN راه‌اندازی
// بشه. دقیقاً همون منطق ساده‌ی Token Authentication که تو secureLink.js
// برای Bunny پیاده شده رو، اینجا برای مسیر پراکسیِ خودِ سرور
// (/chapter-image/:key) تکرار می‌کنیم - تا امنیت (انقضای لینک) از دست
// نره، فقط به‌جای پارس‌پک، خودِ سرور داره فایل کش‌شده رو سرو می‌کنه.
//
// فرمول: token = HMAC_SHA256(secret, key + expires) به صورت hex
//
// نکته‌ی امنیتی مهم: این توکن دقیقاً همون سطح امنیتی presigned URL قبلی
// رو نگه می‌داره - لینک بعد از انقضا کار نمی‌کنه، و کسی نمی‌تونه بدون رد
// شدن از /api/get-chapter-images (که VIP/رایگان بودن و rate-limit رو اونجا
// چک می‌کنه) یک لینک معتبر بسازه. تنها چیزی که عوض شده، سرویس‌دهنده‌ی
// نهاییه (سرور خودمون به‌جای پارس‌پک)، نه سطح کنترل دسترسی.

const crypto = require("crypto");
const { requireSecret } = require("./requireSecret");

// اگه از قبل تو .env ست نشده باشه: رو production سرور اصلاً بالا نمیاد
// (fail-fast، جزئیات تو requireSecret.js)؛ رو dev یک مقدار تصادفی موقع
// بالا اومدن پروسه ساخته می‌شه و فقط warn چاپ می‌شه - همون‌طور که قبلاً
// بود. تنها اثرِ نبودنش (بعد از این تغییر، فقط تو dev): بعد از هر
// ری‌استارت سرور، لینک‌های قبلاً صادرشده باطل می‌شن (دقیقاً مثل presigned
// URL که هم TTL داره، پس این عارضه‌ی جدیدی نیست) - برای جلوگیری کامل از
// این عارضه، LOCAL_IMAGE_TOKEN_SECRET رو تو .env ثابت کنید (یک رشته‌ی
// تصادفی بلند، مثلاً با `openssl rand -hex 32`).
const SECRET = requireSecret(
  "LOCAL_IMAGE_TOKEN_SECRET",
  "[localImageToken]",
  "با هر ری‌استارت سرور، لینک‌های عکسِ قبلاً صادرشده باطل می‌شن (کاربر باید صفحه رو رفرش کنه)."
);

function sign(key, expires) {
  return crypto.createHmac("sha256", SECRET).update(key + expires).digest("hex");
}

// key مثل "manhwas/slug/CH5/srcCH5/1.jpg" (همون چیزی که از پارس‌پک میاد)
function buildLocalImageUrl(key, ttlSeconds) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = sign(key, expires);
  const encodedPath = key.split("/").map(encodeURIComponent).join("/");
  return `/chapter-image/${encodedPath}?token=${token}&expires=${expires}`;
}

function isValidToken(key, expires, token) {
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum) || Math.floor(Date.now() / 1000) > expiresNum) {
    return false;
  }

  const expected = sign(key, expiresNum);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(token || ""), "hex");
  // مقایسه‌ی طول قبل از timingSafeEqual لازمه چون خودِ تابع روی طول‌های
  // نابرابر throw می‌کنه، نه false برمی‌گردونه.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { buildLocalImageUrl, isValidToken };

// lib/requireSecret.js
//
// چرا این فایل اضافه شد:
// چند تا سکرت تو پروژه (GUEST_COOKIE_SECRET تو server.js،
// LOCAL_IMAGE_TOKEN_SECRET تو localImageToken.js) اگه تو .env ست نشده
// باشن، به‌جای این‌که سرور بالا نیاد، یک مقدار تصادفی موقت می‌سازن و فقط
// یک warn تو لاگ چاپ می‌کنن. تو حالت dev این رفتار خوبیه (کسی مجبور نیست
// قبل از `npm start` رو لپ‌تاپ خودش .env کامل بسازه)، ولی رو production
// خطرناکه: اگه یادتون بره ست کنید، سرور بی‌سروصدا بالا میاد و با هر
// ری‌استارت (deploy، crash، pm2 restart، ...) همه‌ی کوکی‌ها/توکن‌های
// فعال (نشست مهمان‌ها، لینک‌های عکسِ در حال استفاده) یهو باطل می‌شن - یک
// باگ که فقط با یک warn تو لاگ که کسی نمی‌بینتش خودش رو نشون می‌ده.
//
// این تابع دقیقاً همون رفتار قبلی رو تو dev حفظ می‌کنه (فال‌بک تصادفی +
// warn)، ولی وقتی NODE_ENV=production باشه و سکرت ست نشده باشه، به‌جای
// warn، پروسه رو با یک پیام واضح خاتمه می‌ده (fail-fast) - تا مشکل همون
// لحظه‌ی deploy معلوم بشه، نه هفته‌ها بعد وقتی یکی می‌پرسه «چرا لاگین
// مهمون‌ها هی می‌پره».
//
// NODE_ENV=production باید توسط خودِ محیط production (pm2/systemd/Docker)
// ست شده باشه؛ اگه ست نشده باشه، این تابع فرض می‌کنه dev/staging‌ه و فقط
// warn می‌ده - پس مطمئن بشید NODE_ENV=production واقعاً رو سرور ست شده.

const crypto = require("crypto");

/**
 * @param {string} envVarName - اسم متغیر محیطی (مثلاً "GUEST_COOKIE_SECRET")
 * @param {string} label - اسم کوتاه برای پیام‌های لاگ (مثلاً "[guestId]")
 * @param {string} consequenceFa - توضیح فارسیِ کوتاه از عارضه‌ی نبودِ این سکرت
 * @returns {string} مقدار سکرت (از .env یا تصادفیِ موقت در dev)
 */
function requireSecret(envVarName, label, consequenceFa) {
  const fromEnv = process.env[envVarName];
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    console.error(
      `${label} ${envVarName} در .env تنظیم نشده. رو production این سکرت اجباریه ` +
        `(وگرنه: ${consequenceFa}). سرور بالا نمیاد - یک مقدار ثابت بسازید و تو .env ` +
        `بذارید، مثلاً: openssl rand -hex 32`
    );
    process.exit(1);
  }

  console.warn(
    `${label} ${envVarName} در .env تنظیم نشده - یک مقدار موقت و تصادفی ساخته شد (فقط چون ` +
      `NODE_ENV=production نیست). عارضه: ${consequenceFa} قبل از deploy حتماً این مقدار رو ` +
      `تو .env ثابت کنید، مثلاً با: openssl rand -hex 32`
  );
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { requireSecret };

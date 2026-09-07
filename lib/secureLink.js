// lib/secureLink.js
//
// ساخت لینک امن (Token Authentication) برای BunnyCDN.
//
// چرا این‌جا لازم شد:
// پشتیبانی پارس‌پک تایید کرد که فعال‌سازی Secure Download Link (که مخصوص
// محصول «هاست دانلود»شونه) روی CDN جلوی باکت Object Storage امکان‌پذیر
// نیست. به‌جای CDN خودِ پارس‌پک، از BunnyCDN به‌عنوان یک لایه‌ی CDN جلوی
// همون باکت استفاده می‌کنیم. BunnyCDN یک قابلیت built-in به اسم
// Token Authentication داره که دقیقاً همون کاری رو می‌کنه که می‌خواستیم:
//
//   - هر لینک فقط برای مدت محدودی (expires) معتبره.
//   - اعتبارسنجی روی خودِ edge/CDN انجام می‌شه، نه روی باکت پارس‌پک - یعنی
//     اگه صدها کاربر VIP هم‌زمان یک چپتر رو باز کنن، فقط اولین درخواست
//     واقعاً به باکت پارس‌پک می‌ره؛ بقیه از کش خودِ Bunny سرو می‌شن (چون
//     Bunny کش رو بر اساس مسیر فایل نگه می‌داره، نه بر اساس توکن/querystring).
//   - کسی نمی‌تونه لینک رو جایی منتشر کنه و برای همیشه ازش دانلود کنه،
//     چون بعد از expires دیگه 403 برمی‌گرده.
//
// فرمول رسمی BunnyCDN (مستندات: docs.bunny.net -> CDN -> Security ->
// Token Authentication):
//
//   token = Base64( SHA256_RAW(security_key + path + expires) )
//   سپس توی رشته‌ی base64:  '+' -> '-'   '/' -> '_'   '='‌ها حذف   '\n' حذف
//
// این نسخه، ساده‌ترین حالت (بدون قفل IP و بدون پارامتر اضافه) رو پیاده
// می‌کنه - دقیقاً همونی که وقتی از پنل Bunny گزینه‌ی "Token Authentication"
// رو روی یک Pull Zone فعال می‌کنید و یک Authentication Key می‌سازید،
// به صورت پیش‌فرض انتظار می‌ره.
//
// نکته‌ی مهم: این فایل فقط لینک CDN می‌سازه. لیست کردن فایل‌های داخل باکت
// (ListObjectsV2) همچنان از طریق کلاینت S3 پارس‌پک انجام می‌شه (توی
// chapterCache.js) چون Bunny به لیست فایل‌های باکت دسترسی نداره - Bunny
// فقط نقش origin-fetch و کش رو بازی می‌کنه.

const crypto = require("crypto");

const BUNNY_CDN_HOSTNAME = (process.env.BUNNY_CDN_HOSTNAME || "").replace(/\/+$/, "");
const BUNNY_TOKEN_SECURITY_KEY = process.env.BUNNY_TOKEN_SECURITY_KEY || "";

// آیا تنظیمات Bunny کامل و آماده‌ی استفاده‌ست؟
// (برای فال‌بک امن به presigned URL مستقیم S3 در chapterCache.js، تا وقتی
// که هنوز BunnyCDN راه‌اندازی نشده باشه)
function isBunnyConfigured() {
  return Boolean(BUNNY_CDN_HOSTNAME && BUNNY_TOKEN_SECURITY_KEY);
}

// base64 استاندارد رو به فرمت url-safe مخصوص Bunny تبدیل می‌کنه
function toBunnyBase64(buffer) {
  return buffer
    .toString("base64")
    .replace(/\n/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// objectKey چیزیه مثل "manhwas/slug/CH5/srcCH5/1.jpg" (بدون اسلش ابتدایی)
// - دقیقاً همون چیزی که از ListObjectsV2 پارس‌پک برمی‌گرده.
// ttlSeconds: مدت اعتبار لینک بر حسب ثانیه.
function buildBunnySignedUrl(objectKey, ttlSeconds) {
  if (!isBunnyConfigured()) {
    throw new Error(
      "BUNNY_CDN_HOSTNAME یا BUNNY_TOKEN_SECURITY_KEY در .env تنظیم نشده - Bunny هنوز آماده نیست."
    );
  }

  // مسیر باید دقیقاً همون چیزی باشه که توی URL نهایی درخواست می‌شه، با یک
  // اسلش ابتدایی. هر بخش از مسیر رو جدا encode می‌کنیم (نه کل مسیر با هم)
  // چون اسم فایل‌های آپلودی می‌تونن شامل فاصله یا کاراکتر خاص باشن، ولی
  // خودِ اسلش‌های جداکننده‌ی پوشه‌ها نباید encode بشن.
  const path = "/" + objectKey.split("/").map(encodeURIComponent).join("/");

  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

  const hashableBase = BUNNY_TOKEN_SECURITY_KEY + path + expires;
  const hash = crypto.createHash("sha256").update(hashableBase).digest();
  const token = toBunnyBase64(hash);

  return `${BUNNY_CDN_HOSTNAME}${path}?token=${token}&expires=${expires}`;
}

// نسخه‌ی دسته‌جمعی - برای یک چپتر که ممکنه ده‌ها تصویر داشته باشه.
async function buildBunnySignedUrls(objectKeys, ttlSeconds) {
  return objectKeys.map((key) => buildBunnySignedUrl(key, ttlSeconds));
}

module.exports = {
  isBunnyConfigured,
  buildBunnySignedUrl,
  buildBunnySignedUrls,
};

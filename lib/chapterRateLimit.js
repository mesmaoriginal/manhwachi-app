// lib/chapterRateLimit.js
//
// Rate limiting به‌ازای هر کاربر (نه IP) روی endpoint خواندن چپتر، برای
// جلوگیری از دانلود انبوه توسط یک اکانت (اسکریپت/بات) که مستقیم به API
// خودِ سایت درخواست می‌زنه - نه به پارس‌پک/Bunny - و به همین دلیل از کش
// ۵۰ دقیقه‌ای chapterCache.js رد می‌شه بدون این‌که هیچ محدودیت زیرساختی
// (سقف ۳۰۰/دقیقه‌ی پارس‌پک) رو لمس کنه.
//
// دو سطح محدودیت جدا از هم اعمال می‌شه چون هدفشون فرق داره:
//
//  1) burst limit: جلوی رفرش‌های دیوانه‌وار/باگ فرانت رو می‌گیره
//     (مثلاً یه لوپ ناخواسته که هر چند صد میلی‌ثانیه یه چپتر رو صدا می‌زنه)
//
//  2) sustained/hourly limit: جلوی "یه نفر با یک اشتراک، کل سایت رو تو
//     یک ساعت اسکرپ کنه" رو می‌گیره - همون سناریویی که کش به‌تنهایی
//     جلوش رو نمی‌گیره چون هیچ‌وقت به پارس‌پک نمی‌رسه تا آلارمی فعال بشه.
//
// نکته‌ی مهم درباره‌ی مقیاس: این پیاده‌سازی in-memory (Map) هست، یعنی اگه
// سرور شما پشت چند instance/process باشه (مثلاً PM2 cluster mode یا چند
// سرور پشت لود بالانسر)، هر instance شمارنده‌ی جدا داره و محدودیت واقعی
// عملاً N برابر می‌شه. برای اون حالت باید این Map رو با یه store مشترک
// (Redis) عوض کرد - ولی برای یک سرور تک-process همین کافیه.

const WINDOW_BURST_MS = 60 * 1000; // ۱ دقیقه
const MAX_REQUESTS_BURST = 20; // حداکثر ۲۰ درخواست چپتر در دقیقه برای هر کاربر

const WINDOW_SUSTAINED_MS = 60 * 60 * 1000; // ۱ ساعت
const MAX_REQUESTS_SUSTAINED = 120; // حداکثر ۱۲۰ درخواست چپتر در ساعت برای هر کاربر

// سقف تعداد کاربرِ متمایزی که هم‌زمان تو حافظه ردیابی می‌شن، تا این Map
// هم مثل کش‌های chapterCache.js بی‌نهایت رشد نکنه.
const MAX_TRACKED_USERS = 5000;

// userId -> آرایه‌ای از timestamp هر درخواست (فقط تا سقف پنجره‌ی ساعتی
// نگه داشته می‌شه؛ پنجره‌ی دقیقه‌ای زیرمجموعه‌ی همینه)
const requestLog = new Map();

function evictOldestIfNeeded() {
  while (requestLog.size > MAX_TRACKED_USERS) {
    const oldestKey = requestLog.keys().next().value;
    requestLog.delete(oldestKey);
  }
}

// هر ۱۰ دقیقه (نه روی هر ریکوئست) رکوردهای کاملاً منقضی‌شده رو پاک می‌کنه
// تا حافظه برای کاربرهایی که رفتن و برنمی‌گردن آزاد بشه.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of requestLog.entries()) {
    const fresh = timestamps.filter((t) => now - t < WINDOW_SUSTAINED_MS);
    if (fresh.length === 0) {
      requestLog.delete(userId);
    } else {
      requestLog.set(userId, fresh);
    }
  }
}, 10 * 60 * 1000);
cleanupInterval.unref(); // اجازه بده پروسه بتونه exit کنه، این تایمر جلوش رو نگیره

/**
 * @param {string} userId
 * @returns {{ allowed: boolean, reason?: "burst"|"sustained", retryAfterSeconds?: number }}
 */
function checkAndRecordChapterRequest(userId) {
  const now = Date.now();
  const timestamps = requestLog.get(userId) || [];

  const withinSustained = timestamps.filter((t) => now - t < WINDOW_SUSTAINED_MS);
  const withinBurst = withinSustained.filter((t) => now - t < WINDOW_BURST_MS);

  if (withinBurst.length >= MAX_REQUESTS_BURST) {
    const oldestInBurst = Math.min(...withinBurst);
    const retryAfterSeconds = Math.ceil((oldestInBurst + WINDOW_BURST_MS - now) / 1000);
    return { allowed: false, reason: "burst", retryAfterSeconds };
  }

  if (withinSustained.length >= MAX_REQUESTS_SUSTAINED) {
    const oldestInSustained = Math.min(...withinSustained);
    const retryAfterSeconds = Math.ceil(
      (oldestInSustained + WINDOW_SUSTAINED_MS - now) / 1000
    );
    return { allowed: false, reason: "sustained", retryAfterSeconds };
  }

  withinSustained.push(now);
  requestLog.set(userId, withinSustained);
  evictOldestIfNeeded();

  return { allowed: true };
}

/**
 * میدل‌ور Express.
 *
 * getUserId باید تابعی باشه که از روی req، شناسه‌ی یکتای کاربر رو
 * برمی‌گردونه: ترجیحاً userId کاربر لاگین‌شده (مثلاً req.user.id یا
 * req.session.user.id - بسته به این‌که auth شما چطور پیاده شده)، و اگه
 * کاربر مهمونه، به IP به‌عنوان fallback برگرد (req.ip) - چون هدف اصلی
 * اکانت‌های VIP لاگین‌شده‌ست، ولی کاربر مهمون هم نباید کاملاً بی‌محدودیت
 * بمونه.
 *
 * @param {(req: import('express').Request) => string} getUserId
 */
function chapterRateLimitMiddleware(getUserId) {
  return function (req, res, next) {
    const userId = getUserId(req);

    if (!userId) {
      // اگه حتی IP هم در دسترس نبود (خیلی نادر)، به‌جای کرش کردن، رد می‌شه
      return next();
    }

    const result = checkAndRecordChapterRequest(userId);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({
        error:
          result.reason === "burst"
            ? "تعداد درخواست‌های شما در این دقیقه زیاده. کمی صبر کنید."
            : "شما به سقف مجاز خواندن چپتر در این ساعت رسیدید.",
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }

    next();
  };
}

module.exports = {
  chapterRateLimitMiddleware,
  checkAndRecordChapterRequest,
};

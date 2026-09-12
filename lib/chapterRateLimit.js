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
//
// برای کاربر لاگین‌شده، کلید همیشه userId هست (خودِ IP اهمیتی نداره - چون
// هدف رفتار غیرعادیِ *اکانت*ه). برای کاربر مهمون (چپترهای رایگان)، دیگه
// از IP خام استفاده نمی‌کنیم - چون CGNAT باعث می‌شه ده‌ها کاربر واقعی
// پشت یک IP مشترک باشن. به‌جاش checkAndRecordGuestChapterRequest رو
// صدا بزنید که یک guestId (از کوکی، توسط server.js ساخته و ست می‌شه) رو
// به‌عنوان کلید اصلی و IP رو فقط به‌عنوان یک سقفِ نرم‌تر/ایمنی در نظر
// می‌گیره - جزئیات کامل پایین‌تر کنار خودِ تابع.

const WINDOW_BURST_MS = 60 * 1000; // ۱ دقیقه
const MAX_REQUESTS_BURST = 20; // حداکثر ۲۰ درخواست چپتر در دقیقه برای هر کاربر/مهمان

const WINDOW_SUSTAINED_MS = 60 * 60 * 1000; // ۱ ساعت
const MAX_REQUESTS_SUSTAINED = 120; // حداکثر ۱۲۰ درخواست چپتر در ساعت برای هر کاربر/مهمان

// سقفِ خیلی نرم‌تر که فقط روی *IP* اعمال می‌شه (نه روی هر کاربر مهمان).
// این فقط یک شبکه‌ی ایمنی در برابر کسیه که عمداً کوکی مهمان رو حذف/بلاک
// می‌کنه تا از سقف per-guest فرار کنه - نه محدودیت اصلی روی ترافیک عادی.
// ضریب ۸ باعث می‌شه ده‌ها کاربر واقعی پشت یک IP مشترک (CGNAT، رایج بین
// کاربرهای موبایل ایران) به‌راحتی زیر این سقف بمونن، ولی یک اسکریپت که
// مدام کوکی عوض می‌کنه بالاخره به همین سقفِ IP برخورد می‌کنه.
const IP_SAFETY_MULTIPLIER = 8;
const MAX_REQUESTS_BURST_IP = MAX_REQUESTS_BURST * IP_SAFETY_MULTIPLIER;
const MAX_REQUESTS_SUSTAINED_IP = MAX_REQUESTS_SUSTAINED * IP_SAFETY_MULTIPLIER;

// سقف تعداد کلید متمایزی (userId / guestId / IP) که هم‌زمان تو حافظه
// ردیابی می‌شن، تا این Map هم مثل کش‌های chapterCache.js بی‌نهایت رشد
// نکنه. از وقتی کاربرهای مهمون هم با یک guestId جدا (به‌جای فقط IP) ردیابی
// می‌شن، تعداد کلیدهای متمایز بیشتر شده، پس سقف رو بالاتر بردیم.
const MAX_TRACKED_USERS = 20000;

// userId -> آرایه‌ای از timestamp هر درخواست (فقط تا سقف پنجره‌ی ساعتی
// نگه داشته می‌شه؛ پنجره‌ی دقیقه‌ای زیرمجموعه‌ی همینه)
const requestLog = new Map();

function evictOldestIfNeeded() {
  while (requestLog.size > MAX_TRACKED_USERS) {
    const oldestKey = requestLog.keys().next().value;
    requestLog.delete(oldestKey);
  }
}

// 🐛 باگ قبلی: پایین‌تر در checkAndRecordChapterRequest، رکورد یک کاربر
// موجود با requestLog.set(userId, ...) آپدیت می‌شد. جاوااسکریپت برای key
// تکراری، فقط مقدار رو عوض می‌کنه و جای آن‌ کلید رو توی ترتیب Map (که
// evictOldestIfNeeded ازش به‌عنوان "قدیمی‌ترین" استفاده می‌کنه) دست
// نمی‌زنه. نتیجه: کاربر/IPـی که پیوسته و فعالانه در حال درخواست دادنه -
// دقیقاً همونی که باید بیشترین سابقه‌ی rate-limit رو نگه داره - چون اولین
// بار زود اضافه شده، همیشه نزدیک "ابتدای" Map می‌مونه و اولین قربانیِ
// evict شدنه. وقتی evict بشه، سابقه‌ش پاک می‌شه و می‌تونه دوباره از صفر
// burst کنه - دقیقاً برعکسِ هدف این فایل.
//
// راه‌حل: هر آپدیت روی یک key موجود رو delete+set می‌کنیم تا به انتهای
// ترتیب Map منتقل بشه؛ اینطوری "ابتدای Map" همیشه واقعاً کم‌فعالیت‌ترین/
// قدیمی‌ترین کاربره.
function setLRU(map, key, value) {
  map.delete(key);
  map.set(key, value);
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
 * @param {string} key شناسه‌ی یکتای چیزی که داره ردیابی می‌شه (userId/guestId/IP)
 * @param {{ maxBurst?: number, maxSustained?: number }} [limits] سقف‌های
 *   سفارشی - اگه ندی، مقادیر پیش‌فرض (MAX_REQUESTS_BURST/SUSTAINED) استفاده
 *   می‌شن. برای سقفِ نرم‌تر IP در checkAndRecordGuestChapterRequest استفاده می‌شه.
 * @returns {{ allowed: boolean, reason?: "burst"|"sustained", retryAfterSeconds?: number }}
 */
function checkAndRecordChapterRequest(key, limits = {}) {
  const maxBurst = limits.maxBurst ?? MAX_REQUESTS_BURST;
  const maxSustained = limits.maxSustained ?? MAX_REQUESTS_SUSTAINED;

  const now = Date.now();
  const timestamps = requestLog.get(key) || [];

  const withinSustained = timestamps.filter((t) => now - t < WINDOW_SUSTAINED_MS);
  const withinBurst = withinSustained.filter((t) => now - t < WINDOW_BURST_MS);

  if (withinBurst.length >= maxBurst) {
    const oldestInBurst = Math.min(...withinBurst);
    const retryAfterSeconds = Math.ceil((oldestInBurst + WINDOW_BURST_MS - now) / 1000);
    // حتی روی رد کردن درخواست هم باید سابقه‌ی این کاربر رو "لمس" کنیم؛
    // وگرنه کسی که مدام و به‌سرعت درخواست می‌ده (دقیقاً کسی که باید بیشترین
    // اولویت نگه‌داشتن سابقه‌شو داشته باشه) اگه از قضا Map پر بشه، ممکنه
    // به‌عنوان "قدیمی‌ترین" evict بشه و سابقه‌ی محدودیتش از دست بره.
    if (requestLog.has(key)) setLRU(requestLog, key, withinSustained);
    return { allowed: false, reason: "burst", retryAfterSeconds };
  }

  if (withinSustained.length >= maxSustained) {
    const oldestInSustained = Math.min(...withinSustained);
    const retryAfterSeconds = Math.ceil(
      (oldestInSustained + WINDOW_SUSTAINED_MS - now) / 1000
    );
    if (requestLog.has(key)) setLRU(requestLog, key, withinSustained);
    return { allowed: false, reason: "sustained", retryAfterSeconds };
  }

  withinSustained.push(now);
  setLRU(requestLog, key, withinSustained);
  evictOldestIfNeeded();

  return { allowed: true };
}

// ---------- محدودیت مخصوص کاربران مهمان (چپترهای رایگان) ----------
//
// چرا لازم شد: قبلاً کاربر مهمان فقط با IP شناسایی می‌شد
// (checkAndRecordChapterRequest(`ip:${req.ip}`)). کاربرهای موبایل ایران
// معمولاً پشت CGNAT هستن، یعنی ده‌ها کاربر واقعی می‌تونن IP یکسان داشته
// باشن - چند نفر که هم‌زمان دارن چپتر رایگان می‌خونن به‌راحتی به سقف
// می‌رسیدن و برای همه‌شون 429 می‌اومد، حتی برای کسی که فقط عادی داره
// می‌خونه.
//
// راه‌حل: هر مهمون یک شناسه‌ی سبک (guestId) توی یک کوکی HttpOnly بلندمدت
// می‌گیره (ساخته و ست می‌شه توسط server.js، این فایل فقط ازش استفاده
// می‌کنه) و سقفِ اصلیِ ۲۰/دقیقه و ۱۲۰/ساعت روی همون guestId اعمال می‌شه -
// نه روی IP. یعنی چند کاربر واقعی پشت یک IP مشترک، هرکدوم سهمیه‌ی جدای
// خودشون رو دارن.
//
// نکته‌ی امنیتی: چون یک اسکریپت/بات می‌تونه کوکی رو هر بار پاک کنه و
// همیشه guestId جدید بگیره تا از سقف per-guest فرار کنه، در کنارش یک سقفِ
// خیلی نرم‌تر و بالاتر هم روی خودِ IP نگه می‌داریم (IP_SAFETY_MULTIPLIER)
// - این فقط جلوی همین حالت فرار از کوکی رو می‌گیره و روی ترافیک عادی پشت
// CGNAT اصلاً لمس نمی‌شه.
//
// @param {string} guestId
// @param {string} ip
function checkAndRecordGuestChapterRequest(guestId, ip) {
  const guestResult = checkAndRecordChapterRequest(`guest:${guestId}`);
  if (!guestResult.allowed) {
    return guestResult;
  }

  const ipResult = checkAndRecordChapterRequest(`ip:${ip}`, {
    maxBurst: MAX_REQUESTS_BURST_IP,
    maxSustained: MAX_REQUESTS_SUSTAINED_IP,
  });
  return ipResult;
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
  checkAndRecordGuestChapterRequest,
};

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
// ---------------------------------------------------------------------------
// 🌐 پشتیبانی چند-instance (Redis)
// ---------------------------------------------------------------------------
// نسخه‌ی قبلی این فایل فقط با یک Map توی حافظه‌ی پروسه کار می‌کرد. یعنی
// اگه سرور پشت چند instance/process باشه (PM2 cluster mode، چند سرور پشت
// لود بالانسر، هر شکل دیگه‌ای از افقی‌کردن)، هر instance شمارنده‌ی کاملاً
// جدا و بی‌خبر از بقیه داره. نتیجه: سقفِ واقعی عملاً N برابر می‌شه (N =
// تعداد instance ها) بدون این‌که هیچ خطا یا لاگی این رو نشون بده - چون هر
// درخواست، فقط instance ای که بهش رسیده رو می‌بینه.
//
// راه‌حل: وقتی متغیر محیطی REDIS_URL ست شده باشه، همه‌ی instance ها به
// همون یک Redis مشترک وصل می‌شن و شمارش سقف‌ها اونجا انجام می‌شه - پس همه‌ی
// instance ها یک "واقعیت" مشترک از تعداد درخواست‌های هر کاربر می‌بینن.
//
// پیاده‌سازی: یک Sorted Set در Redis به‌ازای هر کلید (userId/guestId/IP)،
// که member هر عضوش یه timestamp+نویز تصادفیه (برای این‌که دو تا request
// دقیقاً هم‌میلی‌ثانیه با هم تصادم نکنن) و score همون timestamp. چک/ثبتِ
// burst+sustained به‌صورت یک اسکریپت Lua واحد (EVAL) روی Redis اجرا می‌شه -
// یعنی کل عملیات (پاک‌کردن قدیمی‌ها، شمردن دو پنجره، تصمیم رد/قبول، و در
// صورت قبول، ثبت درخواست جدید) در یک تراکنش اتمیک انجام می‌شه؛ بدون این
// atomicity، بین "خوندن تعداد فعلی" و "ثبت درخواست جدید" دو request
// هم‌زمان از دو instance مختلف می‌تونستن هر دو از سقف رد بشن (race
// condition کلاسیک read-then-write).
//
// فال‌بک: اگه REDIS_URL اصلاً ست نشده باشه (مثلاً روی یک VPS تک-سرور که
// نیازی به Redis نداره)، یا اگه پکیج ioredis نصب نباشه، یا اگه در لحظه‌ی
// اجرا Redis در دسترس نباشه (قطعی موقت شبکه/سرویس)، این ماژول به‌طور خودکار
// و بی‌صدا به همون پیاده‌سازی in-memory قبلی برمی‌گرده - تا یک مشکل Redis
// باعث از کار افتادن کامل خوندن چپتر نشه (fail-open، نه fail-closed). تنها
// تفاوت اینه که در طول همون قطعی، سقف‌ها دوباره per-instance می‌شن - دقیقاً
// همون محدودیت قدیمی، نه بدتر. یک warning هم لاگ می‌شه تا این حالت مخفی
// نمونه.
//
// نصب/تنظیم: `npm install ioredis` (به package.json اضافه شده) + ست‌کردن
// REDIS_URL در .env (مثلاً redis://127.0.0.1:6379 یا آدرس Redis ابری).
// بدون این دو تا، رفتار دقیقاً مثل قبل (in-memory، تک-سرور) می‌مونه - یعنی
// برای یک deployment تک-process همچنان هیچ تغییری لازم نیست.

const crypto = require("crypto");

const WINDOW_BURST_MS = 60 * 1000; // ۱ دقیقه
const MAX_REQUESTS_BURST = 20; // حداکثر ۲۰ درخواست چپتر در دقیقه برای هر کاربر/مهمان

const WINDOW_SUSTAINED_MS = 60 * 60 * 1000; // ۱ ساعت
const MAX_REQUESTS_SUSTAINED = 120; // حداکثر ۱۲۰ درخواست چپتر در ساعت برای هر کاربر/مهمان

// سقفِ درخواست‌های «بدون کوکی معتبر» که روی *IP* اعمال می‌شه (نه روی
// درخواست‌های عادی). کاربر عادی با کوکی سالم فقط با guestId خودش سنجیده
// می‌شه و به این سقف اصلاً نمی‌خوره؛ پس ترافیک عادی پشت CGNAT (که ممکنه
// صدها کاربر یک IP داشته باشن) دیگه به‌خاطر IP مشترک 429 نمی‌گیره.
// فقط کسی که کوکی نگه نمی‌داره (بات/اسکریپتِ کوکی‌دور) هر درخواستش «مهمان
// جدید» حساب می‌شه و به همین سقف می‌رسه.
// چون هر بازدیدکننده‌ی واقعی هم فقط یک‌بار (اولین درخواست) این مسیر رو
// می‌گذرونه، این سقف می‌تونه نسبتاً بالا باشه.
const MAX_REQUESTS_BURST_NEW_GUEST_PER_IP = 60; // در دقیقه
const MAX_REQUESTS_SUSTAINED_NEW_GUEST_PER_IP = 600; // در ساعت

// سقف تعداد کلید متمایزی (userId / guestId / IP) که هم‌زمان تو حافظه
// ردیابی می‌شن، تا این Map هم مثل کش‌های chapterCache.js بی‌نهایت رشد
// نکنه. از وقتی کاربرهای مهمون هم با یک guestId جدا (به‌جای فقط IP) ردیابی
// می‌شن، تعداد کلیدهای متمایز بیشتر شده، پس سقف رو بالاتر بردیم.
// (این فقط برای بک‌اند in-memory معناداره؛ Redis عمر هر کلید رو با
// PEXPIRE خودش مدیریت می‌کنه و نیازی به این سقف نداره.)
const MAX_TRACKED_USERS = 20000;

// ===========================================================================
// بخش ۱: بک‌اند in-memory (پیش‌فرض تک-سرور + فال‌بک هنگام قطعی/نبودن Redis)
// ===========================================================================

// userId -> آرایه‌ای از timestamp هر درخواست (فقط تا سقف پنجره‌ی ساعتی
// نگه داشته می‌شه؛ پنجره‌ی دقیقه‌ای زیرمجموعه‌ی همینه)
const requestLog = new Map();

function evictOldestIfNeeded() {
  while (requestLog.size > MAX_TRACKED_USERS) {
    const oldestKey = requestLog.keys().next().value;
    requestLog.delete(oldestKey);
  }
}

// 🐛 باگ قبلی: پایین‌تر در checkAndRecordChapterRequestLocal، رکورد یک
// کاربر موجود با requestLog.set(userId, ...) آپدیت می‌شد. جاوااسکریپت برای
// key تکراری، فقط مقدار رو عوض می‌کنه و جای آن‌ کلید رو توی ترتیب Map (که
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
 * نسخه‌ی in-memory (تک-پروسه). همیشه sync هست، ولی از بیرون (تابع عمومی
 * checkAndRecordChapterRequest پایین‌تر) همیشه async صدا زده می‌شه تا
 * کد صدازننده مجبور نباشه بین دو بک‌اند فرق بذاره.
 *
 * @param {string} key
 * @param {{ maxBurst: number, maxSustained: number }} limits
 * @returns {{ allowed: boolean, reason?: "burst"|"sustained", retryAfterSeconds?: number }}
 */
function checkAndRecordChapterRequestLocal(key, { maxBurst, maxSustained }) {
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

// ===========================================================================
// بخش ۲: بک‌اند Redis (چند-instance)
// ===========================================================================

// همون الگوریتم بالا (پنجره‌ی لغزان با دو سطح burst/sustained)، این‌بار به
// زبان Lua تا کل چک+ثبت روی خودِ Redis و به‌صورت اتمیک اجرا بشه (EVAL هر
// اسکریپت Lua رو single-threaded و بدون امکان interleave با دستور دیگه‌ای
// اجرا می‌کنه - این دقیقاً همون تضمینی هست که برای جلوگیری از race بین
// چند instance لازم داریم).
//
// KEYS[1] = کلید Redis (پیشوند crl: + همون key ورودی)
// ARGV: now, burstWindowMs, sustainedWindowMs, maxBurst, maxSustained, member
//
// خروجی: { allowedFlag(0|1), reason(""|"burst"|"sustained"), oldestTimestampMs }
const LUA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local burst_window_ms = tonumber(ARGV[2])
local sustained_window_ms = tonumber(ARGV[3])
local max_burst = tonumber(ARGV[4])
local max_sustained = tonumber(ARGV[5])
local member = ARGV[6]

-- درخواست‌های خارج از پنجره‌ی ساعتی (بزرگ‌ترین پنجره) رو دور بریز، دقیقاً
-- مثل filter کردن withinSustained توی نسخه‌ی in-memory.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - sustained_window_ms)

local burst_count = redis.call('ZCOUNT', key, now - burst_window_ms, '+inf')
if burst_count >= max_burst then
  local oldest = redis.call('ZRANGEBYSCORE', key, now - burst_window_ms, '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  local oldest_ts = now
  if oldest[2] then oldest_ts = tonumber(oldest[2]) end
  redis.call('PEXPIRE', key, sustained_window_ms)
  return {0, 'burst', oldest_ts}
end

local sustained_count = redis.call('ZCARD', key)
if sustained_count >= max_sustained then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldest_ts = now
  if oldest[2] then oldest_ts = tonumber(oldest[2]) end
  redis.call('PEXPIRE', key, sustained_window_ms)
  return {0, 'sustained', oldest_ts}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, sustained_window_ms)
return {1, '', 0}
`;

const REDIS_URL = process.env.REDIS_URL || "";
let redisClient = null;
let redisReady = false;

if (REDIS_URL) {
  try {
    // require تنبل (lazy) و داخل try: اگه ioredis نصب نباشه (چون به
    // package.json به‌عنوان optionalDependency اضافه شده، نه اجباری)،
    // به‌جای کرش‌کردن کل سرور، فقط به in-memory فال‌بک می‌کنیم.
    const Redis = require("ioredis");

    redisClient = new Redis(REDIS_URL, {
      // ioredis به‌صورت پیش‌فرض روی خطای اتصال بی‌نهایت retry می‌کنه که
      // خوبه (خودش وصل می‌شه)، ولی ما نمی‌خوایم *یک درخواست کاربر* منتظر
      // اون retry بمونه؛ به‌جاش هر دستور حداکثر یک بار امتحان می‌شه و با
      // timeout کوتاه fail می‌شه تا سریع به in-memory فال‌بک کنیم (پایین‌تر).
      maxRetriesPerRequest: 1,
      commandTimeout: 750,
      lazyConnect: false,
      retryStrategy(times) {
        // بک‌آف نمایی و سقف‌دار برای خودِ اتصال (نه هر دستور) - تا وقتی
        // Redis برگرده، بدون این‌که فلود وصل‌شدن به یک Redis از کار افتاده بزنیم.
        return Math.min(times * 500, 10000);
      },
    });

    redisClient.on("ready", () => {
      redisReady = true;
      console.log(
        "[chapterRateLimit] به Redis وصل شد - سقف‌های rate limit الان بین همه‌ی instance ها مشترکه."
      );
    });

    redisClient.on("error", (err) => {
      // این event می‌تونه مکرر بیاد وقتی Redis پایینه؛ فقط لاگ می‌کنیم،
      // چون ioredis خودش reconnect رو طبق retryStrategy بالا مدیریت می‌کنه.
      if (redisReady) {
        console.warn(
          "[chapterRateLimit] اتصال Redis قطع شد - تا وصل‌شدن مجدد، به‌صورت موقت به in-memory فال‌بک می‌شه (یعنی سقف per-instance می‌شه، نه غیرفعال):",
          err.message
        );
      }
      redisReady = false;
    });

    redisClient.defineCommand("chapterRateLimitCheck", {
      numberOfKeys: 1,
      lua: LUA_SCRIPT,
    });
  } catch (err) {
    console.warn(
      "[chapterRateLimit] REDIS_URL تنظیم شده ولی پکیج ioredis در دسترس نیست (`npm install ioredis`) - فعلاً به in-memory فال‌بک می‌شه؛ یعنی سقف‌ها هنوز per-instance هستن.",
      err.message
    );
  }
} else {
  console.warn(
    "[chapterRateLimit] REDIS_URL تنظیم نشده - rate limit چپتر به‌صورت in-memory (per-process) اجرا می‌شه. اگه بیش از یک instance/process (PM2 cluster mode یا چند سرور پشت لود بالانسر) دارید، سقف واقعی عملاً N برابر می‌شه؛ برای رفعش REDIS_URL رو ست کنید."
  );
}

/**
 * @param {string} key
 * @param {number} maxBurst
 * @param {number} maxSustained
 * @returns {Promise<{ allowed: boolean, reason?: "burst"|"sustained", retryAfterSeconds?: number }>}
 */
async function checkViaRedis(key, maxBurst, maxSustained) {
  const now = Date.now();
  // نویز تصادفی روی member تا اگه دو درخواست دقیقاً هم‌میلی‌ثانیه ثبت
  // بشن، به‌جای overwrite شدن توی Sorted Set (که با member یکسان پیش
  // میومد)، هر دو جدا شمرده بشن.
  const member = `${now}-${crypto.randomBytes(6).toString("hex")}`;
  const redisKey = `crl:${key}`;

  const raw = await redisClient.chapterRateLimitCheck(
    redisKey,
    now,
    WINDOW_BURST_MS,
    WINDOW_SUSTAINED_MS,
    maxBurst,
    maxSustained,
    member
  );

  const allowedFlag = Number(raw[0]);
  const reason = raw[1] || undefined;
  const oldestTs = Number(raw[2]) || now;

  if (allowedFlag === 1) {
    return { allowed: true };
  }

  const windowMs = reason === "burst" ? WINDOW_BURST_MS : WINDOW_SUSTAINED_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
  return { allowed: false, reason, retryAfterSeconds };
}

// ===========================================================================
// بخش ۳: API عمومی - همیشه async، مستقل از این‌که پشت‌صحنه Redis هست یا نه
// ===========================================================================

/**
 * @param {string} key شناسه‌ی یکتای چیزی که داره ردیابی می‌شه (userId/guestId/IP)
 * @param {{ maxBurst?: number, maxSustained?: number }} [limits] سقف‌های
 *   سفارشی - اگه ندی، مقادیر پیش‌فرض (MAX_REQUESTS_BURST/SUSTAINED) استفاده
 *   می‌شن. برای سقفِ نرم‌تر IP در checkAndRecordGuestChapterRequest استفاده می‌شه.
 * @returns {Promise<{ allowed: boolean, reason?: "burst"|"sustained", retryAfterSeconds?: number }>}
 */
async function checkAndRecordChapterRequest(key, limits = {}) {
  const maxBurst = limits.maxBurst ?? MAX_REQUESTS_BURST;
  const maxSustained = limits.maxSustained ?? MAX_REQUESTS_SUSTAINED;

  if (redisClient && redisReady) {
    try {
      return await checkViaRedis(key, maxBurst, maxSustained);
    } catch (err) {
      // یک دستور خاص fail شد (مثلاً timeout لحظه‌ای، بدون این‌که کل
      // اتصال قطع بشه). به‌جای رد کردن یا (بدتر) قبول‌کردن بی‌قیدوشرط این
      // یک درخواست، همین یکی رو با in-memory چک می‌کنیم - سرویس‌دهی قطع
      // نمی‌شه، فقط این یک چک موقتاً per-instance حساب می‌شه.
      console.warn(
        "[chapterRateLimit] دستور Redis fail شد، فال‌بک به in-memory برای همین درخواست:",
        err.message
      );
    }
  }

  return checkAndRecordChapterRequestLocal(key, { maxBurst, maxSustained });
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
// نکته‌ی امنیتی: چون یک اسکریپت/بات می‌تونه کوکی رو هر بار پاک کنه (یا یک
// UUID جعلی بفرسته) تا از سقف per-guest فرار کنه، کوکی امضا می‌شه (server.js)
// و هر درخواستِ بدون کوکیِ معتبر به یک سقفِ جدا روی IP شمرده می‌شه. ترافیک
// عادی (با کوکی سالم) اصلاً به شمارنده‌ی IP دست نمی‌زنه، پس CGNAT مشکلی
// درست نمی‌کنه.
//
// @param {string} guestId
// @param {string} ip
// @param {boolean} isNew  true اگه درخواست کوکی معتبر (امضاشده) نداشته
async function checkAndRecordGuestChapterRequest(guestId, ip, isNew = false) {
  // کوکی معتبر نداشته (کاربر جدید، کوکی بلاک‌شده، یا بات کوکی‌دور):
  // فقط سقف IP - و این‌که هر درخواستش مهمان تازه‌ایه، همینجا شمرده می‌شه.
  if (isNew) {
    const r = await checkAndRecordChapterRequest(`newguest-ip:${ip}`, {
      maxBurst: MAX_REQUESTS_BURST_NEW_GUEST_PER_IP,
      maxSustained: MAX_REQUESTS_SUSTAINED_NEW_GUEST_PER_IP,
    });
    return { ...r, bucket: "ip" };
  }

  // کوکی معتبر داره: فقط سهمیه‌ی خودش، مستقل از بقیه‌ی کاربران هم‌IP.
  const r = await checkAndRecordChapterRequest(`guest:${guestId}`);
  return { ...r, bucket: "guest" };
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
  return async function (req, res, next) {
    const userId = getUserId(req);

    if (!userId) {
      // اگه حتی IP هم در دسترس نبود (خیلی نادر)، به‌جای کرش کردن، رد می‌شه
      return next();
    }

    let result;
    try {
      result = await checkAndRecordChapterRequest(userId);
    } catch (err) {
      // نباید عملاً هیچ‌وقت این‌جا برسه (checkAndRecordChapterRequest خودش
      // خطای Redis رو می‌گیره و به in-memory فال‌بک می‌کنه)، ولی برای هر
      // خطای پیش‌بینی‌نشده‌ی دیگه، fail-open می‌کنیم: نباید یک باگ توی
      // rate-limiter کل خوندن چپتر رو خراب کنه.
      console.error("[chapterRateLimit] خطای غیرمنتظره، عبور بدون محدودیت:", err.message);
      return next();
    }

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

// lib/imageProxyCache.js
//
// راه‌حل سریعِ موقت برای ۴۲۹ های GetObject از پارس‌پک، تا وقتی BunnyCDN
// به‌طور کامل راه‌اندازی بشه.
//
// چرا لازم شد: با presigned URL مستقیم، هر بازدیدکننده برای هر عکس یک
// GetObject جدا مستقیم به پارس‌پک می‌زنه. با چند بازدیدکننده‌ی هم‌زمان،
// این به‌راحتی از سقف نرخ پارس‌پک (۳۰۰/دقیقه) رد می‌شه - چیزی که کش‌های
// chapterKeysCache/signedUrlsCache تو chapterCache.js روش هیچ اثری ندارن،
// چون اون‌ها فقط لیست‌کردن فایل‌ها و امضاکردنِ لینک رو کش می‌کنن (هر دو
// محلی و بدون تماس شبکه)، نه خودِ دانلود بایت‌های عکس.
//
// این ماژول یک کش دیسک ساده جلوی GetObject می‌ذاره: اولین باری که یک
// کلید (یک عکسِ خاصِ یک چپتر) درخواست می‌شه، از پارس‌پک گرفته می‌شه و روی
// دیسک سرور خودمون ذخیره می‌شه. دفعات بعد - چه همون کاربر رفرش کنه، چه
// کاربر دیگه‌ای همون چپتر رو باز کنه - مستقیم از دیسک سرو می‌شه، بدون
// هیچ تماس شبکه‌ای جدید به پارس‌پک.
//
// نتیجه: ترافیک GetObject روی پارس‌پک از «هر عکس × هر بازدیدکننده» به
// «هر عکس، فقط یک‌بار در طول عمر کش دیسک» کاهش پیدا می‌کنه.
//
// این جایگزین دائمیِ Bunny نیست - پهنای باند از سرور خودتون رد می‌شه (نه
// مستقیم مرورگر↔پارس‌پک)، و کش لبه/جغرافیایی هم نداره. برای رفع فوریِ
// ۴۲۹ کافیه؛ وقتی Bunny راه افتاد، signKeys() تو chapterCache.js خودکار
// برمی‌گرده به اون (اولویت با Bunyه، این فقط fallback دومه).

const fs = require("fs");
const path = require("path");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { s3 } = require("./chapterCache");

const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

const CACHE_DIR = path.join(__dirname, "..", "image-cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

// چون اسم فایل روی دیسک از flatten کردن مسیر ساخته می‌شه، پسوند/نوع فایل
// اصلی قابل‌اعتماد نیست - Content-Type رو جدا کنار خودِ فایل ذخیره می‌کنیم.
function metaPath(cachePath) {
  return cachePath + ".meta.json";
}

// همون الگوی محدودکننده‌ی همزمانی LIST_CONCURRENCY توی chapterCache.js،
// این‌بار برای GetObject - تا درست بعد از deploy یا خالی شدن کش دیسک
// (مثلاً بعد از پاکسازی دوره‌ای)، هجوم موازی به پارس‌پک نزنیم.
const GET_CONCURRENCY = 5;
let active = 0;
const queue = [];
function acquire() {
  if (active < GET_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}
function release() {
  const next = queue.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

// دیدوپ درخواست‌های هم‌زمان برای دقیقاً یک کلید - وگرنه اگه ده‌ها نفر
// هم‌زمان اولین بازدیدکننده‌ی یک چپتر جدید باشن، هرکدوم جدا GetObject
// می‌زنن تا کش دیسک پر بشه.
const inFlight = new Map();

function keyToCachePath(key) {
  // اسلش‌ها و کاراکترهای غیرامن رو flatten می‌کنیم تا یک اسم فایل معتبر
  // روی دیسک بشه؛ چون کلید کامل (شامل کل مسیر) پایه‌ی این اسمه، برخورد
  // (collision) بین دو چپتر/مانهوای مختلف عملاً غیرممکنه.
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(CACHE_DIR, safe);
}

function readFromDisk(cachePath) {
  const buffer = fs.readFileSync(cachePath);
  let contentType = "application/octet-stream";
  try {
    contentType = JSON.parse(fs.readFileSync(metaPath(cachePath), "utf8")).contentType;
  } catch {
    // متادیتا نبود (مثلاً از یک نسخه‌ی قدیمی‌تر این کش) - از پیش‌فرض استفاده کن
  }
  return { buffer, contentType };
}

// ---------- قطع‌کننده‌ی مدار (circuit breaker) ----------
// وقتی پارس‌پک 429 می‌ده، ادامه‌ی کوبیدنش فقط وضعیت رو بدتر می‌کنه (و لاگ‌ها
// رو پر می‌کنه). از اولین 429، تا COOLDOWN_MS هیچ درخواست جدیدی برای عکس
// «کش‌نشده» به پارس‌پک نمی‌ره و فوری UpstreamBusyError برمی‌گرده (روت 503 +
// Retry-After می‌ده). عکس‌هایی که روی دیسک کش هستن عادی سرو می‌شن.
const COOLDOWN_MS = 20 * 1000;
let cooldownUntil = 0;
class UpstreamBusyError extends Error {
  constructor(retryAfterSeconds) {
    super("Upstream busy (rate limited)");
    this.name = "UpstreamBusyError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
function checkCooldown() {
  const left = cooldownUntil - Date.now();
  if (left > 0) throw new UpstreamBusyError(Math.ceil(left / 1000));
}

// ---------- فاصله‌گذاری + retry برای 429 ----------
// سقف پارس‌پک ۳۰۰ درخواست در دقیقه برای کل باکته. بین GetObjectها حداقل
// GET_MIN_INTERVAL_MS فاصله می‌ندازیم (≈۲۰۰ در دقیقه، با حاشیه‌ی امن) و اگه
// باز هم 429 اومد، به‌جای شکست فوری، با backoff چند بار دوباره تلاش می‌کنیم.
const GET_MIN_INTERVAL_MS = 300;
const GET_MAX_RETRIES = 4;
let nextSlot = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function paceGet() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + GET_MIN_INTERVAL_MS;
  if (start > now) await sleep(start - now);
}

function isThrottled(err) {
  return (
    err?.$metadata?.httpStatusCode === 429 ||
    err?.name === "SlowDown" ||
    err?.name === "TooManyRequestsException" ||
    /too many requests/i.test(err?.message || "")
  );
}

async function getObjectWithRetry(key) {
  for (let attempt = 0; ; attempt++) {
    await paceGet();
    try {
      return await s3.send(new GetObjectCommand({ Bucket: PARSPACK_BUCKET, Key: key }));
    } catch (err) {
      if (isThrottled(err)) cooldownUntil = Math.max(cooldownUntil, Date.now() + COOLDOWN_MS);
      if (!isThrottled(err) || attempt >= GET_MAX_RETRIES) throw err;
      const delay = Math.min(500 * 2 ** attempt, 4000) + Math.random() * 300;
      console.warn(`[imageProxyCache] 429 از پارس‌پک (تلاش ${attempt + 1}/${GET_MAX_RETRIES}) - ${Math.round(delay)}ms صبر می‌کنیم...`);
      await sleep(delay);
    }
  }
}

async function fetchAndCache(key) {
  const cachePath = keyToCachePath(key);

  await acquire();
  try {
    // بین صف موندن و رسیدن نوبت، ممکنه یکی دیگه همین کار رو کرده باشه
    if (fs.existsSync(cachePath)) {
      return readFromDisk(cachePath);
    }

    checkCooldown(); // اگه تو صف بودیم و وسطش 429 اومد، الکی به پارس‌پک نزن

    const obj = await getObjectWithRetry(key);
    const chunks = [];
    for await (const chunk of obj.Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const contentType = obj.ContentType || "application/octet-stream";

    // نوشتن اتمیک: اول یک فایل موقت با اسم یکتا، بعد rename - تا هیچ
    // ریکوئست هم‌زمانی یک فایل نصفه‌نوشته‌شده رو نخونه.
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, cachePath);
    fs.writeFileSync(metaPath(cachePath), JSON.stringify({ contentType }));

    return { buffer, contentType };
  } finally {
    release();
  }
}

async function getCachedImage(key) {
  const cachePath = keyToCachePath(key);

  if (fs.existsSync(cachePath)) {
    return readFromDisk(cachePath);
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  checkCooldown();

  const promise = fetchAndCache(key).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// ---------- پاکسازی دوره‌ای کش دیسک ----------
// بدون این، پوشه‌ی image-cache بی‌نهایت رشد می‌کنه. هر ۶ ساعت فایل‌هایی
// که بیشتر از IMAGE_CACHE_MAX_AGE_DAYS روز دست نخوردن (mtime قدیمی) رو
// پاک می‌کنیم.
// نکته: فقط mtime رو چک می‌کنیم، نه atime - چون خیلی از فایل‌سیستم‌ها
// atime رو به‌روز نمی‌کنن (noatime mount) و چک کردن atime باعث می‌شد
// فایل‌های پرترافیک هم اشتباهی «قدیمی» به نظر برسن و پاک بشن.
const MAX_AGE_DAYS = Number(process.env.IMAGE_CACHE_MAX_AGE_DAYS || 14);
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

const cleanupInterval = setInterval(() => {
  let removed = 0;
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(CACHE_DIR)) {
      const fullPath = path.join(CACHE_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(fullPath);
          removed++;
        }
      } catch {
        // فایل بین readdir و stat/unlink ممکنه حذف شده باشه (race) - رد شو
      }
    }
    if (removed > 0) {
      console.log(`[imageProxyCache] ${removed} فایل قدیمی از کش دیسک عکس پاک شد.`);
    }
  } catch (err) {
    console.warn("[imageProxyCache] پاکسازی کش دیسک ناموفق بود:", err.message);
  }
}, 6 * 60 * 60 * 1000);
cleanupInterval.unref();

// گرم‌کردن کش: بعد از آپلود/ثبت چپتر از پنل ادمین صدا بزن تا اولین خواننده
// منتظر پارس‌پک نمونه. ترتیبی اجرا می‌شه و از همون pacing استفاده می‌کنه.
async function warmImages(keys) {
  for (const key of keys) {
    try {
      await getCachedImage(key);
    } catch (err) {
      console.warn("[imageProxyCache] warm ناموفق:", key, err.message);
    }
  }
}

module.exports = { getCachedImage, warmImages, UpstreamBusyError };

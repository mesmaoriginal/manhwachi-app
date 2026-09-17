// lib/chapterCache.js
//
// این ماژول تمام منطق مربوط به S3 (پارس‌پک) رو یک‌جا نگه می‌داره تا هم server.js
// و هم پنل ادمین بتونن ازش استفاده کنن، بدون تکرار کد و بدون دو تا نمونه‌ی جدا
// از کش که ممکنه با هم ناهماهنگ بشن.
//
// شامل:
// - buildSignedUrls: ساخت لینک‌های موقت برای تصاویر یک چپتر (با کش)
//   الان اگه BunnyCDN تنظیم شده باشه (lib/secureLink.js)، لینک‌ها از طریق
//   BunnyCDN با Token Authentication ساخته می‌شن (هم امن، هم کش‌شونده روی
//   edge). اگه هنوز Bunny راه‌اندازی نشده، به‌صورت خودکار به همون presigned
//   URL مستقیم S3 پارس‌پک (رفتار قبلی) fallback می‌کنه.
// - invalidateChapterCache: پاک کردن کش یک چپتر مشخص (وقتی عکس جدید آپلود میشه)
// - listChapterFoldersFromS3: لیست شماره چپترهایی که واقعاً روی S3 آپلود شدن
//   (این تابع پایه‌ی قابلیت "بررسی همگام‌سازی" تو پنل ادمینه)
//
// نکته: لیست کردن فایل‌ها (ListObjectsV2) همیشه از طریق کلاینت S3 پارس‌پک
// انجام می‌شه، چه Bunny فعال باشه چه نباشه - چون Bunny فقط serve و کش
// می‌کنه، به محتویات باکت دسترسی مستقیم نداره.

const { S3Client, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { isBunnyConfigured, buildBunnySignedUrls } = require("./secureLink");
const { buildLocalImageUrl } = require("./localImageToken");
const fs = require("fs");
const path = require("path");

// ---------- کش دیسک برای لیست کلیدهای هر چپتر ----------
// چرا این لازمه: امضا کردن لینک (presign / توکن Bunny) کاملاً محلیه و هیچ
// تماس شبکه‌ای نداره - فقط *لیست کردن* فایل‌ها از S3 شبکه‌ست و پارس‌پک
// روش محدودیت نرخ (429) داره. یعنی اگه لیست کلیدهای یک چپتر رو یک بار
// داشته باشیم، می‌تونیم هزاران بار دیگه بدون هیچ درخواست شبکه‌ای دوباره
// امضاش کنیم. قبلاً این لیست فقط تو حافظه (Map) بود، پس هر ری‌استارت
// سرور کاملاً پاکش می‌کرد و همه‌ی چپترهای فعال یک‌جا مجبور می‌شدن دوباره
// از S3 بخونن - دقیقاً همون چیزی که باعث موج 429 می‌شد. حالا این لیست
// روی دیسک هم نگه داشته می‌شه، پس بعد از ری‌استارت هم بلافاصله در دسترسه.
const KEYS_CACHE_FILE = path.join(__dirname, ".chapter-keys-cache.json");

const PARSPACK_ENDPOINT = process.env.PARSPACK_ENDPOINT;
const PARSPACK_ACCESS_KEY = process.env.PARSPACK_ACCESS_KEY;
const PARSPACK_SECRET_KEY = process.env.PARSPACK_SECRET_KEY;
const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

// نکته‌ی مهم: این مقدار باید طوری باشه که حتی برای چپترهای طولانی که
// کاربر کند می‌خونه یا با loading="lazy" دیر به تصاویر پایین‌تر می‌رسه،
// لینک‌ها منقضی نشن. مقدار قبلی (۵ دقیقه) باعث می‌شد بعضی تصاویر با
// خطای 403 (لینک منقضی) دیگه بارگذاری نشن. یک ساعت مقدار امن‌تریه.
const SIGNED_URL_TTL_SECONDS = 3600; // ۱ ساعت

// کش خودِ لینک‌های امضاشده رو کمی کوتاه‌تر از انقضای واقعی نگه می‌داریم تا
// هیچ‌وقت لینکِ نزدیک‌به‌انقضا از کش سرو نشه. قبلاً این کش اصلاً وجود نداشت
// و buildSignedUrls روی هر ریکوئست، برای همه‌ی عکس‌های چپتر دوباره امضا
// می‌ساخت (چند صدها عملیات HMAC تکراری روی چپترهای پرترافیک).
const SIGNED_URLS_CACHE_TTL_MS = 50 * 60 * 1000; // ۵۰ دقیقه
const KEYS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // ۶ ساعت

// سقف تعداد چپتر متمایز (slug::chapterNum) که هم‌زمان تو حافظه کش می‌مونن.
// بدون این سقف، روی سایتی با چپترهای زیاد که کاربرها پراکنده می‌خونن،
// این Map ها بی‌نهایت رشد می‌کردن و هیچ‌وقت پاک نمی‌شدن.
const MAX_CACHE_ENTRIES = 2000;

const s3 = new S3Client({
  endpoint: PARSPACK_ENDPOINT,
  region: "default",
  credentials: {
    accessKeyId: PARSPACK_ACCESS_KEY,
    secretAccessKey: PARSPACK_SECRET_KEY,
  },
  forcePathStyle: true,
  // قبلاً ۵ بود؛ برای مسیر خواندنیِ حساس به تأخیر (لیست کردن/امضا کردن)
  // ۳ تلاش با backoff کافیه و کاربر رو کمتر منتظر می‌ذاره.
  maxAttempts: 3,
});

// ---------- محدودکننده‌ی همزمانی برای ListObjectsV2 ----------
// دلیل اضافه شدنش: درست بعد از هر ری‌استارت سرور، کش خالیه. اگه همون لحظه
// درخواست برای چند چپتر/مانهوای مختلف برسه (که طبیعیه، چون کاربرهای زیادی
// هم‌زمان روی سایت هستن)، هر کدوم مستقل و موازی ListObjectsV2 می‌زنن سمت
// پارس‌پک. باکت پارس‌پک زیر این فشار ناگهانی 429 (Too Many Requests) پس
// می‌ده - چیزی که تو لاگ‌ها دقیقاً همین الگو دیده شد (چند مانهوای کاملاً
// متفاوت هم‌زمان 429 می‌گرفتن، نه فقط یک چپتر پرترافیک).
// این صف ساده تضمین می‌کنه حداکثر LIST_CONCURRENCY تا لیست هم‌زمان در حال
// اجرا باشه؛ بقیه صبر می‌کنن تا نوبتشون برسه، به‌جای این‌که همه با هم به
// باکت هجوم ببرن.
const LIST_CONCURRENCY = 3;
let activeListCount = 0;
const listWaitQueue = [];

function acquireListSlot() {
  if (activeListCount < LIST_CONCURRENCY) {
    activeListCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => listWaitQueue.push(resolve));
}

// نکته: وقتی صف انتظار خالی نیست، جای خالی‌شده رو مستقیم به نفر بعدی
// می‌دیم (بدون کم کردن activeListCount)، چون همون سهمیه داره دست به دست
// می‌شه، نه این‌که آزاد و دوباره گرفته بشه.
function releaseListSlot() {
  const next = listWaitQueue.shift();
  if (next) {
    next();
  } else {
    activeListCount = Math.max(0, activeListCount - 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Retry مخصوص 429 برای ListObjectsV2 ----------
// این مسیر فقط برای اولین‌باری که یک چپتر *هیچ‌جا* کش نشده (نه تو حافظه،
// نه روی دیسک) اجرا می‌شه - یعنی کاربر واقعاً منتظرش می‌مونه، پس نباید
// طولانی باشه. به همین خاطر backoff رو با یه سقف (LIST_MAX_DELAY_MS)
// محدود کردیم: بدترین حالت مجموع انتظار حدود ۷-۸ ثانیه‌ست، نه ده‌ها ثانیه.
// برای چپترهایی که قبلاً یک بار دیده شدن (اکثریت قریب‌به‌اتفاق ترافیک
// واقعی)، این تابع اصلاً صدا زده نمی‌شه چون رفرش‌شون در پس‌زمینه انجام
// می‌شه و کاربر همیشه از کش (حافظه یا دیسک) فوری جواب می‌گیره.
const LIST_MAX_RETRIES = 4;
const LIST_BASE_DELAY_MS = 400;
const LIST_MAX_DELAY_MS = 3000;

function isThrottlingError(err) {
  return (
    err?.$metadata?.httpStatusCode === 429 ||
    err?.Code === "429" ||
    err?.name === "TooManyRequestsException" ||
    err?.name === "ThrottlingException" ||
    err?.name === "SlowDown"
  );
}

async function sendListCommandWithRetry(command) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await s3.send(command);
    } catch (err) {
      attempt++;
      if (!isThrottlingError(err) || attempt > LIST_MAX_RETRIES) {
        throw err;
      }

      // Backoff نمایی با jitter تصادفی، ولی با سقف LIST_MAX_DELAY_MS تا
      // انتظار کاربر از یه حدی بیشتر نشه.
      const rawBackoff = LIST_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const backoff = Math.min(rawBackoff, LIST_MAX_DELAY_MS);
      const jitter = Math.random() * backoff * 0.5;
      const delay = backoff + jitter;

      console.warn(
        `[chapterCache] 429 از پارس‌پک روی ListObjectsV2 (تلاش ${attempt}/${LIST_MAX_RETRIES}) - ${Math.round(
          delay
        )}ms صبر می‌کنیم...`
      );
      await sleep(delay);
    }
  }
}

const chapterKeysCache = new Map(); // cacheKey -> { keys, expiresAt }
const signedUrlsCache = new Map(); // cacheKey -> { urls, expiresAt }
const inFlightRequests = new Map(); // cacheKey -> Promise در حال اجرا (برای لیست‌کردن کلیدها)
const inFlightSignRequests = new Map(); // cacheKey -> Promise در حال اجرا (برای امضا کردن)

// فقط یک بار (نه روی هر ریکوئست) هشدار می‌ده که Bunny تنظیم نشده، تا لاگ
// سرور شلوغ نشه.
let warnedNoBunny = false;

function getCacheKey(slug, chapterNum) {
  return `${slug}::${chapterNum}`;
}

// وقتی یه Map از سقف تعیین‌شده بیشتر شد، قدیمی‌ترین ورودی رو حذف می‌کنه.
// این تابع فقط وقتی درست کار می‌کنه که هر خوندن/نوشتنِ یک key با
// setLRU/touchLRU (پایین‌تر) انجام شده باشه - وگرنه "قدیمی‌ترین توی ترتیب
// Map" لزوماً "کم‌استفاده‌ترین واقعی" نیست.
function evictOldestIfNeeded(map) {
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

// 🐛 باگ قبلی: نوشتن روی یک key موجود با map.set(key, value) ترتیبِ آن
// key رو توی Map عوض نمی‌کنه (جاوااسکریپت فقط برای key های *جدید* آن‌ها
// رو انتهای صف insertion می‌ذاره؛ برای key های تکراری فقط مقدار عوض
// می‌شه و جای قبلی‌اش تو ترتیب حفظ می‌شه). نتیجه: چپترهای پرترافیک که
// اول‌ها اضافه شده بودن و مدام refresh می‌شدن، همیشه نزدیک به «ابتدای»
// Map می‌موندن و evictOldestIfNeeded دقیقاً همین‌ها رو اول از همه پاک
// می‌کرد - یعنی برعکسِ چیزی که یک کش باید انجام بده (LRU واقعی باید
// کم‌استفاده‌ترین‌ها رو پاک کنه، نه پراستفاده‌ترین‌ها را).
//
// راه‌حل: هر بار که یک key خونده می‌شه (touchLRU) یا نوشته می‌شه (setLRU)،
// اول delete و بعد دوباره set می‌کنیم - این باعث می‌شه همیشه به انتهای
// ترتیب Map منتقل بشه. اینطوری «ابتدای Map» همیشه واقعاً قدیمی‌ترین/
// کم‌استفاده‌ترین ورودیه، و evictOldestIfNeeded درست کار می‌کنه.
function setLRU(map, key, value) {
  map.delete(key); // no-op اگه key از قبل نبود؛ برای key موجود، جاش رو آزاد می‌کنه
  map.set(key, value);
}

function touchLRU(map, key) {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
}

// بارگذاری کش کلیدها از دیسک، موقع بالا اومدن سرور. اگه فایل نبود
// (اولین اجرا) یا خراب بود، بی‌سروصدا از یه کش خالی شروع می‌کنیم -
// همون رفتار قبلی.
function loadPersistedKeysCache() {
  try {
    const raw = fs.readFileSync(KEYS_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && Array.isArray(entry.keys) && typeof entry.expiresAt === "number") {
        chapterKeysCache.set(key, entry);
      }
    }
    if (chapterKeysCache.size > 0) {
      console.log(
        `[chapterCache] ${chapterKeysCache.size} چپتر از کش دیسک بازیابی شد - این چپترها بعد از ری‌استارت نیازی به لیست‌کردن مجدد از S3 ندارن.`
      );
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[chapterCache] خواندن کش دیسک ناموفق بود، از کش خالی شروع می‌کنیم:", err.message);
    }
  }
}

// نوشتن‌های پشت‌سرهم رو batch می‌کنیم (به‌جای نوشتن دیسک روی هر set تکی)
// تا زیر بار زیاد، I/O دیسک اضافه به مسیر کاربر تحمیل نشه.
let persistTimer = null;
function schedulePersistKeysCache() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const obj = Object.fromEntries(chapterKeysCache.entries());
      fs.writeFileSync(KEYS_CACHE_FILE, JSON.stringify(obj));
    } catch (err) {
      console.warn("[chapterCache] نوشتن کش دیسک ناموفق بود:", err.message);
    }
  }, 2000);
}

loadPersistedKeysCache();

async function fetchChapterImageKeysFromS3(slug, chapterNum) {
  const prefix = `manhwas/${slug}/CH${chapterNum}/srcCH${chapterNum}/`;
  const keys = [];
  let continuationToken;

  // 💡 قبل از هر درخواست لیست، منتظر می‌مونیم تا یه سهمیه‌ی آزاد از صف
  // همزمانی بگیریم - این چیزیه که جلوی هجوم موازی به پارس‌پک بعد از
  // ری‌استارت سرور رو می‌گیره.
  await acquireListSlot();
  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: PARSPACK_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const response = await sendListCommandWithRetry(command);
      (response.Contents || []).forEach((obj) => {
        // 💡 شرط زیر اضافه شد: فقط کلیدهایی که به / ختم نمی‌شوند و خودِ مسیر پوشه نیستند را اضافه کن
        if (obj.Key && !obj.Key.endsWith("/") && obj.Key !== prefix) {
          keys.push(obj.Key);
        }
      });
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  } finally {
    releaseListSlot();
  }

  keys.sort((a, b) => naturalCompare(a, b));
  return keys;
}

// مقایسه‌ی طبیعی (natural sort): رشته رو به بخش‌های عددی و غیرعددی می‌شکنه
// و بخش‌های عددی رو به‌صورت عدد مقایسه می‌کنه، نه رشته.
// مثال: "page2.jpg" باید قبل از "page10.jpg" بیاد.
function naturalCompare(a, b) {
  const splitParts = (str) => str.match(/(\d+|\D+)/g) || [];
  const partsA = splitParts(a);
  const partsB = splitParts(b);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const pa = partsA[i] ?? "";
    const pb = partsB[i] ?? "";
    const numA = /^\d+$/.test(pa) ? parseInt(pa, 10) : null;
    const numB = /^\d+$/.test(pb) ? parseInt(pb, 10) : null;

    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
    } else if (pa !== pb) {
      return pa < pb ? -1 : 1;
    }
  }
  return 0;
}

// این تابع فقط وظیفه‌ی «واقعاً از S3 لیست بگیر و کش کن» رو داره - چه
// به‌صورت بلاک‌کننده صدا زده بشه (چپتر کاملاً جدید)، چه در پس‌زمینه
// (رفرش کشِ منقضی‌شده بدون معطل کردن کاربر).
function fetchAndCacheKeys(slug, chapterNum, cacheKey) {
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const existing = chapterKeysCache.get(cacheKey);

  const promise = (async () => {
    try {
      const keys = await fetchChapterImageKeysFromS3(slug, chapterNum);
      setLRU(chapterKeysCache, cacheKey, {
        keys,
        expiresAt: Date.now() + KEYS_CACHE_TTL_MS,
      });
      evictOldestIfNeeded(chapterKeysCache);
      schedulePersistKeysCache();
      return keys;
    } catch (err) {
      if (existing) {
        console.warn(
          `S3 list failed for ${cacheKey}, serving stale cache instead:`,
          err.message
        );
        return existing.keys;
      }
      throw err;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

async function getChapterImageKeys(slug, chapterNum) {
  const cacheKey = getCacheKey(slug, chapterNum);
  const cached = chapterKeysCache.get(cacheKey);

  if (cached) {
    if (cached.expiresAt > Date.now()) {
      // 💡 این چپتر همین الان استفاده شد - به انتهای صف LRU منتقلش کن تا
      // evictOldestIfNeeded اشتباهی به‌عنوان "قدیمی‌ترین" پاکش نکنه.
      touchLRU(chapterKeysCache, cacheKey);
      return cached.keys;
    }

    // 💡 stale-while-revalidate: کش منقضی شده، ولی به‌جای این‌که کاربر رو
    // منتظر یک ListObjectsV2 جدید (و ریسک 429) بذاریم، همون داده‌ی قدیمی
    // رو فوری برمی‌گردونیم و رفرش رو در پس‌زمینه، بدون بلاک کردن ریسپانس
    // کاربر، شروع می‌کنیم. حتی اگه این رفرش پس‌زمینه هم با 429 شکست
    // بخوره، کاربر همون چیزی که قبلاً کار می‌کرده رو می‌بینه، نه خطا -
    // و رفرش خودش دوباره در درخواست بعدی امتحان می‌شه.
    fetchAndCacheKeys(slug, chapterNum, cacheKey).catch((err) => {
      console.warn(`[chapterCache] رفرش پس‌زمینه‌ی ${cacheKey} ناموفق بود:`, err.message);
    });
    // این چپتر هنوز داره استفاده می‌شه (حتی با داده‌ی stale) - به انتهای
    // صف LRU منتقلش کن.
    touchLRU(chapterKeysCache, cacheKey);
    return cached.keys;
  }

  // اینجا فقط برای چپترهایی می‌رسیم که *هیچ‌جا* کش نشدن (نه تو حافظه، نه
  // روی دیسک) - یعنی واقعاً اولین باره که کسی این چپتر رو می‌خونه. این
  // تنها حالتیه که کاربر واقعاً منتظر یک تماس شبکه‌ای می‌مونه.
  return fetchAndCacheKeys(slug, chapterNum, cacheKey);
}

// امضای مستقیم S3 پارس‌پک - رفتار قدیمی. دیگه به‌صورت پیش‌فرض صدا زده
// نمی‌شه (چون هر بار GetObject واقعی به پارس‌پک می‌زنه و همون چیزیه که
// باعث ۴۲۹ می‌شد)، فقط برای رفرنس/rollback دستی نگه داشته شده.
async function signKeysDirectlyFromS3(keys) {
  return Promise.all(
    keys.map((key) => {
      const command = new GetObjectCommand({
        Bucket: PARSPACK_BUCKET,
        Key: key,
      });
      return getSignedUrl(s3, command, { expiresIn: SIGNED_URL_TTL_SECONDS });
    })
  );
}

// فال‌بک سریع تا BunnyCDN کامل راه‌اندازی بشه: به‌جای این‌که هر بازدیدکننده
// مستقیم به پارس‌پک GetObject بزنه، لینک به مسیر پراکسیِ خودِ سرور
// (/chapter-image در server.js) اشاره می‌کنه که پشتش یک کش دیسک داره
// (lib/imageProxyCache.js) - فقط اولین بازدیدکننده‌ی هر عکس واقعاً از
// پارس‌پک می‌خونه. توکن هم TTL داره، دقیقاً هم‌سطح امنیتیِ presigned URL
// قبلی (جزئیات در lib/localImageToken.js).
function signKeysViaLocalProxy(keys) {
  return keys.map((key) => buildLocalImageUrl(key, SIGNED_URL_TTL_SECONDS));
}

async function signKeys(keys) {
  // اولویت اول: اگه BunnyCDN تنظیم شده باشه (BUNNY_CDN_HOSTNAME +
  // BUNNY_TOKEN_SECURITY_KEY توی .env)، لینک‌ها رو با Token Authentication
  // از طریق Bunny می‌سازیم - هم امن‌تره، هم بار از روی سرور خودمون هم
  // برداشته می‌شه چون کش لبه‌ی واقعی داره.
  if (isBunnyConfigured()) {
    return buildBunnySignedUrls(keys, SIGNED_URL_TTL_SECONDS);
  }

  // اولویت دوم (فعلاً پیش‌فرض، تا Bunny راه بیفته): پراکسیِ کش‌شده‌ی خودِ
  // سرور - این باعث می‌شه GetObject واقعی فقط یک‌بار به‌ازای هر عکس به
  // پارس‌پک بره، نه یک‌بار به‌ازای هر بازدیدکننده.
  if (!warnedNoBunny) {
    console.warn(
      "[chapterCache] BunnyCDN تنظیم نشده (BUNNY_CDN_HOSTNAME / BUNNY_TOKEN_SECURITY_KEY در .env خالیه) - فعلاً از پراکسی کش‌شده‌ی خودِ سرور (/chapter-image) استفاده می‌شه."
    );
    warnedNoBunny = true;
  }

  return signKeysViaLocalProxy(keys);
}

// نکته‌ی مهم: پارامتر سوم (knownKeys) اختیاریه. اگه از بیرون (مثلاً از
// خودِ data.json که هنگام ثبت چپتر پر شده) لیست فایل‌ها رو داشته باشیم،
// دیگه اصلاً سراغ getChapterImageKeys (و در نتیجه S3) نمی‌ریم - فقط
// همون لیست رو امضا می‌کنیم. این دقیقاً همون چیزیه که ListObjectsV2 رو
// کاملاً از مسیر خوندن معمولی کاربر حذف می‌کنه.
async function buildSignedUrls(slug, chapterNum, knownKeys) {
  const cacheKey = getCacheKey(slug, chapterNum);

  const cachedUrls = signedUrlsCache.get(cacheKey);
  if (cachedUrls && cachedUrls.expiresAt > Date.now()) {
    touchLRU(signedUrlsCache, cacheKey);
    return cachedUrls.urls;
  }

  // 💡 دیدوپ درخواست‌های هم‌زمان: قبلاً اگه ده‌ها ریکوئست هم‌زمان برای یک
  // چپتر پرترافیک با کش خالی/منقضی می‌رسیدن (مثلاً درست بعد از انقضای
  // ۵۰ دقیقه‌ای)، هر کدوم جدا signKeys رو صدا می‌زدن - یعنی چند ده بار
  // امضای تکراری (HMAC / presign) برای دقیقاً همون فایل‌ها. حالا مثل
  // getChapterImageKeys، فقط اولین ریکوئست واقعاً کار امضا رو انجام می‌ده
  // و بقیه همون Promise در حال اجرا رو منتظر می‌مونن.
  if (inFlightSignRequests.has(cacheKey)) {
    return inFlightSignRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const keys =
        Array.isArray(knownKeys) && knownKeys.length > 0
          ? knownKeys
          : await getChapterImageKeys(slug, chapterNum);
      const urls = await signKeys(keys);

      setLRU(signedUrlsCache, cacheKey, {
        urls,
        expiresAt: Date.now() + SIGNED_URLS_CACHE_TTL_MS,
      });
      evictOldestIfNeeded(signedUrlsCache);

      return urls;
    } finally {
      inFlightSignRequests.delete(cacheKey);
    }
  })();

  inFlightSignRequests.set(cacheKey, promise);
  return promise;
}

function invalidateChapterCache(slug, chapterNum) {
  const cacheKey = getCacheKey(slug, chapterNum);
  chapterKeysCache.delete(cacheKey);
  signedUrlsCache.delete(cacheKey);
  schedulePersistKeysCache();
}

// برای پنل ادمین: لیست شماره‌ی چپترهایی که واقعاً روی S3 پوشه دارن
// (manhwas/<slug>/CH<n>/) - با Delimiter فقط پوشه‌های سطح اول رو می‌گیره،
// نه هزاران فایل تک‌تک عکس رو - پس سریع و سبک اجرا می‌شه.
async function listChapterFoldersFromS3(slug) {
  const prefix = `manhwas/${slug}/`;
  const folders = [];
  let continuationToken;

  await acquireListSlot();
  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: PARSPACK_BUCKET,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      });
      const response = await sendListCommandWithRetry(command);
      (response.CommonPrefixes || []).forEach((p) => {
        const match = (p.Prefix || "").match(/CH(\d+)\/$/);
        if (match) folders.push(Number(match[1]));
      });
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  } finally {
    releaseListSlot();
  }

  return folders.sort((a, b) => a - b);
}

module.exports = {
  s3,
  buildSignedUrls,
  invalidateChapterCache,
  listChapterFoldersFromS3,
  // برای پنل ادمین: لیست‌گرفتن یک‌باره‌ی فایل‌های یک چپتر مشخص، تا موقع
  // ثبت/resync چپتر، نتیجه‌اش داخل data.json ذخیره بشه و دیگه لازم نباشه
  // خوندن معمولی چپتر هر بار همین کار رو تکرار کنه.
  listChapterImageKeys: fetchChapterImageKeysFromS3,
};

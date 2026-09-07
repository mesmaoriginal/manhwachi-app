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

const chapterKeysCache = new Map(); // cacheKey -> { keys, expiresAt }
const signedUrlsCache = new Map(); // cacheKey -> { urls, expiresAt }
const inFlightRequests = new Map(); // cacheKey -> Promise در حال اجرا

// فقط یک بار (نه روی هر ریکوئست) هشدار می‌ده که Bunny تنظیم نشده، تا لاگ
// سرور شلوغ نشه.
let warnedNoBunny = false;

function getCacheKey(slug, chapterNum) {
  return `${slug}::${chapterNum}`;
}

// وقتی یه Map از سقف تعیین‌شده بیشتر شد، قدیمی‌ترین ورودی‌ها رو حذف می‌کنه.
// چون Map ترتیب insertion رو حفظ می‌کنه، اولین کلیدها همون قدیمی‌ترین‌هان.
function evictOldestIfNeeded(map) {
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

async function fetchChapterImageKeysFromS3(slug, chapterNum) {
  const prefix = `manhwas/${slug}/CH${chapterNum}/srcCH${chapterNum}/`;
  const keys = [];
  let continuationToken;

  do {
    const command = new ListObjectsV2Command({
      Bucket: PARSPACK_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await s3.send(command);
    (response.Contents || []).forEach((obj) => {
      // 💡 شرط زیر اضافه شد: فقط کلیدهایی که به / ختم نمی‌شوند و خودِ مسیر پوشه نیستند را اضافه کن
      if (obj.Key && !obj.Key.endsWith("/") && obj.Key !== prefix) {
        keys.push(obj.Key);
      }
    });
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

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

async function getChapterImageKeys(slug, chapterNum) {
  const cacheKey = getCacheKey(slug, chapterNum);

  const cached = chapterKeysCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const keys = await fetchChapterImageKeysFromS3(slug, chapterNum);
      chapterKeysCache.set(cacheKey, {
        keys,
        expiresAt: Date.now() + KEYS_CACHE_TTL_MS,
      });
      evictOldestIfNeeded(chapterKeysCache);
      return keys;
    } catch (err) {
      if (cached) {
        console.warn(
          `S3 list failed for ${cacheKey}, serving stale cache instead:`,
          err.message
        );
        return cached.keys;
      }
      throw err;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

// امضای مستقیم S3 پارس‌پک - رفتار قبلی، فقط به‌عنوان fallback وقتی هنوز
// BunnyCDN تنظیم نشده باشه.
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

async function signKeys(keys) {
  // اگه BunnyCDN تنظیم شده باشه (BUNNY_CDN_HOSTNAME + BUNNY_TOKEN_SECURITY_KEY
  // توی .env)، لینک‌ها رو با Token Authentication از طریق Bunny می‌سازیم:
  // هم امن‌تره (بار روی باکت پارس‌پک نمی‌افته، چون Bunny کش می‌کنه)، هم
  // همچنان هر لینک منقضی می‌شه.
  if (isBunnyConfigured()) {
    return buildBunnySignedUrls(keys, SIGNED_URL_TTL_SECONDS);
  }

  // فال‌بک: تا وقتی BunnyCDN راه‌اندازی نشده، از presigned URL مستقیم
  // پارس‌پک استفاده کن تا سایت از کار نیفته.
  if (!warnedNoBunny) {
    console.warn(
      "[chapterCache] BunnyCDN تنظیم نشده (BUNNY_CDN_HOSTNAME / BUNNY_TOKEN_SECURITY_KEY در .env خالیه) - فعلاً از presigned URL مستقیم پارس‌پک استفاده می‌شه."
    );
    warnedNoBunny = true;
  }

  return signKeysDirectlyFromS3(keys);
}

async function buildSignedUrls(slug, chapterNum) {
  const cacheKey = getCacheKey(slug, chapterNum);

  const cachedUrls = signedUrlsCache.get(cacheKey);
  if (cachedUrls && cachedUrls.expiresAt > Date.now()) {
    return cachedUrls.urls;
  }

  const keys = await getChapterImageKeys(slug, chapterNum);
  const urls = await signKeys(keys);

  signedUrlsCache.set(cacheKey, {
    urls,
    expiresAt: Date.now() + SIGNED_URLS_CACHE_TTL_MS,
  });
  evictOldestIfNeeded(signedUrlsCache);

  return urls;
}

function invalidateChapterCache(slug, chapterNum) {
  const cacheKey = getCacheKey(slug, chapterNum);
  chapterKeysCache.delete(cacheKey);
  signedUrlsCache.delete(cacheKey);
}

// برای پنل ادمین: لیست شماره‌ی چپترهایی که واقعاً روی S3 پوشه دارن
// (manhwas/<slug>/CH<n>/) - با Delimiter فقط پوشه‌های سطح اول رو می‌گیره،
// نه هزاران فایل تک‌تک عکس رو - پس سریع و سبک اجرا می‌شه.
async function listChapterFoldersFromS3(slug) {
  const prefix = `manhwas/${slug}/`;
  const folders = [];
  let continuationToken;

  do {
    const command = new ListObjectsV2Command({
      Bucket: PARSPACK_BUCKET,
      Prefix: prefix,
      Delimiter: "/",
      ContinuationToken: continuationToken,
    });
    const response = await s3.send(command);
    (response.CommonPrefixes || []).forEach((p) => {
      const match = (p.Prefix || "").match(/CH(\d+)\/$/);
      if (match) folders.push(Number(match[1]));
    });
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return folders.sort((a, b) => a - b);
}

module.exports = {
  s3,
  buildSignedUrls,
  invalidateChapterCache,
  listChapterFoldersFromS3,
};

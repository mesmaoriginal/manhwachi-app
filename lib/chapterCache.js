// lib/chapterCache.js
//
// این ماژول تمام منطق مربوط به S3 (پارس‌پک) رو یک‌جا نگه می‌داره تا هم server.js
// و هم پنل ادمین بتونن ازش استفاده کنن، بدون تکرار کد و بدون دو تا نمونه‌ی جدا
// از کش که ممکنه با هم ناهماهنگ بشن.
//
// شامل:
// - buildSignedUrls: ساخت لینک‌های امضاشده موقت برای تصاویر یک چپتر (با کش)
// - invalidateChapterCache: پاک کردن کش یک چپتر مشخص (وقتی عکس جدید آپلود میشه)
// - listChapterFoldersFromS3: لیست شماره چپترهایی که واقعاً روی S3 آپلود شدن
//   (این تابع پایه‌ی قابلیت "بررسی همگام‌سازی" تو پنل ادمینه)

const { S3Client, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const PARSPACK_ENDPOINT = process.env.PARSPACK_ENDPOINT;
const PARSPACK_ACCESS_KEY = process.env.PARSPACK_ACCESS_KEY;
const PARSPACK_SECRET_KEY = process.env.PARSPACK_SECRET_KEY;
const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

const SIGNED_URL_TTL_SECONDS = 300; // ۵ دقیقه
const KEYS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // ۶ ساعت

const s3 = new S3Client({
  endpoint: PARSPACK_ENDPOINT,
  region: "default",
  credentials: {
    accessKeyId: PARSPACK_ACCESS_KEY,
    secretAccessKey: PARSPACK_SECRET_KEY,
  },
  forcePathStyle: true,
  maxAttempts: 5,
});

const chapterKeysCache = new Map(); // cacheKey -> { keys, expiresAt }
const inFlightRequests = new Map(); // cacheKey -> Promise در حال اجرا

function getCacheKey(slug, chapterNum) {
  return `${slug}::${chapterNum}`;
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
    (response.Contents || []).forEach((obj) => keys.push(obj.Key));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  keys.sort();
  return keys;
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

async function buildSignedUrls(slug, chapterNum) {
  const keys = await getChapterImageKeys(slug, chapterNum);
  const urls = await Promise.all(
    keys.map((key) => {
      const command = new GetObjectCommand({ Bucket: PARSPACK_BUCKET, Key: key });
      return getSignedUrl(s3, command, { expiresIn: SIGNED_URL_TTL_SECONDS });
    })
  );
  return urls;
}

function invalidateChapterCache(slug, chapterNum) {
  chapterKeysCache.delete(getCacheKey(slug, chapterNum));
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

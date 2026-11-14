const {S3Client: S3Client, GetObjectCommand: GetObjectCommand, ListObjectsV2Command: ListObjectsV2Command} = require("@aws-sdk/client-s3");

const {getSignedUrl: getSignedUrl} = require("@aws-sdk/s3-request-presigner");

const {isBunnyConfigured: isBunnyConfigured, buildBunnySignedUrls: buildBunnySignedUrls} = require("./secureLink");

const {buildLocalImageUrl: buildLocalImageUrl} = require("./localImageToken");

const fs = require("fs");

const path = require("path");

const KEYS_CACHE_FILE = path.join(__dirname, ".chapter-keys-cache.json");

const PARSPACK_ENDPOINT = process.env.PARSPACK_ENDPOINT;

const PARSPACK_ACCESS_KEY = process.env.PARSPACK_ACCESS_KEY;

const PARSPACK_SECRET_KEY = process.env.PARSPACK_SECRET_KEY;

const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

const SIGNED_URL_TTL_SECONDS = 2 * 60 * 60;

const SIGNED_URLS_CACHE_TTL_MS = 50 * 60 * 1e3;

const KEYS_CACHE_TTL_MS = 6 * 60 * 60 * 1e3;

const MAX_CACHE_ENTRIES = 2e3;

const s3 = new S3Client({
  endpoint: PARSPACK_ENDPOINT,
  region: "default",
  credentials: {
    accessKeyId: PARSPACK_ACCESS_KEY,
    secretAccessKey: PARSPACK_SECRET_KEY
  },
  forcePathStyle: true,
  maxAttempts: 3
});

const LIST_CONCURRENCY = 3;

let activeListCount = 0;

const listWaitQueue = [];

function acquireListSlot() {
  if (activeListCount < LIST_CONCURRENCY) {
    activeListCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => listWaitQueue.push(resolve));
}

function releaseListSlot() {
  const next = listWaitQueue.shift();
  if (next) {
    next();
  } else {
    activeListCount = Math.max(0, activeListCount - 1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const LIST_MAX_RETRIES = 4;

const LIST_BASE_DELAY_MS = 400;

const LIST_MAX_DELAY_MS = 3e3;

function isThrottlingError(err) {
  return err?.$metadata?.httpStatusCode === 429 || err?.Code === "429" || err?.name === "TooManyRequestsException" || err?.name === "ThrottlingException" || err?.name === "SlowDown";
}

async function sendListCommandWithRetry(command) {
  let attempt = 0;
  while (true) {
    try {
      return await s3.send(command);
    } catch (err) {
      attempt++;
      if (!isThrottlingError(err) || attempt > LIST_MAX_RETRIES) {
        throw err;
      }
      const rawBackoff = LIST_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const backoff = Math.min(rawBackoff, LIST_MAX_DELAY_MS);
      const jitter = Math.random() * backoff * .5;
      const delay = backoff + jitter;
      console.warn(`[chapterCache] 429 از پارس‌پک روی ListObjectsV2 (تلاش ${attempt}/${LIST_MAX_RETRIES}) - ${Math.round(delay)}ms صبر می‌کنیم...`);
      await sleep(delay);
    }
  }
}

const chapterKeysCache = new Map;

const signedUrlsCache = new Map;

const inFlightRequests = new Map;

const inFlightSignRequests = new Map;

let warnedNoBunny = false;

function getCacheKey(slug, chapterNum) {
  return `${slug}::${chapterNum}`;
}

function evictOldestIfNeeded(map) {
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

function setLRU(map, key, value) {
  map.delete(key);
  map.set(key, value);
}

function touchLRU(map, key) {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
}

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
      console.log(`[chapterCache] ${chapterKeysCache.size} چپتر از کش دیسک بازیابی شد - این چپترها بعد از ری‌استارت نیازی به لیست‌کردن مجدد از S3 ندارن.`);
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[chapterCache] خواندن کش دیسک ناموفق بود، از کش خالی شروع می‌کنیم:", err.message);
    }
  }
}

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
  }, 2e3);
}

loadPersistedKeysCache();

async function listFilesUnderPrefix(prefix) {
  const keys = [];
  let continuationToken;
  await acquireListSlot();
  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: PARSPACK_BUCKET,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken
      });
      const response = await sendListCommandWithRetry(command);
      (response.Contents || []).forEach(obj => {
        if (obj.Key && !obj.Key.endsWith("/") && obj.Key !== prefix) {
          keys.push(obj.Key);
        }
      });
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  } finally {
    releaseListSlot();
  }
  return keys;
}

async function fetchChapterImageKeysFromS3(slug, chapterNum) {
  const newPrefix = `manhwas/${slug}/CH${chapterNum}/`;
  const legacyPrefix = `manhwas/${slug}/CH${chapterNum}/srcCH${chapterNum}/`;
  let keys = await listFilesUnderPrefix(newPrefix);
  if (keys.length === 0) {
    keys = await listFilesUnderPrefix(legacyPrefix);
  }
  keys.sort((a, b) => naturalCompare(a, b));
  return keys;
}

function naturalCompare(a, b) {
  const splitParts = str => str.match(/(\d+|\D+)/g) || [];
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

function fetchAndCacheKeys(slug, chapterNum, cacheKey) {
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }
  const existing = chapterKeysCache.get(cacheKey);
  const promise = (async () => {
    try {
      const keys = await fetchChapterImageKeysFromS3(slug, chapterNum);
      setLRU(chapterKeysCache, cacheKey, {
        keys: keys,
        expiresAt: Date.now() + KEYS_CACHE_TTL_MS
      });
      evictOldestIfNeeded(chapterKeysCache);
      schedulePersistKeysCache();
      return keys;
    } catch (err) {
      if (existing) {
        console.warn(`S3 list failed for ${cacheKey}, serving stale cache instead:`, err.message);
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
      touchLRU(chapterKeysCache, cacheKey);
      return cached.keys;
    }
    fetchAndCacheKeys(slug, chapterNum, cacheKey).catch(err => {
      console.warn(`[chapterCache] رفرش پس‌زمینه‌ی ${cacheKey} ناموفق بود:`, err.message);
    });
    touchLRU(chapterKeysCache, cacheKey);
    return cached.keys;
  }
  return fetchAndCacheKeys(slug, chapterNum, cacheKey);
}

async function signKeysDirectlyFromS3(keys) {
  return Promise.all(keys.map(key => {
    const command = new GetObjectCommand({
      Bucket: PARSPACK_BUCKET,
      Key: key
    });
    return getSignedUrl(s3, command, {
      expiresIn: SIGNED_URL_TTL_SECONDS
    });
  }));
}

function signKeysViaLocalProxy(keys) {
  return keys.map(key => buildLocalImageUrl(key, SIGNED_URL_TTL_SECONDS));
}

async function signKeys(keys) {
  if (isBunnyConfigured()) {
    return buildBunnySignedUrls(keys, SIGNED_URL_TTL_SECONDS);
  }
  if (!warnedNoBunny) {
    console.warn("[chapterCache] BunnyCDN تنظیم نشده (BUNNY_CDN_HOSTNAME / BUNNY_TOKEN_SECURITY_KEY در .env خالیه) - فعلاً از پراکسی کش‌شده‌ی خودِ سرور (/chapter-image) استفاده می‌شه.");
    warnedNoBunny = true;
  }
  return signKeysViaLocalProxy(keys);
}

async function buildSignedUrls(slug, chapterNum, knownKeys) {
  const cacheKey = getCacheKey(slug, chapterNum);
  const cachedUrls = signedUrlsCache.get(cacheKey);
  if (cachedUrls && cachedUrls.expiresAt > Date.now()) {
    touchLRU(signedUrlsCache, cacheKey);
    return cachedUrls.urls;
  }
  if (inFlightSignRequests.has(cacheKey)) {
    return inFlightSignRequests.get(cacheKey);
  }
  const promise = (async () => {
    try {
      const keys = Array.isArray(knownKeys) && knownKeys.length > 0 ? knownKeys : await getChapterImageKeys(slug, chapterNum);
      const urls = await signKeys(keys);
      setLRU(signedUrlsCache, cacheKey, {
        urls: urls,
        expiresAt: Date.now() + SIGNED_URLS_CACHE_TTL_MS
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
        ContinuationToken: continuationToken
      });
      const response = await sendListCommandWithRetry(command);
      (response.CommonPrefixes || []).forEach(p => {
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
  s3: s3,
  buildSignedUrls: buildSignedUrls,
  invalidateChapterCache: invalidateChapterCache,
  listChapterFoldersFromS3: listChapterFoldersFromS3,
  listChapterImageKeys: fetchChapterImageKeysFromS3
};
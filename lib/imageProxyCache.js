const fs = require("fs");

const fsp = fs.promises;

const path = require("path");

const {GetObjectCommand: GetObjectCommand} = require("@aws-sdk/client-s3");

const {s3: s3} = require("./chapterCache");

const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

const CACHE_DIR = process.env.IMAGE_CACHE_DIR || path.join(__dirname, "..", "image-cache");

fs.mkdirSync(CACHE_DIR, {
  recursive: true
});

function metaPath(cachePath) {
  return cachePath + ".meta.json";
}

const GET_CONCURRENCY = 5;

let active = 0;

const queue = [];

function acquire() {
  if (active < GET_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise(resolve => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next(); else active = Math.max(0, active - 1);
}

const inFlight = new Map;

function keyToCachePath(key, ns = "") {
  const safe = (ns ? ns + "~" : "") + key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(CACHE_DIR, safe);
}

async function readFromDisk(cachePath) {
  const buffer = await fsp.readFile(cachePath);
  let contentType = "application/octet-stream";
  try {
    contentType = JSON.parse(await fsp.readFile(metaPath(cachePath), "utf8")).contentType;
  } catch {}
  fsp.utimes(cachePath, new Date, new Date).catch(() => {});
  return {
    buffer: buffer,
    contentType: contentType
  };
}

const exists = p => fsp.access(p).then(() => true, () => false);

const COOLDOWN_MS = 20 * 1e3;

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
  if (left > 0) throw new UpstreamBusyError(Math.ceil(left / 1e3));
}

const GET_MIN_INTERVAL_MS = 300;

const GET_MAX_RETRIES = 4;

let nextSlot = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function paceGet() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + GET_MIN_INTERVAL_MS;
  if (start > now) await sleep(start - now);
}

function isThrottled(err) {
  return err?.$metadata?.httpStatusCode === 429 || err?.name === "SlowDown" || err?.name === "TooManyRequestsException" || /too many requests/i.test(err?.message || "");
}

async function getObjectWithRetry(key) {
  for (let attempt = 0; ;attempt++) {
    await paceGet();
    try {
      return await s3.send(new GetObjectCommand({
        Bucket: PARSPACK_BUCKET,
        Key: key
      }));
    } catch (err) {
      if (isThrottled(err)) cooldownUntil = Math.max(cooldownUntil, Date.now() + COOLDOWN_MS);
      if (!isThrottled(err) || attempt >= GET_MAX_RETRIES) throw err;
      const delay = Math.min(500 * 2 ** attempt, 4e3) + Math.random() * 300;
      console.warn(`[imageProxyCache] 429 از پارس‌پک (تلاش ${attempt + 1}/${GET_MAX_RETRIES}) - ${Math.round(delay)}ms صبر می‌کنیم...`);
      await sleep(delay);
    }
  }
}

async function fetchAndCache(key, ns = "") {
  const cachePath = keyToCachePath(key, ns);
  await acquire();
  try {
    if (await exists(cachePath)) {
      return readFromDisk(cachePath);
    }
    checkCooldown();
    const obj = await getObjectWithRetry(key);
    const chunks = [];
    for await (const chunk of obj.Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const contentType = obj.ContentType || "application/octet-stream";
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmpPath, buffer);
    await fsp.rename(tmpPath, cachePath);
    await fsp.writeFile(metaPath(cachePath), JSON.stringify({
      contentType: contentType
    }));
    knownTotal += buffer.length;
    if (knownTotal > MAX_CACHE_BYTES) setImmediate(() => cleanupCache());
    return {
      buffer: buffer,
      contentType: contentType
    };
  } finally {
    release();
  }
}

async function getCachedImage(key, opts = {}) {
  const ns = opts && opts.ns || "";
  const cachePath = keyToCachePath(key, ns);
  if (await exists(cachePath)) {
    return readFromDisk(cachePath);
  }
  const flightKey = ns ? ns + "~" + key : key;
  if (inFlight.has(flightKey)) {
    return inFlight.get(flightKey);
  }
  checkCooldown();
  const promise = fetchAndCache(key, ns).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, promise);
  return promise;
}

const MAX_AGE_DAYS = Number(process.env.IMAGE_CACHE_MAX_AGE_DAYS || 7);

const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1e3;

const MAX_CACHE_MB = Number(process.env.IMAGE_CACHE_MAX_MB || 100);

const MAX_CACHE_BYTES = MAX_CACHE_MB * 1024 * 1024;

let knownTotal = 0;

let sweeping = null;

const META_SUFFIX = ".meta.json";

const yieldLoop = () => new Promise(r => setImmediate(r));

async function cleanupCache(capBytesOverride) {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const cap = capBytesOverride || MAX_CACHE_BYTES;
    let removedAge = 0, removedSize = 0, removedJunk = 0;
    let total = 0;
    try {
      const now = Date.now();
      const list = await fsp.readdir(CACHE_DIR);
      const names = new Set(list);
      const images = [];
      let i = 0;
      for (const file of list) {
        if (++i % 100 === 0) await yieldLoop();
        const fullPath = path.join(CACHE_DIR, file);
        try {
          const stat = await fsp.stat(fullPath);
          if (!stat.isFile()) continue;
          if (file.includes(".tmp-")) {
            if (now - stat.mtimeMs > 10 * 60 * 1e3) {
              await fsp.unlink(fullPath);
              removedJunk++;
            } else total += stat.size;
            continue;
          }
          if (file.endsWith(META_SUFFIX)) {
            if (!names.has(file.slice(0, -META_SUFFIX.length))) {
              await fsp.unlink(fullPath);
              removedJunk++;
            } else total += stat.size;
            continue;
          }
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            await fsp.unlink(fullPath);
            await fsp.unlink(metaPath(fullPath)).catch(() => {});
            removedAge++;
          } else {
            images.push({
              fullPath: fullPath,
              size: stat.size,
              mtime: stat.mtimeMs
            });
            total += stat.size;
          }
        } catch {}
      }
      if (total > cap) {
        images.sort((x, y) => x.mtime - y.mtime);
        const target = cap * .7;
        let n = 0;
        for (const f of images) {
          if (total <= target) break;
          if (++n % 100 === 0) await yieldLoop();
          try {
            await fsp.unlink(f.fullPath);
            total -= f.size;
            removedSize++;
            try {
              const m = metaPath(f.fullPath);
              const ms = (await fsp.stat(m)).size;
              await fsp.unlink(m);
              total -= ms;
            } catch {}
          } catch {}
        }
      }
      knownTotal = total;
      if (removedAge || removedSize || removedJunk) {
        console.log(`[imageProxyCache] پاکسازی: ${removedAge} فایل قدیمی، ${removedSize} فایل برای رعایت سقف حجم، ${removedJunk} فایل موقت/بی‌صاحب؛ حجم فعلی ~${Math.round(total / 1048576)}MB`);
      }
    } catch (err) {
      console.warn("[imageProxyCache] پاکسازی کش دیسک ناموفق بود:", err.message);
    }
    return total;
  })().finally(() => {
    sweeping = null;
  });
  return sweeping;
}

cleanupCache();

const cleanupInterval = setInterval(() => cleanupCache(), 10 * 60 * 1e3);

cleanupInterval.unref();

async function warmImages(keys) {
  for (const key of keys) {
    try {
      await getCachedImage(key);
    } catch (err) {
      console.warn("[imageProxyCache] warm ناموفق:", key, err.message);
    }
  }
}

module.exports = {
  getCachedImage: getCachedImage,
  warmImages: warmImages,
  UpstreamBusyError: UpstreamBusyError,
  cleanupCache: cleanupCache,
  CACHE_DIR: CACHE_DIR
};
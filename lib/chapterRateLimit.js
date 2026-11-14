const crypto = require("crypto");

const WINDOW_BURST_MS = 60 * 1e3;

const MAX_REQUESTS_BURST = 20;

const WINDOW_SUSTAINED_MS = 60 * 60 * 1e3;

const MAX_REQUESTS_SUSTAINED = 120;

const MAX_REQUESTS_BURST_NEW_GUEST_PER_IP = 60;

const MAX_REQUESTS_SUSTAINED_NEW_GUEST_PER_IP = 600;

const MAX_TRACKED_USERS = 2e4;

const requestLog = new Map;

function evictOldestIfNeeded() {
  while (requestLog.size > MAX_TRACKED_USERS) {
    const oldestKey = requestLog.keys().next().value;
    requestLog.delete(oldestKey);
  }
}

function setLRU(map, key, value) {
  map.delete(key);
  map.set(key, value);
}

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of requestLog.entries()) {
    const fresh = timestamps.filter(t => now - t < WINDOW_SUSTAINED_MS);
    if (fresh.length === 0) {
      requestLog.delete(userId);
    } else {
      requestLog.set(userId, fresh);
    }
  }
}, 10 * 60 * 1e3);

cleanupInterval.unref();

function checkAndRecordChapterRequestLocal(key, {maxBurst: maxBurst, maxSustained: maxSustained}) {
  const now = Date.now();
  const timestamps = requestLog.get(key) || [];
  const withinSustained = timestamps.filter(t => now - t < WINDOW_SUSTAINED_MS);
  const withinBurst = withinSustained.filter(t => now - t < WINDOW_BURST_MS);
  if (withinBurst.length >= maxBurst) {
    const oldestInBurst = Math.min(...withinBurst);
    const retryAfterSeconds = Math.ceil((oldestInBurst + WINDOW_BURST_MS - now) / 1e3);
    if (requestLog.has(key)) setLRU(requestLog, key, withinSustained);
    return {
      allowed: false,
      reason: "burst",
      retryAfterSeconds: retryAfterSeconds
    };
  }
  if (withinSustained.length >= maxSustained) {
    const oldestInSustained = Math.min(...withinSustained);
    const retryAfterSeconds = Math.ceil((oldestInSustained + WINDOW_SUSTAINED_MS - now) / 1e3);
    if (requestLog.has(key)) setLRU(requestLog, key, withinSustained);
    return {
      allowed: false,
      reason: "sustained",
      retryAfterSeconds: retryAfterSeconds
    };
  }
  withinSustained.push(now);
  setLRU(requestLog, key, withinSustained);
  evictOldestIfNeeded();
  return {
    allowed: true
  };
}

const LUA_SCRIPT = `\nlocal key = KEYS[1]\nlocal now = tonumber(ARGV[1])\nlocal burst_window_ms = tonumber(ARGV[2])\nlocal sustained_window_ms = tonumber(ARGV[3])\nlocal max_burst = tonumber(ARGV[4])\nlocal max_sustained = tonumber(ARGV[5])\nlocal member = ARGV[6]\n\n-- درخواست‌های خارج از پنجره‌ی ساعتی (بزرگ‌ترین پنجره) رو دور بریز، دقیقاً\n-- مثل filter کردن withinSustained توی نسخه‌ی in-memory.\nredis.call('ZREMRANGEBYSCORE', key, '-inf', now - sustained_window_ms)\n\nlocal burst_count = redis.call('ZCOUNT', key, now - burst_window_ms, '+inf')\nif burst_count >= max_burst then\n  local oldest = redis.call('ZRANGEBYSCORE', key, now - burst_window_ms, '+inf', 'WITHSCORES', 'LIMIT', 0, 1)\n  local oldest_ts = now\n  if oldest[2] then oldest_ts = tonumber(oldest[2]) end\n  redis.call('PEXPIRE', key, sustained_window_ms)\n  return {0, 'burst', oldest_ts}\nend\n\nlocal sustained_count = redis.call('ZCARD', key)\nif sustained_count >= max_sustained then\n  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')\n  local oldest_ts = now\n  if oldest[2] then oldest_ts = tonumber(oldest[2]) end\n  redis.call('PEXPIRE', key, sustained_window_ms)\n  return {0, 'sustained', oldest_ts}\nend\n\nredis.call('ZADD', key, now, member)\nredis.call('PEXPIRE', key, sustained_window_ms)\nreturn {1, '', 0}\n`;

const REDIS_URL = process.env.REDIS_URL || "";

let redisClient = null;

let redisReady = false;

if (REDIS_URL) {
  try {
    const Redis = require("ioredis");
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      commandTimeout: 750,
      lazyConnect: false,
      retryStrategy(times) {
        return Math.min(times * 500, 1e4);
      }
    });
    redisClient.on("ready", () => {
      redisReady = true;
      console.log("[chapterRateLimit] به Redis وصل شد - سقف‌های rate limit الان بین همه‌ی instance ها مشترکه.");
    });
    redisClient.on("error", err => {
      if (redisReady) {
        console.warn("[chapterRateLimit] اتصال Redis قطع شد - تا وصل‌شدن مجدد، به‌صورت موقت به in-memory فال‌بک می‌شه (یعنی سقف per-instance می‌شه، نه غیرفعال):", err.message);
      }
      redisReady = false;
    });
    redisClient.defineCommand("chapterRateLimitCheck", {
      numberOfKeys: 1,
      lua: LUA_SCRIPT
    });
  } catch (err) {
    console.warn("[chapterRateLimit] REDIS_URL تنظیم شده ولی پکیج ioredis در دسترس نیست (`npm install ioredis`) - فعلاً به in-memory فال‌بک می‌شه؛ یعنی سقف‌ها هنوز per-instance هستن.", err.message);
  }
} else {
  console.warn("[chapterRateLimit] REDIS_URL تنظیم نشده - rate limit چپتر به‌صورت in-memory (per-process) اجرا می‌شه. اگه بیش از یک instance/process (PM2 cluster mode یا چند سرور پشت لود بالانسر) دارید، سقف واقعی عملاً N برابر می‌شه؛ برای رفعش REDIS_URL رو ست کنید.");
}

async function checkViaRedis(key, maxBurst, maxSustained) {
  const now = Date.now();
  const member = `${now}-${crypto.randomBytes(6).toString("hex")}`;
  const redisKey = `crl:${key}`;
  const raw = await redisClient.chapterRateLimitCheck(redisKey, now, WINDOW_BURST_MS, WINDOW_SUSTAINED_MS, maxBurst, maxSustained, member);
  const allowedFlag = Number(raw[0]);
  const reason = raw[1] || undefined;
  const oldestTs = Number(raw[2]) || now;
  if (allowedFlag === 1) {
    return {
      allowed: true
    };
  }
  const windowMs = reason === "burst" ? WINDOW_BURST_MS : WINDOW_SUSTAINED_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1e3));
  return {
    allowed: false,
    reason: reason,
    retryAfterSeconds: retryAfterSeconds
  };
}

async function checkAndRecordChapterRequest(key, limits = {}) {
  const maxBurst = limits.maxBurst ?? MAX_REQUESTS_BURST;
  const maxSustained = limits.maxSustained ?? MAX_REQUESTS_SUSTAINED;
  if (redisClient && redisReady) {
    try {
      return await checkViaRedis(key, maxBurst, maxSustained);
    } catch (err) {
      console.warn("[chapterRateLimit] دستور Redis fail شد، فال‌بک به in-memory برای همین درخواست:", err.message);
    }
  }
  return checkAndRecordChapterRequestLocal(key, {
    maxBurst: maxBurst,
    maxSustained: maxSustained
  });
}

async function checkAndRecordGuestChapterRequest(guestId, ip, isNew = false) {
  if (isNew) {
    const r = await checkAndRecordChapterRequest(`newguest-ip:${ip}`, {
      maxBurst: MAX_REQUESTS_BURST_NEW_GUEST_PER_IP,
      maxSustained: MAX_REQUESTS_SUSTAINED_NEW_GUEST_PER_IP
    });
    return {
      ...r,
      bucket: "ip"
    };
  }
  const r = await checkAndRecordChapterRequest(`guest:${guestId}`);
  return {
    ...r,
    bucket: "guest"
  };
}

function chapterRateLimitMiddleware(getUserId) {
  return async function(req, res, next) {
    const userId = getUserId(req);
    if (!userId) {
      return next();
    }
    let result;
    try {
      result = await checkAndRecordChapterRequest(userId);
    } catch (err) {
      console.error("[chapterRateLimit] خطای غیرمنتظره، عبور بدون محدودیت:", err.message);
      return next();
    }
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({
        error: result.reason === "burst" ? "تعداد درخواست‌های شما در این دقیقه زیاده. کمی صبر کنید." : "شما به سقف مجاز خواندن چپتر در این ساعت رسیدید.",
        retryAfterSeconds: result.retryAfterSeconds
      });
    }
    next();
  };
}

module.exports = {
  chapterRateLimitMiddleware: chapterRateLimitMiddleware,
  checkAndRecordChapterRequest: checkAndRecordChapterRequest,
  checkAndRecordGuestChapterRequest: checkAndRecordGuestChapterRequest
};
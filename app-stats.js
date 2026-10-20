// app-stats.js
// آمار کاربران فعال اپ اندروید، بدون SDK و بدون سرویس خارجی.
// اپ روی هر درخواست API هدر X-App-Device (شناسه‌ی دستگاه) + X-App-Platform + X-App-Version-Code می‌فرسته.
// اینجا شناسه با نمک هش می‌شه (فقط ۱۶ کاراکتر هش ذخیره می‌شه) و هر دستگاه روزی یک‌بار شمرده می‌شه.
//
// متغیرهای محیطی:
//   APP_STATS_KEY   رمز طولانی برای دیدن آمار (اگه نباشه endpoint غیرفعال می‌شه)
//   APP_STATS_SALT  رشته‌ی تصادفی برای هش شناسه‌ها
//   APP_STATS_FILE  (اختیاری) مسیر فایل ذخیره؛ پیش‌فرض ./app-stats.json
//   APP_STATS_TZ    (اختیاری) منطقه‌ی زمانی برای تعیین «روز»؛ پیش‌فرض Asia/Tehran

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = process.env.APP_STATS_FILE || path.join(__dirname, "app-stats.json");
const TZ = process.env.APP_STATS_TZ || "Asia/Tehran";
const SALT = process.env.APP_STATS_SALT || "";
const KEY = process.env.APP_STATS_KEY || "";

const KEEP_DAYS = 120; // داده‌ی قدیمی‌تر پاک می‌شه
const MAX_DEVICES_PER_DAY = 300000; // سقف ایمنی در برابر هدر جعلی (جلوگیری از پر شدن رم)
const SAVE_DEBOUNCE_MS = 30 * 1000;
const HASH_LEN = 16;

if (!SALT) console.warn("[app-stats] APP_STATS_SALT تنظیم نشده؛ هش بدون نمک ضعیف‌تره. حتماً ست کن.");
if (!KEY) console.warn("[app-stats] APP_STATS_KEY تنظیم نشده؛ /api/app/stats غیرفعاله.");

// ساختار: { "2026-10-21": { "<hash16>": versionCode, ... }, ... }
let days = Object.create(null);

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.days && typeof raw.days === "object") {
      for (const [day, devs] of Object.entries(raw.days)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && devs && typeof devs === "object") {
          days[day] = Object.assign(Object.create(null), devs);
        }
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[app-stats] خواندن فایل ناموفق بود:", e.message);
  }
}
load();

// ---------- تاریخ ----------
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function dayKey(date = new Date()) {
  return dayFmt.format(date); // YYYY-MM-DD
}
function lastNDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) out.push(dayKey(new Date(now - i * 86400000)));
  return out; // اولین عنصر = امروز
}

// ---------- ذخیره‌سازی ----------
let dirty = false;
let timer = null;
let saving = false;

function prune() {
  const keep = new Set(lastNDays(KEEP_DAYS));
  for (const d of Object.keys(days)) if (!keep.has(d)) delete days[d];
}

function save() {
  if (!dirty || saving) return;
  saving = true;
  dirty = false;
  prune();
  const tmp = FILE + ".tmp";
  fs.writeFile(tmp, JSON.stringify({ days }), (err) => {
    if (err) {
      dirty = true;
      saving = false;
      console.error("[app-stats] ذخیره ناموفق:", err.message);
      return;
    }
    fs.rename(tmp, FILE, (err2) => {
      saving = false;
      if (err2) {
        dirty = true;
        console.error("[app-stats] rename ناموفق:", err2.message);
      }
    });
  });
}

function scheduleSave() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    save();
  }, SAVE_DEBOUNCE_MS);
  timer.unref();
}

function flushSync() {
  try {
    if (!dirty) return;
    prune();
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ days }));
    fs.renameSync(FILE + ".tmp", FILE);
    dirty = false;
  } catch (e) {
    console.error("[app-stats] flush ناموفق:", e.message);
  }
}
process.on("exit", flushSync);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    flushSync();
    process.exit(0);
  });
}

// ---------- ثبت ----------
function hashDevice(id) {
  return crypto.createHash("sha256").update(SALT + "|" + id).digest("hex").slice(0, HASH_LEN);
}

// شناسه‌ی معتبر: ANDROID_ID (۱۶ هگز) یا emu_<uuid>
const DEVICE_RE = /^[A-Za-z0-9_\-]{8,64}$/;

function track(req, res, next) {
  try {
    const dev = req.get("x-app-device");
    if (dev && req.method !== "OPTIONS" && DEVICE_RE.test(dev)) {
      const platform = (req.get("x-app-platform") || "").toLowerCase();
      if (platform === "android") {
        const today = dayKey();
        const bucket = days[today] || (days[today] = Object.create(null));
        const h = hashDevice(dev);
        const ver = parseInt(req.get("x-app-version-code"), 10);
        const v = Number.isFinite(ver) && ver > 0 && ver < 1e7 ? ver : 0;
        if (!(h in bucket)) {
          if (Object.keys(bucket).length < MAX_DEVICES_PER_DAY) {
            bucket[h] = v;
            scheduleSave();
          }
        } else if (v && bucket[h] !== v) {
          bucket[h] = v; // کاربر وسط روز آپدیت کرده
          scheduleSave();
        }
      }
    }
  } catch (e) {
    // آمار نباید هیچ‌وقت درخواست اصلی رو خراب کنه
    console.error("[app-stats] track error:", e.message);
  }
  next();
}

// ---------- گزارش ----------
function uniqueActive(dayList) {
  const set = new Set();
  for (const d of dayList) {
    const b = days[d];
    if (b) for (const h in b) set.add(h);
  }
  return set.size;
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// محدودیت ساده برای حدس زدن رمز: ۱۰ تلاش ناموفق در ۱۰ دقیقه برای هر IP
const fails = new Map();
function tooManyFails(ip) {
  const f = fails.get(ip);
  return f && f.until > Date.now() && f.n >= 10;
}
function noteFail(ip) {
  const now = Date.now();
  const f = fails.get(ip);
  if (!f || f.until <= now) fails.set(ip, { n: 1, until: now + 10 * 60 * 1000 });
  else f.n++;
  if (fails.size > 5000) fails.clear();
}

function statsEndpoint(req, res) {
  res.set("Cache-Control", "no-store");
  if (!KEY) return res.status(404).json({ error: "disabled" });
  if (tooManyFails(req.ip)) return res.status(429).json({ error: "too_many_attempts" });

  const given = req.get("x-stats-key") || "";
  if (!given || !safeEqual(given, KEY)) {
    noteFail(req.ip);
    return res.status(401).json({ error: "unauthorized" });
  }

  const list30 = lastNDays(30);
  const today = list30[0];

  const versionsToday = {};
  const bucket = days[today] || {};
  for (const h in bucket) {
    const v = String(bucket[h] || "unknown");
    versionsToday[v] = (versionsToday[v] || 0) + 1;
  }

  const perDay = list30
    .slice()
    .reverse()
    .map((d) => ({ date: d, active: days[d] ? Object.keys(days[d]).length : 0 }));

  res.json({
    timezone: TZ,
    today: Object.keys(bucket).length,
    last7days: uniqueActive(list30.slice(0, 7)),
    last30days: uniqueActive(list30),
    versionsToday,
    perDay,
  });
}

module.exports = { track, statsEndpoint };

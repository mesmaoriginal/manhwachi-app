// lib/vipConfig.js
// تنظیمات قابل‌ویرایش بخش عضویت (VIP): قیمت/متن پلن‌ها + باز/بسته بودن کل بخش.
// - ذخیره‌سازی: یک فایل JSON روی دیسک (data/vip-config.json یا مسیر VIP_CONFIG_PATH) - بدون وابستگی به Supabase/SQLite
// - مسیر عمومی (سایت و اپ):   GET  /api/vip/config
// - صفحه‌ی مدیریت:            GET  /vip-admin
// - API مدیریت (نیاز به کلید): GET/PUT /api/vip-admin/config   (هدر x-vip-admin-key = مقدار VIP_ADMIN_KEY)
// قیمت‌ها در پنل و فایل به «تومان» ذخیره می‌شن؛ مبلغ ارسالی به زیبال (ریال) = تومان × ۱۰ و فقط سمت سرور محاسبه می‌شه.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const FILE = process.env.VIP_CONFIG_PATH || path.join(__dirname, "..", "data", "vip-config.json");
const PAGE = path.join(__dirname, "..", "admin", "vip-admin.html");

const DEFAULT_CLOSED_MESSAGE = "فروش اشتراک VIP فعلاً بسته است. به‌زودی دوباره باز می‌شود.";

// مقدارهای پیش‌فرض = همان قیمت‌ها و متن‌هایی که قبلاً داخل vip.html / VipActivity.kt / server.js ثابت بودند
const DEFAULTS = {
  rev: 1,
  updatedAt: null,
  enabled: true,
  closedMessage: DEFAULT_CLOSED_MESSAGE,
  promo: { enabled: true, text: "۵۰٪ تخفیف ویژه روی پلن‌های ماهانه و سه‌ماهه" },
  plans: [
    {
      key: "weekly", enabled: true, hero: false,
      title: "اشتراک هفتگی", sub: "مناسب برای تست و مطالعه کوتاه‌مدت",
      price: 25000, oldPrice: null, chip: "", badge: "",
      features: ["دسترسی کامل به چپترهای VIP", "بدون تبلیغات مزاحم", "پشتیبانی سریع"],
      buyLabel: "خرید پلن هفتگی", days: 7, months: 0,
    },
    {
      key: "monthly", enabled: true, hero: true,
      title: "اشتراک ماهانه", sub: "صرفه‌جویی در هزینه مطالعه",
      price: 55000, oldPrice: 110000, chip: "۵۰٪ تخفیف محدود", badge: "محبوب‌ترین",
      features: ["دسترسی کامل به چپترهای VIP", "سرور دانلود و مشاهده اختصاصی", "نشان اختصاصی 👑 VIP در پروفایل"],
      buyLabel: "خرید پلن ماهانه", days: 0, months: 1,
    },
    {
      key: "quarterly", enabled: true, hero: false,
      title: "اشتراک سه‌ماهه", sub: "برای خوره مانهواها و خوانندگان حرفه‌ای",
      price: 150000, oldPrice: 300000, chip: "بیشترین صرفه‌جویی", badge: "",
      features: ["تمامی امکانات پلن‌های قبلی", "بیشترین میزان تخفیف"],
      buyLabel: "خرید پلن سه‌ماهه", days: 0, months: 3,
    },
  ],
};

// ───────────────────────── اعتبارسنجی ─────────────────────────

class ValidationError extends Error {}

function str(v, max, label, { required = false } = {}) {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  if (required && !s) throw new ValidationError(`${label} نباید خالی باشد.`);
  if (s.length > max) throw new ValidationError(`${label} حداکثر ${max} کاراکتر می‌تواند باشد.`);
  return s;
}

function intIn(v, min, max, label) {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,٬\s]/g, ""));
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label} باید عدد صحیح بین ${min.toLocaleString("en-US")} و ${max.toLocaleString("en-US")} باشد.`);
  }
  return n;
}

function sanitizePlan(p, i) {
  const n = i + 1;
  if (!p || typeof p !== "object") throw new ValidationError(`پلن ${n} نامعتبر است.`);
  const key = str(p.key, 24, `کلید پلن ${n}`, { required: true });
  if (!/^[a-z][a-z0-9_]{1,23}$/.test(key)) {
    throw new ValidationError(`کلید پلن ${n} فقط می‌تواند حروف کوچک انگلیسی، عدد و _ باشد (مثلاً yearly).`);
  }
  const title = str(p.title, 60, `عنوان پلن ${n}`, { required: true });
  const features = (Array.isArray(p.features) ? p.features : [])
    .map((f) => str(f, 100, `ویژگی پلن ${n}`))
    .filter(Boolean);
  if (features.length > 8) throw new ValidationError(`پلن ${n} حداکثر ۸ ویژگی می‌تواند داشته باشد.`);

  const price = intIn(p.price, 1000, 100000000, `قیمت پلن ${n} (تومان)`);
  const hasOld = p.oldPrice !== null && p.oldPrice !== undefined && String(p.oldPrice).trim() !== "" && Number(p.oldPrice) !== 0;
  const oldPrice = hasOld ? intIn(p.oldPrice, 1000, 100000000, `قیمت قبل از تخفیف پلن ${n}`) : null;

  const days = intIn(p.days ?? 0, 0, 3650, `تعداد روز پلن ${n}`);
  const months = intIn(p.months ?? 0, 0, 120, `تعداد ماه پلن ${n}`);
  if (days === 0 && months === 0) throw new ValidationError(`مدت پلن ${n} نباید صفر باشد.`);

  return {
    key,
    enabled: !!p.enabled,
    hero: !!p.hero,
    title,
    sub: str(p.sub, 120, `توضیح پلن ${n}`),
    price,
    oldPrice,
    chip: str(p.chip, 40, `برچسب پلن ${n}`),
    badge: str(p.badge, 30, `نشان پلن ${n}`),
    features,
    buyLabel: str(p.buyLabel, 40, `متن دکمه‌ی پلن ${n}`) || `خرید ${title}`,
    days,
    months,
  };
}

function sanitizeConfig(input, current) {
  if (!input || typeof input !== "object") throw new ValidationError("بدنه‌ی درخواست نامعتبر است.");
  const rawPlans = Array.isArray(input.plans) ? input.plans : [];
  if (rawPlans.length < 1 || rawPlans.length > 8) throw new ValidationError("تعداد پلن‌ها باید بین ۱ تا ۸ باشد.");
  const plans = rawPlans.map(sanitizePlan);

  const seen = new Set();
  for (const p of plans) {
    if (seen.has(p.key)) throw new ValidationError(`کلید «${p.key}» تکراری است.`);
    seen.add(p.key);
  }
  // پلنی که قبلاً ساخته شده حذف نمی‌شه (فقط غیرفعال) تا پرداخت‌های pending قدیمی هنوز بتونن شارژ بشن
  for (const old of current.plans) {
    if (!seen.has(old.key)) {
      throw new ValidationError(`پلن «${old.key}» را نمی‌توان حذف کرد؛ به‌جای حذف آن را غیرفعال کنید.`);
    }
  }
  return {
    enabled: !!input.enabled,
    closedMessage: str(input.closedMessage, 300, "پیام بسته بودن") || DEFAULT_CLOSED_MESSAGE,
    promo: {
      enabled: !!(input.promo && input.promo.enabled),
      text: str(input.promo && input.promo.text, 120, "متن بنر تخفیف"),
    },
    plans,
  };
}

// ───────────────────────── ذخیره / خواندن ─────────────────────────

let cache = null; // { cfg, mtimeMs, checkedAt }

function readFromDisk() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    const cfg = {
      rev: Number.isInteger(parsed.rev) ? parsed.rev : 1,
      updatedAt: parsed.updatedAt || null,
      ...sanitizeConfig(parsed, DEFAULTS),
    };
    return cfg;
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[vipConfig] خواندن/اعتبارسنجی فایل تنظیمات ناموفق بود؛ از پیش‌فرض استفاده می‌شود:", e.message);
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

// کش حافظه‌ای با چک mtime (حداکثر ثانیه‌ای یک‌بار) - اگه چند پروسه‌ی Node بالا باشه هم تغییر همه‌جا می‌رسه
function getConfig() {
  const now = Date.now();
  if (cache && now - cache.checkedAt < 1000) return cache.cfg;
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(FILE).mtimeMs; } catch { /* فایل هنوز ساخته نشده */ }
  if (!cache || cache.mtimeMs !== mtimeMs) {
    cache = { cfg: readFromDisk(), mtimeMs, checkedAt: now };
  } else {
    cache.checkedAt = now;
  }
  return cache.cfg;
}

function saveConfig(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, FILE); // نوشتن اتمیک؛ نیمه‌کاره خوانده نمی‌شه
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(FILE).mtimeMs; } catch {}
  cache = { cfg: next, mtimeMs, checkedAt: Date.now() };
}

// ───────────────────────── استفاده در خرید ─────────────────────────

/** برای /purchase/request: فقط پلن فعال. برای تایید پرداخت: includeDisabled تا پرداخت‌های pending قدیمی هم شارژ بشن. */
function getPlan(key, { includeDisabled = false } = {}) {
  const cfg = getConfig();
  if (typeof key !== "string") return null;
  const p = cfg.plans.find((x) => x.key === key);
  if (!p) return null;
  if (!includeDisabled && !p.enabled) return null;
  return {
    key: p.key,
    amount: p.price * 10, // تومان → ریال (زیبال)
    days: p.days || 0,
    months: p.months || 0,
  };
}

function isOpen() {
  return getConfig().enabled;
}

function closedMessage() {
  return getConfig().closedMessage;
}

/** نمای عمومی برای سایت و اپ. وقتی بخش بسته است، لیست پلن‌ها خالی برمی‌گردد. */
function publicView() {
  const cfg = getConfig();
  const open = cfg.enabled;
  return {
    enabled: open,
    closedMessage: cfg.closedMessage,
    promo: open && cfg.promo.enabled && cfg.promo.text ? cfg.promo.text : null,
    plans: open
      ? cfg.plans.filter((p) => p.enabled).map((p) => ({
          key: p.key, title: p.title, sub: p.sub, price: p.price, oldPrice: p.oldPrice,
          chip: p.chip || null, badge: p.badge || null, features: p.features,
          buyLabel: p.buyLabel, hero: p.hero,
        }))
      : [],
    updatedAt: cfg.updatedAt,
  };
}

// ───────────────────────── مسیرها ─────────────────────────

// قفل موقت بعد از چند کلید اشتباه (به‌ازای IP) - برای جلوگیری از حدس زدن کلید
const FAIL_MAX = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> { count, resetAt }

function sha(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

function adminAuth(req, res, next) {
  const secret = process.env.VIP_ADMIN_KEY;
  if (!secret || secret.length < 12) {
    return res.status(503).json({ message: "VIP_ADMIN_KEY روی سرور تنظیم نشده (حداقل ۱۲ کاراکتر)." });
  }
  const ip = req.ip;
  const now = Date.now();
  const f = fails.get(ip);
  if (f && f.resetAt > now && f.count >= FAIL_MAX) {
    res.setHeader("Retry-After", String(Math.ceil((f.resetAt - now) / 1000)));
    return res.status(429).json({ message: "تلاش‌های ناموفق زیاد بود. کمی بعد دوباره امتحان کنید." });
  }
  const provided = req.headers["x-vip-admin-key"];
  const ok = typeof provided === "string" && crypto.timingSafeEqual(sha(provided), sha(secret));
  if (!ok) {
    const cur = f && f.resetAt > now ? f : { count: 0, resetAt: now + FAIL_WINDOW_MS };
    cur.count += 1;
    fails.set(ip, cur);
    return res.status(401).json({ message: "کلید مدیریت نادرست است." });
  }
  fails.delete(ip);
  next();
}

function createRouter() {
  const router = express.Router();

  // عمومی - همیشه تازه (بدون کش) تا تغییر پنل فوراً اعمال بشه
  router.get("/api/vip/config", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(publicView());
  });

  router.get("/vip-admin", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(PAGE);
  });

  router.get("/api/vip-admin/config", adminAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getConfig());
  });

  router.put("/api/vip-admin/config", adminAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const current = getConfig();
      const baseRev = req.body && req.body.rev;
      if (baseRev !== current.rev) {
        return res.status(409).json({ message: "این تنظیمات در این فاصله جای دیگری تغییر کرده. صفحه را رفرش کنید.", config: current });
      }
      const clean = sanitizeConfig(req.body, current);
      const next = { rev: current.rev + 1, updatedAt: new Date().toISOString(), ...clean };
      saveConfig(next);
      console.log(`[vipConfig] تنظیمات به‌روز شد (rev ${next.rev}) enabled=${next.enabled}`);
      res.json(next);
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ message: e.message });
      console.error("[vipConfig] ذخیره ناموفق بود:", e);
      res.status(500).json({ message: "ذخیره‌ی تنظیمات روی سرور ناموفق بود." });
    }
  });

  return router;
}

module.exports = { createRouter, adminAuth, getConfig, getPlan, isOpen, closedMessage, publicView };

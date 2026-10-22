// lib/careersConfig.js
// باز/بسته بودن ثبت‌نام همکاری (Careers.html سایت + CareersActivity اپ) از سرور.
// - ذخیره: data/careers-config.json (یا CAREERS_CONFIG_PATH)
// - عمومی:  GET /api/careers/config
// - مدیریت: GET/PUT /api/careers-admin/config (همان کلید VIP_ADMIN_KEY؛ از همان صفحه‌ی /vip-admin)
// - گارد ثبت‌نام: POST /rest/v1/applications وقتی بخش/نقش بسته است رد می‌شود (CAREERS_CLOSED)
// هر «نقش» یک کارت در Careers.html است: متن کارت (عنوان، توضیح، برچسب، آیکون، حقوق) و باز/بسته بودن
// هر دو اینجا ذخیره می‌شوند و از پنل /vip-admin (تب «ثبت‌نام همکاری») قابل ویرایش‌اند؛ کارت جدید هم از همان‌جا ساخته می‌شود.
// نقش‌ها حذف نمی‌شوند (مثل پلن‌ها)؛ برای برداشتن از سایت، «نمایش در سایت» را خاموش کنید.
// اپ اندروید فقط فیلد roles (نقشه‌ی key → باز/بسته) را می‌خواند؛ نقش‌های جدید در اپ نمایش داده نمی‌شوند.

const fs = require("fs");
const path = require("path");
const express = require("express");

const FILE = process.env.CAREERS_CONFIG_PATH || path.join(__dirname, "..", "data", "careers-config.json");
const DEFAULT_MESSAGE = "ثبت‌نام همکاری فعلاً بسته است. به‌زودی دوباره باز می‌شود.";

// پیش‌فرض = وضعیت فعلی Careers.html سایت (همه‌ی نقش‌ها بسته). بعد از اولین دیپلوی از پنل باز کن.
const DEFAULTS = {
  rev: 1,
  updatedAt: null,
  enabled: true,
  closedMessage: DEFAULT_MESSAGE,
  roles: [
    {
      key: "تایپیست", open: false, visible: true,
      title: "تایپیست (ادیتور)", badge: "آموزش رایگان", icon: "fa-solid fa-laptop-code",
      desc: "فرقی نمی‌کنه حرفه‌ای هستی یا کاملاً مبتدی؛ خیلی راحت می‌تونی بیای تو تیم ما. صفر تا صد ادیت و ادیتور شدن رو خودمون بهت یاد می‌دیم!",
      salary: "حقوق: ۲۰ تا ۲۵ هزار تومن به ازای هر چپتر",
    },
    {
      key: "مترجم", open: false, visible: true,
      title: "مترجم", badge: "نیازمند تسلط به زبان", icon: "fa-solid fa-language",
      desc: "اگه به انگلیسی مسلطی و عاشق مانهوایی، بیا مترجم تیم ما شو و متن‌ها رو روون و بی‌نقص به فارسی ترجمه کن.",
      salary: "حقوق: ۱۵ هزار تومن به ازای هر چپتر",
    },
    {
      key: "کلینر", open: false, visible: true,
      title: "کلینر", badge: "آموزش رایگان", icon: "fa-solid fa-eraser",
      desc: "کار شما پاک‌سازی و آماده‌سازی صفحات خام مانهواست؛ حذف متن اصلی و تمیزکاری تصاویر قبل از تایپ. اگر بهش علاقه داری، جای تو همینجاست.",
      salary: "",
    },
    {
      key: "تیم ترجمه تلگرامی", open: false, visible: true,
      title: "تیم‌های ترجمه تلگرام", badge: "همکاری با کانال‌ها", icon: "fa-solid fa-rocket",
      desc: "اگر کانال تلگرام دارید مانهوا های ترجمه‌شده خودتون رو توی مانهواچی با نام و لینک مستقیم کانال خودتون قرار می‌دیم تا دیده‌ بشن و ممبرهای کانالتون چند برابر بشه.",
      salary: "",
    },
  ],
};

const ICON_RE = /^fa-(solid|regular|brands) fa-[a-z0-9-]{1,40}$/;
const DEFAULT_ICON = "fa-solid fa-user";

function text(v, max, label) {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max) throw new ValidationError(`${label} حداکثر ${max} کاراکتر می‌تواند باشد.`);
  return s;
}

class ValidationError extends Error {}

function sanitize(input, current) {
  if (!input || typeof input !== "object") throw new ValidationError("بدنه‌ی درخواست نامعتبر است.");
  const msg = typeof input.closedMessage === "string" ? input.closedMessage.trim() : "";
  if (msg.length > 300) throw new ValidationError("پیام بسته بودن حداکثر ۳۰۰ کاراکتر می‌تواند باشد.");
  const raw = Array.isArray(input.roles) ? input.roles : [];
  if (raw.length < 1 || raw.length > 30) throw new ValidationError("لیست نقش‌ها نامعتبر است.");
  const seen = new Set();
  const roles = raw.map((r, i) => {
    const key = r && typeof r.key === "string" ? r.key.trim() : "";
    if (!key || key.length > 60) throw new ValidationError(`نقش ${i + 1} نامعتبر است.`);
    if (seen.has(key)) throw new ValidationError(`نقش «${key}» تکراری است.`);
    seen.add(key);
    // فیلدهایی که ارسال نشده (مثلاً فایل قدیمی روی دیسک) از پیش‌فرض همان نقش پر می‌شوند؛ رشته‌ی خالی یعنی عمداً خالی.
    const def = DEFAULTS.roles.find((d) => d.key === key) || {};
    const pick = (field, fallback) => (r[field] == null ? fallback : r[field]);
    const title = text(pick("title", def.title || key), 60, `عنوان نقش ${i + 1}`) || key;
    const icon = text(pick("icon", def.icon || DEFAULT_ICON), 60, `آیکون نقش ${i + 1}`) || DEFAULT_ICON;
    if (!ICON_RE.test(icon)) {
      throw new ValidationError(`آیکون نقش «${key}» باید مثل «fa-solid fa-pen-nib» باشد (فقط حروف کوچک انگلیسی، عدد و -).`);
    }
    return {
      key,
      open: !!r.open,
      visible: r.visible == null ? true : !!r.visible,
      title,
      badge: text(pick("badge", def.badge || ""), 40, `برچسب نقش «${key}»`),
      icon,
      desc: text(pick("desc", def.desc || ""), 400, `توضیح نقش «${key}»`),
      salary: text(pick("salary", def.salary || ""), 80, `سطر حقوق نقش «${key}»`),
    };
  });
  // نقشی که قبلاً ساخته شده حذف نمی‌شود (فقط بسته/مخفی)؛ وگرنه ثبت‌نام آن نقش از گارد رد نمی‌شد
  if (current) {
    for (const old of current.roles) {
      if (!seen.has(old.key)) throw new ValidationError(`نقش «${old.key}» را نمی‌توان حذف کرد؛ به‌جای حذف، «نمایش در سایت» را خاموش کنید.`);
    }
  }
  return { enabled: !!input.enabled, closedMessage: msg || DEFAULT_MESSAGE, roles };
}

let cache = null;

function readDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { rev: Number.isInteger(parsed.rev) ? parsed.rev : 1, updatedAt: parsed.updatedAt || null, ...sanitize(parsed) };
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[careersConfig] فایل تنظیمات خراب است؛ پیش‌فرض استفاده می‌شود:", e.message);
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function getConfig() {
  const now = Date.now();
  if (cache && now - cache.checkedAt < 1000) return cache.cfg;
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(FILE).mtimeMs; } catch {}
  if (!cache || cache.mtimeMs !== mtimeMs) cache = { cfg: readDisk(), mtimeMs, checkedAt: now };
  else cache.checkedAt = now;
  return cache.cfg;
}

function save(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(FILE).mtimeMs; } catch {}
  cache = { cfg: next, mtimeMs, checkedAt: Date.now() };
}

/** نقش مشخص باز است؟ (کل بخش باید باز باشد؛ نقش ناشناخته = تابع وضعیت کلی) */
function isRoleOpen(key) {
  const cfg = getConfig();
  if (!cfg.enabled) return false;
  const r = cfg.roles.find((x) => x.key === key);
  return r ? r.open && r.visible : true;
}

function publicView() {
  const cfg = getConfig();
  const roles = {};
  for (const r of cfg.roles) roles[r.key] = cfg.enabled && r.open && r.visible;
  // cards: فقط برای سایت (Careers.html). اپ اندروید همچنان فقط enabled/closedMessage/roles را می‌خواند.
  const cards = cfg.roles.filter((r) => r.visible).map((r) => ({
    key: r.key, title: r.title, badge: r.badge, icon: r.icon, desc: r.desc, salary: r.salary,
    open: cfg.enabled && r.open,
  }));
  return { enabled: cfg.enabled, closedMessage: cfg.closedMessage, roles, cards, updatedAt: cfg.updatedAt };
}

/**
 * گارد ثبت‌نام: روی POST /rest/v1/applications سوار می‌شود (قبل از localdb).
 * بدنه را خودش می‌خواند چون /rest/v1 قبل از express.json سراسری سوار می‌شود.
 * توجه: فقط وقتی اثر دارد که ثبت‌نام سایت/اپ از همین سرور (LOCAL_DB=1 → /rest/v1) رد شود.
 */
function applicationsGuard() {
  const parse = express.json({ limit: "20kb" });
  return [
    parse,
    (req, res, next) => {
      const body = req.body;
      const rows = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
      const cfg = getConfig();
      const blocked = !cfg.enabled || rows.some((r) => r && typeof r.role === "string" && !isRoleOpen(r.role.trim()));
      if (blocked) {
        return res.status(403).json({
          message: cfg.enabled ? "ثبت‌نام این بخش فعلاً بسته است." : cfg.closedMessage,
          code: "CAREERS_CLOSED",
        });
      }
      next();
    },
  ];
}

function createRouter({ adminAuth }) {
  const router = express.Router();

  router.get("/api/careers/config", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(publicView());
  });

  router.get("/api/careers-admin/config", adminAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getConfig());
  });

  router.put("/api/careers-admin/config", adminAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const current = getConfig();
      if (!req.body || req.body.rev !== current.rev) {
        return res.status(409).json({ message: "این تنظیمات در این فاصله جای دیگری تغییر کرده. صفحه را رفرش کنید.", config: current });
      }
      const next = { rev: current.rev + 1, updatedAt: new Date().toISOString(), ...sanitize(req.body, current) };
      save(next);
      console.log(`[careersConfig] به‌روز شد (rev ${next.rev}) enabled=${next.enabled}`);
      res.json(next);
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ message: e.message });
      console.error("[careersConfig] ذخیره ناموفق:", e);
      res.status(500).json({ message: "ذخیره‌ی تنظیمات روی سرور ناموفق بود." });
    }
  });

  return router;
}

module.exports = { createRouter, applicationsGuard, getConfig, isRoleOpen, publicView };

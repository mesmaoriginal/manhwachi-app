// blog/blogAuth.js
// احراز هویت و دسترسی کارکنان وبلاگ - کاملاً مستقل از /admin (Basic Auth) و از کاربران سایت.
//
// - رمز: scrypt با salt تصادفی
// - نشست: کوکی HttpOnly امضاشده با HMAC (BLOG_SESSION_SECRET، حداقل ۳۲ کاراکتر)
// - هر درخواست وضعیت کاربر رو (با کش ۳۰ ثانیه‌ای) از دیتابیس چک می‌کنه، پس
//   غیرفعال کردن یک نفر حداکثر بعد از ۳۰ ثانیه اعمال می‌شه
// - ضد CSRF: SameSite=Strict + الزام هدر سفارشی روی درخواست‌های غیر GET

const crypto = require("crypto");
const { promisify } = require("util");
const { sb, enc } = require("./blogDb");

const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = "blog_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // ۱۲ ساعت
const STAFF_CACHE_TTL_MS = 30 * 1000;

// ---------- نقش‌ها و مجوزها ----------
const ROLE_PERMS = {
  admin: ["posts.write.all", "posts.publish", "pages.write.all", "taxonomy.manage", "staff.manage", "media.upload", "support.reply"],
  editor: ["posts.write.all", "posts.publish", "pages.write.all", "taxonomy.manage", "media.upload"],
  author: ["posts.write.own", "pages.write.own", "media.upload"],
  support: ["support.reply"],
};

function can(staff, perm) {
  if (!staff || !staff.is_active) return false;
  if (perm === "posts.publish" && staff.role === "author") return !!staff.can_publish;
  return (ROLE_PERMS[staff.role] || []).includes(perm);
}

function permsOf(staff) {
  const all = new Set(ROLE_PERMS[staff.role] || []);
  if (staff.role === "author" && staff.can_publish) all.add("posts.publish");
  return [...all];
}

// ---------- رمز عبور ----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(String(password), salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// هش ساختگی برای یکسان نگه داشتن زمان پاسخ وقتی username وجود نداره
const DUMMY_HASH_PROMISE = hashPassword("dummy-password-for-timing");

// ---------- نشست ----------
function secret() {
  const s = process.env.BLOG_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("BLOG_SESSION_SECRET باید حداقل ۳۲ کاراکتر باشد");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function createSessionToken(staffId, version) {
  const payload = `${staffId}.${Number(version) || 0}.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  const expected = sign(`${id}.${ver}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!(Number(exp) > Date.now())) return null;
  return { id, ver: Number(ver) };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(raw);
    } catch {
      out[part.slice(0, i).trim()] = raw; // کوکی خراب: بدون decode (توکن معتبر نمی‌شه و 401 می‌گیره، نه 500)
    }
  }
  return out;
}

const isHttps = (req) => req.secure || String(req.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";

function setSessionCookie(req, res, token) {
  const flags = ["Path=/panel", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (isHttps(req)) flags.push("Secure");
  res.append("Set-Cookie", `${COOKIE_NAME}=${token}; ${flags.join("; ")}`);
}

function clearSessionCookie(req, res) {
  const flags = ["Path=/panel", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isHttps(req)) flags.push("Secure");
  res.append("Set-Cookie", `${COOKIE_NAME}=; ${flags.join("; ")}`);
}

// ---------- لینک پیش‌نمایش پیش‌نویس ----------
// بدون ستون اضافه در دیتابیس: توکن = HMAC(نوع|شناسه|انقضا). هر کس لینک را داشته باشد تا ۷ روز می‌تواند
// پیش‌نویس را (با noindex) ببیند؛ برای دادن به نویسنده/ویراستار/مشتری قبل از انتشار.
const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function previewSig(kind, id, exp) {
  return sign(`preview|${kind}|${id}|${exp}`);
}

function makePreviewPath(kind, id) {
  const exp = Date.now() + PREVIEW_TTL_MS;
  return `/blog/preview/${kind}/${id}/${exp}/${previewSig(kind, id, exp)}`;
}

function verifyPreview(kind, id, exp, sig) {
  if (!["posts", "pages"].includes(kind) || !(Number(exp) > Date.now())) return false;
  const a = Buffer.from(String(sig || ""));
  const b = Buffer.from(previewSig(kind, id, exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- کش کارکنان ----------
const staffCache = new Map(); // id -> { staff, expiresAt }

function invalidateStaff(id) {
  staffCache.delete(id);
}

async function loadStaff(id) {
  const hit = staffCache.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.staff;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sb(
    `blog_staff?id=eq.${enc(id)}&select=id,username,display_name,role,can_publish,is_active,session_version&limit=1`
  );
  const staff = Array.isArray(rows) && rows[0] ? rows[0] : null;
  staffCache.set(id, { staff, expiresAt: Date.now() + STAFF_CACHE_TTL_MS });
  while (staffCache.size > 500) staffCache.delete(staffCache.keys().next().value);
  return staff;
}

// ---------- میان‌افزارها ----------
async function requireStaff(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const session = verifySessionToken(token);
    if (!session) return res.status(401).json({ error: "نیاز به ورود دارید" });
    const staff = await loadStaff(session.id);
    if (!staff || !staff.is_active || staff.session_version !== session.ver) {
      clearSessionCookie(req, res);
      return res.status(401).json({ error: "حساب شما غیرفعال است یا نشست منقضی شده" });
    }
    req.staff = staff;
    next();
  } catch (e) {
    console.error("[blog] requireStaff:", e.message);
    res.status(500).json({ error: "خطای داخلی" });
  }
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req.staff, perm)) return res.status(403).json({ error: "دسترسی کافی ندارید" });
    next();
  };
}

// درخواست‌های تغییردهنده فقط وقتی پذیرفته می‌شن که هدر سفارشی داشته باشن؛
// فرم/درخواست cross-site نمی‌تونه این هدر رو بفرسته.
function csrfGuard(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.get("x-blog-panel") !== "1") return res.status(403).json({ error: "درخواست نامعتبر" });
  next();
}

// ---------- محدودیت تلاش ورود ----------
// دو سطح: هر (IP+نام‌کاربری) حداکثر ۵ شکست، و هر IP در کل حداکثر ۴۰ شکست در ۱۵ دقیقه
// (جلوگیری از چرخاندن نام‌کاربری‌ها برای فشار آوردن به scrypt).
// توجه: برای درست کار کردن، پشت پروکسی باید app.set("trust proxy", ...) تنظیم باشد؛
// وگرنه req.ip همان IP پروکسی است و همه یک سطل مشترک دارند.
const loginAttempts = new Map(); // key -> { count, resetAt }
const MAX_ATTEMPTS = 5;
const MAX_IP_ATTEMPTS = 40;
const WINDOW_MS = 15 * 60 * 1000;

const userKey = (ip, username) => `${ip}|${username}`;
const ipKey = (ip) => `${ip}|*`;

function isOver(key, max) {
  const e = loginAttempts.get(key);
  return !!e && e.resetAt > Date.now() && e.count >= max;
}

function hit(key) {
  const now = Date.now();
  const e = loginAttempts.get(key);
  if (!e || e.resetAt <= now) loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else e.count++;
  while (loginAttempts.size > 5000) loginAttempts.delete(loginAttempts.keys().next().value);
}

function isLoginBlocked(ip, username) {
  return isOver(userKey(ip, username), MAX_ATTEMPTS) || isOver(ipKey(ip), MAX_IP_ATTEMPTS);
}

function recordLoginFailure(ip, username) {
  hit(userKey(ip, username));
  hit(ipKey(ip));
}

function clearLoginFailures(ip, username) {
  loginAttempts.delete(userKey(ip, username));
}

module.exports = {
  ROLE_PERMS,
  can,
  permsOf,
  hashPassword,
  verifyPassword,
  DUMMY_HASH_PROMISE,
  createSessionToken,
  makePreviewPath,
  verifyPreview,
  verifySessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  invalidateStaff,
  requireStaff,
  requirePerm,
  csrfGuard,
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
};

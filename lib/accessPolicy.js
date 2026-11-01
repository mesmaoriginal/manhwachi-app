// lib/accessPolicy.js
//
// تنها جایی که «قانون دسترسی» مانهواچی تعریف شده. هیچ I/O ندارد (فقط توابع خالص) تا هم سرور،
// هم دانلود آفلاین، هم API وضعیت از یک منبع واحد استفاده کنند.
//
// ── انواع اشتراک ───────────────────────────────────────────────
//   استاندارد: ۱ هفته | ۱ ماه | ۳ ماه
//   پرمیوم:    ۱ ماه   | ۳ ماه
//
// ── فصل‌های رایگان (episode.free = true) ────────────────────────
//   بدون اشتراک (حتی مهمان) → ۲۴ ساعت اول بعد از انتشار قفل
//   هر اشتراکی (استاندارد/پرمیوم) → کاملاً باز
//
// ── فصل‌های اشتراکی (episode.free = false) ──────────────────────
//   بدون اشتراک → همیشه بسته (باید اشتراک بخرد)
//   استاندارد ۱ هفته‌ای → ۱ روز اول قفل  (plan.lockDays = 1)
//   بقیه (استاندارد ۱/۳ ماهه + همه‌ی پرمیوم‌ها) → کاملاً باز (plan.lockDays = 0)
//
// ── امکانات فقط پرمیوم ──────────────────────────────────────────
//   دانلود آفلاین، درخواست مانهوا
//   (پشتیبانی/تیکت برای همه‌ی کاربران لاگین‌شده است)

const HOUR_MS = 3600 * 1000;
const FREE_CHAPTER_LOCK_HOURS = Number(process.env.FREE_CHAPTER_LOCK_HOURS) > 0
  ? Number(process.env.FREE_CHAPTER_LOCK_HOURS)
  : 24;

const TIERS = Object.freeze({ NONE: "none", STANDARD: "standard", PREMIUM: "premium" });

const NO_SUB = Object.freeze({
  active: false,
  tier: TIERS.NONE,
  planKey: null,
  isPremium: false,
  lockMs: 0, // مدتی که فصل‌های اشتراکیِ تازه برای این اشتراک قفل می‌مانند
  until: null,
  canOffline: false,
  canRequestManhwa: false,
});

function normTier(t) {
  return t === TIERS.PREMIUM ? TIERS.PREMIUM : TIERS.STANDARD;
}

/**
 * وضعیت اشتراک یک کاربر را از روی ردیف profiles و پلن‌های تنظیم‌شده می‌سازد.
 * @param {object|null} prof   { is_vip, vip_until, vip_tier, vip_plan_key }
 * @param {(key:string)=>({tier?:string,lockDays?:number}|null)} planLookup
 */
function resolveSubscription(prof, planLookup, now = Date.now()) {
  if (!prof || !prof.is_vip) return NO_SUB;
  const untilMs = prof.vip_until ? new Date(prof.vip_until).getTime() : null;
  if (untilMs !== null && !(Number.isFinite(untilMs) && untilMs > now)) return NO_SUB;

  const planKey = prof.vip_plan_key || null;
  const plan = planKey && typeof planLookup === "function" ? planLookup(planKey) : null;

  // کاربران قدیمی (قبل از این سیستم) پلن ثبت‌شده ندارند → استاندارد و کاملاً باز (بدون قفل).
  const tier = normTier(prof.vip_tier || (plan && plan.tier));
  const isPremium = tier === TIERS.PREMIUM;
  const lockDays = isPremium ? 0 : Math.max(0, Number(plan && plan.lockDays) || 0);

  return {
    active: true,
    tier,
    planKey,
    isPremium,
    lockMs: lockDays * 24 * HOUR_MS,
    until: untilMs,
    canOffline: isPremium,
    canRequestManhwa: isPremium,
  };
}

/** رتبه‌ی یک اشتراک برای قانون «ارتقا»: 0 هیچ | 1 استاندارد قفل‌دار | 2 استاندارد باز | 3 پرمیوم */
function rankOfSub(sub) {
  if (!sub || !sub.active) return 0;
  if (sub.isPremium) return 3;
  return sub.lockMs > 0 ? 1 : 2;
}
function rankOfPlan(plan) {
  if (!plan) return 0;
  if (normTier(plan.tier) === TIERS.PREMIUM) return 3;
  return (Number(plan.lockDays) || 0) > 0 ? 1 : 2;
}

/**
 * وقتی کاربر اشتراک جدیدی می‌خرد، «نوع/پلن» ذخیره‌شده در پروفایل چه شود؟
 * - اگر پلن جدید هم‌رتبه یا بالاتر است → همان پلن جدید
 * - اگر پایین‌تر است (مثلاً پرمیوم دارد و هفتگی می‌خرد) → همان قبلی می‌ماند و فقط زمان اضافه می‌شود
 */
function stackedPlan(currentSub, newPlan) {
  if (currentSub && currentSub.active && rankOfSub(currentSub) > rankOfPlan(newPlan)) {
    return { tier: currentSub.tier, planKey: currentSub.planKey };
  }
  return { tier: normTier(newPlan.tier), planKey: newPlan.key };
}

// ───────────────────────── زمان انتشار چپتر ─────────────────────────

function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm;
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [gy, gm, gd];
}

const TEHRAN_OFFSET_MS = 3.5 * HOUR_MS; // ایران ساعت تابستانی ندارد (UTC+3:30 ثابت)

/** «۱۴۰۵/۰۸/۰۹» (فارسی/عربی/لاتین) → میلی‌ثانیه‌ی شروع آن روز به وقت تهران؛ نامعتبر → null */
function parseJalaliDateMs(str) {
  if (!str) return null;
  const latin = String(str)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = latin.match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (jy < 1300 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return Date.UTC(gy, gm - 1, gd) - TEHRAN_OFFSET_MS;
}

/** اگر ادمین/پنل فیلد دقیق انتشار گذاشته باشد (published_at / released_at) همان استفاده می‌شود. */
function explicitReleaseMs(ep) {
  const v = ep && (ep.published_at ?? ep.released_at ?? ep.publishedAt ?? ep.releasedAt);
  if (v === undefined || v === null || v === "") return null;
  const ms = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ───────────────────────── تصمیم نهایی دسترسی ─────────────────────────

/**
 * @returns {{allowed:true}|{allowed:false,status:number,code:string,unlocksAt?:number,error:string}}
 *   codes: AUTH_REQUIRED | VIP_REQUIRED | FREE_LOCKED | EARLY_LOCKED
 */
function decideChapterAccess({ episode, releasedAtMs, sub, loggedIn, now = Date.now() }) {
  const s = sub || NO_SUB;

  if (episode.free) {
    if (s.active) return { allowed: true };
    const unlocksAt = releasedAtMs + FREE_CHAPTER_LOCK_HOURS * HOUR_MS;
    if (now >= unlocksAt) return { allowed: true };
    return {
      allowed: false, status: 403, code: "FREE_LOCKED", unlocksAt,
      error: "این قسمت تا ۲۴ ساعت اول فقط برای دارندگان اشتراک باز است. با خرید اشتراک همین حالا بخوانید یا منتظر بمانید.",
    };
  }

  // چپتر اشتراکی
  if (!loggedIn) {
    return { allowed: false, status: 401, code: "AUTH_REQUIRED", error: "برای این قسمت باید وارد حساب شوید" };
  }
  if (!s.active) {
    return { allowed: false, status: 403, code: "VIP_REQUIRED", error: "این قسمت مخصوص دارندگان اشتراک است" };
  }
  if (s.lockMs > 0) {
    const unlocksAt = releasedAtMs + s.lockMs;
    if (now < unlocksAt) {
      return {
        allowed: false, status: 403, code: "EARLY_LOCKED", unlocksAt,
        error: "با اشتراک هفتگی، قسمت‌های اشتراکی تا ۱ روز اول قفل هستند. برای دسترسی زودهنگام اشتراک ماهانه یا سه‌ماهه بگیرید.",
      };
    }
  }
  return { allowed: true };
}

/** برای نمایش در فهرست چپترها: چه زمانی این چپتر برای این کاربر باز می‌شود؟ (null = همین الان باز است یا هرگز) */
function unlockTimeFor({ episode, releasedAtMs, sub, now = Date.now() }) {
  const s = sub || NO_SUB;
  let t = null;
  if (episode.free) {
    if (!s.active) t = releasedAtMs + FREE_CHAPTER_LOCK_HOURS * HOUR_MS;
  } else if (s.active && s.lockMs > 0) {
    t = releasedAtMs + s.lockMs;
  }
  return t !== null && t > now ? t : null;
}

function publicSub(sub) {
  const s = sub || NO_SUB;
  return {
    active: s.active,
    tier: s.tier,
    planKey: s.planKey,
    until: s.until ? new Date(s.until).toISOString() : null,
    lockHours: Math.round(s.lockMs / HOUR_MS),
    canOffline: s.canOffline,
    canRequestManhwa: s.canRequestManhwa,
  };
}

module.exports = {
  HOUR_MS, FREE_CHAPTER_LOCK_HOURS, TIERS, NO_SUB,
  resolveSubscription, stackedPlan, rankOfSub, rankOfPlan,
  jalaliToGregorian, parseJalaliDateMs, explicitReleaseMs,
  decideChapterAccess, unlockTimeFor, publicSub,
};

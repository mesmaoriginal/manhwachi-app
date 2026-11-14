const HOUR_MS = 3600 * 1e3;

const FREE_CHAPTER_LOCK_HOURS = Number(process.env.FREE_CHAPTER_LOCK_HOURS) > 0 ? Number(process.env.FREE_CHAPTER_LOCK_HOURS) : 24;

const TIERS = Object.freeze({
  NONE: "none",
  STANDARD: "standard",
  PREMIUM: "premium"
});

const NO_SUB = Object.freeze({
  active: false,
  tier: TIERS.NONE,
  planKey: null,
  isPremium: false,
  lockMs: 0,
  until: null,
  canOffline: false,
  canRequestManhwa: false
});

function normTier(t) {
  return t === TIERS.PREMIUM ? TIERS.PREMIUM : TIERS.STANDARD;
}

function resolveSubscription(prof, planLookup, now = Date.now()) {
  if (!prof || !prof.is_vip) return NO_SUB;
  const untilMs = prof.vip_until ? new Date(prof.vip_until).getTime() : null;
  if (untilMs !== null && !(Number.isFinite(untilMs) && untilMs > now)) return NO_SUB;
  const planKey = prof.vip_plan_key || null;
  const plan = planKey && typeof planLookup === "function" ? planLookup(planKey) : null;
  const tier = normTier(prof.vip_tier || plan && plan.tier);
  const isPremium = tier === TIERS.PREMIUM;
  const lockDays = isPremium ? 0 : Math.max(0, Number(plan && plan.lockDays) || 0);
  return {
    active: true,
    tier: tier,
    planKey: planKey,
    isPremium: isPremium,
    lockMs: lockDays * 24 * HOUR_MS,
    until: untilMs,
    canOffline: isPremium,
    canRequestManhwa: isPremium
  };
}

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

function stackedPlan(currentSub, newPlan) {
  if (currentSub && currentSub.active && rankOfSub(currentSub) > rankOfPlan(newPlan)) {
    return {
      tier: currentSub.tier,
      planKey: currentSub.planKey
    };
  }
  return {
    tier: normTier(newPlan.tier),
    planKey: newPlan.key
  };
}

function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor((jy % 33 + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
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
  const sal = [ 0, 31, gy % 4 === 0 && gy % 100 !== 0 || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];
  let gm;
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [ gy, gm, gd ];
}

const TEHRAN_OFFSET_MS = 3.5 * HOUR_MS;

function parseJalaliDateMs(str) {
  if (!str) return null;
  const latin = String(str).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632));
  const m = latin.match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (!m) return null;
  const [jy, jm, jd] = [ Number(m[1]), Number(m[2]), Number(m[3]) ];
  if (jy < 1300 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return Date.UTC(gy, gm - 1, gd) - TEHRAN_OFFSET_MS;
}

function explicitReleaseMs(ep) {
  const v = ep && (ep.published_at ?? ep.released_at ?? ep.publishedAt ?? ep.releasedAt);
  if (v === undefined || v === null || v === "") return null;
  const ms = typeof v === "number" ? v < 1e12 ? v * 1e3 : v : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function decideChapterAccess({episode: episode, releasedAtMs: releasedAtMs, sub: sub, loggedIn: loggedIn, now: now = Date.now()}) {
  const s = sub || NO_SUB;
  if (episode.free) {
    if (s.active) return {
      allowed: true
    };
    const unlocksAt = releasedAtMs + FREE_CHAPTER_LOCK_HOURS * HOUR_MS;
    if (now >= unlocksAt) return {
      allowed: true
    };
    return {
      allowed: false,
      status: 403,
      code: "FREE_LOCKED",
      unlocksAt: unlocksAt,
      error: "این قسمت تا ۲۴ ساعت اول فقط برای دارندگان اشتراک باز است. با خرید اشتراک همین حالا بخوانید یا منتظر بمانید."
    };
  }
  if (!loggedIn) {
    return {
      allowed: false,
      status: 401,
      code: "AUTH_REQUIRED",
      error: "برای این قسمت باید وارد حساب شوید"
    };
  }
  if (!s.active) {
    return {
      allowed: false,
      status: 403,
      code: "VIP_REQUIRED",
      error: "این قسمت مخصوص دارندگان اشتراک است"
    };
  }
  if (s.lockMs > 0) {
    const unlocksAt = releasedAtMs + s.lockMs;
    if (now < unlocksAt) {
      return {
        allowed: false,
        status: 403,
        code: "EARLY_LOCKED",
        unlocksAt: unlocksAt,
        error: "با اشتراک هفتگی، قسمت‌های اشتراکی تا ۱ روز اول قفل هستند. برای دسترسی زودهنگام اشتراک ماهانه یا سه‌ماهه بگیرید."
      };
    }
  }
  return {
    allowed: true
  };
}

function unlockTimeFor({episode: episode, releasedAtMs: releasedAtMs, sub: sub, now: now = Date.now()}) {
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
    canRequestManhwa: s.canRequestManhwa
  };
}

module.exports = {
  HOUR_MS: HOUR_MS,
  FREE_CHAPTER_LOCK_HOURS: FREE_CHAPTER_LOCK_HOURS,
  TIERS: TIERS,
  NO_SUB: NO_SUB,
  resolveSubscription: resolveSubscription,
  stackedPlan: stackedPlan,
  rankOfSub: rankOfSub,
  rankOfPlan: rankOfPlan,
  jalaliToGregorian: jalaliToGregorian,
  parseJalaliDateMs: parseJalaliDateMs,
  explicitReleaseMs: explicitReleaseMs,
  decideChapterAccess: decideChapterAccess,
  unlockTimeFor: unlockTimeFor,
  publicSub: publicSub
};
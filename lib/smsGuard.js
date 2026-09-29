// lib/smsGuard.js
// محافظ شارژ پنل پیامک. قبل از هر ارسال پیامک OTP باید reserve(phone, ip) صدا زده شود:
//  • هر شماره: حداکثر ۲ پیامک در ساعت (SMS_MAX_PER_PHONE_HOUR)
//  • تکرار درخواست بعد از پر شدن سقف (۳ بار «اضافه») → بلاک شماره برای ۶ ساعت (SMS_BLOCK_MINUTES)
//  • هر شماره: سقف روزانه (۴)
//  • هر IP: حداکثر ۶ پیامک در ساعت، و تکرار → بلاک ۶۰ دقیقه‌ای (IP ممکنه مشترک باشه، پس بلاک کوتاه‌تر)
//  • سقف کل روزانه‌ی سایت (SMS_DAILY_CAP، پیش‌فرض ۵۰۰) - آخرین خط دفاع در برابر تخلیه‌ی شارژ
// اگر پیامک نرفت، slot.release() سهمیه را برمی‌گرداند.
// در حافظه است (مثل otpStore)؛ با چند instance باید به Redis منتقل شود.
const { OtpRateLimitError } = require("./otpStore");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const int = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const PER_PHONE_HOUR = int(process.env.SMS_MAX_PER_PHONE_HOUR, 2);
const PER_PHONE_DAY = int(process.env.SMS_MAX_PER_PHONE_DAY, 4);
const PER_IP_HOUR = int(process.env.SMS_MAX_PER_IP_HOUR, 6);
const GLOBAL_DAILY_CAP = int(process.env.SMS_DAILY_CAP, 500);
const PHONE_BLOCK_MS = int(process.env.SMS_BLOCK_MINUTES, 360) * 60 * 1000;
const IP_BLOCK_MS = 60 * 60 * 1000;
const STRIKES_TO_BLOCK = 3;

const phoneLog = new Map(); // phone -> number[]
const ipLog = new Map();
const globalLog = [];
const strikes = new Map(); // key -> { count, expiresAt }
const blocks = new Map(); // key -> until

const prune = (arr, now, win) => arr.filter((t) => now - t < win);
const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));
const fmt = (ms) => (ms >= HOUR ? `${Math.ceil(ms / HOUR)} ساعت` : `${mins(ms)} دقیقه`);

function fail(msg, ms) {
  throw new OtpRateLimitError(msg, Math.max(1, Math.ceil(ms / 1000)));
}

function strike(key, blockMs, now) {
  const s = strikes.get(key);
  const cur = s && s.expiresAt > now ? s : { count: 0, expiresAt: now + DAY };
  cur.count += 1;
  strikes.set(key, cur);
  if (cur.count >= STRIKES_TO_BLOCK) {
    blocks.set(key, now + blockMs);
    strikes.delete(key);
    return true;
  }
  return false;
}

function reserve(phone, ip) {
  const now = Date.now();
  const pk = `p:${phone}`;
  const ik = `i:${ip || "unknown"}`;

  for (const [k, msg] of [[pk, "شماره"], [ik, "IP"]]) {
    const until = blocks.get(k);
    if (until && until > now) {
      fail(`به دلیل درخواست‌های مکرر، این ${msg} موقتاً مسدود شده. ${fmt(until - now)} دیگر تلاش کن.`, until - now);
    }
    if (until && until <= now) blocks.delete(k);
  }

  const pLog = prune(phoneLog.get(phone) || [], now, DAY);
  const pHour = pLog.filter((t) => now - t < HOUR);
  if (pHour.length >= PER_PHONE_HOUR) {
    const wait = HOUR - (now - pHour[0]);
    if (strike(pk, PHONE_BLOCK_MS, now)) {
      fail(`درخواست‌های مکرر ثبت شد؛ این شماره ${fmt(PHONE_BLOCK_MS)} مسدود شد.`, PHONE_BLOCK_MS);
    }
    fail(`در هر ساعت فقط ${PER_PHONE_HOUR} بار می‌توانی کد بگیری. ${fmt(wait)} دیگر تلاش کن.`, wait);
  }
  if (pLog.length >= PER_PHONE_DAY) {
    const wait = DAY - (now - pLog[0]);
    fail(`سقف روزانه‌ی دریافت کد برای این شماره پر شده. ${fmt(wait)} دیگر تلاش کن.`, wait);
  }

  const iLog = prune(ipLog.get(ik) || [], now, HOUR);
  if (iLog.length >= PER_IP_HOUR) {
    const wait = HOUR - (now - iLog[0]);
    if (strike(ik, IP_BLOCK_MS, now)) fail(`درخواست‌های مکرر از این IP؛ ${fmt(IP_BLOCK_MS)} مسدود شد.`, IP_BLOCK_MS);
    fail(`تعداد درخواست کد از این شبکه زیاد است. ${fmt(wait)} دیگر تلاش کن.`, wait);
  }

  while (globalLog.length && now - globalLog[0] >= DAY) globalLog.shift();
  if (globalLog.length >= GLOBAL_DAILY_CAP) {
    console.error("[smsGuard] سقف روزانه‌ی کل پیامک پر شد:", GLOBAL_DAILY_CAP);
    fail("سرویس پیامک موقتاً محدود شده. کمی بعد یا با ایمیل تلاش کن.", 30 * 60 * 1000);
  }

  pLog.push(now);
  iLog.push(now);
  globalLog.push(now);
  phoneLog.set(phone, pLog);
  ipLog.set(ik, iLog);

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      for (const arr of [phoneLog.get(phone), ipLog.get(ik), globalLog]) {
        const i = arr ? arr.indexOf(now) : -1;
        if (i !== -1) arr.splice(i, 1);
      }
    },
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of phoneLog) { const f = prune(v, now, DAY); f.length ? phoneLog.set(k, f) : phoneLog.delete(k); }
  for (const [k, v] of ipLog) { const f = prune(v, now, HOUR); f.length ? ipLog.set(k, f) : ipLog.delete(k); }
  for (const [k, u] of blocks) if (u <= now) blocks.delete(k);
  for (const [k, s] of strikes) if (s.expiresAt <= now) strikes.delete(k);
}, 5 * 60 * 1000).unref();

module.exports = { reserve };

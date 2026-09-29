// lib/otpStore.js
// مدیریت کامل چرخه‌ی OTP پیامکی: تولید کد، هش کردن (هیچ‌وقت کد خام ذخیره
// نمی‌شه)، محدودیت نرخ ارسال (هم روی شماره، هم روی IP - چون هر پیامک برای
// ما هزینه داره و این endpoint می‌تونه هدف حملات SMS bombing قرار بگیره)،
// و در نهایت صدور یک "تیکت امضاشده" بعد از تایید موفق کد، که سرور در قدم
// بعدی (ساخت اکانت) ازش مطمئن می‌شه که این شماره واقعاً توسط صاحبش تایید
// شده - بدون این‌که لازم باشه کد OTP رو یک بار دیگه جایی نگه داریم.
//
// همه‌چیز در حافظه (Map) نگه داشته می‌شه، دقیقاً مثل الگوی authCache و
// guestId توی server.js. یعنی با ری‌استارت سرور همه‌ی کدهای در انتظار
// پاک می‌شن - قابل قبوله چون طول عمر یک کد OTP خودش فقط ۲ دقیقه‌ست.
// اگه سرور رو با چند instance (PM2 cluster / چند سرور پشت لود بالانسر)
// اجرا می‌کنید، این حافظه بین instance ها مشترک نیست و باید به Redis
// منتقل بشه - در حالت تک‌سروری (رایج‌ترین حالت VPS ایرانی) مشکلی نداره.

const crypto = require("crypto");

// رو production اگه OTP_SECRET ست نشده باشه سرور بالا نمیاد (fail-fast)، مثل
// بقیه‌ی سکرت‌ها؛ رو dev فقط warn می‌ده و یک مقدار موقت می‌سازه.
const { requireSecret } = require("./requireSecret");
const OTP_SECRET = requireSecret(
  "OTP_SECRET",
  "[otpStore]",
  "با هر ری‌استارت سرور، همه‌ی تیکت‌های صادرشده و کدهای در انتظار نامعتبر می‌شن."
);

const CODE_LENGTH = 6;
const CODE_TTL_MS = 2 * 60 * 1000; // هر کد ۲ دقیقه معتبره
const RESEND_COOLDOWN_MS = 90 * 1000; // حداقل فاصله بین دو ارسال برای یک شماره
const MAX_SENDS_PER_PHONE_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_REQUESTS_PER_IP_PER_HOUR = 8;
// سقف «حدس اشتباه» روی هر کلید (شماره/ایمیل) - مستقل از کد. سقف MAX_VERIFY_ATTEMPTS
// فقط روی یک کد اعمال می‌شد و با گرفتن کد جدید صفر می‌شد؛ یعنی مهاجم با ۵ کد
// در ساعت تا ۲۵ حدس در ساعت می‌زد. این سقف با عوض شدن کد ریست نمی‌شه.
const MAX_FAILS_PER_KEY_PER_HOUR = 8;
const MAX_FAILS_PER_KEY_PER_DAY = 20;
const TICKET_TTL_MS = 10 * 60 * 1000; // تیکت تاییدشده ۱۰ دقیقه برای تکمیل ثبت‌نام معتبره

// phone(normalized "98912...") -> { codeHash, expiresAt, attemptsLeft, resendAvailableAt, sentAtLog: number[] }
const otpRecords = new Map();
// ip -> number[] (زمان درخواست‌های موفق در یک ساعت اخیر)
const ipRequestLog = new Map();
// sig تیکت‌های مصرف‌شده -> زمان انقضای تیکت (بعد از انقضا خودکار پاک می‌شه)
const usedTickets = new Map();
// key -> number[] (زمان حدس‌های اشتباه در ۲۴ ساعت اخیر)
const failLog = new Map();

function hmac(input) {
  return crypto.createHmac("sha256", OTP_SECRET).update(input).digest("base64url");
}

// پیشوندهای otp:/ticket: (domain separation) تا هش کد و امضای تیکت که با
// یک کلید ساخته می‌شن، هیچ‌وقت بتونن جای هم استفاده بشن.
function hashCode(phone, code) {
  return hmac(`otp:${phone}:${code}`);
}

function generateNumericCode() {
  // به‌جای Math.random از crypto.randomInt استفاده می‌کنیم که برای کد
  // تایید امنیتی مناسبه (غیرقابل پیش‌بینی)، نه رندوم معمولی جاوااسکریپت.
  const min = 10 ** (CODE_LENGTH - 1);
  const max = 10 ** CODE_LENGTH - 1;
  return String(crypto.randomInt(min, max + 1));
}

class OtpRateLimitError extends Error {
  constructor(message, retryAfterSeconds) {
    super(message);
    this.name = "OtpRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// چک محدودیت IP - جدا از محدودیت شماره، تا کسی نتونه با عوض کردن مداوم
// شماره (که هزینه‌ای براش نداره) این محدودیت رو دور بزنه؛ ترکیب هر دو
// محدودیت لازمه.
function checkIpRateLimit(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const log = (ipRequestLog.get(key) || []).filter(
    (t) => now - t < 60 * 60 * 1000
  );
  if (log.length >= MAX_REQUESTS_PER_IP_PER_HOUR) {
    throw new OtpRateLimitError(
      "تعداد درخواست‌های کد تایید از این IP در این ساعت بیش از حد مجاز است.",
      60 * 60
    );
  }
  log.push(now);
  ipRequestLog.set(key, log);
}

// تولید کد جدید برای یک شماره، با رعایت cooldown بین ارسال‌ها و سقف تعداد
// ارسال در ساعت. کد خام رو برمی‌گردونه تا پیامک با اون ارسال بشه - ولی
// فقط هش‌شده‌اش ذخیره می‌مونه.
function createOtp(phone) {
  const now = Date.now();
  const existing = otpRecords.get(phone);

  if (existing && existing.resendAvailableAt > now) {
    throw new OtpRateLimitError(
      "کد قبلی هنوز معتبره. کمی صبر کن و دوباره تلاش کن.",
      Math.ceil((existing.resendAvailableAt - now) / 1000)
    );
  }

  const sentAtLog = (existing?.sentAtLog || []).filter(
    (t) => now - t < 60 * 60 * 1000
  );
  if (sentAtLog.length >= MAX_SENDS_PER_PHONE_PER_HOUR) {
    throw new OtpRateLimitError(
      "به سقف تعداد ارسال کد برای این شماره در این ساعت رسیدید.",
      60 * 60
    );
  }

  const code = generateNumericCode();
  sentAtLog.push(now);

  otpRecords.set(phone, {
    codeHash: hashCode(phone, code),
    expiresAt: now + CODE_TTL_MS,
    attemptsLeft: MAX_VERIFY_ATTEMPTS,
    resendAvailableAt: now + RESEND_COOLDOWN_MS,
    sentAtLog,
  });

  return { code, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

// اگه ارسال پیامک شکست خورد (خطای پنل ippanel)، رکورد رو پاک می‌کنیم تا
// کاربر مجبور نشه تا پایان cooldown صبر کنه برای یک کدی که اصلاً بهش
// نرسیده.
function discardOtp(phone) {
  otpRecords.delete(phone);
}

// نتیجه: { ok: true } یا { ok: false, error, attemptsLeft }
function verifyOtp(phone, code) {
  const now = Date.now();

  // قفل سقف حدس اشتباه (قبل از هر چیز؛ حتی کد درست هم در دوره‌ی قفل رد می‌شه)
  const fails = (failLog.get(phone) || []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  const hourFails = fails.filter((t) => now - t < 60 * 60 * 1000);
  if (hourFails.length >= MAX_FAILS_PER_KEY_PER_HOUR || fails.length >= MAX_FAILS_PER_KEY_PER_DAY) {
    return {
      ok: false,
      error: "تلاش‌های ناموفق بیش از حد مجاز بود. کمی بعد دوباره تلاش کن.",
      locked: true,
    };
  }

  const record = otpRecords.get(phone);

  if (!record) {
    return { ok: false, error: "کدی برای این شماره ارسال نشده یا منقضی شده. دوباره درخواست کد بده." };
  }
  if (record.expiresAt < now) {
    otpRecords.delete(phone);
    return { ok: false, error: "کد وارد شده منقضی شده. دوباره درخواست کد بده." };
  }
  if (record.attemptsLeft <= 0) {
    otpRecords.delete(phone);
    return { ok: false, error: "تعداد تلاش‌های مجاز تمام شد. دوباره درخواست کد بده." };
  }

  const expectedHash = record.codeHash;
  const actualHash = hashCode(phone, String(code ?? "").trim());

  // مقایسه‌ی timing-safe تا از حمله‌ی timing attack روی مقایسه‌ی رشته‌ای
  // جلوگیری بشه - دقیقاً همون الگویی که برای guestId توی server.js هست.
  const a = Buffer.from(expectedHash);
  const b = Buffer.from(actualHash);
  const isMatch = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!isMatch) {
    fails.push(now);
    failLog.set(phone, fails);
    record.attemptsLeft -= 1;
    otpRecords.set(phone, record);
    return {
      ok: false,
      error: "کد وارد شده اشتباه است.",
      attemptsLeft: record.attemptsLeft,
    };
  }

  otpRecords.delete(phone);
  failLog.delete(phone); // صاحب واقعی کد رو با تایپوهای قبلی‌اش قفل نگه نمی‌داریم
  return { ok: true };
}

// بعد از تایید موفق کد، یک تیکت امضاشده صادر می‌کنیم که ثابت می‌کنه این
// شماره همین الان (در ۱۰ دقیقه‌ی اخیر) با موفقیت OTP شده. مرحله‌ی بعد
// (ساخت اکانت) این تیکت رو چک می‌کنه، نه کد OTP رو - چون کد OTP همین‌جا
// مصرف و پاک شده.
function issueVerifiedTicket(phone) {
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const payload = `${phone}.${expiresAt}`;
  const sig = hmac(`ticket:${payload}`);
  return `${payload}.${sig}`;
}

function checkVerifiedTicket(ticket, phone) {
  if (!ticket || typeof ticket !== "string") return false;
  const parts = ticket.split(".");
  if (parts.length !== 3) return false;
  const [ticketPhone, expiresAtRaw, sig] = parts;
  if (ticketPhone !== phone) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expectedSig = hmac(`ticket:${ticketPhone}.${expiresAtRaw}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return false;

  // تیکتی که قبلاً برای ساخت اکانت مصرف شده دیگه معتبر نیست
  return !usedTickets.has(sig);
}

// بعد از ساخت موفق اکانت صدا زده می‌شه تا همون تیکت دوباره قابل استفاده
// نباشه. عمداً جدا از checkVerifiedTicket ـه: اگه ساخت اکانت تو Supabase
// شکست بخوره، کاربر مجبور نیست دوباره OTP بگیره.
function consumeVerifiedTicket(ticket) {
  if (!ticket || typeof ticket !== "string") return;
  const parts = ticket.split(".");
  if (parts.length !== 3) return;
  const expiresAt = Number(parts[1]);
  if (Number.isFinite(expiresAt)) usedTickets.set(parts[2], expiresAt);
}

// جاروب دوره‌ای حافظه - جلوی رشد بی‌نهایت Map ها رو با گذشت زمان می‌گیره.
setInterval(() => {
  const now = Date.now();
  for (const [phone, record] of otpRecords.entries()) {
    if (record.expiresAt < now && record.resendAvailableAt < now) {
      otpRecords.delete(phone);
    }
  }
  for (const [sig, exp] of usedTickets.entries()) {
    if (exp < now) usedTickets.delete(sig);
  }
  for (const [k, log] of failLog.entries()) {
    const fresh = log.filter((t) => now - t < 24 * 60 * 60 * 1000);
    if (fresh.length === 0) failLog.delete(k);
    else failLog.set(k, fresh);
  }
  for (const [ip, log] of ipRequestLog.entries()) {
    const fresh = log.filter((t) => now - t < 60 * 60 * 1000);
    if (fresh.length === 0) ipRequestLog.delete(ip);
    else ipRequestLog.set(ip, fresh);
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  OtpRateLimitError,
  checkIpRateLimit,
  createOtp,
  discardOtp,
  verifyOtp,
  issueVerifiedTicket,
  checkVerifiedTicket,
  consumeVerifiedTicket,
};

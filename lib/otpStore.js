const crypto = require("crypto");

const {requireSecret: requireSecret} = require("./requireSecret");

const OTP_SECRET = requireSecret("OTP_SECRET", "[otpStore]", "با هر ری‌استارت سرور، همه‌ی تیکت‌های صادرشده و کدهای در انتظار نامعتبر می‌شن.");

const CODE_LENGTH = 6;

const CODE_TTL_MS = 2 * 60 * 1e3;

const RESEND_COOLDOWN_MS = 90 * 1e3;

const MAX_SENDS_PER_PHONE_PER_HOUR = 5;

const MAX_VERIFY_ATTEMPTS = 5;

const MAX_REQUESTS_PER_IP_PER_HOUR = 8;

const MAX_FAILS_PER_KEY_PER_HOUR = 8;

const MAX_FAILS_PER_KEY_PER_DAY = 20;

const TICKET_TTL_MS = 10 * 60 * 1e3;

const otpRecords = new Map;

const ipRequestLog = new Map;

const usedTickets = new Map;

const failLog = new Map;

function hmac(input) {
  return crypto.createHmac("sha256", OTP_SECRET).update(input).digest("base64url");
}

function hashCode(phone, code) {
  return hmac(`otp:${phone}:${code}`);
}

function generateNumericCode() {
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

function checkIpRateLimit(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const log = (ipRequestLog.get(key) || []).filter(t => now - t < 60 * 60 * 1e3);
  if (log.length >= MAX_REQUESTS_PER_IP_PER_HOUR) {
    throw new OtpRateLimitError("تعداد درخواست‌های کد تایید از این IP در این ساعت بیش از حد مجاز است.", 60 * 60);
  }
  log.push(now);
  ipRequestLog.set(key, log);
}

function createOtp(phone) {
  const now = Date.now();
  const existing = otpRecords.get(phone);
  if (existing && existing.resendAvailableAt > now) {
    throw new OtpRateLimitError("کد قبلی هنوز معتبره. کمی صبر کن و دوباره تلاش کن.", Math.ceil((existing.resendAvailableAt - now) / 1e3));
  }
  const sentAtLog = (existing?.sentAtLog || []).filter(t => now - t < 60 * 60 * 1e3);
  if (sentAtLog.length >= MAX_SENDS_PER_PHONE_PER_HOUR) {
    throw new OtpRateLimitError("به سقف تعداد ارسال کد برای این شماره در این ساعت رسیدید.", 60 * 60);
  }
  const code = generateNumericCode();
  sentAtLog.push(now);
  otpRecords.set(phone, {
    codeHash: hashCode(phone, code),
    expiresAt: now + CODE_TTL_MS,
    attemptsLeft: MAX_VERIFY_ATTEMPTS,
    resendAvailableAt: now + RESEND_COOLDOWN_MS,
    sentAtLog: sentAtLog
  });
  return {
    code: code,
    resendAfterSeconds: RESEND_COOLDOWN_MS / 1e3
  };
}

function discardOtp(phone) {
  otpRecords.delete(phone);
}

function verifyOtp(phone, code) {
  const now = Date.now();
  const fails = (failLog.get(phone) || []).filter(t => now - t < 24 * 60 * 60 * 1e3);
  const hourFails = fails.filter(t => now - t < 60 * 60 * 1e3);
  if (hourFails.length >= MAX_FAILS_PER_KEY_PER_HOUR || fails.length >= MAX_FAILS_PER_KEY_PER_DAY) {
    return {
      ok: false,
      error: "تلاش‌های ناموفق بیش از حد مجاز بود. کمی بعد دوباره تلاش کن.",
      locked: true
    };
  }
  const record = otpRecords.get(phone);
  if (!record) {
    return {
      ok: false,
      error: "کدی برای این شماره ارسال نشده یا منقضی شده. دوباره درخواست کد بده."
    };
  }
  if (record.expiresAt < now) {
    otpRecords.delete(phone);
    return {
      ok: false,
      error: "کد وارد شده منقضی شده. دوباره درخواست کد بده."
    };
  }
  if (record.attemptsLeft <= 0) {
    otpRecords.delete(phone);
    return {
      ok: false,
      error: "تعداد تلاش‌های مجاز تمام شد. دوباره درخواست کد بده."
    };
  }
  const expectedHash = record.codeHash;
  const actualHash = hashCode(phone, String(code ?? "").trim());
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
      attemptsLeft: record.attemptsLeft
    };
  }
  otpRecords.delete(phone);
  failLog.delete(phone);
  return {
    ok: true
  };
}

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
  return !usedTickets.has(sig);
}

function consumeVerifiedTicket(ticket) {
  if (!ticket || typeof ticket !== "string") return;
  const parts = ticket.split(".");
  if (parts.length !== 3) return;
  const expiresAt = Number(parts[1]);
  if (Number.isFinite(expiresAt)) usedTickets.set(parts[2], expiresAt);
}

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
    const fresh = log.filter(t => now - t < 24 * 60 * 60 * 1e3);
    if (fresh.length === 0) failLog.delete(k); else failLog.set(k, fresh);
  }
  for (const [ip, log] of ipRequestLog.entries()) {
    const fresh = log.filter(t => now - t < 60 * 60 * 1e3);
    if (fresh.length === 0) ipRequestLog.delete(ip); else ipRequestLog.set(ip, fresh);
  }
}, 5 * 60 * 1e3).unref();

module.exports = {
  OtpRateLimitError: OtpRateLimitError,
  checkIpRateLimit: checkIpRateLimit,
  createOtp: createOtp,
  discardOtp: discardOtp,
  verifyOtp: verifyOtp,
  issueVerifiedTicket: issueVerifiedTicket,
  checkVerifiedTicket: checkVerifiedTicket,
  consumeVerifiedTicket: consumeVerifiedTicket
};
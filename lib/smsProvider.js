const IPPANEL_BASE_URL = process.env.IPPANEL_BASE_URL || "https://edge.ippanel.com/v1";

const IPPANEL_API_KEY = process.env.IPPANEL_API_KEY;

const IPPANEL_ORIGINATOR = process.env.IPPANEL_ORIGINATOR;

const IPPANEL_OTP_PATTERN_CODE = process.env.IPPANEL_OTP_PATTERN_CODE;

const IPPANEL_OTP_PATTERN_VAR = process.env.IPPANEL_OTP_PATTERN_VAR || "code";

class SmsSendError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "SmsSendError";
    this.details = details;
  }
}

async function sendOtpSms(phone, code) {
  if (!IPPANEL_API_KEY || !IPPANEL_ORIGINATOR || !IPPANEL_OTP_PATTERN_CODE) {
    console.error("[ippanel] تنظیمات پنل پیامک کامل نیست (IPPANEL_API_KEY / IPPANEL_ORIGINATOR / IPPANEL_OTP_PATTERN_CODE در .env تنظیم نشده).");
    throw new SmsSendError("سرویس ارسال پیامک موقتاً در دسترس نیست.");
  }
  const body = {
    sending_type: "pattern",
    from_number: IPPANEL_ORIGINATOR,
    code: IPPANEL_OTP_PATTERN_CODE,
    recipients: [ phone ],
    params: {
      [IPPANEL_OTP_PATTERN_VAR]: code
    }
  };
  let res;
  try {
    res = await fetch(`${IPPANEL_BASE_URL}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: IPPANEL_API_KEY
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1e4)
    });
  } catch (networkErr) {
    console.error("[ippanel] خطای شبکه در اتصال به edge.ippanel.com:", networkErr.message);
    throw new SmsSendError("ارتباط با پنل پیامک برقرار نشد.");
  }
  const rawText = await res.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = rawText;
  }
  if (!res.ok) {
    console.error("[ippanel] خطای ارسال پیامک:", res.status, JSON.stringify(data));
    throw new SmsSendError("ارسال پیامک ناموفق بود. لطفاً بعداً دوباره تلاش کنید.", {
      status: res.status,
      body: data
    });
  }
  return data;
}

module.exports = {
  sendOtpSms: sendOtpSms,
  SmsSendError: SmsSendError
};
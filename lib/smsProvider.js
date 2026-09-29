// lib/smsProvider.js
// ارسال پیامک کد تایید (OTP) از طریق API جدید ippanel موسوم به "Edge"
// (همون که در https://edge.ippanel.com/v1 مستنده و پنل شما - xzn - هم
// روی همین زیرساخت سوار است).
//
// ⚠️ نکته‌ی خیلی مهم درباره‌ی این فایل، حتماً بخونید:
// ساختار دقیق JSON که این endpoint انتظار داره رو نتونستم توی همین
// session تاییدِ ۱۰۰٪ بگیرم، چون docs.ippanel.com رو به ابزارهای
// خودکار (robots.txt) بسته و صفحه رو نمی‌شد مستقیم خوند. چیزی که پایین
// نوشته شده بر اساس مستندترین و پرتکرارترین الگوی SDKهای رسمی/غیررسمی
// ippanel (sending_type / code / recipients / from_number / params)
// ساخته شده و به احتمال زیاد درسته، ولی قبل از اعتماد کامل، حتماً:
//   ۱. یک بار از همین تابع یک OTP واقعی برای شماره‌ی خودت بگیر.
//   ۲. اگه پیامک نرسید یا خطا داد، متن دقیق خطای برگشتی از ippanel رو
//      (که در کنسول با پیشوند [ippanel] لاگ می‌شه) نگاه کن - معمولاً
//      دقیقاً می‌گه کدوم فیلد اشتباهه.
//   ۳. تو پنل خودت (xzn/ippanel) روی پترنی که ساختی، دنبال بخش
//      «نمونه کد» یا «Sample Code» بگرد - اونجا دقیقاً همون بدنه‌ی
//      درخواستی که پنل شما توقع داره رو با API Key خودت نشون می‌ده.
//      اگه فرق داشت، فقط کافیه تابع sendOtpSms پایین رو با همون فرمت
//      match کنی - بقیه‌ی سیستم (OTP store، rate limit، ثبت‌نام) به این
//      فایل کاری نداره و دست‌نخورده می‌مونه.

const IPPANEL_BASE_URL =
  process.env.IPPANEL_BASE_URL || "https://edge.ippanel.com/v1";
const IPPANEL_API_KEY = process.env.IPPANEL_API_KEY;
const IPPANEL_ORIGINATOR = process.env.IPPANEL_ORIGINATOR; // شماره خط ارسال‌کننده، از پنل
const IPPANEL_OTP_PATTERN_CODE = process.env.IPPANEL_OTP_PATTERN_CODE; // کد پترن تاییدشده
// اسم متغیری که داخل متن پترن نوشتی (مثلاً اگه پترنت "کد شما: %code%"
// هست، این باید "code" باشه؛ بعضی پترن‌های ippanel به‌جای اون از
// "verification-code" استفاده می‌کنن - دقیقاً همون اسمی که تو پنل موقع
// ساخت پترن به‌عنوان نام متغیر ثبت کردی رو اینجا بذار).
const IPPANEL_OTP_PATTERN_VAR = process.env.IPPANEL_OTP_PATTERN_VAR || "code";

class SmsSendError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "SmsSendError";
    this.details = details;
  }
}

// phone باید خروجی lib/phone.js#normalizeIranPhone باشه (فرمت "98912...")
async function sendOtpSms(phone, code) {
  if (!IPPANEL_API_KEY || !IPPANEL_ORIGINATOR || !IPPANEL_OTP_PATTERN_CODE) {
    // جزئیات (اسم متغیرهای env) فقط تو لاگ سرور؛ پیام SmsSendError مستقیم به
    // کلاینت برمی‌گرده و نباید ساختار تنظیمات داخلی رو لو بده.
    console.error(
      "[ippanel] تنظیمات پنل پیامک کامل نیست (IPPANEL_API_KEY / IPPANEL_ORIGINATOR / IPPANEL_OTP_PATTERN_CODE در .env تنظیم نشده)."
    );
    throw new SmsSendError("سرویس ارسال پیامک موقتاً در دسترس نیست.");
  }

  const body = {
    sending_type: "pattern",
    from_number: IPPANEL_ORIGINATOR,
    code: IPPANEL_OTP_PATTERN_CODE,
    recipients: [phone],
    params: {
      [IPPANEL_OTP_PATTERN_VAR]: code,
    },
  };

  let res;
  try {
    res = await fetch(`${IPPANEL_BASE_URL}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: IPPANEL_API_KEY,
      },
      body: JSON.stringify(body),
      // بدون timeout، کندی/قطعی پنل پیامک درخواست کاربر رو بی‌نهایت باز نگه می‌داشت
      signal: AbortSignal.timeout(10_000),
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
    throw new SmsSendError(
      "ارسال پیامک ناموفق بود. لطفاً بعداً دوباره تلاش کنید.",
      { status: res.status, body: data }
    );
  }

  return data;
}

module.exports = { sendOtpSms, SmsSendError };

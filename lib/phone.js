// lib/phone.js
// نرمال‌سازی شماره موبایل ایران به یک فرمت ثابت: "98912xxxxxxx" (بدون +،
// بدون صفر ابتدایی). همین یک فرمت هم برای ارسال به ippanel استفاده می‌شه
// هم برای فیلد phone در Supabase (auth.users.phone) - چون اگه یک شماره
// یک بار با فرمت "0912..." و یک بار "+98912..." ذخیره بشه، سیستم اون رو
// دو کاربر متفاوت می‌بینه.
//
// فرمت‌های ورودی قابل قبول: 09121234567 / +989121234567 / 00989121234567
// / 989121234567 / با فاصله یا خط‌تیره بین ارقام.
const IRAN_MOBILE_RE = /^989\d{9}$/;

// ارقام فارسی (۰-۹) و عربی (٠-٩) رو به انگلیسی تبدیل می‌کنه - کاربرهای
// ایرانی با کیبورد فارسی معمولاً همین‌ها رو تایپ می‌کنن و بدون این تبدیل،
// شماره یا کد کاملاً درست هم «نامعتبر» رد می‌شد.
function toEnglishDigits(input) {
  return String(input ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function normalizeIranPhone(raw) {
  if (!raw) return null;
  let digits = toEnglishDigits(raw).replace(/[\s\-().\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");

  digits = digits.replace(/^\+/, "");
  digits = digits.replace(/^0098/, "98");
  digits = digits.replace(/^98/, "98"); // no-op, برای وضوح
  digits = digits.replace(/^0/, "98"); // 0912... -> 98912...

  // اگه با 9 شروع شده (بدون کد کشور و بدون صفر) هم قبول کن: 912xxxxxxx
  if (/^9\d{9}$/.test(digits)) {
    digits = `98${digits}`;
  }

  return IRAN_MOBILE_RE.test(digits) ? digits : null;
}

module.exports = { normalizeIranPhone, toEnglishDigits, IRAN_MOBILE_RE };

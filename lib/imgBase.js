// آدرس پایه‌ی CDN عکس‌ها (مثلاً https://img.manhwachi.ir).
// اگه متغیر محیطی IMG_BASE ست نشده باشه، رشته‌ی خالیه و همه‌ی آدرس‌ها مثل قبل
// نسبی می‌مونن (از همون دامنه‌ی اصلی سرو می‌شن) - پس بدون ست کردنش هیچ‌چیز عوض نمی‌شه.
const raw = String(process.env.IMG_BASE || "").trim().replace(/\/+$/, "");
const IMG_BASE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(raw) ? raw : "";
if (raw && !IMG_BASE) console.warn("[imgBase] IMG_BASE نامعتبر است (باید مثل https://img.example.ir باشد) - نادیده گرفته شد.");
// برای تزریق به <head> صفحات؛ فرانت از window.IMG_BASE استفاده می‌کنه.
const IMG_SNIPPET = IMG_BASE ? `<script>window.IMG_BASE=${JSON.stringify(IMG_BASE)};</script>` : "";
module.exports = { IMG_BASE, IMG_SNIPPET };

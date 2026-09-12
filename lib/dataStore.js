// lib/dataStore.js
//
// این ماژول جایگزین سه جای پراکنده‌ای شد که قبلاً هر کدوم جدا data.json رو
// از دیسک می‌خوندن (renderMangaPage، findEpisodeFromJson، و روت
// /data/data.json). مشکل نسخه‌ی قبلی این بود که دو تا از این سه جا با
// fs.readFileSync (synchronous) کار می‌کردن - یعنی هر بار که یکی چپتر باز
// می‌کرد یا صفحه‌ی مانهوا رو لود می‌کرد، کل event loop تا پایان خوندن فایل
// از دیسک قفل می‌شد و همه‌ی کاربرهای دیگه هم منتظر می‌موندن.
//
// حالا فقط یک بار از دیسک خونده می‌شه و توی حافظه کش می‌مونه.
//
// باطل‌سازی کش از دو راه مستقل انجام می‌شه، عمداً هم‌زمان، نه فقط یکی:
//
//  1) dataEvents / DATA_UPDATED: مسیر «سریع» - وقتی پنل ادمین بعد از یک
//     تغییر این event رو emit می‌کنه، کش همون لحظه (بدون حتی یک fs.stat)
//     باطل می‌شه.
//
//  2) چک mtime روی هر فراخوانی getData()/getRawJson(): مسیر «ایمن» -
//     قبل از برگردوندن کش، یک fs.statSync سبک (فقط متادیتا، نه خوندن کل
//     فایل) می‌زنیم و mtime فایل رو با چیزی که موقع آخرین بار خوندن کش
//     کردیم مقایسه می‌کنیم. اگه فرق داشت، یعنی data.json از زیر پای ما
//     عوض شده - چه با emit شدنِ درستِ DATA_UPDATED، چه بدونش.
//
// چرا راه (۲) لازم بود: راه (۱) به تنهایی وابسته به این بود که *همه‌ی*
// مسیرهای adminRouter.js (اضافه/ویرایش/حذف چپتر یا مانهوا) حتماً و بدون
// استثنا dataEvents.emit(DATA_UPDATED) رو صدا بزنن. اگه فقط یک route
// (مثلاً حذف چپتر) این کار رو فراموش می‌کرد، خودِ فایل دیسک درست آپدیت
// می‌شد ولی کش سرور برای همیشه (تا ری‌استارت بعدی) قدیمی می‌موند - دقیقاً
// همون شکایت «آپدیت کردم ولی رو سایت نیومد». حالا حتی اگه یک route جا
// بذاره، همون فراخوانی بعدی getData()/getRawJson() خودش متوجه تغییر
// mtime می‌شه و از دیسک تازه می‌خونه - مستقل از این‌که adminRouter.js
// درست نوشته شده باشه یا نه.
//
// هزینه‌ی این ایمنی: یک fs.statSync اضافه روی هر ریکوئست (نه یک
// fs.readFileSync کامل) - این متادیتا از کش خودِ سیستم‌عامل میاد و در حد
// میکروثانیه‌ست، پس عملاً هزینه‌ی محسوسی به مسیر خوندن کاربر اضافه نمی‌کنه.

const fs = require("fs");
const path = require("path");
const { dataEvents, DATA_UPDATED } = require("./dataEvents");

const JSON_PATH = path.join(__dirname, "..", "data", "data.json");

let cachedData = null; // آبجکت پارس‌شده
let cachedRaw = null; // متن خام (برای سرو مستقیم به کلاینت بدون JSON.stringify دوباره)
let cachedMtimeMs = null; // mtime فایل در لحظه‌ی آخرین بار خوندن از دیسک

function loadFromDisk() {
  try {
    const stat = fs.existsSync(JSON_PATH) ? fs.statSync(JSON_PATH) : null;
    const raw = stat ? fs.readFileSync(JSON_PATH, "utf-8") : "{}";
    cachedRaw = raw;
    cachedData = JSON.parse(raw);
    cachedMtimeMs = stat ? stat.mtimeMs : 0;
  } catch (err) {
    console.error("خطا در خواندن data.json:", err);
    cachedData = cachedData || {};
    cachedRaw = cachedRaw || "{}";
  }
}

// چک می‌کنه که آیا data.json روی دیسک از آخرین باری که کش کردیمش تغییر
// کرده یا نه. اگه فایل به هر دلیلی الان قابل stat کردن نباشه (مثلاً یک
// جابه‌جایی اتمیک فایل درست وسط این لحظه)، به‌جای کرش، فرض می‌کنیم کش
// هنوز معتبره - همون کشِ قبلی رو نگه می‌داریم، دفعه‌ی بعد دوباره چک می‌شه.
function isStaleOnDisk() {
  try {
    const stat = fs.statSync(JSON_PATH);
    return stat.mtimeMs !== cachedMtimeMs;
  } catch {
    return false;
  }
}

function ensureFresh() {
  if (cachedData === null || isStaleOnDisk()) {
    loadFromDisk();
  }
}

// آبجکت پارس‌شده - برای استفاده‌ی داخلی سرور (renderMangaPage, findEpisodeFromJson)
function getData() {
  ensureFresh();
  return cachedData;
}

// متن خام JSON - برای سرو مستقیم به کلاینت بدون هزینه‌ی JSON.stringify اضافه
function getRawJson() {
  ensureFresh();
  return cachedRaw;
}

// مسیر «سریع»: وقتی پنل ادمین درست emit می‌کنه، نیازی به صبر کردن برای
// چک mtime نیست - کش رو همون لحظه خالی می‌کنیم تا فراخوانی بعدی حتماً
// از دیسک بخونه.
dataEvents.on(DATA_UPDATED, () => {
  cachedData = null;
  cachedRaw = null;
});

module.exports = { getData, getRawJson };

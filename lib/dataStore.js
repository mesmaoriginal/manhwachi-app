// lib/dataStore.js
//
// این ماژول جایگزین سه جای پراکنده‌ای شد که قبلاً هر کدوم جدا data.json رو
// از دیسک می‌خوندن (renderMangaPage، findEpisodeFromJson، و روت
// /data/data.json). مشکل نسخه‌ی قبلی این بود که دو تا از این سه جا با
// fs.readFileSync (synchronous) کار می‌کردن - یعنی هر بار که یکی چپتر باز
// می‌کرد یا صفحه‌ی مانهوا رو لود می‌کرد، کل event loop تا پایان خوندن فایل
// از دیسک قفل می‌شد و همه‌ی کاربرهای دیگه هم منتظر می‌موندن.
//
// حالا فقط یک بار از دیسک خونده می‌شه و توی حافظه کش می‌مونه. با شنیدن
// رویداد DATA_UPDATED (که پنل ادمین بعد از هر تغییر ساطع می‌کنه) کش
// باطل می‌شه تا دفعه‌ی بعد که کسی داده رو بخواد، دوباره تازه از دیسک
// خونده بشه.

const fs = require("fs");
const path = require("path");
const { dataEvents, DATA_UPDATED } = require("./dataEvents");

const JSON_PATH = path.join(__dirname, "..", "data", "data.json");

let cachedData = null; // آبجکت پارس‌شده
let cachedRaw = null; // متن خام (برای سرو مستقیم به کلاینت بدون JSON.stringify دوباره)

function loadFromDisk() {
  try {
    const raw = fs.existsSync(JSON_PATH) ? fs.readFileSync(JSON_PATH, "utf-8") : "{}";
    cachedRaw = raw;
    cachedData = JSON.parse(raw);
  } catch (err) {
    console.error("خطا در خواندن data.json:", err);
    cachedData = cachedData || {};
    cachedRaw = cachedRaw || "{}";
  }
}

// آبجکت پارس‌شده - برای استفاده‌ی داخلی سرور (renderMangaPage, findEpisodeFromJson)
function getData() {
  if (!cachedData) loadFromDisk();
  return cachedData;
}

// متن خام JSON - برای سرو مستقیم به کلاینت بدون هزینه‌ی JSON.stringify اضافه
function getRawJson() {
  if (!cachedRaw) loadFromDisk();
  return cachedRaw;
}

dataEvents.on(DATA_UPDATED, () => {
  cachedData = null;
  cachedRaw = null;
});

module.exports = { getData, getRawJson };

// lib/dataEvents.js
//
// یک EventEmitter مشترک و سبک، فقط برای این که وقتی dataStore.js فایل
// data.json رو با موفقیت روی دیسک می‌نویسه، به بقیه‌ی ماژول‌ها (مثل
// server.js) خبر بده که کش‌هاشون از data.json دیگه معتبر نیست.
//
// چرا لازم بود:
// server.js یک نسخه از محتوای data.json رو تو متغیر cachedDataJson نگه
// می‌داشت تا از خوندن مکرر دیسک جلوگیری کنه، ولی هیچ‌جا اون کش رو باطل
// نمی‌کرد. در نتیجه بعد از هر تغییر از پنل ادمین (اضافه/ویرایش/حذف چپتر
// یا مانهوا)، خودِ فایل data.json درست آپدیت می‌شد ولی روتِ
// GET /data/data.json همچنان نسخه‌ی قدیمی رو به فرانت‌اند سایت برمی‌گردوند.

const { EventEmitter } = require("events");

const dataEvents = new EventEmitter();

// نامی که هر وقت data.json آپدیت میشه ساطع می‌شه
const DATA_UPDATED = "data-updated";

module.exports = { dataEvents, DATA_UPDATED };

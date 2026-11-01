// lib/chapterTimes.js
//
// قفل ۲۴ ساعته و ۱ روزه به «لحظه‌ی دقیق انتشار» هر چپتر نیاز دارد، ولی data.json فقط تاریخ شمسی
// (بدون ساعت) دارد: ep.date = "1405/08/09". این ماژول برای هر چپتر یک زمان انتشار ثابت نگه می‌دارد:
//
//   ۱) اگر در data.json فیلد دقیق ep.published_at (یا released_at) باشد، همان معتبر است (برای آینده‌ی پنل ادمین).
//   ۲) وگرنه اولین باری که سرور چپتر را در data.json دید ثبت می‌شود (زمان ذخیره‌ی فایل توسط پنل ادمین).
//   ۳) چپترهای قدیمی/وارداتی (تاریخ شمسی‌شان بیش از ~۳۶ ساعت قبل از ذخیره است) و همه‌ی چپترهای موجود در
//      اولین اجرا، با شروع همان روز شمسی ثبت می‌شوند تا بعد از دیپلوی چپترهای قدیمی ناگهان قفل نشوند.
//
// ذخیره: data/chapter-times.json (روی همان دیسک دائمی که data.json هست). نوشتن اتمیک.

const fs = require("fs");
const path = require("path");
const { parseJalaliDateMs, explicitReleaseMs, HOUR_MS } = require("./accessPolicy");

const FILE = process.env.CHAPTER_TIMES_PATH || path.join(__dirname, "..", "data", "chapter-times.json");
const OLD_IMPORT_MS = 36 * HOUR_MS;

let times = null; // Map<"slug|num", ms>

function keyOf(slug, num) {
  return `${slug}|${Number(num)}`;
}

function load() {
  if (times) return times;
  times = new Map();
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [k, v] of Object.entries(obj)) if (Number.isFinite(v)) times.set(k, v);
    times.__existed = true;
  } catch (e) {
    times.__existed = false;
    if (e.code !== "ENOENT") console.error("[chapterTimes] خواندن فایل ناموفق بود:", e.message);
  }
  return times;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(times)), "utf8");
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error("[chapterTimes] ذخیره ناموفق بود:", e.message);
  }
}

/** بعد از هر بار خواندن data.json از دیسک صدا زده می‌شود. savedAtMs = mtime فایل data.json */
function sync(data, savedAtMs) {
  const map = load();
  const firstRun = !map.__existed;
  const stamp = Number.isFinite(savedAtMs) && savedAtMs > 0 ? savedAtMs : Date.now();
  let dirty = false;

  for (const [slug, manhwa] of Object.entries(data || {})) {
    if (!manhwa || !Array.isArray(manhwa.episodes)) continue;
    for (const ep of manhwa.episodes) {
      if (!ep || ep.num === undefined || ep.num === null) continue;
      const k = keyOf(slug, ep.num);
      if (map.has(k)) continue;
      const dayStart = parseJalaliDateMs(ep.date);
      let ms;
      if (firstRun) ms = dayStart ?? 0;
      else if (dayStart !== null && stamp - dayStart > OLD_IMPORT_MS) ms = dayStart;
      else ms = stamp;
      map.set(k, ms);
      dirty = true;
    }
  }
  if (dirty || firstRun) {
    map.__existed = true;
    persist();
  }
}

/** زمان انتشار یک چپتر (ms). همیشه عدد برمی‌گرداند. */
function getReleaseMs(slug, episode) {
  const explicit = explicitReleaseMs(episode);
  if (explicit !== null) return explicit;
  const map = load();
  const v = map.get(keyOf(slug, episode.num));
  if (v !== undefined) return v;
  // هنوز sync نشده (نباید پیش بیاید) → تاریخ شمسی یا «خیلی قدیمی» تا کاربر الکی قفل نشود
  return parseJalaliDateMs(episode.date) ?? 0;
}

module.exports = { sync, getReleaseMs };

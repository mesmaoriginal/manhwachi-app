#!/usr/bin/env node
// scripts/migrateToStrips.js
//
// تبدیل همه‌ی چپترهای قدیمی به «تکه‌های بلند WebP» تا تعداد درخواست به
// پارس‌پک چندین برابر کمتر بشه (مثلاً ۱۵۰ عکس -> ۱۰ فایل).
//
// امنیت کار:
//  - عکس‌های اصلی (srcCH<n>) هیچ‌وقت پاک یا تغییر داده نمی‌شن. تکه‌ها تو یک
//    پوشه‌ی جدا (stripCH<n>) ذخیره می‌شن، پس برگشت همیشه ممکنه.
//  - قبل از هر تغییر تو data.json یک بک‌آپ با تاریخ گرفته می‌شه.
//  - قابل ادامه‌ست: پیشرفت تو scripts/.migrate-progress.json ذخیره می‌شه و اگه
//    وسط کار قطع بشه، دوباره اجرا کنی از همون‌جا ادامه می‌ده.
//  - سرعت درخواست‌ها به پارس‌پک محدوده (پیش‌فرض ~۲۰۰ در دقیقه) تا خودِ
//    مایگریشن 429 نگیره.
//
// نحوه‌ی اجرا (از ریشه‌ی پروژه، همون جایی که .env هست):
//   node scripts/migrateToStrips.js --dry-run          فقط گزارش، بدون هیچ تغییری
//   node scripts/migrateToStrips.js --slug=my-manhwa --chapter=1   تست روی یک چپتر
//   node scripts/migrateToStrips.js                    اجرای کامل
//
// گزینه‌ها:
//   --data=مسیر/data.json     (یا متغیر DATA_JSON) اگه خودکار پیدا نشد
//   --slug=  --chapter=  --limit=N   محدودکردن دامنه
//   --width=800  --max-height=15000  --quality=80  --interval=300
//   --lossless    کیفیت واقعاً ۱۰۰٪ (بدون افت). همراه --width=auto یعنی نه کیفیت کم می‌شه نه عرض
//   --width=auto  عرض خروجی = عرض خود عکس‌های اصلی
//   --rebuild     چپترهایی که قبلاً با کیفیت پایین‌تر تکه‌ای شدن رو دوباره بساز (عکس اصلی‌ها باید هنوز روی S3 باشن)
//   --no-warm     کپی تکه‌ها رو تو image-cache نذار
//   --no-apply    فقط آپلود کن، data.json رو عوض نکن
//   --apply-only  آپلود نکن، فقط نتیجه‌های ذخیره‌شده رو تو data.json اعمال کن
//   --redo        چپتری که قبلاً با ساختار/اسم قدیمی (stripCH<n> یا part01) تبدیل شده رو دوباره
//                 با اسم‌گذاری فعلی (CH<n>/001.webp) بساز (عکس‌های اصلی از روی پیشرفت ذخیره‌شده خونده می‌شن)

try { require("dotenv").config(); } catch { /* dotenv نصب نیست، از env موجود استفاده می‌شه */ }

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { listChapterImageKeys } = require("../lib/chapterCache");

// کلاینت جدا با maxAttempts=1: SDK خودش روی 429 چند بار دوباره درخواست می‌زنه و
// هر کدوم تو سقف پارس‌پک شمرده می‌شه. اینجا retry رو خودمون کنترل می‌کنیم.
const s3 = new S3Client({
  endpoint: process.env.PARSPACK_ENDPOINT,
  region: "default",
  credentials: {
    accessKeyId: process.env.PARSPACK_ACCESS_KEY,
    secretAccessKey: process.env.PARSPACK_SECRET_KEY,
  },
  forcePathStyle: true,
  maxAttempts: 1,
});

// ---------- آرگومان‌ها ----------
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};

// --width=auto: عرض خروجی = عرض واقعی اولین عکس چپتر (بدون کوچک/بزرگ کردن)
const WIDTH_AUTO = opt("width") === "auto";
const WIDTH = WIDTH_AUTO ? 800 : Number(opt("width") || 800);
const MAX_STRIP_HEIGHT = Number(opt("max-height") || 15000); // سقف WebP: 16383
const QUALITY = Number(opt("quality") || 80);
// --lossless: WebP بدون افت کیفیت (واقعاً ۱۰۰٪؛ quality=100 هم هنوز lossy حساب می‌شه)
const LOSSLESS = flag("lossless");
const INTERVAL_MS = Number(opt("interval") || 300);
const DRY = flag("dry-run");
const WARM = !flag("no-warm");
const APPLY = !flag("no-apply");
const APPLY_ONLY = flag("apply-only");
const REBUILD = flag("rebuild"); // مثل --redo، ولی چپترهایی که الان تکه‌ای هستن رو هم دوباره می‌سازه
const REDO = flag("redo") || REBUILD;
const ONLY_SLUG = opt("slug");
const ONLY_CHAPTER = opt("chapter") !== null ? Number(opt("chapter")) : null;
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;

const BUCKET = process.env.PARSPACK_BUCKET;
const ROOT = path.join(__dirname, "..");
const IMAGE_CACHE_DIR = path.join(ROOT, "image-cache");
const PROGRESS_FILE = path.join(__dirname, ".migrate-progress.json");

// ---------- پیدا کردن data.json ----------
function findDataFile() {
  const explicit = opt("data") || process.env.DATA_JSON;
  const candidates = [
    explicit,
    path.join(ROOT, "data", "data.json"),
    path.join(ROOT, "data.json"),
    path.join(ROOT, "..", "data", "data.json"),
    path.join(ROOT, "..", "data.json"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return path.resolve(c);
  console.error("data.json پیدا نشد. مسیرش رو با --data=/path/to/data.json بده.");
  process.exit(1);
}

// ---------- pacing تطبیقی + retry روی 429 ----------
// اگه پارس‌پک 429 داد، فاصله‌ی بین درخواست‌ها خودکار بیشتر می‌شه؛ وقتی چند
// درخواست پشت‌سرهم موفق بود، آروم‌آروم به سرعت پایه برمی‌گرده.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_INTERVAL_MS = 5000;
let curInterval = INTERVAL_MS;
let okStreak = 0;
let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + curInterval;
  if (start > now) await sleep(start - now);
}
function isThrottled(err) {
  return (
    err?.$metadata?.httpStatusCode === 429 ||
    err?.name === "SlowDown" ||
    /too many requests/i.test(err?.message || "")
  );
}
async function paced(fn) {
  for (let attempt = 0; ; attempt++) {
    await pace();
    try {
      const r = await fn();
      if (++okStreak >= 30 && curInterval > INTERVAL_MS) {
        curInterval = Math.max(INTERVAL_MS, Math.round(curInterval * 0.8));
        okStreak = 0;
        console.log(`  سرعت کمی بالا رفت (فاصله ${curInterval}ms)`);
      }
      return r;
    } catch (err) {
      if (!isThrottled(err)) throw err;
      okStreak = 0;
      curInterval = Math.min(MAX_INTERVAL_MS, Math.round(curInterval * 1.5));
      if (attempt >= 12) throw err;
      const delay = Math.min(2000 * 2 ** Math.min(attempt, 5), 60000) + Math.random() * 1000;
      nextSlot = Math.max(nextSlot, Date.now() + delay);
      console.warn(`  429 از پارس‌پک (تلاش ${attempt + 1}/12) - ${Math.round(delay / 1000)}s صبر، فاصله‌ی جدید ${curInterval}ms`);
      await sleep(delay);
    }
  }
}

async function getObjectBuffer(key) {
  return paced(async () => {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return Buffer.from(await obj.Body.transformToByteArray());
  });
}

async function putObject(key, buffer) {
  return paced(() =>
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    )
  );
}

// همون الگوی اسم‌گذاری lib/imageProxyCache.js (keyToCachePath)
function writeToImageCache(key, buffer) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
  const p = path.join(IMAGE_CACHE_DIR, key.replace(/[^a-zA-Z0-9._-]/g, "_"));
  fs.writeFileSync(p, buffer);
  fs.writeFileSync(p + ".meta.json", JSON.stringify({ contentType: "image/webp" }));
}

// ---------- ساخت تکه‌ها (استریمی: حافظه محدود می‌مونه) ----------
async function processChapter(slug, num, originals) {
  const prefix = `manhwas/${slug}/CH${num}/`; // مستقیم تو پوشه‌ی CH<n> (کنار srcCH<n>)
  const outKeys = [];
  let width = WIDTH;
  let firstBody = null;
  if (WIDTH_AUTO) {
    firstBody = await getObjectBuffer(originals[0]);
    width = (await sharp(firstBody).metadata()).width || WIDTH;
  }
  let group = [];
  let groupH = 0;

  const flush = async () => {
    if (!group.length) return;
    const key = `${prefix}${String(outKeys.length + 1).padStart(3, "0")}.webp`;
    let top = 0;
    const composite = group.map((g) => {
      const c = {
        input: g.data,
        raw: { width: g.width, height: g.height, channels: g.channels },
        top,
        left: 0,
      };
      top += g.height;
      return c;
    });
    const buffer = await sharp({
      create: { width, height: top, channels: 3, background: "#ffffff" },
    })
      .composite(composite)
      .webp(LOSSLESS ? { lossless: true } : { quality: QUALITY })
      .toBuffer();
    await putObject(key, buffer);
    if (WARM) writeToImageCache(key, buffer);
    outKeys.push(key);
    group = [];
    groupH = 0;
  };

  for (const key of originals) {
    let body;
    if (firstBody) { body = firstBody; firstBody = null; }
    else body = await getObjectBuffer(key);
    const { data, info } = await sharp(body)
      .flatten({ background: "#ffffff" })
      .resize({ width })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.height > 16383) {
      throw new Error(`تصویر ${key} بعد از تغییر اندازه ${info.height}px ارتفاع داره (سقف WebP: 16383)`);
    }
    if (group.length && groupH + info.height > MAX_STRIP_HEIGHT) await flush();
    group.push({ data, width: info.width, height: info.height, channels: info.channels });
    groupH += info.height;
  }
  await flush();
  return outKeys;
}

// ---------- کمکی‌ها ----------
// ساختار فعلی: .../CH<n>/001.webp
// ساختارهای قبلی (که --redo جایگزینشون می‌کنه): .../CH<n>/part01.webp و .../CH<n>/stripCH<n>/part01.webp
const isFlatStripKey = (k) => typeof k === "string" && /\/CH\d+\/\d{3}\.webp$/.test(k);
const isStripKey = (k) =>
  typeof k === "string" && /\/CH\d+\/(?:\d{3}|part\d+|stripCH\d+\/part\d+)\.webp$/.test(k);
const sameArray = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return {}; }
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- اعمال نتیجه‌ها روی data.json ----------
function applyToDataFile(dataFile, progress) {
  const fresh = JSON.parse(fs.readFileSync(dataFile, "utf8")); // دوباره می‌خونیم تا تغییرات همین الان ادمین گم نشه
  let applied = 0, skipped = 0;

  for (const [id, rec] of Object.entries(progress)) {
    const [slug, numStr] = id.split("::");
    const ep = fresh[slug]?.episodes?.find((e) => Number(e.num) === Number(numStr));
    if (!ep) { skipped++; continue; }
    if (sameArray(ep.images, rec.strips)) continue; // قبلاً اعمال شده
    if (!sameArray(ep.images, rec.originals) && !sameArray(ep.images, rec.replaces || [])) {
      console.warn(`  رد شد (images از زمان مایگریشن عوض شده): ${id}`);
      skipped++;
      continue;
    }
    ep.images = rec.strips;
    applied++;
  }

  if (!applied) { console.log("چیزی برای اعمال روی data.json نبود."); return; }

  const backup = `${dataFile}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(dataFile, backup);
  atomicWriteJson(dataFile, fresh);
  console.log(`data.json به‌روز شد: ${applied} چپتر اعمال، ${skipped} رد. بک‌آپ: ${backup}`);
  console.log("⚠️  سرور رو ری‌استارت کن تا کش‌های حافظه (dataStore و لینک‌های امضاشده) تازه بشن.");
}

// ---------- main ----------
(async () => {
  if (!BUCKET && !DRY && !APPLY_ONLY) { console.error("PARSPACK_BUCKET تنظیم نشده (.env رو چک کن)."); process.exit(1); }

  console.log(
    `تنظیمات: عرض=${WIDTH_AUTO ? "auto (اصلی)" : WIDTH} | ${LOSSLESS ? "lossless" : `quality=${QUALITY}`}${REBUILD ? " | rebuild" : ""}`
  );
  const dataFile = findDataFile();
  console.log(`data.json: ${dataFile}`);
  const progress = loadProgress();

  if (APPLY_ONLY) { applyToDataFile(dataFile, progress); return; }

  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));

  // فهرست کارها
  const work = [];
  let alreadyDone = 0, badData = 0;
  for (const [slug, manhwa] of Object.entries(data)) {
    if (ONLY_SLUG && slug !== ONLY_SLUG) continue;
    for (const ep of manhwa?.episodes || []) {
      if (ONLY_CHAPTER !== null && Number(ep.num) !== ONLY_CHAPTER) continue;
      const id = `${slug}::${Number(ep.num)}`;
      const imgs = Array.isArray(ep.images) ? ep.images : [];
      if (REDO) {
        if (!REBUILD && imgs.length && imgs.every(isFlatStripKey)) { alreadyDone++; continue; }
        if (!progress[id]?.originals?.length) {
          console.warn(`  رد شد (برای --redo سابقه‌ی عکس‌های اصلی تو progress نیست): ${id}`);
          badData++;
          continue;
        }
        work.push({ slug, num: Number(ep.num), id, originals: progress[id].originals, replaces: imgs });
        continue;
      }
      if (imgs.length && imgs.every(isStripKey)) { alreadyDone++; continue; }
      if (progress[id] && (imgs.length === 0 || sameArray(progress[id].originals, imgs))) { alreadyDone++; continue; }
      if (imgs.some((k) => typeof k !== "string")) {
        console.warn(`  رد شد (images شامل مقدار غیررشته‌ای است): ${id}`);
        badData++;
        continue;
      }
      work.push({ slug, num: Number(ep.num), id, originals: imgs });
    }
  }
  const batch = work.slice(0, LIMIT);

  const totalImgs = batch.reduce((s, w) => s + w.originals.length, 0);
  const etaMin = Math.ceil(((totalImgs + batch.length * 12) * INTERVAL_MS) / 60000);
  console.log(`چپتر برای تبدیل: ${batch.length} | قبلاً انجام‌شده: ${alreadyDone} | داده‌ی مشکل‌دار: ${badData}`);
  console.log(`عکس برای دانلود: ${totalImgs} (+ چپترهایی که images خالی دارن) | زمان تقریبی: ~${etaMin} دقیقه`);
  if (DRY) { console.log("--dry-run: هیچ تغییری داده نشد."); return; }

  let ok = 0, failed = 0;
  for (let i = 0; i < batch.length; i++) {
    const w = batch[i];
    console.log(`[${i + 1}/${batch.length}] ${w.id}`);
    try {
      let originals = w.originals;
      if (originals.length === 0) {
        originals = await paced(() => listChapterImageKeys(w.slug, w.num));
        if (originals.length === 0) { console.warn("  هیچ عکسی تو پارس‌پک نبود - رد شد"); failed++; continue; }
      }
      const strips = await processChapter(w.slug, w.num, originals);
      progress[w.id] = { originals: w.originals, strips, replaces: w.replaces || [] };
      saveProgress(progress);
      console.log(`  ✓ ${originals.length} عکس -> ${strips.length} تکه`);
      ok++;
    } catch (err) {
      console.error(`  ✗ خطا: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nتمام شد: موفق ${ok} | ناموفق ${failed}`);

  if (APPLY) applyToDataFile(dataFile, progress);
  else console.log("--no-apply: برای اعمال روی data.json بعداً با --apply-only اجرا کن.");
})().catch((err) => { console.error(err); process.exit(1); });

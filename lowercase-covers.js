#!/usr/bin/env node
// lowercase-covers.js
//
// اسم فایل کاورِ فقط همین مانهواهای لیست‌شده رو به حروف کوچیک تبدیل می‌کنه:
//   1) data.json  →  فیلد cover_image
//   2) S3 (پارس‌پک) →  manhwas/<slug>/<Cover.JPG>  کپی می‌شه به  manhwas/<slug>/<cover.jpg>
//
// کنار server.js بذار و اجرا کن:
//
//   node lowercase-covers.js                     ← فقط گزارش (dry-run)
//   node lowercase-covers.js --apply             ← فقط data.json (با بکاپ)
//   node lowercase-covers.js --apply --s3        ← + کپی فایل کاور روی S3
//   node lowercase-covers.js --apply --s3 --delete-old   ← + حذف فایل قدیمی S3
//   node lowercase-covers.js --data /path/to/data.json
//
// نکته: اگه قبلاً lowercase-slugs.js رو با --apply اجرا کردی، slug ها همین حالا
// lowercase هستن و این اسکریپت درست کار می‌کنه (slug ها case-insensitive تطبیق داده می‌شن).
// بعد از --apply سرور رو ری‌استارت کن.

const fs = require("fs");
const path = require("path");

try { require("dotenv").config(); } catch { /* dotenv نصب نیست */ }

const SLUGS = [
  "error-d-echo",
  "the-demon-king-s-friend",
  "space-marines-now-have-a-status-window",
  "the-crazy-villain-regains-his-sanity",
  "starting-my-new-life-as-a-demon-kid",
  "blade-of-the-discarded",
  "solo-swordmaster",
  "sword-of-the-undying",
  "the-hero-cannot-rest",
  "the-male-lead-i-raised-is-obsessed-with-me",
];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argVal = (f) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : null;
};

const APPLY = has("--apply");
const DO_S3 = has("--s3");
const DELETE_OLD = has("--delete-old");
const DATA_PATH =
  argVal("--data") ||
  process.env.DATA_JSON_PATH ||
  path.join(__dirname, "data", "data.json");

const log = (...a) => console.log(...a);

if (!fs.existsSync(DATA_PATH)) {
  console.error(`❌ فایل پیدا نشد: ${DATA_PATH}\n   مسیر درست رو با --data بده.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const wanted = new Set(SLUGS.map((s) => s.toLowerCase()));

// ---------- ساخت پلن ----------
const plan = []; // { key, slug, from, to }
const skipped = [];
const found = new Set();

for (const key of Object.keys(data)) {
  const lk = key.toLowerCase();
  if (!wanted.has(lk)) continue;
  found.add(lk);

  const from = (data[key] && data[key].cover_image) || "";
  if (!from) {
    skipped.push(`${key}: cover_image خالیه`);
    continue;
  }
  const to = from.toLowerCase();
  if (to === from) {
    skipped.push(`${key}: از قبل lowercase (${from})`);
    continue;
  }
  plan.push({ key, slug: key, from, to });
}

const missing = SLUGS.filter((s) => !found.has(s));

log(`فایل: ${DATA_PATH}`);
log(`نیازمند تغییر: ${plan.length} | ردشده: ${skipped.length} | پیدا نشده: ${missing.length}\n`);
for (const p of plan) log(`  ${p.slug}:  ${p.from}  →  ${p.to}`);
if (skipped.length) { log("\nردشده:"); skipped.forEach((s) => log("  " + s)); }
if (missing.length) { log("\n⚠️ توی data.json نبودن:"); missing.forEach((s) => log("  " + s)); }

// ---------- S3 ----------
async function migrateS3() {
  const {
    CopyObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  } = require("@aws-sdk/client-s3");
  const { s3 } = require("./lib/chapterCache");
  const Bucket = process.env.PARSPACK_BUCKET;
  if (!Bucket) throw new Error("PARSPACK_BUCKET تنظیم نشده");

  const encodeKey = (k) => k.split("/").map(encodeURIComponent).join("/");
  const exists = async (Key) => {
    try { await s3.send(new HeadObjectCommand({ Bucket, Key })); return true; }
    catch { return false; }
  };

  async function copyOne(srcKey, dstKey) {
    try {
      await s3.send(new CopyObjectCommand({
        Bucket, Key: dstKey, CopySource: `${Bucket}/${encodeKey(srcKey)}`,
      }));
    } catch {
      const got = await s3.send(new GetObjectCommand({ Bucket, Key: srcKey }));
      const chunks = [];
      for await (const c of got.Body) chunks.push(c);
      await s3.send(new PutObjectCommand({
        Bucket, Key: dstKey, Body: Buffer.concat(chunks), ContentType: got.ContentType,
      }));
    }
  }

  const okSet = new Set();
  for (const p of plan) {
    const src = `manhwas/${p.slug}/${p.from}`;
    const dst = `manhwas/${p.slug}/${p.to}`;
    if (!(await exists(src))) {
      // شاید قبلاً کپی شده
      if (await exists(dst)) { log(`  [S3] ${p.slug}: مقصد از قبل هست`); okSet.add(p.key); }
      else log(`  [S3] ${p.slug}: فایل ${src} پیدا نشد`);
      continue;
    }
    log(`  [S3] ${src}  →  ${dst}`);
    if (!APPLY) continue;
    try {
      await copyOne(src, dst);
      okSet.add(p.key);
      if (DELETE_OLD) {
        await s3.send(new DeleteObjectCommand({ Bucket, Key: src }));
        log("     فایل قدیمی حذف شد");
      }
    } catch (e) {
      console.error(`     ❌ ${src}: ${e.message}`);
    }
  }
  return okSet;
}

(async () => {
  if (!plan.length) { log("\n✅ چیزی برای تغییر نیست."); return; }

  if (!APPLY) {
    log("\n(dry-run) هیچ تغییری اعمال نشد. برای اعمال: --apply");
    if (DO_S3) { log("\nپیش‌نمایش S3:"); await migrateS3(); }
    return;
  }

  // اول S3؛ فقط مانهواهایی که فایلشون واقعاً کپی شد توی data.json عوض می‌شن
  let toApply = plan;
  if (DO_S3) {
    log("\nS3:");
    const ok = await migrateS3();
    toApply = plan.filter((p) => ok.has(p.key));
    if (toApply.length !== plan.length) {
      log(`\n⚠️ ${plan.length - toApply.length} مورد به‌خاطر خطا/نبودن فایل توی data.json عوض نشد.`);
    }
  }

  for (const p of toApply) data[p.key].cover_image = p.to;

  const backup = `${DATA_PATH}.bak-${Date.now()}`;
  fs.copyFileSync(DATA_PATH, backup);
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_PATH);

  log(`\n✅ ${toApply.length} کاور اصلاح شد. بکاپ: ${backup}`);
  log("⚠️ سرور رو ری‌استارت کن تا کش data.json تازه بشه.");
  if (!DO_S3) log("ℹ️ بدون --s3 فایل‌های S3 جابه‌جا نشدن؛ اگه اسم فایل روی S3 فرق کنه کاور 404 می‌ده.");
})().catch((e) => {
  console.error("❌ خطا:", e);
  process.exit(1);
});

#!/usr/bin/env node
// lowercase-slugs.js
//
// همه‌ی slug های data.json رو به حروف کوچیک تبدیل می‌کنه.
// اختیاری: پوشه‌های manhwas/<Slug>/ روی S3 (پارس‌پک) رو هم به مسیر lowercase کپی می‌کنه.
//
// این فایل رو کنار server.js بذار (ریشه‌ی پروژه) و اجرا کن:
//
//   node lowercase-slugs.js                      ← فقط گزارش (dry-run)، هیچی تغییر نمی‌کنه
//   node lowercase-slugs.js --apply              ← data.json رو اصلاح می‌کنه (با بکاپ)
//   node lowercase-slugs.js --apply --s3         ← + کپی فایل‌های S3 به مسیر جدید
//   node lowercase-slugs.js --apply --s3 --delete-old
//                                                ← + حذف فایل‌های قدیمی S3 (فقط بعد از اینکه مطمئن شدی)
//   node lowercase-slugs.js --data /path/to/data.json
//
// بعد از اجرا با --apply سرور رو ری‌استارت کن (کش data.json پاک بشه).

const fs = require("fs");
const path = require("path");

try { require("dotenv").config(); } catch { /* dotenv نصب نیست؛ اشکالی نداره */ }

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

// ---------- ۱) خوندن data.json و پیدا کردن slug های نیازمند تغییر ----------
if (!fs.existsSync(DATA_PATH)) {
  console.error(`❌ فایل پیدا نشد: ${DATA_PATH}\n   مسیر درست رو با --data بده.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const oldKeys = Object.keys(data);

const plan = [];       // [{from, to}]
const conflicts = [];  // slug هایی که lowercase‌شون با یه slug دیگه یکی می‌شه
const existing = new Set(oldKeys);
const targets = new Map(); // to -> from (برای تشخیص دو slug که هر دو به یک مقصد می‌رسن)

for (const key of oldKeys) {
  const to = key.trim().toLowerCase();
  if (to === key) continue;
  if (existing.has(to) || targets.has(to)) {
    conflicts.push({ from: key, to, with: existing.has(to) ? to : targets.get(to) });
    continue;
  }
  targets.set(to, key);
  plan.push({ from: key, to });
}

log(`فایل: ${DATA_PATH}`);
log(`کل slug ها: ${oldKeys.length} | نیازمند تغییر: ${plan.length} | تداخل: ${conflicts.length}\n`);

for (const { from, to } of plan) log(`  ${from}  →  ${to}`);
if (conflicts.length) {
  log("\n⚠️ تداخل (این‌ها دست نمی‌خورن، باید دستی تصمیم بگیری):");
  for (const c of conflicts) log(`  ${c.from}  →  ${c.to}  (قبلاً وجود داره: ${c.with})`);
}

// ---------- ۲) ساخت data جدید (کلیدها + مسیرهای manhwas/<slug>/ داخل مقادیر) ----------
function rewriteStrings(node, renames) {
  if (typeof node === "string") {
    let s = node;
    for (const { from, to } of renames) {
      const needle = `manhwas/${from}/`;
      if (s.includes(needle)) s = s.split(needle).join(`manhwas/${to}/`);
    }
    return s;
  }
  if (Array.isArray(node)) return node.map((v) => rewriteStrings(v, renames));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = rewriteStrings(v, renames);
    return out;
  }
  return node;
}

const renameMap = new Map(plan.map((p) => [p.from, p.to]));
const newData = {};
for (const key of oldKeys) {
  newData[renameMap.get(key) || key] = data[key];
}
const finalData = rewriteStrings(newData, plan);

// ---------- ۳) S3 ----------
async function migrateS3() {
  const {
    ListObjectsV2Command,
    CopyObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
  } = require("@aws-sdk/client-s3");
  const { s3 } = require("./lib/chapterCache");
  const Bucket = process.env.PARSPACK_BUCKET;
  if (!Bucket) throw new Error("PARSPACK_BUCKET تنظیم نشده");

  const encodeKey = (k) => k.split("/").map(encodeURIComponent).join("/");

  async function listAll(prefix) {
    const keys = [];
    let ContinuationToken;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }));
      for (const o of r.Contents || []) keys.push(o.Key);
      ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return keys;
  }

  async function copyOne(srcKey, dstKey) {
    try {
      await s3.send(new CopyObjectCommand({
        Bucket,
        Key: dstKey,
        CopySource: `${Bucket}/${encodeKey(srcKey)}`,
      }));
    } catch {
      // بعضی S3-سازگارها CopyObject رو کامل ساپورت نمی‌کنن → دانلود + آپلود
      const got = await s3.send(new GetObjectCommand({ Bucket, Key: srcKey }));
      const chunks = [];
      for await (const c of got.Body) chunks.push(c);
      await s3.send(new PutObjectCommand({
        Bucket,
        Key: dstKey,
        Body: Buffer.concat(chunks),
        ContentType: got.ContentType,
      }));
    }
  }

  for (const { from, to } of plan) {
    const srcPrefix = `manhwas/${from}/`;
    const dstPrefix = `manhwas/${to}/`;
    const srcKeys = await listAll(srcPrefix);
    if (!srcKeys.length) {
      log(`  [S3] ${from}: چیزی زیر ${srcPrefix} نیست (شاید از قبل lowercase بوده)`);
      continue;
    }
    log(`  [S3] ${from}: ${srcKeys.length} فایل → ${dstPrefix}`);
    if (!APPLY) continue;

    let ok = 0;
    for (const k of srcKeys) {
      const dst = dstPrefix + k.slice(srcPrefix.length);
      try {
        await copyOne(k, dst);
        ok++;
      } catch (e) {
        console.error(`     ❌ ${k}: ${e.message}`);
      }
    }
    log(`     کپی شد: ${ok}/${srcKeys.length}`);

    if (DELETE_OLD && ok === srcKeys.length) {
      for (const k of srcKeys) await s3.send(new DeleteObjectCommand({ Bucket, Key: k }));
      log(`     فایل‌های قدیمی حذف شدن`);
    } else if (DELETE_OLD) {
      log(`     ⚠️ چون همه‌ی فایل‌ها کپی نشدن، چیزی حذف نشد`);
    }
  }
}

// ---------- ۴) اجرا ----------
(async () => {
  if (!plan.length) {
    log("\n✅ همه‌ی slug ها از قبل lowercase هستن.");
    return;
  }

  if (!APPLY) {
    log("\n(dry-run) هیچ تغییری اعمال نشد. برای اعمال: --apply");
    if (DO_S3) {
      log("\nپیش‌نمایش S3:");
      await migrateS3();
    }
    return;
  }

  // ترتیب مهم: اول S3 (اگه خواسته شده) تا اگه خطا خورد data.json دست‌نخورده بمونه
  if (DO_S3) {
    log("\nS3:");
    await migrateS3();
  }

  const backup = `${DATA_PATH}.bak-${Date.now()}`;
  fs.copyFileSync(DATA_PATH, backup);
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(finalData, null, 2), "utf8");
  fs.renameSync(tmp, DATA_PATH);

  log(`\n✅ data.json اصلاح شد. بکاپ: ${backup}`);
  log("⚠️ سرور رو ری‌استارت کن تا کش data.json تازه بشه.");
  log("⚠️ اگه جدول‌های دیتابیس (امتیاز، بوکمارک، کامنت و...) slug رو ذخیره می‌کنن، اون‌ها جداگانه باید lowercase بشن.");
})().catch((e) => {
  console.error("❌ خطا:", e);
  process.exit(1);
});

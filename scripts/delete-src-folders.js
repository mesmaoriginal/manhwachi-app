// scripts/delete-src-folders.js
//
// حذف پوشه‌های srcCH<n> مانهواهای مشخص‌شده از S3 (پارس‌پک).
//
// پیش‌فرض Dry-run هست (فقط نشون می‌ده چی حذف می‌شه، هیچی پاک نمی‌کنه):
//   node scripts/delete-src-folders.js slug1 slug2 slug3
//
// حذف واقعی:
//   node scripts/delete-src-folders.js --yes slug1 slug2 slug3
//
// سیفتی: یک فایل داخل srcCH<n>/ فقط وقتی پاک می‌شه که همون اسم فایل
// داخل پوشه‌ی CH<n>/ (یک سطح بالاتر) هم وجود داشته باشه. فایلی که
// نسخه‌ی جدید نداره دست نمی‌خوره و گزارش می‌شه.

const { s3 } = require("../lib/chapterCache");
const { ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const BUCKET = process.env.PARSPACK_BUCKET;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listAllKeys(prefix) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    (res.Contents || []).forEach((o) => o.Key && keys.push(o.Key));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    await sleep(150);
  } while (token);
  return keys;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--yes");
  const slugs = args.filter((a) => !a.startsWith("--"));

  if (slugs.length === 0) {
    console.log("حداقل یک slug بده. مثال: node scripts/delete-src-folders.js --yes slug1 slug2");
    process.exit(1);
  }

  console.log(execute ? "⚠️  حالت حذف واقعی\n" : "🔍 Dry-run (چیزی حذف نمی‌شه، برای حذف واقعی --yes بزن)\n");

  let totalDelete = 0;
  let totalSkipped = 0;

  for (const slug of slugs) {
    const base = `manhwas/${slug}/`;
    const allKeys = await listAllKeys(base);
    const keySet = new Set(allKeys);
    const srcRe = new RegExp(`^${escapeRegex(base)}CH(\\d+)/srcCH\\1/(.*)$`);

    const toDelete = [];
    const skipped = [];

    for (const key of allKeys) {
      const m = key.match(srcRe);
      if (!m) continue;
      const [, ch, rest] = m;

      // placeholder خودِ پوشه (کلید خالی که به / ختم می‌شه)
      if (rest === "" || key.endsWith("/")) {
        toDelete.push(key);
        continue;
      }

      const counterpart = `${base}CH${ch}/${rest}`;
      if (keySet.has(counterpart)) {
        toDelete.push(key);
      } else {
        skipped.push(key);
      }
    }

    console.log(`[${slug}] برای حذف: ${toDelete.length} | رد شده (بدون نسخه‌ی جدید): ${skipped.length}`);
    skipped.slice(0, 10).forEach((k) => console.log(`   ⛔ ${k}`));
    if (skipped.length > 10) console.log(`   ... و ${skipped.length - 10} مورد دیگه`);

    totalDelete += toDelete.length;
    totalSkipped += skipped.length;

    if (!execute) continue;

    let done = 0;
    for (const key of toDelete) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        done++;
      } catch (err) {
        console.log(`   ❌ ${key}: ${err.message}`);
      }
      await sleep(50);
    }
    console.log(`   ✅ ${done}/${toDelete.length} حذف شد.\n`);
  }

  console.log(`\nمجموع ${execute ? "حذف‌شده/تلاش‌شده" : "قابل حذف"}: ${totalDelete} | رد شده: ${totalSkipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("خطا:", err);
    process.exit(1);
  });

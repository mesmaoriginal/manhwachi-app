// scripts/migrate-episode-images.js
//
// اسکریپت یک‌بارمصرف: برای هر اپیزود قدیمی که فیلد images نداره (یعنی
// چپترهایی که قبل از این تغییر ثبت شدن)، لیست واقعی فایل‌هاش رو یک بار
// از S3 می‌گیره و داخل data.json ذخیره می‌کنه. بعد از اجرای موفق این
// اسکریپت، سایت برای این چپترها دیگه هیچ‌وقت مستقیم ListObjectsV2 نمی‌زنه.
//
// اجرا (از ریشه‌ی پروژه، جایی که متغیرهای PARSPACK_* در دسترس‌ان):
//   node scripts/migrate-episode-images.js
//
// اگه env variables رو از یک فایل .env می‌خونید (نه از تنظیمات هاست)،
// قبل از این خط با `node -r dotenv/config scripts/migrate-episode-images.js`
// اجراش کنید یا در ابتدای این فایل require('dotenv').config() اضافه کنید.

const { readData, updateData } = require("../admin/dataStore");
const { listChapterImageKeys } = require("../lib/chapterCache");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// فاصله‌ی کوچیک بین هر چپتر: صرفاً یک لایه‌ی احتیاط اضافه، تا این
// اسکریپتِ یک‌بارمصرف هم - حتی با وجود صف همزمانی داخل chapterCache.js -
// فشار ناگهانی زیادی به پارس‌پک وارد نکنه.
const DELAY_BETWEEN_CHAPTERS_MS = 300;

async function main() {
  const data = readData();
  const slugs = Object.keys(data);

  let totalEpisodes = 0;
  let migrated = 0;
  let skippedAlready = 0;
  let failed = 0;

  console.log(`[migrate] ${slugs.length} مانهوا پیدا شد. شروع...\n`);

  for (const slug of slugs) {
    const manhwa = data[slug];
    const episodes = Array.isArray(manhwa.episodes) ? manhwa.episodes : [];

    for (const ep of episodes) {
      totalEpisodes++;

      if (Array.isArray(ep.images) && ep.images.length > 0) {
        skippedAlready++;
        continue;
      }

      const num = Number(ep.num);
      process.stdout.write(`[migrate] ${slug} - چپتر ${num} ... `);

      try {
        const images = await listChapterImageKeys(slug, num);

        if (images.length === 0) {
          console.log("⚠️  هیچ فایلی روی S3 پیدا نشد، رد شد (بعداً با دکمه‌ی resync امتحان کن).");
          failed++;
        } else {
          await updateData((d) => {
            const m = d[slug];
            if (!m) return;
            const target = (m.episodes || []).find((e) => Number(e.num) === num);
            if (target) target.images = images;
          });
          console.log(`✅ ${images.length} تصویر ذخیره شد.`);
          migrated++;
        }
      } catch (err) {
        console.log(`❌ خطا: ${err.message}`);
        failed++;
      }

      await sleep(DELAY_BETWEEN_CHAPTERS_MS);
    }
  }

  console.log("\n---------------------------------------------");
  console.log(`مجموع اپیزودها:              ${totalEpisodes}`);
  console.log(`از قبل images داشتن (رد شد): ${skippedAlready}`);
  console.log(`با موفقیت migrate شد:        ${migrated}`);
  console.log(`ناموفق:                      ${failed}`);
  console.log("---------------------------------------------");
  if (failed > 0) {
    console.log(
      "برای موارد ناموفق، از پنل ادمین دکمه‌ی resync-images همون چپتر رو بزن یا این اسکریپت رو دوباره اجرا کن."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("خطای کلی اسکریپت:", err);
    process.exit(1);
  });

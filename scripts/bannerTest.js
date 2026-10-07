// تست مستقل ساخت بنر (بدون پنل): از ریشه‌ی پروژه اجرا کن
//   node scripts/bannerTest.js "علی رضایی" "Ali Rezaei" "سارا"      → out.png
//   node scripts/bannerTest.js مترجم تایپیست کلینر <کلید-تصویر-در-S3>   (آرگومان چهارم اختیاری)
require("dotenv").config?.();
const fs = require("fs");
const { buildBanner } = require("../lib/teamBanner");
const [translator, typist, cleaner, coverKey] = process.argv.slice(2);
if (!translator) { console.log('نمونه: node scripts/bannerTest.js "علی رضایی" "Ali Rezaei" "سارا"'); process.exit(1); }
buildBanner({ names: { translator, typist, cleaner }, coverKey: coverKey || null })
  .then((b) => { fs.writeFileSync("out.png", b); console.log("OK → out.png", b.length, "bytes"); })
  .catch((e) => { console.error("خطا:", e.message); process.exit(1); });

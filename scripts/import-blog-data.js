// scripts/import-blog-data.js
// انتقال مطالب/کاربران وبلاگ از خروجی سوپابیس به blog.sqlite (فقط اگر قبلاً مطلبی در سوپابیس داشتید).
//
// ورودی: پوشه‌ی export/ که scripts/export-supabase.js ساخته (فایل‌های blog_staff.json ، blog_categories.json ،
//        blog_posts.json ، blog_pages.json ، blog_media.json — هرکدام که هست).
// استفاده:
//   node scripts/import-blog-data.js ./export            ← فقط گزارش می‌دهد (چیزی نمی‌نویسد)
//   node scripts/import-blog-data.js ./export --apply   ← واقعاً می‌نویسد (اجرای دوباره مشکلی ندارد)
// رمزهای کارکنان (scrypt) همان‌طور که هست منتقل می‌شوند؛ نیازی به ساخت دوباره‌ی کاربر نیست.

try { require("dotenv").config(); } catch { /* dotenv نصب نیست */ }
const fs = require("fs");
const path = require("path");
const { upsertRow, init, TABLES, _file } = require("../blog/blogDb");

const dir = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dir || !fs.existsSync(dir)) {
  console.error("استفاده: node scripts/import-blog-data.js <پوشه‌ی export> [--apply]");
  process.exit(1);
}

init();
console.log(`${apply ? "نوشتن در" : "گزارش برای"}: ${_file()}\n`);

// ترتیب مهم است (کلید خارجی): کارکنان ← دسته‌ها ← مطلب‌ها/صفحه‌ها ← رسانه
let bad = 0;
for (const table of ["blog_staff", "blog_categories", "blog_posts", "blog_pages", "blog_media"]) {
  const f = path.join(dir, table + ".json");
  if (!fs.existsSync(f)) { console.log(`- ${table}: فایلی نیست (رد شد)`); continue; }
  const rows = JSON.parse(fs.readFileSync(f, "utf8"));
  let ok = 0, fail = 0;
  for (const r of rows) {
    // تاریخ‌ها یکدست می‌شوند (2026-01-02T10:00:00.000Z) چون مقایسه‌ی زمان در سایت عمومی متنی است
    for (const c of Object.keys(r)) if (/_at$/.test(c) && typeof r[c] === "string" && !Number.isNaN(Date.parse(r[c]))) r[c] = new Date(r[c]).toISOString();
    try {
      if (apply) upsertRow(table, r);
      ok++;
    } catch (e) {
      fail++; bad++;
      console.log(`  ✗ ${table} ${r.id || ""}: ${e.message}`);
    }
  }
  const unknown = rows.length ? Object.keys(rows[0]).filter((c) => !TABLES[table].cols.has(c)) : [];
  console.log(`- ${table}: ${rows.length} ردیف${apply ? `، موفق ${ok}، ناموفق ${fail}` : ""}${unknown.length ? `  (ستون‌های نادیده: ${unknown.join(", ")})` : ""}`);
}
console.log(apply ? (bad ? "\nبعضی ردیف‌ها منتقل نشدند؛ پیام‌های بالا را ببینید." : "\n✅ انتقال کامل شد.") : "\nچیزی نوشته نشد. اگر گزارش خوب بود با --apply اجرا کنید.");
process.exit(bad ? 1 : 0);

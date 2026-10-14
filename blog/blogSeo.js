// blog/blogSeo.js
// حداقل‌های سئو که قبل از «انتشار» (و حین ویرایشِ مطلب منتشرشده) سمت سرور اعمال می‌شن.
// فقط موارد قطعی و بدون سلیقه؛ هشدارهای نرم (طول عنوان، تعداد کلمات، ...) در پنل نمایش داده می‌شن.

const TEXT_TYPES = new Set(["paragraph", "heading", "list", "quote", "callout", "faq", "table"]);
const filled = (v) => typeof v === "string" && v.trim().length > 0;

// برمی‌گردونه: آرایه‌ای از پیام‌های فارسی (خالی = مشکلی نیست)
function seoProblems(row, kind) {
  const problems = [];
  const blocks = Array.isArray(row.content) ? row.content : [];

  if (!filled(row.title)) problems.push("عنوان خالی است");
  if (!filled(row.slug)) problems.push("نشانک (آدرس) خالی است");
  if (!blocks.some((b) => TEXT_TYPES.has(b.type))) problems.push("مطلب هیچ محتوای متنی ندارد");

  const noAlt = blocks.filter((b) => b.type === "image" && !filled(b.data && b.data.alt)).length;
  if (noAlt) problems.push(`${noAlt} تصویر بدون متن جایگزین (alt) دارید`);

  if (kind === "posts") {
    if (row.cover_url && row.cover_style !== "none" && !filled(row.cover_alt)) {
      problems.push("کاور بدون متن جایگزین (alt) است");
    }
    if (!filled(row.excerpt) && !filled(row.seo_desc)) {
      problems.push("«خلاصه» یا «توضیح سئو» را پر کنید (برای توضیح متای گوگل)");
    }
  }
  return problems;
}

module.exports = { seoProblems };

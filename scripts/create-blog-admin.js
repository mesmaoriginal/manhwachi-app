// scripts/create-blog-admin.js
// ساخت اولین ادمین وبلاگ (جدول‌ها خودکار ساخته می‌شوند؛ نیازی به SQL نیست).
// استفاده:  node scripts/create-blog-admin.js <username> <password> "<نام نمایشی>"
// بقیه‌ی کارکنان رو از داخل پنل می‌سازی.

try { require("dotenv").config(); } catch { /* dotenv نصب نیست؛ env از محیط خونده می‌شه */ }
const { sb } = require("../blog/blogDb");
const { hashPassword } = require("../blog/blogAuth");

(async () => {
  const [username, password, displayName] = process.argv.slice(2);
  if (!username || !password) {
    console.error('استفاده: node scripts/create-blog-admin.js <username> <password> "<نام نمایشی>"');
    process.exit(1);
  }
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    console.error("نام کاربری: ۳ تا ۳۲ حرف کوچک انگلیسی/عدد/._-");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("رمز باید حداقل ۱۰ کاراکتر باشد");
    process.exit(1);
  }
  try {
    await sb("blog_staff", {
      method: "POST",
      body: { username, display_name: displayName || username, password_hash: await hashPassword(password), role: "admin" },
    });
    console.log(`✅ ادمین وبلاگ «${username}» ساخته شد.`);
  } catch (e) {
    console.error("❌ خطا:", e.status === 409 ? "این نام کاربری قبلاً وجود دارد" : e.message, e.detail || "");
    process.exit(1);
  }
})();

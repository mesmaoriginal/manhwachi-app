// ساخت (یا بازنشانی رمز) مدیر وبلاگ — از ریشه‌ی پروژه (کنار server.js) اجرا کنید:
//   BLOG_ADMIN_USER=ali BLOG_ADMIN_PASS='یک-رمز-قوی-حداقل-۱۰-کاراکتر' node blog/create-admin.js
// اگر کاربری با همین نام باشد، فقط رمزش عوض می‌شود و نقشش admin و فعال می‌شود.
const { sb, init } = require("./blogDb");
const A = require("./blogAuth");

(async () => {
  const username = String(process.env.BLOG_ADMIN_USER || "").trim().toLowerCase();
  const password = String(process.env.BLOG_ADMIN_PASS || "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("BLOG_ADMIN_USER: ۳ تا ۳۲ حرف انگلیسی کوچک/عدد/._-");
  if (password.length < 10 || password.length > 200) throw new Error("BLOG_ADMIN_PASS: حداقل ۱۰ کاراکتر");
  init();
  const password_hash = await A.hashPassword(password);
  const ex = await sb(`blog_staff?username=eq.${encodeURIComponent(username)}&select=id,session_version&limit=1`);
  if (ex && ex[0]) {
    await sb(`blog_staff?id=eq.${encodeURIComponent(ex[0].id)}`, {
      method: "PATCH",
      body: { password_hash, role: "admin", is_active: true, session_version: (ex[0].session_version || 0) + 1 },
    });
    console.log(`رمز کاربر «${username}» عوض شد (مدیر).`);
  } else {
    await sb("blog_staff", { method: "POST", body: { username, display_name: username, password_hash, role: "admin", can_publish: false } });
    console.log(`مدیر «${username}» ساخته شد.`);
  }
  process.exit(0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });

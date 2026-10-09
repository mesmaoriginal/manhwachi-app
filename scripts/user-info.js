// scripts/user-info.js — بررسی/اصلاح وضعیت VIP یک کاربر در دیتابیس محلی
// نمایش:       node scripts/user-info.js ایمیل-یا-شماره-یا-id
// فعال کردن:   node scripts/user-info.js ایمیل --set-vip-until=2026-12-31
// فهرست VIPها: node scripts/user-info.js --list-vip
// (قبلش LOCALDB_FILE را همان مسیر دیتابیس سایت بگذارید.)
const L = require("../lib/localdb");
L.init({ skipChecks: true, skipJobs: true });
const { all, get, run } = L.sqlite;
const args = process.argv.slice(2);
const q = args.find((a) => !a.startsWith("--"));
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
const n = (t) => get(`SELECT COUNT(*) c FROM ${t}`).c;
console.log(`کاربران: ${n("auth_users")} | پروفایل‌ها: ${n("profiles")} | VIP: ${get("SELECT COUNT(*) c FROM profiles WHERE is_vip=1").c} | پرداخت‌ها: ${n("payments")}`);
if (args.includes("--list-vip")) { console.table(all("SELECT id,full_name,is_vip,vip_until FROM profiles WHERE is_vip=1 ORDER BY vip_until DESC LIMIT 50")); process.exit(0); }
if (!q) { console.log("ایمیل/شماره/id را بدهید."); process.exit(0); }
const phone = q.replace(/^\+/, "");
const u = get("SELECT id,email,phone,created_at FROM auth_users WHERE id=? OR lower(email)=lower(?) OR phone=?", [q, q, phone]);
if (!u) { console.log("❌ کاربر در auth_users پیدا نشد (وارد کردن کاربران را انجام داده‌اید؟)"); process.exit(0); }
console.log("کاربر:", u);
let p = get("SELECT * FROM profiles WHERE id=?", [u.id]);
console.log("پروفایل:", p || "❌ ندارد (برای همین VIP شناخته نمی‌شود؛ جدول profiles از export وارد نشده)");
console.log("پرداخت‌ها:"); console.table(all("SELECT track_id,plan_key,amount,status,created_at FROM payments WHERE user_id=? ORDER BY created_at DESC", [u.id]));
const until = opt("set-vip-until");
if (until) {
  const d = new Date(until); if (isNaN(d)) { console.log("تاریخ نامعتبر (مثال: 2026-12-31)"); process.exit(1); }
  const now = new Date().toISOString();
  if (p) run("UPDATE profiles SET is_vip=1, vip_until=?, updated_at=? WHERE id=?", [d.toISOString(), now, u.id]);
  else run("INSERT INTO profiles (id,is_vip,vip_until,created_at,updated_at) VALUES (?,1,?,?,?)", [u.id, d.toISOString(), now, now]);
  console.log("✅ VIP تا", d.toISOString(), "فعال شد. (تا ۹۰ ثانیه ممکن است کش باشد؛ اپ را ری‌استارت کنید یا صبر کنید.)");
}

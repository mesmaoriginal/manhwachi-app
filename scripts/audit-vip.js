// scripts/audit-vip.js — بررسی و ترمیم اشتراک همه‌ی کاربران بر اساس پرداخت‌های موفق
//
// پیش‌فرض فقط «گزارش» می‌دهد و هیچ‌چیز را تغییر نمی‌دهد.
//   node scripts/audit-vip.js            ← فقط گزارش
//   node scripts/audit-vip.js --apply    ← بکاپ می‌گیرد و اشتراک‌های ناقص را ترمیم می‌کند
//   node scripts/audit-vip.js --user=<ایمیل|شماره|id>   ← فقط یک کاربر
//
// منطق: پرداخت‌های success هر کاربر را به ترتیب زمان پخش می‌کند (هر پرداخت به باقی‌مانده‌ی
// اشتراک اضافه می‌شود، مثل server.js). اگر vip_until فعلی از این حداقلِ محاسبه‌شده کمتر بود،
// اشتراک خراب شده. ترمیم فقط «زیاد» می‌کند، هرگز اشتراک کسی را کم نمی‌کند.
// جایزه‌ی چرخونه و تغییر دستی ادمین فقط اشتراک را بیشتر می‌کنند، پس این حد پایین امن است.
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONLY = (args.find((a) => a.startsWith("--user=")) || "").slice(7).trim().toLowerCase();
const FILE = process.env.LOCALDB_FILE || path.join(process.cwd(), "data", "app.sqlite");
if (!fs.existsSync(FILE)) { console.error("فایل دیتابیس پیدا نشد: " + FILE + "\nمتغیر LOCALDB_FILE را درست ست کنید."); process.exit(1); }

let db;
try { const { DatabaseSync } = require("node:sqlite"); db = new DatabaseSync(FILE); }
catch { db = new (require("better-sqlite3"))(FILE); }
db.exec("PRAGMA busy_timeout = 5000");
const all = (sql, p = []) => db.prepare(sql).all(...p);
const get = (sql, p = []) => db.prepare(sql).get(...p);

// پلن‌ها: از data/vip-config.json اگر بود، وگرنه پیش‌فرض
let plans = { weekly: { days: 7, months: 0 }, monthly: { days: 0, months: 1 }, quarterly: { days: 0, months: 3 } };
const cfgFile = process.env.VIP_CONFIG_PATH || path.join(path.dirname(FILE), "vip-config.json");
try {
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  for (const p of cfg.plans || []) plans[p.key] = { days: p.days || 0, months: p.months || 0 };
} catch {}

const iso = (d) => d.toISOString();
const fa = (s) => (s ? new Date(s).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) : "—");
const now = new Date();

let users = all("SELECT DISTINCT user_id FROM payments WHERE status = 'success'").map((r) => r.user_id);
if (ONLY) {
  const u = get("SELECT id FROM auth_users WHERE lower(email)=? OR phone=? OR lower(id)=? OR upper(substr(id,1,8))=upper(?)", [ONLY, ONLY.replace(/^\+/, ""), ONLY, ONLY]);
  if (!u) { console.error("کاربر پیدا نشد."); process.exit(1); }
  users = [u.id];
}

const broken = [];
for (const uid of users) {
  const pays = all("SELECT track_id, plan_key, amount, status, COALESCE(updated_at, created_at) AS t FROM payments WHERE user_id = ? AND status = 'success' ORDER BY t", [uid]);
  let cur = null, unknownPlan = false;
  for (const p of pays) {
    const pl = plans[p.plan_key];
    if (!pl) { unknownPlan = true; continue; }
    const pt = new Date(p.t);
    const d = cur && cur > pt ? new Date(cur) : new Date(pt);
    if (pl.days) d.setDate(d.getDate() + pl.days);
    if (pl.months) d.setMonth(d.getMonth() + pl.months);
    cur = d;
  }
  if (!cur || cur <= now) continue; // طبق پرداخت‌ها الان اشتراک نباید فعال باشد؛ کاری نداریم
  const prof = get("SELECT is_vip, vip_until FROM profiles WHERE id = ?", [uid]);
  const have = prof && prof.vip_until ? new Date(prof.vip_until) : null;
  const okVip = prof && prof.is_vip && (prof.vip_until === null || have > now);
  const short = !have || have < cur;
  if (!prof || !okVip || (have && short && prof.vip_until !== null)) {
    const a = get("SELECT email, phone FROM auth_users WHERE id = ?", [uid]) || {};
    broken.push({ uid, who: a.email || a.phone || uid, hasProfile: !!prof, is_vip: prof ? prof.is_vip : null, have: prof?.vip_until || null, expected: cur, unknownPlan });
  }
}

console.log(`کاربران دارای پرداخت موفق: ${users.length}`);
console.log(`اشتراک‌های ناقص یا از دست رفته: ${broken.length}\n`);
for (const b of broken) {
  console.log(`- ${b.who}  [${b.uid.slice(0, 8).toUpperCase()}]  پروفایل:${b.hasProfile ? "دارد" : "ندارد"}  is_vip=${b.is_vip}  الان تا: ${fa(b.have)}  باید تا: ${fa(iso(b.expected))}${b.unknownPlan ? "  (⚠ یک پرداخت با پلن ناشناس هم دارد)" : ""}`);
}

// پرداخت‌های مشکوک برای بررسی دستی در پنل زیبال (اتوماتیک ترمیم نمی‌شوند چون پرداخت‌شدنشان تأیید نشده)
const sus = all("SELECT p.track_id, p.status, p.plan_key, p.amount, p.created_at, a.email, a.phone FROM payments p LEFT JOIN auth_users a ON a.id = p.user_id WHERE p.status IN ('processing','failed','pending') AND p.created_at >= ? ORDER BY p.created_at DESC", [iso(new Date(Date.now() - 7 * 864e5))]);
const stuck = sus.filter((r) => r.status === "processing");
console.log(`\nپرداخت‌های «processing» گیرکرده (باید دستی چک شوند): ${stuck.length}`);
for (const r of stuck) console.log(`  track=${r.track_id}  ${r.email || r.phone}  ${r.plan_key}  ${fa(r.created_at)}`);
const cnt = (s) => sus.filter((r) => r.status === s).length;
console.log(`\nمرور ۷ روز اخیر: pending=${cnt("pending")}  failed=${cnt("failed")}  processing=${cnt("processing")}`);
console.log("برای failed/pending اگر کاربر ادعای پرداخت دارد، trackId را در پنل زیبال چک کنید.");

if (!APPLY) { console.log("\n(فقط گزارش بود. برای ترمیم: node scripts/audit-vip.js --apply)"); process.exit(0); }
if (!broken.length) { console.log("\nچیزی برای ترمیم نیست."); process.exit(0); }

const dir = path.join(path.dirname(FILE), "backups");
fs.mkdirSync(dir, { recursive: true });
const bk = path.join(dir, "pre-audit-vip-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite");
db.exec(`VACUUM INTO '${bk.replace(/'/g, "''")}'`);
console.log("\nبکاپ گرفته شد: " + bk);

const t = iso(new Date());
db.exec("BEGIN IMMEDIATE");
try {
  for (const b of broken) {
    if (b.hasProfile) db.prepare("UPDATE profiles SET is_vip = 1, vip_until = ?, updated_at = ? WHERE id = ?").run(iso(b.expected), t, b.uid);
    else db.prepare("INSERT INTO profiles (id, is_vip, vip_until, created_at, updated_at) VALUES (?, 1, ?, ?, ?)").run(b.uid, iso(b.expected), t, t);
  }
  db.exec("COMMIT");
} catch (e) { db.exec("ROLLBACK"); console.error("خطا؛ هیچ تغییری اعمال نشد:", e.message); process.exit(1); }
console.log(`ترمیم شد: ${broken.length} کاربر. (تا ۹۰ ثانیه کش سرور؛ با ری‌استارت اپ فوری می‌شود)`);

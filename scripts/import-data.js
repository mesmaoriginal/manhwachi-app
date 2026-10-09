// scripts/import-data.js — وارد کردن داده‌های خروجی سوپابیس (export/*.json + CSVهای کاربران) به SQLite محلی
// اجرا:  node scripts/import-data.js ./export users1.csv users2.csv users3.csv
// CSV کاربران (هش رمز) از کوئری‌های sql-queries-users.md می‌آید؛ همه‌ی صفحه‌ها را بدهید.
// اگر ردیفی از قبل هست، با همان کلید جایگزین می‌شود (INSERT OR REPLACE)؛ پس می‌شود چند بار اجرا کرد.
const fs = require("fs");
const path = require("path");
process.env.LOCALDB_FILE = process.env.LOCALDB_FILE || path.join(process.cwd(), "data", "app.sqlite");
const L = require("../lib/localdb");
const { toDb } = require("../lib/localdb/rest");
const { normTs } = require("../lib/localdb/rest");
const SCHEMA = require("../lib/localdb/schema.json").tables;

const dir = process.argv[2], csvFiles = process.argv.slice(3);
if (!dir || !fs.existsSync(dir)) { console.error("استفاده: node scripts/import-data.js ./export [users.csv ...]"); process.exit(1); }

function parseCsv(text) { // RFC4180 ساده
  const rows = []; let row = [], f = "", inq = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inq = false; } else f += c; }
    else if (c === '"') inq = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f.replace(/\r$/, "")); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const nul = (v) => (v === undefined || v === null || v === "" || v === "null" ? null : v);

L.init({ skipChecks: true, skipJobs: true });
const { run, tx, get } = L.sqlite;
const report = {};

// ۱) جدول‌های public
for (const [t, T] of Object.entries(SCHEMA)) {
  const f = path.join(dir, `${t}.json`);
  if (!fs.existsSync(f)) { console.warn("فایل نیست:", f); continue; }
  const rows = JSON.parse(fs.readFileSync(f, "utf8"));
  tx(() => {
    for (const r of rows) {
      const names = Object.keys(r).filter((k) => T.cols[k]);
      run(`INSERT OR REPLACE INTO "${t}" (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`, names.map((n) => toDb(T.cols[n], r[n])));
    }
  });
  report[t] = `${rows.length} → ${get(`SELECT COUNT(*) c FROM "${t}"`).c}`;
}

// ۲) کاربران: فهرست ادمین (اگر هست) + همه‌ی ردیف‌های CSV (حتی اگر در فهرست ادمین نباشند) + هش رمز از CSVها
const adminFile = path.join(dir, "_auth_users_admin.json");
const admin = fs.existsSync(adminFile) ? JSON.parse(fs.readFileSync(adminFile, "utf8")) : [];
const hashes = new Map(), csvMeta = new Map();
let csvRows = 0, csvWithHashCol = false;
for (const f of csvFiles) for (const r of parseCsv(fs.readFileSync(f, "utf8"))) {
  if (!r.id) continue;
  csvRows++;
  if ("encrypted_password" in r) csvWithHashCol = true;
  if (nul(r.encrypted_password)) hashes.set(r.id, r.encrypted_password);
  csvMeta.set(r.id, r);
}
if (csvFiles.length && !csvWithHashCol) console.warn("⚠️ در CSV ستون encrypted_password نیست؛ فقط خودِ کاربران اضافه می‌شوند و رمزها منتقل نمی‌شوند. کوئری را از sql-queries-users.md بگیرید.");
const jparse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
// کاربرانی که فقط در CSV هستند (مثلاً بعد از خروجی ادمین ثبت‌نام کرده‌اند) هم اضافه شوند
const adminIds = new Set(admin.map((u) => u.id));
const extra = [...csvMeta.values()].filter((r) => !adminIds.has(r.id)).map((r) => ({
  id: r.id, email: r.email, phone: r.phone, email_confirmed_at: r.email_confirmed_at, phone_confirmed_at: r.phone_confirmed_at,
  created_at: r.created_at, updated_at: r.created_at, last_sign_in_at: r.last_sign_in_at,
  user_metadata: jparse(r.raw_user_meta_data, {}), app_metadata: jparse(r.raw_app_meta_data, null),
}));
const users = admin.concat(extra);
let withHash = 0, noHash = 0;
tx(() => {
  for (const u of users) {
    const c = csvMeta.get(u.id) || {};
    const prev = get("SELECT encrypted_password p FROM auth_users WHERE id=?", [u.id]);
    const h = hashes.get(u.id) || (prev && prev.p) || ""; // رمزِ قبلاً واردشده با ردیف بدون رمز پاک نشود
    h ? withHash++ : noHash++;
    const email = nul(u.email) ? String(u.email).toLowerCase() : null, phone = nul(u.phone) ? String(u.phone).replace(/^\+/, "") : null;
    run(`INSERT OR REPLACE INTO auth_users (id,email,phone,encrypted_password,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,raw_user_meta_data,raw_app_meta_data)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      u.id, email, phone, h,
      nul(u.email_confirmed_at) ? normTs(u.email_confirmed_at) : nul(c.email_confirmed_at) ? normTs(c.email_confirmed_at) : null,
      nul(u.phone_confirmed_at) ? normTs(u.phone_confirmed_at) : nul(c.phone_confirmed_at) ? normTs(c.phone_confirmed_at) : null,
      normTs(u.created_at), normTs(u.updated_at || u.created_at), nul(u.last_sign_in_at) ? normTs(u.last_sign_in_at) : null,
      JSON.stringify(u.user_metadata || {}), JSON.stringify(u.app_metadata || { provider: email ? "email" : "phone", providers: [email ? "email" : "phone"] }),
    ]);
  }
});
report.auth_users = `${users.length} (از CSV: ${csvRows}، فقط-CSV: ${extra.length}، با هش رمز: ${withHash}، بدون هش: ${noHash})`;
const failed = L.createIndexes();
console.log("نتیجه‌ی وارد کردن:"); console.table(report);
if (failed.length) console.warn("ایندکس‌های ناموفق (احتمالاً داده‌ی تکراری):", failed);
if (noHash) console.warn(`⚠️ ${noHash} کاربر هش رمز ندارند (CSV ناقص). آن‌ها باید از «فراموشی رمز» وارد شوند. هر سه CSV را بدهید و دوباره اجرا کنید.`);

// lib/localdb/dbadmin.js — پنل مدیریت دیتابیس محلی (جایگزین Table Editor سوپابیس)
// آدرس: /dbadmin — فقط وقتی فعال است که DBADMIN_TOKEN (حداقل ۱۶ نویسه) ست شده باشد.
// نمای کلی، جستجوی کاربر، مشاهده‌ی همه‌ی جدول‌ها (فقط‌خواندنی)، و دو عمل: فعال/غیرفعال کردن VIP و تایید ایمیل.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const S = require("./sqlite");
const SCHEMA = require("./schema.json").tables;

const TOKEN = () => process.env.DBADMIN_TOKEN || "";
const mac = (exp) => crypto.createHmac("sha256", TOKEN()).update("dbadmin-session-v2:" + exp).digest("hex");
const makeCookie = () => { const exp = Date.now() + 8 * 3600e3; return exp + "." + mac(exp); };
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const fails = new Map(); // ip -> {n, t}
const clientIp = (req) => { const x = String(req.headers["x-forwarded-for"] || "").split(",").map((v) => v.trim()).filter(Boolean); return x.length ? x[x.length - 1] : req.socket.remoteAddress || ""; };
let globalFails = { n: 0, t: Date.now() };
const cookieOf = (req, n) => (String(req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(n + "=")) || "").slice(n.length + 1);
const authed = (req) => { const c = cookieOf(req, "dbadmin"), [exp, m] = c.split("."); return !!m && Number(exp) > Date.now() && eq(m, mac(exp)); };
const nowIso = () => new Date().toISOString();

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "X-Frame-Options": "DENY", ...extra });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 100000) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
const n = (sql, p) => S.get(sql, p).c;
const dbFile = () => process.env.LOCALDB_FILE || path.join(process.cwd(), "data", "app.sqlite");
const backupDir = () => process.env.LOCALDB_BACKUP_DIR || path.join(path.dirname(dbFile()), "backups");
const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const vipActive = "is_vip=1 AND (vip_until IS NULL OR vip_until > ?)";

function overview() {
  const t = nowIso();
  const q = (tbl) => (SCHEMA[tbl] ? n(`SELECT COUNT(*) c FROM ${tbl}`) : 0);
  let backups = [];
  try { backups = fs.readdirSync(backupDir()).map((f) => ({ f, s: size(path.join(backupDir(), f)), t: fs.statSync(path.join(backupDir(), f)).mtime.toISOString() })).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 8); } catch {}
  const env = process.env;
  return {
    counts: {
      users: n("SELECT COUNT(*) c FROM auth_users"),
      profiles: q("profiles"), vip_active: n(`SELECT COUNT(*) c FROM profiles WHERE ${vipActive}`, [t]),
      vip_expired: n("SELECT COUNT(*) c FROM profiles WHERE is_vip=1 AND vip_until IS NOT NULL AND vip_until <= ?", [t]),
      vip_standard: n(`SELECT COUNT(*) c FROM profiles WHERE ${vipActive} AND COALESCE(vip_tier,'standard')<>'premium'`, [t]),
      vip_premium: n(`SELECT COUNT(*) c FROM profiles WHERE ${vipActive} AND vip_tier='premium'`, [t]),
      users_without_profile: n("SELECT COUNT(*) c FROM auth_users a WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id=a.id)"),
      payments: q("payments"), messages: q("messages"), messages_pending: n("SELECT COUNT(*) c FROM messages WHERE approved IS NULL OR approved=0"),
      reel_comments_pending: n("SELECT COUNT(*) c FROM comments WHERE approved IS NULL OR approved=0"),
      reels: q("reels"), ratings: q("manhwa_ratings"), reports: q("chapter_reports"), bookmarks: q("bookmarks"),
    },
    payments_by_status: S.all("SELECT status, COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments GROUP BY status"),
    signups_per_day: S.all("SELECT substr(created_at,1,10) d, COUNT(*) c FROM auth_users GROUP BY d ORDER BY d DESC LIMIT 14"),
    recent_users: S.all("SELECT a.id,a.email,a.phone,a.created_at,p.full_name,p.is_vip,p.vip_tier FROM auth_users a LEFT JOIN profiles p ON p.id=a.id ORDER BY a.created_at DESC LIMIT 12"),
    recent_payments: S.all("SELECT id,user_id,plan_key,amount,status,created_at FROM payments ORDER BY created_at DESC LIMIT 8"),
    system: {
      node: process.version, driver: S.driver(), uptime_s: Math.round(process.uptime()), rss_mb: Math.round(process.memoryUsage().rss / 1048576),
      db_file: dbFile(), db_mb: +(size(dbFile()) / 1048576).toFixed(2), wal_mb: +(size(dbFile() + "-wal") / 1048576).toFixed(2), backups,
    },
    checks: [
      ["LOCAL_DB=1", env.LOCAL_DB === "1"], ["LOCALDB_JWT_SECRET (حداقل ۲۰ نویسه)", (env.LOCALDB_JWT_SECRET || "").length >= 20],
      ["SMTP_HOST", !!env.SMTP_HOST], ["SMTP_USER", !!env.SMTP_USER], ["SMTP_PASS", !!env.SMTP_PASS], ["EMAIL_FROM", !!(env.EMAIL_FROM || env.SMTP_FROM)],
      ["SITE_URL", !!env.SITE_URL], ["SUPABASE_SERVICE_ROLE_KEY", !!env.SUPABASE_SERVICE_ROLE_KEY], ["NODE_ENV=production", env.NODE_ENV === "production"],
      ["پروفایل‌ها وارد شده‌اند", n("SELECT COUNT(*) c FROM profiles") > 0], ["بکاپ موجود است", backups.length > 0],
    ],
  };
}


// ---------- ابزارهای مشترک ----------
const SQL_BLOCK = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|truncate|load_extension|pragma)\b|auth_|encrypted_password|dbadmin_audit|;/i;
const ident = (c, cols) => (cols.includes(c) ? c : null);
const csvCell = (v) => { if (v == null) return ""; let s = typeof v === "object" ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (cols, rows) => "﻿" + [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
let auditReady = false;
function audit(req, action, detail) {
  try {
    if (!auditReady) { S.exec("CREATE TABLE IF NOT EXISTS dbadmin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, ip TEXT, action TEXT, detail TEXT)"); auditReady = true; }
    S.run("INSERT INTO dbadmin_audit (at,ip,action,detail) VALUES (?,?,?,?)", [nowIso(), clientIp(req), action, String(detail).slice(0, 2000)]);
  } catch (e) { console.error("[dbadmin] audit:", e.message); }
  console.log(`[dbadmin] ${action}: ${detail}`);
}

function users(qs) {
  const page = Math.max(1, parseInt(qs.get("page")) || 1), per = 30, q = (qs.get("q") || "").trim().toLowerCase();
  const like = `%${q}%`, t = nowIso(), conds = [], params = [];
  if (q) { conds.push("(lower(a.email) LIKE ? OR a.phone LIKE ? OR lower(p.full_name) LIKE ? OR lower(a.id) LIKE ?)"); params.push(like, like, like, q + "%"); }
  const f = qs.get("filter") || "";
  if (f === "vip") { conds.push("p.is_vip=1 AND (p.vip_until IS NULL OR p.vip_until > ?)"); params.push(t); }
  else if (f === "vip_standard") { conds.push("p.is_vip=1 AND (p.vip_until IS NULL OR p.vip_until > ?) AND COALESCE(p.vip_tier,'standard')<>'premium'"); params.push(t); }
  else if (f === "vip_premium") { conds.push("p.is_vip=1 AND (p.vip_until IS NULL OR p.vip_until > ?) AND p.vip_tier='premium'"); params.push(t); }
  else if (f === "vip_expired") { conds.push("p.is_vip=1 AND p.vip_until IS NOT NULL AND p.vip_until <= ?"); params.push(t); }
  else if (f === "vip_soon") { conds.push("p.is_vip=1 AND p.vip_until > ? AND p.vip_until <= ?"); params.push(t, new Date(Date.now() + 7 * 864e5).toISOString()); }
  else if (f === "unconfirmed") conds.push("a.email IS NOT NULL AND a.email_confirmed_at IS NULL");
  else if (f === "no_profile") conds.push("p.id IS NULL");
  else if (f === "banned") { conds.push("a.banned_until > ?"); params.push(t); }
  else if (f === "inactive") { conds.push("(a.last_sign_in_at IS NULL OR a.last_sign_in_at < ?)"); params.push(new Date(Date.now() - 90 * 864e5).toISOString()); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const SORTS = { created_at: "a.created_at", last_sign_in_at: "a.last_sign_in_at", email: "lower(a.email)", full_name: "lower(p.full_name)", vip_until: "p.vip_until" };
  const sort = SORTS[qs.get("sort")] || SORTS.created_at, dir = qs.get("dir") === "asc" ? "ASC" : "DESC";
  const from = "FROM auth_users a LEFT JOIN profiles p ON p.id=a.id " + where;
  const cols = "a.id,a.email,a.phone,a.created_at,a.last_sign_in_at,a.email_confirmed_at,a.banned_until,p.full_name,p.is_vip,p.vip_until,p.vip_tier,p.vip_plan_key";
  const order = `ORDER BY ${sort} ${dir} NULLS LAST, a.created_at DESC`;
  if (qs.get("format") === "csv") {
    const rows = S.all(`SELECT ${cols} ${from} ${order} LIMIT 50000`, params);
    return { csv: toCsv(["id", "email", "phone", "full_name", "is_vip", "vip_until", "vip_tier", "vip_plan_key", "email_confirmed_at", "last_sign_in_at", "created_at", "banned_until"], rows), name: "users.csv" };
  }
  return { total: n("SELECT COUNT(*) c " + from, params), page, per, rows: S.all(`SELECT ${cols} ${from} ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`, params) };
}
function userDetail(id) {
  const a = S.get("SELECT id,email,phone,created_at,updated_at,last_sign_in_at,email_confirmed_at,phone_confirmed_at,banned_until,raw_user_meta_data,(encrypted_password<>'') has_password FROM auth_users WHERE id=?", [id]);
  if (!a) return null;
  const has = (tbl, col) => !!(SCHEMA[tbl] && SCHEMA[tbl].cols[col]);
  const one = (tbl, col = "user_id") => (has(tbl, col) ? S.all(`SELECT * FROM ${tbl} WHERE ${col}=? ORDER BY ${has(tbl, "created_at") ? "created_at DESC" : "rowid DESC"} LIMIT 20`, [id]) : []);
  const cnt = (tbl) => (has(tbl, "user_id") ? n(`SELECT COUNT(*) c FROM ${tbl} WHERE user_id=?`, [id]) : 0);
  return {
    auth: a, profile: S.get("SELECT * FROM profiles WHERE id=?", [id]) || null, contact: S.get("SELECT * FROM profile_contacts WHERE user_id=?", [id]) || null,
    payments: one("payments"), messages: one("messages"), ratings: cnt("manhwa_ratings"), bookmarks: cnt("bookmarks"),
    tickets: one("support_tickets"), requests: one("manhwa_requests"), reports: cnt("chapter_reports"),
    sessions: n("SELECT COUNT(*) c FROM auth_refresh_tokens WHERE user_id=? AND revoked=0", [id]),
    team: S.get("SELECT * FROM team_members WHERE user_id=?", [id]) || null,
  };
}
function setVip(id, untilStr, req, tier) {
  if (tier !== undefined && tier !== null && tier !== "standard" && tier !== "premium") return { status: 400, body: { error: "نوع اشتراک نامعتبر (standard یا premium)" } };
  if (!S.get("SELECT 1 x FROM auth_users WHERE id=?", [id])) return { status: 404, body: { error: "کاربر نیست" } };
  const t = nowIso(), has = S.get("SELECT 1 x FROM profiles WHERE id=?", [id]);
  if (untilStr === null) { // غیرفعال
    if (has) S.run("UPDATE profiles SET is_vip=0, vip_tier=NULL, vip_plan_key=NULL, updated_at=? WHERE id=?", [t, id]);
    audit(req, "vip-off", id); return { status: 200, body: { ok: true } };
  }
  const d = new Date(untilStr);
  if (isNaN(d)) return { status: 400, body: { error: "تاریخ نامعتبر" } };
  const tr = tier || null; // اگر نوع فرستاده نشد، نوع فعلی دست‌نخورده می‌ماند (تمدید)
  if (has) S.run("UPDATE profiles SET is_vip=1, vip_until=?, vip_tier=COALESCE(?, vip_tier), updated_at=? WHERE id=?", [d.toISOString(), tr, t, id]);
  else S.run("INSERT INTO profiles (id,is_vip,vip_until,vip_tier,created_at,updated_at) VALUES (?,1,?,?,?,?)", [id, d.toISOString(), tr || "standard", t, t]);
  audit(req, "vip-set", `${id} → ${d.toISOString()}${tr ? " (" + tr + ")" : ""}`); return { status: 200, body: { ok: true } };
}
function setBan(id, on, req) {
  if (!S.get("SELECT 1 x FROM auth_users WHERE id=?", [id])) return { status: 404, body: { error: "کاربر نیست" } };
  const t = nowIso();
  S.tx(() => {
    S.run("UPDATE auth_users SET banned_until=?, updated_at=? WHERE id=?", [on ? "2999-01-01T00:00:00.000Z" : null, t, id]);
    if (on) S.run("UPDATE auth_refresh_tokens SET revoked=1 WHERE user_id=?", [id]); // خروج از همه‌ی دستگاه‌ها
  });
  audit(req, on ? "ban" : "unban", id); return { status: 200, body: { ok: true } };
}
function revokeSessions(id, req) {
  S.run("UPDATE auth_refresh_tokens SET revoked=1 WHERE user_id=?", [id]);
  audit(req, "revoke-sessions", id); return { status: 200, body: { ok: true } };
}

function table(name, qs) {
  const def = SCHEMA[name];
  if (!def) return null;
  const cols = Object.keys(def.cols), textCols = cols.filter((c) => def.cols[c].t === "text");
  const page = Math.max(1, parseInt(qs.get("page")) || 1), per = [25, 50, 100, 200].includes(+qs.get("per")) ? +qs.get("per") : 50, q = (qs.get("q") || "").trim().toLowerCase();
  const conds = [], params = [];
  if (q && textCols.length) { conds.push("(" + textCols.map((c) => `lower(CAST(${c} AS TEXT)) LIKE ?`).join(" OR ") + ")"); params.push(...textCols.map(() => `%${q}%`)); }
  const fc = ident(qs.get("fcol"), cols), fv = qs.get("fval");
  if (fc && fv !== null && fv !== "") {
    if (fv === "__null__") conds.push(`${fc} IS NULL`);
    else { conds.push(`CAST(${fc} AS TEXT) = ?`); params.push(fv); }
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const sc = ident(qs.get("sort"), cols), dir = qs.get("dir") === "asc" ? "ASC" : "DESC";
  const order = sc ? `${sc} ${dir}` : cols.includes("created_at") ? "created_at DESC" : cols[0];
  if (qs.get("format") === "csv") return { csv: toCsv(cols, S.all(`SELECT * FROM ${name} ${where} ORDER BY ${order} LIMIT 50000`, params)), name: name + ".csv" };
  const types = Object.fromEntries(cols.map((c) => [c, def.cols[c].t]));
  return { cols, types, pk: def.pk[0], total: n(`SELECT COUNT(*) c FROM ${name} ${where}`, params), page, per, rows: S.all(`SELECT * FROM ${name} ${where} ORDER BY ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`, params) };
}
function editCell(name, key, col, value, req) {
  const def = SCHEMA[name];
  if (!def) return { status: 404, body: { error: "جدول نیست" } };
  const pk = def.pk[0];
  if (def.pk.length !== 1 || !def.cols[col]) return { status: 400, body: { error: "ستون نامعتبر" } };
  if (col === pk) return { status: 400, body: { error: "کلید اصلی قابل ویرایش نیست" } };
  const t = def.cols[col].t;
  let v = value;
  if (v === null || v === "") v = t === "text" ? (v === "" ? "" : null) : null;
  else if (t === "int") { v = Number(v); if (!Number.isInteger(v)) return { status: 400, body: { error: "عدد صحیح لازم است" } }; }
  else if (t === "bool") v = v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
  else if (t === "ts") { const d = new Date(v); if (isNaN(d)) return { status: 400, body: { error: "تاریخ نامعتبر" } }; v = d.toISOString(); }
  else if (t === "text") v = String(v).slice(0, 20000);
  else return { status: 400, body: { error: "ویرایش این نوع ستون پشتیبانی نمی‌شود" } };
  const old = S.get(`SELECT ${col} v FROM ${name} WHERE ${pk}=?`, [key]);
  if (!old) return { status: 404, body: { error: "ردیف نیست" } };
  const sets = [`${col}=?`], params = [v];
  if (col !== "updated_at" && def.cols.updated_at) { sets.push("updated_at=?"); params.push(nowIso()); }
  S.run(`UPDATE ${name} SET ${sets.join(",")} WHERE ${pk}=?`, [...params, key]);
  audit(req, "edit", `${name}[${key}].${col}: ${JSON.stringify(old.v)} → ${JSON.stringify(v)}`);
  return { status: 200, body: { ok: true, value: v } };
}
function deleteRow(name, key, req) {
  const def = SCHEMA[name];
  if (!def || def.pk.length !== 1) return { status: 404, body: { error: "جدول نیست" } };
  const row = S.get(`SELECT * FROM ${name} WHERE ${def.pk[0]}=?`, [key]);
  if (!row) return { status: 404, body: { error: "ردیف نیست" } };
  S.run(`DELETE FROM ${name} WHERE ${def.pk[0]}=?`, [key]);
  audit(req, "delete", `${name}[${key}] ${JSON.stringify(row)}`);
  return { status: 200, body: { ok: true } };
}
function runSql(sql, req) {
  sql = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!sql) return { status: 400, body: { error: "کوئری خالی است" } };
  if (sql.length > 5000) return { status: 400, body: { error: "کوئری خیلی بلند است" } };
  if (!/^(select|with)\b/i.test(sql)) return { status: 400, body: { error: "فقط SELECT مجاز است" } };
  if (SQL_BLOCK.test(sql)) return { status: 400, body: { error: "این کوئری مجاز نیست (فقط خواندن؛ جدول‌های auth و عبارت‌های تغییر‌دهنده بسته‌اند)" } };
  const t0 = Date.now();
  const rows = S.all(`SELECT * FROM (${sql}) LIMIT 501`);
  audit(req, "sql", sql);
  return { status: 200, body: { cols: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, 500), truncated: rows.length > 500, ms: Date.now() - t0 } };
}
function backupNow(req) {
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `manual-${nowIso().replace(/[:.]/g, "-")}.sqlite`, dst = path.join(backupDir(), name);
  S.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  audit(req, "backup", name);
  return { ok: true, name, mb: +(size(dst) / 1048576).toFixed(2) };
}
function stats() {
  const t = nowIso(), d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  return {
    logins_per_day: S.all("SELECT substr(last_sign_in_at,1,10) d, COUNT(*) c FROM auth_users WHERE last_sign_in_at >= ? GROUP BY d ORDER BY d", [d30]),
    signups_per_day: S.all("SELECT substr(created_at,1,10) d, COUNT(*) c FROM auth_users WHERE created_at >= ? GROUP BY d ORDER BY d", [d30]),
    payments_per_day: S.all("SELECT substr(created_at,1,10) d, COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE created_at >= ? GROUP BY d ORDER BY d", [d30]),
    expiring: S.all("SELECT a.id,a.email,a.phone,p.full_name,p.vip_until FROM profiles p JOIN auth_users a ON a.id=p.id WHERE p.is_vip=1 AND p.vip_until > ? AND p.vip_until <= ? ORDER BY p.vip_until LIMIT 30", [t, new Date(Date.now() + 7 * 864e5).toISOString()]),
    audit: (() => { try { return S.all("SELECT at,ip,action,detail FROM dbadmin_audit ORDER BY id DESC LIMIT 100"); } catch { return []; } })(),
  };
}

let pageCache = null;
const page = () => {
  if (pageCache && process.env.NODE_ENV === "production") return pageCache;
  try { return (pageCache = fs.readFileSync(path.join(__dirname, "dbadmin-page.html"), "utf8")); }
  catch (e) { return "<meta charset=utf-8><p dir=rtl>فایل dbadmin-page.html کنار dbadmin.js پیدا نشد.</p>"; }
};

async function handle(req, res) {
  try {
    const u = new URL(req.url, "http://x"), p = u.pathname.replace(/\/+$/, "") || "/";
    if (p === "/login" && req.method === "POST") {
      const ip = clientIp(req), f = fails.get(ip) || { n: 0, t: Date.now() };
      if (Date.now() - f.t > 15 * 60e3) { f.n = 0; f.t = Date.now(); }
      if (Date.now() - globalFails.t > 15 * 60e3) globalFails = { n: 0, t: Date.now() };
      if (f.n >= 8 || globalFails.n >= 60) return send(res, 429, { error: "تلاش زیاد؛ ۱۵ دقیقه دیگر دوباره امتحان کنید" });
      const body = await readJson(req);
      if (!eq(body.token || "", TOKEN())) { f.n++; globalFails.n++; fails.set(ip, f); return send(res, 401, { error: "توکن اشتباه است" }); }
      fails.delete(ip);
      const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
      return send(res, 200, { ok: true }, undefined, { "Set-Cookie": `dbadmin=${makeCookie()}; HttpOnly; SameSite=Strict; Path=/dbadmin; Max-Age=28800${secure}` });
    }
    if (p === "/logout") return send(res, 200, { ok: true }, undefined, { "Set-Cookie": "dbadmin=; HttpOnly; SameSite=Strict; Path=/dbadmin; Max-Age=0" });
    if (p === "/" && req.method === "GET") return send(res, 200, page(), "text/html; charset=utf-8");
    if (!authed(req)) return send(res, 401, { error: "وارد نشده‌اید" });
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "dbadmin") return send(res, 403, { error: "درخواست نامعتبر" });
    let m;
    const sendCsv = (r) => send(res, 200, r.csv, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="${r.name}"` });
    const UID = "([0-9a-f-]{36})";
    if (p === "/api/overview") return send(res, 200, overview());
    if (p === "/api/stats") return send(res, 200, stats());
    if (p === "/api/users") { const r = users(u.searchParams); if (r.csv) { audit(req, "export", r.name); return sendCsv(r); } return send(res, 200, r); }
    if (p === "/api/tables") return send(res, 200, Object.keys(SCHEMA).sort().map((t) => ({ name: t, count: n(`SELECT COUNT(*) c FROM ${t}`), cols: Object.keys(SCHEMA[t].cols).length })));
    if (p === "/api/sql" && req.method === "POST") { const b = await readJson(req); const r = runSql(b.sql, req); return send(res, r.status, r.body); }
    if (p === "/api/backup" && req.method === "POST") return send(res, 200, backupNow(req));
    if ((m = p.match(/^\/api\/backup\/(app-[\w.-]+\.sqlite|manual-[\w.-]+\.sqlite)$/)) && req.method === "GET") {
      const f = path.join(backupDir(), m[1]);
      if (!fs.existsSync(f)) return send(res, 404, { error: "فایل نیست" });
      audit(req, "backup-download", m[1]);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${m[1]}"`, "Cache-Control": "no-store" });
      return fs.createReadStream(f).pipe(res);
    }
    if ((m = p.match(/^\/api\/table\/([a-z_]+)$/)) && req.method === "GET") { const r = table(m[1], u.searchParams); if (!r) return send(res, 404, { error: "جدول نیست" }); if (r.csv) { audit(req, "export", r.name); return sendCsv(r); } return send(res, 200, r); }
    if ((m = p.match(/^\/api\/table\/([a-z_]+)\/row$/)) && req.method === "POST") { const b = await readJson(req); const r = editCell(m[1], String(b.key ?? ""), String(b.col || ""), b.value, req); return send(res, r.status, r.body); }
    if ((m = p.match(/^\/api\/table\/([a-z_]+)\/row$/)) && req.method === "DELETE") { const b = await readJson(req); const r = deleteRow(m[1], String(b.key ?? ""), req); return send(res, r.status, r.body); }
    if ((m = p.match(new RegExp("^/api/user/" + UID + "$"))) && req.method === "GET") { const r = userDetail(m[1]); return r ? send(res, 200, r) : send(res, 404, { error: "کاربر نیست" }); }
    if ((m = p.match(new RegExp("^/api/user/" + UID + "/vip$"))) && req.method === "POST") { const b = await readJson(req); const r = setVip(m[1], b.until === null ? null : String(b.until || ""), req, b.tier === undefined ? undefined : b.tier); return send(res, r.status, r.body); }
    if ((m = p.match(new RegExp("^/api/user/" + UID + "/ban$"))) && req.method === "POST") { const b = await readJson(req); const r = setBan(m[1], !!b.on, req); return send(res, r.status, r.body); }
    if ((m = p.match(new RegExp("^/api/user/" + UID + "/revoke-sessions$"))) && req.method === "POST") { const r = revokeSessions(m[1], req); return send(res, r.status, r.body); }
    if ((m = p.match(new RegExp("^/api/user/" + UID + "/confirm-email$"))) && req.method === "POST") {
      S.run("UPDATE auth_users SET email_confirmed_at=COALESCE(email_confirmed_at,?), updated_at=? WHERE id=?", [nowIso(), nowIso(), m[1]]);
      audit(req, "confirm-email", m[1]); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "پیدا نشد" });
  } catch (e) { console.error("[dbadmin]", e); return send(res, 500, { error: "خطای سرور: " + e.message }); }
}

function mount(app) {
  if (!TOKEN() || TOKEN().length < 16) { console.log("[dbadmin] غیرفعال (DBADMIN_TOKEN حداقل ۱۶ نویسه ست نشده)"); return; }
  app.use("/dbadmin", (req, res) => handle(req, res));
  console.log("[dbadmin] فعال: /dbadmin");
}

module.exports = { mount, handle };

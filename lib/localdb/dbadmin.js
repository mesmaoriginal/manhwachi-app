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
    req.on("data", (c) => { b += c; if (b.length > 20000) req.destroy(); });
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
      users_without_profile: n("SELECT COUNT(*) c FROM auth_users a WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id=a.id)"),
      payments: q("payments"), messages: q("messages"), messages_pending: n("SELECT COUNT(*) c FROM messages WHERE approved IS NULL OR approved=0"),
      reel_comments_pending: n("SELECT COUNT(*) c FROM comments WHERE approved IS NULL OR approved=0"),
      reels: q("reels"), ratings: q("manhwa_ratings"), reports: q("chapter_reports"), bookmarks: q("bookmarks"),
    },
    payments_by_status: S.all("SELECT status, COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments GROUP BY status"),
    signups_per_day: S.all("SELECT substr(created_at,1,10) d, COUNT(*) c FROM auth_users GROUP BY d ORDER BY d DESC LIMIT 14"),
    recent_users: S.all("SELECT a.id,a.email,a.phone,a.created_at,p.full_name,p.is_vip FROM auth_users a LEFT JOIN profiles p ON p.id=a.id ORDER BY a.created_at DESC LIMIT 12"),
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

function users(qs) {
  const page = Math.max(1, parseInt(qs.get("page")) || 1), per = 30, q = (qs.get("q") || "").trim().toLowerCase();
  const like = `%${q}%`;
  const where = q ? "WHERE lower(a.email) LIKE ? OR a.phone LIKE ? OR lower(p.full_name) LIKE ? OR lower(a.id) LIKE ?" : "";
  const params = q ? [like, like, like, q + "%"] : []; // آخرین پارامتر: ابتدای id (کد ۸ نویسه‌ای مثل 397F8942)
  const from = "FROM auth_users a LEFT JOIN profiles p ON p.id=a.id " + where;
  return {
    total: n("SELECT COUNT(*) c " + from, params), page, per,
    rows: S.all(`SELECT a.id,a.email,a.phone,a.created_at,a.last_sign_in_at,a.email_confirmed_at,p.full_name,p.is_vip,p.vip_until ${from} ORDER BY a.created_at DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, params),
  };
}
function userDetail(id) {
  const a = S.get("SELECT id,email,phone,created_at,updated_at,last_sign_in_at,email_confirmed_at,phone_confirmed_at,raw_user_meta_data,(encrypted_password<>'') has_password FROM auth_users WHERE id=?", [id]);
  if (!a) return null;
  const one = (tbl, col = "user_id") => (SCHEMA[tbl] ? S.all(`SELECT * FROM ${tbl} WHERE ${col}=? ORDER BY created_at DESC LIMIT 20`, [id]) : []);
  return {
    auth: a, profile: S.get("SELECT * FROM profiles WHERE id=?", [id]) || null, contact: S.get("SELECT * FROM profile_contacts WHERE user_id=?", [id]) || null,
    payments: one("payments"), messages: one("messages"), ratings: n("SELECT COUNT(*) c FROM manhwa_ratings WHERE user_id=?", [id]), bookmarks: n("SELECT COUNT(*) c FROM bookmarks WHERE user_id=?", [id]),
    team: S.get("SELECT * FROM team_members WHERE user_id=?", [id]) || null,
  };
}
function setVip(id, untilStr) {
  if (!S.get("SELECT 1 x FROM auth_users WHERE id=?", [id])) return { status: 404, body: { error: "کاربر نیست" } };
  const t = nowIso(), has = S.get("SELECT 1 x FROM profiles WHERE id=?", [id]);
  if (untilStr === null) { // غیرفعال
    if (has) S.run("UPDATE profiles SET is_vip=0, updated_at=? WHERE id=?", [t, id]);
    console.log(`[dbadmin] VIP خاموش شد: ${id}`); return { status: 200, body: { ok: true } };
  }
  const d = new Date(untilStr);
  if (isNaN(d)) return { status: 400, body: { error: "تاریخ نامعتبر" } };
  if (has) S.run("UPDATE profiles SET is_vip=1, vip_until=?, updated_at=? WHERE id=?", [d.toISOString(), t, id]);
  else S.run("INSERT INTO profiles (id,is_vip,vip_until,created_at,updated_at) VALUES (?,1,?,?,?)", [id, d.toISOString(), t, t]);
  console.log(`[dbadmin] VIP تا ${d.toISOString()}: ${id}`); return { status: 200, body: { ok: true } };
}
function table(name, qs) {
  const def = SCHEMA[name];
  if (!def) return null;
  const cols = Object.keys(def.cols), textCols = cols.filter((c) => def.cols[c].t === "text");
  const page = Math.max(1, parseInt(qs.get("page")) || 1), per = 50, q = (qs.get("q") || "").trim().toLowerCase();
  const where = q && textCols.length ? "WHERE " + textCols.map((c) => `lower(CAST(${c} AS TEXT)) LIKE ?`).join(" OR ") : "";
  const params = q && textCols.length ? textCols.map(() => `%${q}%`) : [];
  const order = cols.includes("created_at") ? "created_at DESC" : cols[0];
  return { cols, total: n(`SELECT COUNT(*) c FROM ${name} ${where}`, params), page, per, rows: S.all(`SELECT * FROM ${name} ${where} ORDER BY ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`, params) };
}

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
    if (p === "/" && req.method === "GET") return send(res, 200, PAGE, "text/html; charset=utf-8");
    if (!authed(req)) return send(res, 401, { error: "وارد نشده‌اید" });
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "dbadmin") return send(res, 403, { error: "درخواست نامعتبر" });
    let m;
    if (p === "/api/overview") return send(res, 200, overview());
    if (p === "/api/users") return send(res, 200, users(u.searchParams));
    if (p === "/api/tables") return send(res, 200, Object.keys(SCHEMA).sort().map((t) => ({ name: t, count: n(`SELECT COUNT(*) c FROM ${t}`) })));
    if ((m = p.match(/^\/api\/table\/([a-z_]+)$/))) { const r = table(m[1], u.searchParams); return r ? send(res, 200, r) : send(res, 404, { error: "جدول نیست" }); }
    if ((m = p.match(/^\/api\/user\/([0-9a-f-]{36})$/)) && req.method === "GET") { const r = userDetail(m[1]); return r ? send(res, 200, r) : send(res, 404, { error: "کاربر نیست" }); }
    if ((m = p.match(/^\/api\/user\/([0-9a-f-]{36})\/vip$/)) && req.method === "POST") { const b = await readJson(req); const r = setVip(m[1], b.until === null ? null : String(b.until || "")); return send(res, r.status, r.body); }
    if ((m = p.match(/^\/api\/user\/([0-9a-f-]{36})\/confirm-email$/)) && req.method === "POST") {
      S.run("UPDATE auth_users SET email_confirmed_at=COALESCE(email_confirmed_at,?), updated_at=? WHERE id=?", [nowIso(), nowIso(), m[1]]);
      console.log(`[dbadmin] ایمیل تایید شد: ${m[1]}`); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "پیدا نشد" });
  } catch (e) { console.error("[dbadmin]", e); return send(res, 500, { error: "خطای سرور: " + e.message }); }
}

function mount(app) {
  if (!TOKEN() || TOKEN().length < 16) { console.log("[dbadmin] غیرفعال (DBADMIN_TOKEN حداقل ۱۶ نویسه ست نشده)"); return; }
  app.use("/dbadmin", (req, res) => handle(req, res));
  console.log("[dbadmin] فعال: /dbadmin");
}

const PAGE = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>پنل دیتابیس</title>
<style>
:root{--bg:#0f0f10;--c:#1a1a1c;--b:#2c2c30;--t:#eee;--m:#9a9aa2;--r:#ef4444;--g:#22c55e;--y:#f59e0b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:14px Tahoma,Arial,sans-serif}
header{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--b);position:sticky;top:0;background:var(--bg);flex-wrap:wrap;z-index:2}
header b{color:var(--r);margin-left:10px}button,input,select{font:inherit;color:var(--t);background:var(--c);border:1px solid var(--b);border-radius:8px;padding:7px 12px}
button{cursor:pointer}button.on,button.pri{background:var(--r);border-color:var(--r);color:#fff}main{padding:14px;max-width:1200px;margin:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px}.card{background:var(--c);border:1px solid var(--b);border-radius:12px;padding:12px}
.card .n{font-size:22px;font-weight:700}.card .l{color:var(--m);font-size:12px}h3{margin:18px 0 8px}
.tw{overflow-x:auto;border:1px solid var(--b);border-radius:12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:7px 10px;border-bottom:1px solid var(--b);text-align:right;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}th{color:var(--m);background:var(--c)}
tr.k{cursor:pointer}tr.k:hover{background:#222}.ok{color:var(--g)}.bad{color:var(--r)}.warn{color:var(--y)}.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center}
dl{display:grid;grid-template-columns:150px 1fr;gap:4px 10px;margin:0}dt{color:var(--m)}dd{margin:0;word-break:break-all;direction:ltr;text-align:right}.ltr{direction:ltr}.login{max-width:320px;margin:20vh auto;text-align:center}.login input{width:100%;margin:10px 0}
</style></head><body><div id="app"></div><script>
const $=s=>document.querySelector(s),H={'X-Requested-With':'dbadmin','Content-Type':'application/json'};
const esc=v=>v==null?'':String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fd=v=>v?esc(String(v).replace('T',' ').slice(0,16)):'—';
async function api(p,o={}){const r=await fetch('/dbadmin'+p,{credentials:'same-origin',headers:H,...o});const j=await r.json().catch(()=>({}));if(r.status===401){login();throw new Error('401')}if(!r.ok)throw new Error(j.error||r.status);return j}
function login(){$('#app').innerHTML='<div class="login"><h2>پنل دیتابیس</h2><input id="tk" type="password" placeholder="توکن (DBADMIN_TOKEN)" autofocus><button class="pri" id="go">ورود</button><p id="er" class="bad"></p></div>';
 const go=async()=>{const r=await fetch('/dbadmin/login',{method:'POST',headers:H,body:JSON.stringify({token:$('#tk').value})});if(r.ok)shell();else $('#er').textContent=(await r.json()).error};$('#go').onclick=go;$('#tk').onkeydown=e=>{if(e.key==='Enter')go()}}
function shell(){$('#app').innerHTML='<header><b>پنل دیتابیس</b><button data-v="ov">نمای کلی</button><button data-v="us">کاربران</button><button data-v="tb">جدول‌ها</button><span style="flex:1"></span><button id="lo">خروج</button></header><main id="m"></main>';
 document.querySelectorAll('header [data-v]').forEach(b=>b.onclick=()=>view(b.dataset.v));$('#lo').onclick=async()=>{await api('/logout',{method:'POST'}).catch(()=>{});login()};view('ov')}
function view(v,a){document.querySelectorAll('header [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v));({ov:overview,us:users,tb:tables}[v])(a).catch(e=>{if(e.message!=='401')$('#m').innerHTML='<p class="bad">'+esc(e.message)+'</p>'})}
const card=(l,v,c='')=>'<div class="card"><div class="n '+c+'">'+esc(v)+'</div><div class="l">'+l+'</div></div>';
async function overview(){const d=await api('/api/overview'),c=d.counts,s=d.system;
 $('#m').innerHTML='<div class="grid">'+card('کاربران',c.users)+card('پروفایل‌ها',c.profiles,c.profiles?'':'bad')+card('VIP فعال',c.vip_active,'ok')+card('VIP منقضی',c.vip_expired,'warn')+card('کاربر بدون پروفایل',c.users_without_profile,c.users_without_profile?'warn':'')+card('پرداخت‌ها',c.payments)+card('نظر منتظر تایید',c.messages_pending,c.messages_pending?'warn':'')+card('کامنت ریلز منتظر',c.reel_comments_pending)+card('گزارش مشکل چپتر',c.reports)+card('امتیازها',c.ratings)+card('ریلز',c.reels)+card('نشان‌ها',c.bookmarks)+'</div>'
 +'<h3>بررسی تنظیمات</h3><div class="card">'+d.checks.map(x=>'<div>'+(x[1]?'<span class="ok">✔</span>':'<span class="bad">✘</span>')+' <span class="ltr">'+esc(x[0])+'</span></div>').join('')+'</div>'
 +'<h3>سیستم</h3><div class="card"><dl><dt>Node / درایور</dt><dd>'+esc(s.node)+' / '+esc(s.driver)+'</dd><dt>فایل دیتابیس</dt><dd>'+esc(s.db_file)+'</dd><dt>حجم</dt><dd>'+s.db_mb+' MB (WAL '+s.wal_mb+')</dd><dt>آپ‌تایم</dt><dd>'+Math.round(s.uptime_s/60)+' دقیقه</dd><dt>حافظه</dt><dd>'+s.rss_mb+' MB</dd><dt>بکاپ‌ها</dt><dd>'+(s.backups.length?s.backups.map(b=>esc(b.f)+' ('+fd(b.t)+')').join('<br>'):'<span class="bad">ندارد</span>')+'</dd></dl></div>'
 +'<h3>ثبت‌نام روزانه (۱۴ روز اخیر)</h3><div class="card">'+d.signups_per_day.map(x=>'<span style="margin-left:14px">'+esc(x.d)+': <b>'+x.c+'</b></span>').join('')+'</div>'
 +'<h3>آخرین کاربران</h3>'+tbl(['ایمیل/شماره','نام','VIP','ثبت‌نام'],d.recent_users.map(u=>[esc(u.email||u.phone),esc(u.full_name),u.is_vip?'<span class="ok">✔</span>':'',fd(u.created_at)]),d.recent_users.map(u=>u.id))
 +'<h3>پرداخت‌ها بر اساس وضعیت</h3>'+tbl(['وضعیت','تعداد','جمع (ریال)'],d.payments_by_status.map(x=>[esc(x.status),x.c,esc(x.s)]))
 +'<h3>آخرین پرداخت‌ها</h3>'+tbl(['پلن','مبلغ','وضعیت','زمان'],d.recent_payments.map(x=>[esc(x.plan_key),esc(x.amount),esc(x.status),fd(x.created_at)]),d.recent_payments.map(x=>x.user_id));
 bindRows()}
function tbl(h,rows,ids){return '<div class="tw"><table><tr>'+h.map(x=>'<th>'+x+'</th>').join('')+'</tr>'+rows.map((r,i)=>'<tr '+(ids&&ids[i]?'class="k" data-id="'+esc(ids[i])+'"':'')+'>'+r.map(c=>'<td>'+(c==null?'':c)+'</td>').join('')+'</tr>').join('')+'</table></div>'}
function bindRows(){document.querySelectorAll('tr.k').forEach(r=>r.onclick=()=>detail(r.dataset.id))}
async function users(a={}){const q=a.q||'',p=a.page||1,d=await api('/api/users?q='+encodeURIComponent(q)+'&page='+p);
 $('#m').innerHTML='<div class="row"><input id="q" placeholder="ایمیل، شماره، نام یا کد عضویت (۸ نویسه‌ی اول id)" value="'+esc(q)+'" style="min-width:260px"><button class="pri" id="s">جستجو</button><span>'+d.total+' کاربر</span></div>'
 +tbl(['ایمیل','شماره','نام','VIP تا','ایمیل تایید','آخرین ورود','ثبت‌نام'],d.rows.map(u=>[esc(u.email),esc(u.phone),esc(u.full_name),u.is_vip?'<span class="ok">'+fd(u.vip_until)+'</span>':'—',u.email_confirmed_at?'✔':'',fd(u.last_sign_in_at),fd(u.created_at)]),d.rows.map(u=>u.id))+pager(d,pg=>users({q,page:pg}));
 $('#s').onclick=()=>users({q:$('#q').value});$('#q').onkeydown=e=>{if(e.key==='Enter')users({q:$('#q').value})};bindRows()}
function pager(d,fn){const last=Math.max(1,Math.ceil(d.total/d.per));setTimeout(()=>{$('#pv')&&($('#pv').onclick=()=>fn(d.page-1));$('#nx')&&($('#nx').onclick=()=>fn(d.page+1))});return '<div class="row"><button id="pv" '+(d.page<=1?'disabled':'')+'>قبلی</button><span>صفحه '+d.page+' از '+last+'</span><button id="nx" '+(d.page>=last?'disabled':'')+'>بعدی</button></div>'}
async function detail(id){const d=await api('/api/user/'+id),a=d.auth,p=d.profile;
 const kv=o=>'<dl>'+Object.entries(o||{}).map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(typeof v==='object'?JSON.stringify(v):v)+'</dd>').join('')+'</dl>';
 $('#m').innerHTML='<button id="bk">← برگشت</button><h3>'+esc(a.email||a.phone)+'</h3><div class="card">'+kv({id:a.id,email:a.email,phone:a.phone,'رمز دارد':a.has_password?'بله':'خیر',ایمیل_تایید:a.email_confirmed_at,ثبت‌نام:a.created_at,آخرین_ورود:a.last_sign_in_at,متادیتا:a.raw_user_meta_data})+'</div>'
 +'<h3>اشتراک (VIP)</h3><div class="card">'+(p?kv({نام:p.full_name,is_vip:p.is_vip,vip_until:p.vip_until}):'<p class="warn">پروفایل ندارد</p>')
 +'<div class="row"><input type="date" id="vd"><button class="pri" id="v1">فعال کردن تا این تاریخ</button><button id="v30">+۳۰ روز از امروز</button><button id="v0">غیرفعال</button><button id="ce">تایید ایمیل</button></div></div>'
 +'<h3>پرداخت‌ها ('+d.payments.length+')</h3>'+tbl(['پلن','مبلغ','وضعیت','ref','زمان'],d.payments.map(x=>[esc(x.plan_key),esc(x.amount),esc(x.status),esc(x.ref_number),fd(x.created_at)]))
 +'<h3>آمار</h3><div class="card">امتیازها: '+d.ratings+' | نشان‌ها: '+d.bookmarks+(d.team?' | عضو تیم: '+esc(d.team.display_name):'')+'</div>'
 +'<h3>نظرها ('+d.messages.length+')</h3>'+tbl(['متن','مانهوا','تایید','زمان'],d.messages.map(x=>[esc((x.text||'').slice(0,80)),esc(x.manhwa_slug),x.approved?'✔':'—',fd(x.created_at)]));
 const act=async(path,body,msg)=>{try{await api(path,{method:'POST',body:JSON.stringify(body)});alert(msg);detail(id)}catch(e){alert('خطا: '+e.message)}};
 $('#bk').onclick=()=>view('us');$('#v1').onclick=()=>$('#vd').value?act('/api/user/'+id+'/vip',{until:$('#vd').value+'T23:59:59Z'},'انجام شد'):alert('تاریخ را انتخاب کنید');
 $('#v30').onclick=()=>act('/api/user/'+id+'/vip',{until:new Date(Date.now()+30*864e5).toISOString()},'۳۰ روز فعال شد');$('#v0').onclick=()=>confirm('VIP خاموش شود؟')&&act('/api/user/'+id+'/vip',{until:null},'خاموش شد');$('#ce').onclick=()=>act('/api/user/'+id+'/confirm-email',{},'ایمیل تایید شد')}
async function tables(a={}){const l=await api('/api/tables');if(!a.name){$('#m').innerHTML='<h3>همه‌ی جدول‌ها</h3>'+tbl(['جدول','تعداد ردیف'],l.map(t=>['<a href="#" data-t="'+esc(t.name)+'" style="color:var(--r)">'+esc(t.name)+'</a>',t.count]));document.querySelectorAll('[data-t]').forEach(x=>x.onclick=e=>{e.preventDefault();tables({name:x.dataset.t})});return}
 const q=a.q||'',p=a.page||1,d=await api('/api/table/'+a.name+'?q='+encodeURIComponent(q)+'&page='+p);
 $('#m').innerHTML='<div class="row"><button id="bk">← جدول‌ها</button><b class="ltr">'+esc(a.name)+'</b><input id="q" placeholder="جستجو در ستون‌های متنی" value="'+esc(q)+'"><button class="pri" id="s">جستجو</button><span>'+d.total+' ردیف (فقط خواندنی)</span></div>'
 +tbl(d.cols,d.rows.map(r=>d.cols.map(c=>esc(typeof r[c]==='object'&&r[c]!==null?JSON.stringify(r[c]):r[c]))))+pager(d,pg=>tables({name:a.name,q,page:pg}));
 $('#bk').onclick=()=>tables();$('#s').onclick=()=>tables({name:a.name,q:$('#q').value});$('#q').onkeydown=e=>{if(e.key==='Enter')tables({name:a.name,q:$('#q').value})}}
fetch('/dbadmin/api/overview',{credentials:'same-origin',headers:H}).then(r=>r.ok?shell():login());
</script></body></html>`;

module.exports = { mount, handle };

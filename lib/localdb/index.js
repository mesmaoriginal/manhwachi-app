// lib/localdb/index.js — نقطه‌ی ورود: دیتابیس SQLite + API سازگار با Supabase (/rest/v1 و /auth/v1) داخل خود برنامه‌ی Node
const fs = require("fs");
const path = require("path");
const sqlite = require("./sqlite");
const cfg = require("./config");
const rest = require("./rest");
const auth = require("./auth");
const SCHEMA = require("./schema.json").tables;

const SQL_TYPE = { text: "TEXT", ts: "TEXT", int: "INTEGER", bool: "INTEGER", num: "REAL", arr: "TEXT", json: "TEXT" };
const EXTRA_INDEXES = [
  ["manhwa_ratings", "uq_manhwa_ratings_user_slug", ["user_id", "manhwa_slug"], true],
  ["bookmarks", "uq_bookmarks_user_slug", ["user_id", "manhwa_slug"], true],
  ["payments", "uq_payments_track", ["track_id"], true],
  ["team_tasks", "ix_team_tasks_status", ["status"]], ["team_tasks", "ix_team_tasks_assignee", ["assignee"]],
  ["team_tasks", "ix_team_tasks_chapter", ["chapter_id"]], ["team_ledger", "ix_team_ledger_user", ["user_id"]],
  ["messages", "ix_messages_slug", ["manhwa_slug", "approved"]], ["replies", "ix_replies_message", ["message_id"]],
  ["comments", "ix_comments_reel", ["reel_id"]], ["payments", "ix_payments_user", ["user_id"]],
  ["profiles", "ix_profiles_vip", ["is_vip"]], ["reel_likes", "ix_reel_likes_device", ["device_id"]],
];
const q = (s) => `"${s}"`;

function createTables() {
  for (const [t, T] of Object.entries(SCHEMA)) {
    const cols = Object.entries(T.cols).map(([n, d]) => {
      if (d.auto) return `${q(n)} INTEGER PRIMARY KEY AUTOINCREMENT`;
      const pk = T.pk.length === 1 && T.pk[0] === n ? " PRIMARY KEY" : "";
      return `${q(n)} ${SQL_TYPE[d.t]}${pk}${d.nn && !pk ? " NOT NULL" : ""}`;
    });
    sqlite.exec(`CREATE TABLE IF NOT EXISTS ${q(t)} (${cols.join(", ")})`);
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT, phone TEXT, encrypted_password TEXT, email_confirmed_at TEXT, phone_confirmed_at TEXT,
      created_at TEXT, updated_at TEXT, last_sign_in_at TEXT, raw_user_meta_data TEXT, raw_app_meta_data TEXT, banned_until TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_email ON auth_users(lower(email)) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_phone ON auth_users(phone) WHERE phone IS NOT NULL;
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE, user_id TEXT, session_id TEXT, created_at TEXT, revoked INTEGER DEFAULT 0, used_at TEXT);
    CREATE INDEX IF NOT EXISTS ix_rt_user ON auth_refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS ix_rt_session ON auth_refresh_tokens(session_id);
    CREATE TABLE IF NOT EXISTS auth_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, kind TEXT, code_hash TEXT, link_hash TEXT, created_at TEXT, expires_at TEXT, attempts INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_codes_user ON auth_codes(user_id, kind);
  `);
}
function createIndexes() {
  const failed = [];
  for (const [t, name, cols, uniq] of EXTRA_INDEXES) {
    try { sqlite.exec(`CREATE ${uniq ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ON ${q(t)} (${cols.map(q).join(",")})`); }
    catch (e) { failed.push(`${name}: ${e.message}`); }
  }
  return failed;
}

function init(opts = {}) {
  const file = opts.dbFile || process.env.LOCALDB_FILE || path.join(process.cwd(), "data", "app.sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  Object.assign(cfg, {
    anonKey: opts.anonKey || process.env.SUPABASE_ANON_KEY || "",
    serviceKey: opts.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    jwtSecret: opts.jwtSecret || process.env.LOCALDB_JWT_SECRET || "",
    siteUrl: (opts.siteUrl || process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, ""),
  });
  if (!opts.skipChecks) {
    if (cfg.jwtSecret.length < 32) throw new Error("LOCALDB_JWT_SECRET باید حداقل ۳۲ کاراکتر تصادفی باشد");
    if (!cfg.anonKey || !cfg.serviceKey) throw new Error("SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY لازم است (همان کلیدهای قبلی)");
  }
  sqlite.open(file);
  createTables();
  const failed = createIndexes();
  if (failed.length) console.warn("[localdb] ایندکس‌های ناموفق:", failed);
  if (!opts.skipJobs) startJobs(file, opts.backupDir || process.env.LOCALDB_BACKUP_DIR || path.join(path.dirname(file), "backups"));
  console.log(`[localdb] آماده: ${file} (درایور: ${sqlite.driver()})`);
  return { file };
}

function startJobs(file, dir) {
  const clean = () => {
    try {
      sqlite.run("DELETE FROM auth_refresh_tokens WHERE revoked = 1 AND created_at < ?", [new Date(Date.now() - 7 * 864e5).toISOString()]);
      sqlite.run("DELETE FROM auth_codes WHERE expires_at < ?", [new Date().toISOString()]);
    } catch (e) { console.error("[localdb] clean:", e.message); }
  };
  const backup = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const dst = path.join(dir, `app-${new Date().toISOString().slice(0, 10)}.sqlite`);
      if (!fs.existsSync(dst)) {
        sqlite.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
        console.log("[localdb] backup:", dst);
        const files = fs.readdirSync(dir).filter((f) => /^app-.*\.sqlite$/.test(f)).sort();
        for (const f of files.slice(0, Math.max(0, files.length - 7))) fs.unlinkSync(path.join(dir, f));
      }
    } catch (e) { console.error("[localdb] backup:", e.message); }
  };
  clean(); setTimeout(backup, 30_000).unref();
  setInterval(clean, 3600e3).unref();
  setInterval(backup, 6 * 3600e3).unref();
}

// ---------- اتصال به Express ----------
function mount(app, express) {
  const origins = (process.env.LOCALDB_CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const jsonParser = express.json({ limit: "1mb" });
  const wrap = (handler) => async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization,apikey,content-type,prefer,range,accept,x-client-info,accept-profile,content-profile,range-unit", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS", "Access-Control-Expose-Headers": "content-range" });
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
    const r = await handler({ method: req.method, path: req.path, query: new URLSearchParams(qs), headers: req.headers, body: req.body, ip: req.ip });
    res.set("Cache-Control", "no-store");
    if (r.headers) res.set(r.headers);
    res.status(r.status);
    if (r.body === undefined) return res.end();
    res.type("application/json").send(JSON.stringify(r.body));
  };
  app.use("/rest/v1", jsonParser, wrap(rest.handle));
  app.use("/auth/v1", jsonParser, wrap(auth.handle));
  require("./dbadmin").mount(app); // پنل مدیریت (فقط با DBADMIN_TOKEN فعال می‌شود)
}

// ---------- fetch درون‌پردازشی: کدهای فعلی سرور بدون تغییر (SUPABASE_URL = prefix) مستقیم به دیتابیس محلی می‌رسند ----------
const LOCAL_PREFIX = "http://supabase.local";
function installFetch(prefix = LOCAL_PREFIX) {
  const real = globalThis.__realFetch || globalThis.fetch;
  globalThis.__realFetch = real;
  globalThis.fetch = async function localAwareFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (!url.startsWith(prefix)) return real(input, init);
    const u = new URL(url);
    const hdrs = Object.fromEntries([...new Headers(init.headers || (typeof input === "object" ? input.headers : undefined) || {})]);
    let body = init.body;
    if (typeof body === "string" && body.length) { try { body = JSON.parse(body); } catch { body = undefined; } } else body = undefined;
    const handler = u.pathname.startsWith("/auth/v1") ? auth.handle : rest.handle;
    const rel = u.pathname.replace(/^\/(auth|rest)\/v1/, "");
    const r = await handler({ method: (init.method || "GET").toUpperCase(), path: rel, query: u.searchParams, headers: hdrs, body, ip: "127.0.0.1" });
    const noBody = r.body === undefined || [204, 304].includes(r.status);
    return new Response(noBody ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers || {}) } });
  };
}
module.exports = { init, mount, installFetch, createTables, createIndexes, LOCAL_PREFIX, rest, auth, sqlite };

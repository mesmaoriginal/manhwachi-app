// blog/blogDb.js
// دیتابیس وبلاگ: یک فایل SQLite مستقل (blog.sqlite) — بدون سوپابیس، بدون شبکه، بدون SQL اضافه.
//   - جدول‌ها و ستون‌های جدید خودکار موقع اولین استفاده ساخته/اضافه می‌شوند (نیازی به اجرای SQL نیست).
//   - مسیر فایل: env BLOG_DB_FILE، وگرنه کنار LOCALDB_FILE (دیسک دائمی)، وگرنه ./data/blog.sqlite
//     برای تست: BLOG_DB_FILE=:memory:
//   - بکاپ خودکار هر ۶ ساعت (۷ نسخه) در پوشه‌ی blog-backups کنار فایل.
//   - درایور: node:sqlite (Node 22.5+؛ روی هاست شما v24) و در غیر این صورت better-sqlite3.
//
// رابط sb(path, opts) عمداً همان قبلی است (آدرس به سبک PostgREST: جدول?فیلتر&order=...)
// تا هیچ‌کدام از فایل‌های دیگر وبلاگ تغییر نکند؛ ولی اینجا به SQL واقعی ترجمه می‌شود.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const enc = encodeURIComponent;

// ---------- ساختار جدول‌ها ----------
// نوع ستون‌ها برای تبدیل خودکار: bool (0/1 ⇄ true/false)، json (متن JSON ⇄ شیء)، arr (آرایه‌ی متنی)
const TABLES = {
  blog_staff: {
    ddl: `CREATE TABLE IF NOT EXISTS blog_staff (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 32),
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('admin','editor','author','support')),
      can_publish INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
    add: { bio: "TEXT NOT NULL DEFAULT ''", avatar_url: "TEXT NOT NULL DEFAULT ''", public_slug: "TEXT" },
    bool: ["can_publish", "is_active"],
  },
  blog_categories: {
    ddl: `CREATE TABLE IF NOT EXISTS blog_categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    add: { old_slugs: "TEXT NOT NULL DEFAULT '[]'", description: "TEXT NOT NULL DEFAULT ''" },
    arr: ["old_slugs"],
  },
  blog_posts: {
    ddl: `CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT NOT NULL DEFAULT '',
      cover_style TEXT NOT NULL DEFAULT 'full' CHECK (cover_style IN ('full','split','overlay','compact','none')),
      cover_alt TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
      author_id TEXT NOT NULL REFERENCES blog_staff(id),
      seo_title TEXT NOT NULL DEFAULT '',
      seo_desc TEXT NOT NULL DEFAULT '',
      views INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    add: {
      old_slugs: "TEXT NOT NULL DEFAULT '[]'", featured: "INTEGER NOT NULL DEFAULT 0", search_text: "TEXT NOT NULL DEFAULT ''",
      word_count: "INTEGER NOT NULL DEFAULT 0", focus_keyword: "TEXT NOT NULL DEFAULT ''", canonical_url: "TEXT NOT NULL DEFAULT ''",
      noindex: "INTEGER NOT NULL DEFAULT 0",
    },
    bool: ["featured", "noindex"],
    json: ["content"],
    arr: ["tags", "old_slugs"],
    touch: true,
  },
  blog_pages: {
    ddl: `CREATE TABLE IF NOT EXISTS blog_pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
      author_id TEXT NOT NULL REFERENCES blog_staff(id),
      seo_title TEXT NOT NULL DEFAULT '',
      seo_desc TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    add: { old_slugs: "TEXT NOT NULL DEFAULT '[]'" },
    json: ["content"],
    arr: ["old_slugs"],
    touch: true,
  },
  blog_media: {
    ddl: `CREATE TABLE IF NOT EXISTS blog_media (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      uploader_id TEXT REFERENCES blog_staff(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    )`,
  },
  blog_revisions: {
    // عمداً بدون کلید خارجی روی item_id تا بعد از حذف مطلب هم نسخه‌ها بمانند
    ddl: `CREATE TABLE IF NOT EXISTS blog_revisions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('posts','pages')),
      item_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '[]',
      saved_by TEXT REFERENCES blog_staff(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    )`,
    json: ["content"],
  },
};
const INDEXES = [
  "CREATE INDEX IF NOT EXISTS blog_posts_status_pub_idx ON blog_posts (status, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS blog_posts_author_idx ON blog_posts (author_id)",
  "CREATE INDEX IF NOT EXISTS blog_posts_category_idx ON blog_posts (category_id, status, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS blog_posts_featured_idx ON blog_posts (featured, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS blog_pages_status_idx ON blog_pages (status, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS blog_revisions_item_idx ON blog_revisions (kind, item_id, created_at DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS blog_staff_public_slug_idx ON blog_staff (public_slug) WHERE public_slug IS NOT NULL",
];

// ---------- باز کردن دیتابیس ----------
let db = null;
let dbFile = "";

function resolveFile() {
  if (process.env.BLOG_DB_FILE) return process.env.BLOG_DB_FILE;
  if (process.env.LOCALDB_FILE) return path.join(path.dirname(process.env.LOCALDB_FILE), "blog.sqlite");
  return path.join(process.cwd(), "data", "blog.sqlite");
}

// یک پوشش کوچک که هر دو درایور را شبیه هم می‌کند: all / get / run / exec
function wrap(d) {
  return {
    exec: (sql) => d.exec(sql),
    all: (sql, p = []) => d.prepare(sql).all(...p),
    get: (sql, p = []) => d.prepare(sql).get(...p),
    run: (sql, p = []) => d.prepare(sql).run(...p),
  };
}
function openDriver(file) {
  let Native = null;
  try {
    ({ DatabaseSync: Native } = require("node:sqlite"));
  } catch { /* Node قدیمی: better-sqlite3 */ }
  if (Native) return wrap(new Native(file));
  const Better = require("better-sqlite3");
  return wrap(new Better(file));
}

function init() {
  if (db) return db;
  dbFile = resolveFile();
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = openDriver(dbFile);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  // ساخت جدول‌ها (ترتیب مهم است: کلیدهای خارجی)
  for (const name of ["blog_staff", "blog_categories", "blog_posts", "blog_pages", "blog_media", "blog_revisions"]) {
    db.exec(TABLES[name].ddl);
    // ستون‌هایی که در نسخه‌های بعدی اضافه شدند (برای دیتابیس‌های قدیمی‌تر)
    const have = new Set(db.all(`PRAGMA table_info(${name})`).map((c) => c.name));
    for (const [col, def] of Object.entries(TABLES[name].add || {})) {
      if (!have.has(col)) db.exec(`ALTER TABLE ${name} ADD COLUMN ${col} ${def}`);
    }
    TABLES[name].cols = new Set(db.all(`PRAGMA table_info(${name})`).map((c) => c.name));
  }
  for (const sql of INDEXES) db.exec(sql);
  startBackups();
  return db;
}

// ---------- بکاپ خودکار ----------
function backupNow() {
  init();
  if (dbFile === ":memory:") return;
  const dir = path.join(path.dirname(dbFile), "blog-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 13).replace("T", "-"); // 2026-10-14-09
  const target = path.join(dir, `blog-${stamp}.sqlite`);
  if (!fs.existsSync(target)) db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter((f) => /^blog-.*\.sqlite$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 7))) fs.rmSync(path.join(dir, f), { force: true });
}
let backupTimer = null;
function startBackups() {
  if (backupTimer || dbFile === ":memory:") return;
  const run = () => { try { backupNow(); } catch (e) { console.error("[blog-db] backup:", e.message); } };
  run();
  backupTimer = setInterval(run, 6 * 3600 * 1000);
  if (backupTimer.unref) backupTimer.unref();
}

// ---------- تبدیل مقدارها ----------
const typeOf = (t, col) => {
  const T = TABLES[t];
  if ((T.bool || []).includes(col)) return "bool";
  if ((T.json || []).includes(col)) return "json";
  if ((T.arr || []).includes(col)) return "arr";
  return "plain";
};
function toDb(t, col, v) {
  const k = typeOf(t, col);
  if (v === undefined) return null;
  if (k === "bool") return v === true || v === 1 || v === "true" ? 1 : 0;
  if (k === "json" || k === "arr") return v === null ? null : JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}
function fromDb(t, row) {
  if (!row) return row;
  const out = { ...row };
  for (const col of Object.keys(out)) {
    const k = typeOf(t, col);
    if (k === "bool") out[col] = !!out[col];
    else if ((k === "json" || k === "arr") && typeof out[col] === "string") {
      try { out[col] = JSON.parse(out[col]); } catch { out[col] = []; }
    }
  }
  return out;
}

function httpError(status, code, message) {
  const e = new Error(message || `db ${status}`);
  e.status = status;
  e.detail = JSON.stringify({ code, message });
  return e;
}
function mapDbError(e) {
  const m = String((e && e.message) || "");
  if (/UNIQUE constraint failed/i.test(m)) return httpError(409, "23505", m);
  if (/FOREIGN KEY constraint failed/i.test(m)) return httpError(409, "23503", m);
  if (/CHECK constraint failed|NOT NULL constraint failed/i.test(m)) return httpError(400, "23514", m);
  return e;
}

// ---------- ترجمه‌ی فیلترهای آدرس به SQL ----------
const COL_RE = /^[a-z_][a-z0-9_]*$/;
function splitTop(s) {
  const out = [];
  let depth = 0, q = false, cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unq = (x) => x.trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
const parseList = (v) => splitTop(v.replace(/^\(|\)$/g, "")).map(unq);
const parseArrayLiteral = (v) => splitTop(v.replace(/^\{|\}$/g, "")).map(unq);

// نام ستون همیشه با فهرست ستون‌های واقعی جدول چک می‌شود (جلوگیری از تزریق SQL)
function colCheck(t, col) {
  if (!COL_RE.test(col) || !TABLES[t].cols.has(col)) throw httpError(400, "42703", `ستون نامعتبر: ${col}`);
  return col;
}

function condSql(t, col, op, val, params) {
  colCheck(t, col);
  const kind = typeOf(t, col);
  const conv = (x) => (kind === "bool" ? (x === "true" ? 1 : 0) : x);
  switch (op) {
    case "eq": params.push(conv(val)); return `${col} = ?`;
    case "neq": params.push(conv(val)); return `${col} IS NOT ?`;
    case "gt": params.push(val); return `${col} > ?`;
    case "gte": params.push(val); return `${col} >= ?`;
    case "lt": params.push(val); return `${col} < ?`;
    case "lte": params.push(val); return `${col} <= ?`;
    case "ilike": {
      // * جای % ؛ خود % و _ در عبارت جستجو معنی خاص ندارند (escape می‌شوند)
      params.push(val.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "%"));
      return `${col} LIKE ? ESCAPE '\\'`;
    }
    case "in": {
      const list = parseList(val);
      if (!list.length) return "0";
      params.push(...list.map(conv));
      return `${col} IN (${list.map(() => "?").join(",")})`;
    }
    case "is": return val === "null" ? `${col} IS NULL` : `${col} IS NOT NULL`;
    case "cs": { // آرایه شامل همه‌ی مقدارها باشد: cs.{"a","b"}
      if (kind !== "arr") throw httpError(400, "42883", "cs فقط برای ستون آرایه‌ای است");
      const items = parseArrayLiteral(val);
      if (!items.length) return "1";
      return items.map((x) => { params.push(x); return `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`; }).join(" AND ");
    }
    case "ov": {
      if (kind !== "arr") throw httpError(400, "42883", "ov فقط برای ستون آرایه‌ای است");
      const items = parseArrayLiteral(val);
      if (!items.length) return "0";
      return "(" + items.map((x) => { params.push(x); return `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`; }).join(" OR ") + ")";
    }
    default: throw httpError(400, "42883", `عملگر پشتیبانی‌نشده: ${op}`);
  }
}

function buildWhere(t, params) {
  const parts = [];
  const sqlParams = [];
  for (const [k, raw] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (k === "or") {
      const subs = splitTop(raw.replace(/^\(|\)$/g, "")).map((p) => {
        const [col, op, ...rest] = p.split(".");
        return condSql(t, col, op, rest.join("."), sqlParams);
      });
      parts.push("(" + (subs.join(" OR ") || "0") + ")");
      continue;
    }
    const i = raw.indexOf(".");
    parts.push(condSql(t, k, raw.slice(0, i), raw.slice(i + 1), sqlParams));
  }
  return { where: parts.length ? " WHERE " + parts.join(" AND ") : "", params: sqlParams };
}

function buildOrder(t, order) {
  if (!order) return "";
  const specs = order.split(",").map((s) => {
    const [col, dir = "asc", nulls] = s.split(".");
    colCheck(t, col);
    const d = dir === "desc" ? "DESC" : "ASC";
    // پیش‌فرض PostgreSQL: صعودی null آخر، نزولی null اول
    const n = nulls === "nullslast" ? "NULLS LAST" : nulls === "nullsfirst" ? "NULLS FIRST" : d === "ASC" ? "NULLS LAST" : "NULLS FIRST";
    return `${col} ${d} ${n}`;
  });
  return " ORDER BY " + specs.join(", ");
}

// ---------- رابط اصلی ----------
// sb("blog_posts?slug=eq.x&select=id,title&order=created_at.desc&limit=10")
// sb("blog_posts", { method:"POST", body:{...}, prefer:"return=representation" })
async function sb(pathAndQuery, { method = "GET", body, prefer, withCount = false } = {}) {
  init();
  const qi = pathAndQuery.indexOf("?");
  const table = qi === -1 ? pathAndQuery : pathAndQuery.slice(0, qi);
  const params = [...new URLSearchParams(qi === -1 ? "" : pathAndQuery.slice(qi + 1)).entries()];
  const T = TABLES[table];
  if (!T) throw httpError(404, "42P01", `جدول ناشناخته: ${table}`);
  const wantRows = !!prefer && /return=representation/.test(prefer);
  const get = (k) => (params.find((p) => p[0] === k) || [])[1];

  try {
    if (method === "POST") {
      const ids = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { ...b };
        row.id = row.id || crypto.randomUUID();
        row.created_at = row.created_at || new Date().toISOString();
        if (T.touch) row.updated_at = row.updated_at || row.created_at;
        const cols = Object.keys(row).filter((c) => row[c] !== undefined);
        cols.forEach((c) => colCheck(table, c));
        db.run(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => toDb(table, c, row[c])));
        ids.push(row.id);
      }
      if (!wantRows) return null;
      const r = db.all(`SELECT * FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      return ids.map((id) => fromDb(table, r.find((x) => x.id === id)));
    }

    const { where, params: wp } = buildWhere(table, params);

    if (method === "PATCH") {
      const rows = db.all(`SELECT * FROM ${table}${where}`, wp);
      const cols = Object.keys(body || {}).filter((c) => body[c] !== undefined);
      cols.forEach((c) => colCheck(table, c));
      for (const old of rows) {
        const upd = {};
        for (const c of cols) upd[c] = toDb(table, c, body[c]);
        if (T.touch) {
          // مثل تریگر قبلی: فقط تغییر واقعی (غیر از شمارنده‌ی بازدید) تاریخ ویرایش را عوض می‌کند
          const changed = cols.some((c) => c !== "views" && c !== "updated_at" && String(upd[c] ?? "") !== String(old[c] ?? ""));
          upd.updated_at = changed ? new Date().toISOString() : old.updated_at;
        }
        const ks = Object.keys(upd);
        if (ks.length) db.run(`UPDATE ${table} SET ${ks.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...ks.map((c) => upd[c]), old.id]);
      }
      if (!wantRows || !rows.length) return wantRows ? [] : null;
      return db.all(`SELECT * FROM ${table} WHERE id IN (${rows.map(() => "?").join(",")})`, rows.map((r) => r.id)).map((r) => fromDb(table, r));
    }

    if (method === "DELETE") {
      db.run(`DELETE FROM ${table}${where}`, wp);
      return null;
    }

    // GET
    const sel = get("select");
    const colsSql = sel && sel !== "*" ? sel.split(",").map((c) => colCheck(table, c.trim())).join(", ") : "*";
    const limit = get("limit") !== undefined ? Math.max(0, parseInt(get("limit"), 10) || 0) : null;
    const offset = Math.max(0, parseInt(get("offset"), 10) || 0);
    let sql = `SELECT ${colsSql} FROM ${table}${where}${buildOrder(table, get("order"))}`;
    if (limit !== null) sql += ` LIMIT ${limit}`;
    if (offset) sql += (limit === null ? " LIMIT -1" : "") + ` OFFSET ${offset}`;
    const rows = db.all(sql, wp).map((r) => fromDb(table, r));
    if (!withCount) return rows;
    return { rows, total: db.get(`SELECT COUNT(*) AS n FROM ${table}${where}`, wp).n };
  } catch (e) {
    throw mapDbError(e);
  }
}

// برای اسکریپت درون‌ریزی: درج/جایگزینی مستقیم یک ردیف (ستون‌های ناشناخته نادیده گرفته می‌شوند)
function upsertRow(table, row) {
  init();
  const T = TABLES[table];
  const cols = Object.keys(row).filter((c) => T.cols.has(c) && row[c] !== undefined);
  db.run(`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => toDb(table, c, row[c])));
}

module.exports = { sb, enc, upsertRow, init, backupNow, TABLES, _file: () => dbFile };

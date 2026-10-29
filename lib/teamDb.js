// lib/teamDb.js — دسترسی مستقیم سیستم تیم به SQLite (بدون /rest/v1، بدون fetch، بدون هیچ ارتباطی با Supabase)
// از همان اتصال باز SQLite که localdb.init() ساخته استفاده می‌کند (lib/localdb/sqlite.js)، پس باید بعد از init صدا زده شود.
const crypto = require("crypto");
const sqlite = require("./localdb/sqlite");
const SCHEMA = require("./localdb/schema.json").tables;

const q = (s) => `"${s}"`;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isUnique = (e) => /UNIQUE constraint|23505|duplicate/i.test(String((e && e.message) || e));

// ---------- تبدیل ردیف‌ها: bool → true/false ، آرایه/JSON → شیء ----------
function norm(table, row) {
  if (!row) return row;
  const cols = (SCHEMA[table] && SCHEMA[table].cols) || {};
  const o = { ...row };
  for (const [k, d] of Object.entries(cols)) {
    if (!(k in o) || o[k] == null) continue;
    if (d.t === "bool") o[k] = !!o[k];
    else if ((d.t === "arr" || d.t === "json") && typeof o[k] === "string") { try { o[k] = JSON.parse(o[k]); } catch {} }
  }
  return o;
}
function ser(table, key, v) {
  const t = SCHEMA[table] && SCHEMA[table].cols[key] && SCHEMA[table].cols[key].t;
  if (v === undefined) return null;
  if (v !== null && (t === "arr" || t === "json") && typeof v !== "string") return JSON.stringify(v);
  return v; // boolean و undefined را خود sqlite.js به ۰/۱ و null تبدیل می‌کند
}

// ---------- خواندن ----------
const all = (sql, params, table) => sqlite.all(sql, params).map((r) => (table ? norm(table, r) : r));
const get = (sql, params, table) => { const r = sqlite.get(sql, params); return table ? norm(table, r) : r; };
const run = (sql, params) => sqlite.run(sql, params);
const tx = (fn) => sqlite.tx(fn);
const ph = (arr) => arr.map(() => "?").join(","); // "?,?,?" برای IN (...)

// ---------- نوشتن (پیش‌فرض‌های schema.json مثل rest.js اعمال می‌شود) ----------
function insert(table, row) {
  const cols = SCHEMA[table].cols;
  const r = { ...row };
  for (const [k, d] of Object.entries(cols)) {
    if (r[k] !== undefined || d.auto || !d.def) continue;
    if (d.def.uuid) r[k] = crypto.randomUUID();
    else if (d.def.now) r[k] = new Date().toISOString();
    else if ("value" in d.def) r[k] = d.def.value;
  }
  const keys = Object.keys(r).filter((k) => r[k] !== undefined);
  keys.forEach((k) => { if (!IDENT.test(k)) throw new Error("bad column " + k); });
  const info = sqlite.run(`INSERT INTO ${q(table)} (${keys.map(q).join(",")}) VALUES (${ph(keys)})`, keys.map((k) => ser(table, k, r[k])));
  const out = norm(table, r);
  if (cols.id && cols.id.auto) out.id = Number(info.lastInsertRowid);
  return out;
}
function update(table, set, where, params = []) {
  const keys = Object.keys(set).filter((k) => set[k] !== undefined);
  if (!keys.length) return [];
  keys.forEach((k) => { if (!IDENT.test(k)) throw new Error("bad column " + k); });
  return sqlite.all(
    `UPDATE ${q(table)} SET ${keys.map((k) => `${q(k)}=?`).join(",")} WHERE ${where} RETURNING *`,
    [...keys.map((k) => ser(table, k, set[k])), ...params]
  ).map((r) => norm(table, r));
}
const remove = (table, where, params = []) => sqlite.all(`DELETE FROM ${q(table)} WHERE ${where} RETURNING *`, params).map((r) => norm(table, r));

// ---------- پیدا کردن کاربر سایت (جایگزین find_auth_user) ----------
function findAuthUser({ phone, email }) {
  if (email) return get("SELECT id FROM auth_users WHERE lower(email)=lower(?) LIMIT 1", [email]) || null;
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  const c = new Set([d]);
  if (d.startsWith("0098")) c.add(d.slice(2));
  if (d.startsWith("0")) c.add("98" + d.slice(1));
  if (d.length === 10 && d.startsWith("9")) c.add("98" + d);
  const list = [...c];
  return get(`SELECT id FROM auth_users WHERE phone IN (${ph(list)}) OR REPLACE(phone,'+','') IN (${ph(list)}) LIMIT 1`, [...list, ...list]) || null;
}

// ---------- تایید اتمیک کار + پرداخت توکن (جایگزین RPC approve_team_task) ----------
function approveTaskTx(id) {
  return tx(() => {
    const t = sqlite.get("SELECT * FROM team_tasks WHERE id=? AND status='submitted'", [id]);
    if (!t || !t.assignee) return { ok: false };
    const rows = update("team_tasks", { status: "approved", reviewed_at: new Date().toISOString() }, "id=? AND status='submitted'", [id]);
    if (!rows.length) return { ok: false };
    insert("team_ledger", { user_id: t.assignee, task_id: id, tokens: t.reward_tokens, kind: "reward", note: `پاداش کار ${t.label || ""}`.trim() });
    return { ok: true, tokens: t.reward_tokens };
  });
}

// ---------- ستون‌ها و ایندکس‌هایی که سیستم تیم لازم دارد (جایگزین team-upgrade*.sql؛ خودکار و ایمن برای چندبار اجرا) ----------
const COLS = [
  ["team_manhwas", "slug", "TEXT"], ["team_manhwas", "source_url", "TEXT"],
  ["team_chapters", "banner_translator", "TEXT"], ["team_chapters", "banner_typist", "TEXT"], ["team_chapters", "banner_cleaner", "TEXT"],
];
const INDEXES = [
  ["team_manhwas_slug_uq", `CREATE UNIQUE INDEX IF NOT EXISTS team_manhwas_slug_uq ON team_manhwas(slug) WHERE slug IS NOT NULL`],
  ["uq_team_tasks_typist_chapter", `CREATE UNIQUE INDEX IF NOT EXISTS uq_team_tasks_typist_chapter ON team_tasks(chapter_id) WHERE role='typist' AND chapter_id IS NOT NULL`],
  ["uq_team_withdrawals_pending", `CREATE UNIQUE INDEX IF NOT EXISTS uq_team_withdrawals_pending ON team_withdrawals(user_id) WHERE status='pending'`],
  ["ix_team_support_user", `CREATE INDEX IF NOT EXISTS ix_team_support_user ON team_support(user_id, status)`],
  ["ix_team_tickets_user", `CREATE INDEX IF NOT EXISTS ix_team_tickets_user ON team_tickets(user_id)`],
  ["ix_team_chapters_manhwa", `CREATE INDEX IF NOT EXISTS ix_team_chapters_manhwa ON team_chapters(manhwa_id)`],
];
let migrated = false;
function ready() {
  if (migrated) return;
  for (const [t, c, type] of COLS) {
    const have = sqlite.all(`PRAGMA table_info(${q(t)})`).map((r) => r.name);
    if (!have.includes(c)) sqlite.exec(`ALTER TABLE ${q(t)} ADD COLUMN ${q(c)} ${type}`);
  }
  for (const [name, sql] of INDEXES) {
    try { sqlite.exec(sql); } catch (e) { console.warn(`[team] ایندکس ${name} ساخته نشد (داده‌ی تکراری؟): ${e.message}`); }
  }
  migrated = true;
}

module.exports = { ready, all, get, run, tx, ph, insert, update, remove, norm, isUnique, findAuthUser, approveTaskTx };

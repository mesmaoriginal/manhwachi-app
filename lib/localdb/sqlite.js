// lib/localdb/sqlite.js — لایه‌ی نازک روی SQLite. اول node:sqlite (Node 22.5+) و اگر نبود better-sqlite3.
const fs = require("fs");
let db = null, kind = null;
const cache = new Map();

function open(file) {
  if (db) return db;
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  try {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(file); kind = "node";
  } catch (e1) {
    try { const Better = require("better-sqlite3"); db = new Better(file); kind = "better"; }
    catch (e2) { throw new Error("هیچ درایور SQLite پیدا نشد. یا Node نسخه‌ی ۲۲.۵ به بالا بگیرید یا اجرا کنید: npm i better-sqlite3\n" + e1.message + "\n" + e2.message); }
  }
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;");
  return db;
}
const clean = (params) => (params || []).map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
function stmt(sql) { let s = cache.get(sql); if (!s) { s = db.prepare(sql); if (cache.size > 500) cache.clear(); cache.set(sql, s); } return s; }

const exec = (sql) => db.exec(sql);
const run = (sql, params) => stmt(sql).run(...clean(params));
const get = (sql, params) => stmt(sql).get(...clean(params));
const all = (sql, params) => stmt(sql).all(...clean(params));

let depth = 0;
function tx(fn) {
  const top = depth === 0, sp = `sp${depth}`;
  db.exec(top ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--; db.exec(top ? "COMMIT" : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    try { db.exec(top ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch {}
    throw e;
  }
}
module.exports = { open, exec, run, get, all, tx, driver: () => kind };

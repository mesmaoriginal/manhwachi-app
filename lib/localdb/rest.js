// lib/localdb/rest.js — شبیه‌ساز PostgREST (/rest/v1) روی SQLite
// پشتیبانی: select/order/limit/offset/Range، فیلترها (eq neq gt gte lt lte like ilike in is not cs cd ov و or/and تو‌در‌تو)،
// POST (تکی/آرایه + upsert با on_conflict)، PATCH، DELETE، HEAD، Prefer (return, count, resolution)، Accept object، RPC.
const crypto = require("crypto");
const { all, get, run, tx } = require("./sqlite");
const { HttpError } = require("./errors");
const cfg = require("./config");
const jwt = require("./jwt");
const P = require("./policies");
const SCHEMA = require("./schema.json").tables;

const MAX_ROWS = 1000;
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "and", "or", "apikey"]);
const q = (s) => `"${s}"`;
const err = (status, code, message, details = null, hint = null) => new HttpError(status, code, message, details, hint);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- تبدیل مقدارها ----------
function normTs(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  let s = String(v).trim();
  s = s.replace(/^(\d{4}-\d\d-\d\d) (?=\d)/, "$1T");
  if (/^\d{4}-\d\d-\d\d$/.test(s)) s += "T00:00:00Z";
  s = s.replace(/(T\d\d:\d\d(?::\d\d(?:\.\d+)?)?) (\d\d(?::?\d\d)?)$/, "$1+$2"); // '+' در URL به فاصله تبدیل شده
  if (/T.*[+-]\d\d$/.test(s)) s += ":00";
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
function toDb(col, v) {
  if (v === undefined || v === null) return null;
  switch (col.t) {
    case "bool":
      if (v === true || v === "true" || v === 1 || v === "1") return 1;
      if (v === false || v === "false" || v === 0 || v === "0") return 0;
      throw err(400, "22P02", `invalid input syntax for type boolean: "${v}"`);
    case "int": {
      const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
      if (!Number.isInteger(n)) throw err(400, "22P02", `invalid input syntax for type integer: "${v}"`);
      return n;
    }
    case "num": { const n = Number(v); if (!Number.isFinite(n)) throw err(400, "22P02", `invalid input syntax for type numeric: "${v}"`); return n; }
    case "ts": { const t = normTs(v); if (!t) throw err(400, "22007", `invalid input syntax for type timestamp: "${v}"`); return t; }
    case "arr":
      if (Array.isArray(v)) return JSON.stringify(v);
      if (typeof v === "string" && /^\{.*\}$/s.test(v)) return JSON.stringify(v.slice(1, -1) ? v.slice(1, -1).split(",").map((x) => x.trim().replace(/^"|"$/g, "")) : []);
      throw err(400, "22P02", `malformed array literal: "${v}"`);
    case "json": return JSON.stringify(v);
    default:
      if (typeof v === "object") throw err(400, "22P02", "invalid input syntax for type text");
      return String(v);
  }
}
function fromDb(col, v) {
  if (v === null || v === undefined) return null;
  if (col.t === "bool") return !!v;
  if (col.t === "arr" || col.t === "json") { try { return JSON.parse(v); } catch { return col.t === "arr" ? [] : null; } }
  return v;
}
const rowOut = (T, row, cols) => { const o = {}; for (const c of cols) o[c.out] = fromDb(T.cols[c.col], row[c.col]); return o; };

// ---------- ابزارهای پارس ----------
function tableOf(name) {
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, name)) throw err(404, "PGRST205", `Could not find the table 'public.${name}' in the schema cache`);
  return SCHEMA[name];
}
function colOf(table, T, name) {
  if (!Object.prototype.hasOwnProperty.call(T.cols, name)) throw err(400, "42703", `column ${table}.${name} does not exist`);
  return T.cols[name];
}
function parseSelect(table, T, sel) {
  if (!sel || sel === "*") return Object.keys(T.cols).map((c) => ({ col: c, out: c }));
  const out = [];
  for (let part of sel.split(",")) {
    part = part.trim();
    if (!part) continue;
    if (part === "*") { for (const c of Object.keys(T.cols)) out.push({ col: c, out: c }); continue; }
    if (part.includes("(")) throw err(400, "PGRST100", "Embedded resources (joins) are not supported by the local database", null, "Select columns separately.");
    part = part.replace(/::\w+$/, "");
    let alias = null;
    if (part.includes(":")) [alias, part] = part.split(":");
    colOf(table, T, part);
    out.push({ col: part, out: alias || part });
  }
  if (!out.length) throw err(400, "PGRST100", "empty select");
  return out;
}
function splitTop(s) {
  const out = []; let d = 0, inq = false, cur = "";
  for (const ch of s) {
    if (ch === '"') inq = !inq;
    if (!inq) { if (ch === "(") d++; else if (ch === ")") d--; else if (ch === "," && d === 0) { out.push(cur); cur = ""; continue; } }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function listOf(v) {
  const m = /^[({](.*)[)}]$/s.exec(v.trim());
  const inner = m ? m[1] : v;
  return inner === "" ? [] : splitTop(inner).map((x) => x.trim().replace(/^"(.*)"$/s, "$1"));
}
const typed = (col, s) => (col.t === "text" ? s : toDb(col, s));

function condition(table, T, name, expr) {
  const col = colOf(table, T, name), c = q(name);
  let neg = false;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf(".");
  if (i < 0) throw err(400, "PGRST100", `failed to parse filter (${name}.${expr})`);
  const op = expr.slice(0, i), v = expr.slice(i + 1);
  let sql, params = [];
  switch (op) {
    case "eq": sql = `${c} = ?`; params = [typed(col, v)]; break;
    case "neq": sql = `${c} <> ?`; params = [typed(col, v)]; break;
    case "gt": sql = `${c} > ?`; params = [typed(col, v)]; break;
    case "gte": sql = `${c} >= ?`; params = [typed(col, v)]; break;
    case "lt": sql = `${c} < ?`; params = [typed(col, v)]; break;
    case "lte": sql = `${c} <= ?`; params = [typed(col, v)]; break;
    case "like": case "ilike": sql = `${c} LIKE ?`; params = [v.replace(/\*/g, "%")]; break;
    case "in": { const l = listOf(v); if (!l.length) { sql = "0"; break; } sql = `${c} IN (${l.map(() => "?").join(",")})`; params = l.map((x) => typed(col, x)); break; }
    case "is":
      if (v === "null") sql = `${c} IS NULL`;
      else if (v === "true") sql = `${c} = 1`;
      else if (v === "false") sql = `${c} = 0`;
      else if (v === "unknown") sql = `${c} IS NULL`;
      else throw err(400, "PGRST100", `invalid value for is: ${v}`);
      break;
    case "cs": case "cd": case "ov": {
      if (col.t !== "arr") throw err(400, "42883", `operator ${op} is only supported on array columns`);
      const l = listOf(v);
      if (op === "cs") { sql = l.length ? l.map(() => `EXISTS (SELECT 1 FROM json_each(${c}) WHERE value = ?)`).join(" AND ") : "1"; params = l; }
      else if (op === "ov") { sql = l.length ? `EXISTS (SELECT 1 FROM json_each(${c}) WHERE value IN (${l.map(() => "?").join(",")}))` : "0"; params = l; }
      else { sql = l.length ? `NOT EXISTS (SELECT 1 FROM json_each(${c}) WHERE value NOT IN (${l.map(() => "?").join(",")}))` : `json_array_length(${c}) = 0`; params = l; }
      break;
    }
    default: throw err(400, "PGRST100", `unsupported operator: ${op}`);
  }
  return { sql: neg ? `NOT (${sql})` : `(${sql})`, params };
}
function group(table, T, expr, joiner) {
  const inner = expr.trim().replace(/^\((.*)\)$/s, "$1");
  const parts = [];
  for (const item of splitTop(inner)) {
    const m = /^(not\.)?(and|or)(\(.*\))$/s.exec(item.trim());
    if (m) { const g = group(table, T, m[3], m[2].toUpperCase()); parts.push(m[1] ? { sql: `NOT ${g.sql}`, params: g.params } : g); continue; }
    const t = item.trim(), d = t.indexOf(".");
    if (d < 0) throw err(400, "PGRST100", `failed to parse logic tree (${item})`);
    parts.push(condition(table, T, t.slice(0, d), t.slice(d + 1)));
  }
  if (!parts.length) return { sql: "1", params: [] };
  return { sql: `(${parts.map((p) => p.sql).join(` ${joiner} `)})`, params: parts.flatMap((p) => p.params) };
}
function buildFilters(table, T, query) {
  const parts = [];
  for (const [k, v] of query) {
    if (k === "or" || k === "and") { parts.push(group(table, T, v, k.toUpperCase())); continue; }
    if (RESERVED.has(k)) continue;
    parts.push(condition(table, T, k, v));
  }
  return parts;
}
function buildOrder(table, T, order) {
  if (!order) return "";
  const out = [];
  for (const it of order.split(",")) {
    const [name, ...mods] = it.trim().split(".");
    colOf(table, T, name);
    out.push(`${q(name)} ${mods.includes("desc") ? "DESC" : "ASC"}${mods.includes("nullsfirst") ? " NULLS FIRST" : mods.includes("nullslast") ? " NULLS LAST" : ""}`);
  }
  return out.length ? ` ORDER BY ${out.join(", ")}` : "";
}
const prefer = (h) => Object.fromEntries(String(h || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf("="); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)]; }));
const polFilter = (pol, op, ctx) => {
  const f = pol && pol[op];
  if (!f) return false;
  return typeof f === "function" ? f(ctx) : f;
};
const whereSql = (parts) => (parts.length ? ` WHERE ${parts.map((p) => p.sql).join(" AND ")}` : "");
const whereParams = (parts) => parts.flatMap((p) => p.params);

// ---------- احراز هویت ----------
function authenticate(req) {
  const apikey = String(req.headers["apikey"] || req.query.get("apikey") || "");
  const isKey = (k) => k && ((cfg.anonKey && safeEq(k, cfg.anonKey)) || (cfg.serviceKey && safeEq(k, cfg.serviceKey)));
  if (!isKey(apikey)) throw err(401, "PGRST301", "No API key found in request", null, "No `apikey` request header or url param was found.");
  const bearer = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim() || apikey;
  const ctx = { role: "anon", uid: null, ip: req.ip || "unknown" };
  if (cfg.serviceKey && safeEq(bearer, cfg.serviceKey)) { ctx.role = "service_role"; return ctx; }
  if (cfg.anonKey && safeEq(bearer, cfg.anonKey)) return ctx;
  const p = jwt.verify(bearer, cfg.jwtSecret);
  if (!p || p.expired || !p.sub) throw err(401, "PGRST301", p && p.expired ? "JWT expired" : "JWT invalid");
  if (!get("SELECT 1 AS x FROM auth_users WHERE id = ?", [p.sub])) throw err(401, "PGRST301", "JWT invalid");
  ctx.role = "authenticated"; ctx.uid = p.sub;
  return ctx;
}

// ---------- عملیات ----------
function doGet(req, ctx, table, T, head) {
  const cols = parseSelect(table, T, req.query.get("select"));
  const parts = buildFilters(table, T, req.query);
  if (ctx.role !== "service_role") {
    const pf = polFilter(P.policies[table], "select", ctx);
    if (pf === false) return respondRows(req, T, cols, [], 0, 0, head);
    if (pf && pf !== true) parts.push(pf);
  }
  const pr = prefer(req.headers["prefer"]);
  let limit = req.query.get("limit"), offset = req.query.get("offset") || 0;
  const range = String(req.headers["range"] || "").match(/^(\d+)-(\d*)$/);
  if (range) { offset = Number(range[1]); if (range[2] !== "") limit = Number(range[2]) - offset + 1; }
  limit = limit == null || limit === "" ? MAX_ROWS : Number(limit); offset = Number(offset);
  if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(offset) || offset < 0) throw err(400, "PGRST103", "invalid limit/offset");
  limit = Math.min(limit, MAX_ROWS);
  const W = whereSql(parts), params = whereParams(parts);
  const total = pr.count ? get(`SELECT COUNT(*) AS n FROM ${q(table)}${W}`, params).n : null;
  const rows = all(`SELECT ${[...new Set(cols.map((c) => q(c.col)))].join(", ")} FROM ${q(table)}${W}${buildOrder(table, T, req.query.get("order"))} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return respondRows(req, T, cols, rows, total, offset, head);
}
function respondRows(req, T, cols, rows, total, offset, head, status = 200) {
  const out = rows.map((r) => rowOut(T, r, cols));
  const headers = { "Content-Range": `${out.length ? `${offset}-${offset + out.length - 1}` : "*"}/${total ?? "*"}` };
  if (/vnd\.pgrst\.object\+json/.test(String(req.headers["accept"] || ""))) {
    if (out.length !== 1) throw err(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${out.length} rows`);
    return { status, headers, body: head ? undefined : out[0] };
  }
  return { status, headers, body: head ? undefined : out };
}

function doInsert(req, ctx, table, T) {
  let rows = req.body;
  if (rows === undefined || rows === null || typeof rows !== "object") throw err(400, "PGRST102", "Empty or invalid json");
  if (!Array.isArray(rows)) rows = [rows];
  if (!rows.length) throw err(400, "PGRST102", "Empty or invalid json");
  if (rows.length > 500) throw err(400, "PGRST102", "too many rows");
  const pr = prefer(req.headers["prefer"]), service = ctx.role === "service_role";
  const merge = pr.resolution === "merge-duplicates", ignore = pr.resolution === "ignore-duplicates";
  const pol = P.policies[table];
  if (!service) {
    if (!pol || !pol.insert || (merge && !pol.update)) throw err(403, "42501", `permission denied for table ${table}`);
    P.limitWrite(ctx, table);
  }
  let conflict = req.query.get("on_conflict");
  conflict = conflict ? conflict.split(",").map((c) => (colOf(table, T, c.trim()), c.trim())) : T.pk;
  const cols = parseSelect(table, T, req.query.get("select"));
  const inserted = tx(() => {
    const out = [];
    for (let row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw err(400, "PGRST102", "All object keys must match");
      for (const k of Object.keys(row)) if (!Object.prototype.hasOwnProperty.call(T.cols, k)) throw err(400, "PGRST204", `Could not find the '${k}' column of '${table}' in the schema cache`);
      if (!service) row = pol.insert(ctx, row);
      const rec = {};
      for (const [name, col] of Object.entries(T.cols)) {
        let v = row[name];
        if (v === undefined) {
          if (col.auto) continue;
          if (col.def) v = col.def.uuid ? crypto.randomUUID() : col.def.now ? new Date().toISOString() : col.def.value;
        }
        if (v === undefined) { if (col.nn) throw err(400, "23502", `null value in column "${name}" of relation "${table}" violates not-null constraint`); continue; }
        if ((v === null) && col.nn) throw err(400, "23502", `null value in column "${name}" of relation "${table}" violates not-null constraint`);
        rec[name] = toDb(col, v);
      }
      const names = Object.keys(rec);
      let sql = names.length ? `INSERT INTO ${q(table)} (${names.map(q).join(",")}) VALUES (${names.map(() => "?").join(",")})` : `INSERT INTO ${q(table)} DEFAULT VALUES`;
      if (merge || ignore) {
        const upd = merge ? names.filter((n) => !conflict.includes(n)) : [];
        sql += ` ON CONFLICT (${conflict.map(q).join(",")}) ` + (upd.length ? `DO UPDATE SET ${upd.map((n) => `${q(n)} = excluded.${q(n)}`).join(", ")}` : "DO NOTHING");
      }
      out.push(...all(sql + " RETURNING *", Object.values(rec)));
    }
    return out;
  });
  const h = require("./policies").hooks[table];
  if (h && h.afterInsert) h.afterInsert(inserted);
  if (pr.return === "representation") return respondRows(req, T, cols, inserted, null, 0, false, 201);
  return { status: 201, headers: {} };
}

function doUpdate(req, ctx, table, T) {
  const parts = buildFilters(table, T, req.query);
  if (!parts.length) throw err(400, "21000", "UPDATE requires a WHERE clause");
  const patch = req.body;
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length) throw err(400, "PGRST102", "Empty or invalid json");
  const pol = P.policies[table];
  if (ctx.role !== "service_role") {
    const pf = polFilter(pol, "update", ctx);
    if (pf === false) return { status: 204, headers: {} };
    for (const k of Object.keys(patch)) if (!(pol.updateCols || []).includes(k)) throw err(403, "42501", `permission denied for column ${k} of table ${table}`);
    if (pf !== true) parts.push(pf);
    P.limitWrite(ctx, table);
  }
  P.beforeUpdate(table, patch);
  if (T.cols.updated_at && patch.updated_at === undefined) patch.updated_at = new Date().toISOString();
  const names = Object.keys(patch);
  for (const k of names) colOf(table, T, k);
  const pr = prefer(req.headers["prefer"]), cols = parseSelect(table, T, req.query.get("select"));
  const sql = `UPDATE ${q(table)} SET ${names.map((n) => `${q(n)} = ?`).join(", ")}${whereSql(parts)} RETURNING *`;
  const rows = all(sql, [...names.map((n) => toDb(T.cols[n], patch[n])), ...whereParams(parts)]);
  if (pr.return === "representation") return respondRows(req, T, cols, rows, null, 0, false, 200);
  return { status: 204, headers: {} };
}

function doDelete(req, ctx, table, T) {
  const parts = buildFilters(table, T, req.query);
  if (!parts.length) throw err(400, "21000", "DELETE requires a WHERE clause");
  if (ctx.role !== "service_role") {
    const pf = polFilter(P.policies[table], "delete", ctx);
    if (pf === false) return { status: 204, headers: {} };
    if (pf !== true) parts.push(pf);
    P.limitWrite(ctx, table);
  }
  const pr = prefer(req.headers["prefer"]), cols = parseSelect(table, T, req.query.get("select"));
  const rows = all(`DELETE FROM ${q(table)}${whereSql(parts)} RETURNING *`, whereParams(parts));
  const h = P.hooks[table];
  if (h && h.afterDelete) h.afterDelete(rows);
  if (pr.return === "representation") return respondRows(req, T, cols, rows, null, 0, false, 200);
  return { status: 204, headers: {} };
}

function mapDbError(e) {
  const m = String(e.message || "");
  if (/UNIQUE constraint failed/i.test(m)) return err(409, "23505", `duplicate key value violates unique constraint`, m);
  if (/NOT NULL constraint failed/i.test(m)) return err(400, "23502", "null value violates not-null constraint", m);
  if (/ON CONFLICT clause does not match/i.test(m)) return err(400, "42P10", "there is no unique or exclusion constraint matching the ON CONFLICT specification", m);
  return null;
}

async function handle(req) {
  try {
    const ctx = authenticate(req);
    const parts = req.path.split("/").filter(Boolean);
    const m = req.method;
    if (!parts.length) throw err(404, "PGRST125", "Invalid path specified in request URL");
    if (parts[0] === "rpc" && parts[1]) {
      if (m !== "POST" && m !== "GET") throw err(405, "PGRST101", "Only POST and GET are allowed for functions");
      return await rpc().call(parts[1], req, ctx);
    }
    const table = parts[0], T = tableOf(table);
    if (m === "GET" || m === "HEAD") return doGet(req, ctx, table, T, m === "HEAD");
    if (m === "POST") return doInsert(req, ctx, table, T);
    if (m === "PATCH") return doUpdate(req, ctx, table, T);
    if (m === "DELETE") return doDelete(req, ctx, table, T);
    throw err(405, "PGRST117", "Unsupported HTTP method: " + m);
  } catch (e) {
    const he = e instanceof HttpError ? e : mapDbError(e);
    if (he) return { status: he.status, headers: {}, body: { code: he.code, details: he.details, hint: he.hint, message: he.message } };
    console.error("[rest]", e);
    return { status: 500, headers: {}, body: { code: "XX000", details: null, hint: null, message: "Internal server error" } };
  }
}
let _rpc; const rpc = () => _rpc || (_rpc = require("./rpc"));
module.exports = { handle, toDb, fromDb, normTs };

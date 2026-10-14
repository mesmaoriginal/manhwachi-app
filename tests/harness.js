// tests/harness.js — دیتابیس واقعی SQLite (در حافظه) + اکسپرس ساختگی؛ بدون نصب هیچ پکیجی قابل اجراست.
const Module = require("module");
const path = require("path");

// دیتابیس: خود blogDb واقعی (SQLite در حافظه)
process.env.BLOG_DB_FILE = ":memory:";
const { sb } = require("../blog/blogDb");

// ---------- اکسپرس ساختگی ----------
function makeRouter() {
  const entries = [];
  const r = { entries };
  for (const m of ["get", "post", "put", "delete"]) r[m] = (p, ...h) => entries.push({ type: "route", method: m.toUpperCase(), pattern: p, handlers: h.flat() });
  r.use = (...a) => { const prefix = typeof a[0] === "string" ? a.shift() : ""; for (const fn of a.flat()) entries.push({ type: "use", prefix, fn }); };
  return r;
}
function pat(p) { const keys = []; const re = new RegExp("^" + p.replace(/\/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$"); return { re, keys }; }
async function dispatch(router, method, url, { headers = {}, body, ip = "1.2.3.4" } = {}) {
  const u = new URL(url, "http://x");
  const hdr = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method, originalUrl: url, path: u.pathname, url: u.pathname, query: Object.fromEntries(u.searchParams), params: {}, headers: hdr, body, ip, secure: false, get: (n) => hdr[n.toLowerCase()] };
  const out = { status: 200, headers: {}, cookies: [], body: "", redirect: null };
  let done;
  const finished = new Promise((r) => (done = r));
  const res = {
    headersSent: false,
    status(c) { out.status = c; return this; },
    set(k, v) { if (typeof k === "object") Object.assign(out.headers, k); else out.headers[k.toLowerCase()] = v; return this; },
    append(k, v) { out.cookies.push(v); return this; },
    type(t) { out.headers["content-type"] = t; return this; },
    json(o) { out.headers["content-type"] = "application/json"; out.body = JSON.stringify(o); res.headersSent = true; done(); return this; },
    send(b) { out.body = typeof b === "string" ? b : JSON.stringify(b); res.headersSent = true; done(); return this; },
    end() { res.headersSent = true; done(); return this; },
    redirect(s, l) { out.status = s; out.redirect = l; res.headersSent = true; done(); },
  };
  const chain = [];
  for (const e of router.entries) {
    if (e.type === "use") { if (!e.prefix || u.pathname === e.prefix || u.pathname.startsWith(e.prefix + "/")) chain.push({ fn: e.fn, params: {} }); }
    else if (e.method === method) { const { re, keys } = pat(e.pattern); const m = re.exec(u.pathname); if (m) { const params = {}; keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); for (const h of e.handlers) chain.push({ fn: h, params }); } }
  }
  let i = 0;
  const next = async (err) => {
    while (i < chain.length) {
      const { fn, params } = chain[i++];
      if (fn.length === 4 && !err) continue;
      if (fn.length !== 4 && err) continue;
      req.params = params;
      try { err ? await fn(err, req, res, next) : await fn(req, res, next); } catch (e) { return next(e); }
      return;
    }
    if (!res.headersSent) { out.status = 404; out.body = "unmatched"; done(); }
  };
  next();
  await finished;
  out.json = () => JSON.parse(out.body);
  return out;
}

// ---------- جایگزینی ماژول‌ها ----------
function install() {
  const orig = Module._load;
  const stubExpress = () => {};
  stubExpress.Router = makeRouter;
  stubExpress.json = () => (req, res, next) => next();
  stubExpress.static = () => (req, res, next) => next();
  Module._load = function (request, parent, isMain) {
    if (request === "express") return stubExpress;
    return orig.apply(this, arguments);
  };
}
module.exports = { install, dispatch, sb };

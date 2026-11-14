"use strict";

const crypto = require("crypto");

const fs = require("fs");

const path = require("path");

function intEnv(name, def, min, max) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

const ENABLED = process.env.DEVICE_LIMIT !== "0";

const MAX_DEVICES = intEnv("MAX_DEVICES_PER_ACCOUNT", 2, 1, 10);

const INACTIVE_MS = intEnv("DEVICE_INACTIVE_DAYS", 30, 1, 365) * 864e5;

const RELEASES_PER_DAY = intEnv("DEVICE_RELEASES_PER_DAY", 3, 1, 50);

const EXEMPT = new Set(String(process.env.DEVICE_LIMIT_EXEMPT_USER_IDS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

const DEVICE_COOKIE = "mc_did";

const RELEASE_COOKIE = "mc_dl";

const DEVICE_COOKIE_MAX_AGE_MS = 400 * 864e5;

const RELEASE_TTL_MS = 10 * 6e4;

const TOKEN_TOUCH_EVERY_MS = 10 * 6e4;

const fa = n => String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);

const MSG_LIMIT = `این حساب هم‌اکنون روی ${fa(MAX_DEVICES)} دستگاه فعال است. برای ورود از این دستگاه، یکی از دستگاه‌های قبلی را از حساب خارج کن.`;

const MSG_REVOKED = "این دستگاه از حساب خارج شده است. دوباره وارد شو.";

let db = null;

let stmts = null;

let mounted = false;

function dbFile() {
  if (process.env.DEVICES_DB_FILE) return process.env.DEVICES_DB_FILE;
  const base = process.env.LOCALDB_FILE || path.join(process.cwd(), "data", "app.sqlite");
  return path.join(path.dirname(base), "devices.sqlite");
}

function open() {
  if (db) return db;
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });
  try {
    const {DatabaseSync: DatabaseSync} = require("node:sqlite");
    db = new DatabaseSync(file);
  } catch {
    const Better = require("better-sqlite3");
    db = new Better(file);
  }
  db.exec(`\n    PRAGMA journal_mode = WAL;\n    PRAGMA busy_timeout = 5000;\n    CREATE TABLE IF NOT EXISTS devices (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      user_id TEXT NOT NULL,\n      device_key TEXT NOT NULL,\n      label TEXT,\n      ip TEXT,\n      created_at INTEGER NOT NULL,\n      last_seen_at INTEGER NOT NULL,\n      revoked_at INTEGER,\n      revoked_reason TEXT,\n      UNIQUE (user_id, device_key)\n    );\n    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices (user_id, revoked_at);\n    CREATE TABLE IF NOT EXISTS tokens (\n      hash TEXT PRIMARY KEY,\n      device_id INTEGER NOT NULL,\n      exp INTEGER NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_tokens_device ON tokens (device_id);\n    CREATE INDEX IF NOT EXISTS idx_tokens_exp ON tokens (exp);\n    CREATE TABLE IF NOT EXISTS releases (\n      user_id TEXT NOT NULL,\n      at INTEGER NOT NULL\n    );\n    CREATE INDEX IF NOT EXISTS idx_releases_user ON releases (user_id, at);\n  `);
  stmts = {
    getRow: db.prepare("SELECT * FROM devices WHERE user_id = ? AND device_key = ?"),
    getById: db.prepare("SELECT * FROM devices WHERE id = ? AND user_id = ?"),
    countActive: db.prepare("SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND revoked_at IS NULL AND last_seen_at >= ?"),
    listActive: db.prepare("SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL AND last_seen_at >= ? ORDER BY last_seen_at DESC"),
    insert: db.prepare("INSERT INTO devices (user_id, device_key, label, ip, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"),
    reactivate: db.prepare("UPDATE devices SET revoked_at = NULL, revoked_reason = NULL, label = ?, ip = ?, last_seen_at = ? WHERE id = ?"),
    touch: db.prepare("UPDATE devices SET label = ?, ip = ?, last_seen_at = ? WHERE id = ?"),
    touchOnly: db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?"),
    revoke: db.prepare("UPDATE devices SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"),
    revokeAll: db.prepare("UPDATE devices SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL"),
    addToken: db.prepare("INSERT OR REPLACE INTO tokens (hash, device_id, exp) VALUES (?, ?, ?)"),
    tokenInfo: db.prepare("SELECT d.id AS id, d.user_id AS user_id, d.revoked_at AS revoked_at, d.last_seen_at AS last_seen_at " + "FROM tokens t JOIN devices d ON d.id = t.device_id WHERE t.hash = ?"),
    pruneTokens: db.prepare("DELETE FROM tokens WHERE exp < ?"),
    pruneDevices: db.prepare("DELETE FROM devices WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR last_seen_at < ?"),
    pruneReleases: db.prepare("DELETE FROM releases WHERE at < ?"),
    addRelease: db.prepare("INSERT INTO releases (user_id, at) VALUES (?, ?)"),
    countReleases: db.prepare("SELECT COUNT(*) AS n FROM releases WHERE user_id = ? AND at >= ?")
  };
  const t = setInterval(prune, 36e5);
  if (t.unref) t.unref();
  prune();
  return db;
}

function prune() {
  try {
    const now = Date.now();
    stmts.pruneTokens.run(Math.floor(now / 1e3) - 3600);
    stmts.pruneDevices.run(now - 120 * 864e5, now - 400 * 864e5);
    stmts.pruneReleases.run(now - 2 * 864e5);
  } catch (e) {
    console.error("[deviceLimit] prune:", e.message);
  }
}

let cachedSecret = null;

function secret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.DEVICE_COOKIE_SECRET || process.env.GUEST_COOKIE_SECRET || process.env.LOCALDB_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return cachedSecret = fromEnv;
  const f = path.join(path.dirname(dbFile()), "device-secret.txt");
  try {
    cachedSecret = fs.readFileSync(f, "utf8").trim();
    if (cachedSecret.length >= 32) return cachedSecret;
  } catch {}
  cachedSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(f, cachedSecret, {
    mode: 384
  });
  return cachedSecret;
}

function sign(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url").slice(0, 27);
}

function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of String(header).split(";")) {
    const i = pair.indexOf("=");
    if (i === -1) continue;
    const k = pair.slice(0, i).trim();
    let v = pair.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {}
    if (k) out[k] = v;
  }
  return out;
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function jwtPayload(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function describeUa(ua) {
  ua = String(ua || "");
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /CrOS/i.test(ua) ? "ChromeOS" : /Linux|X11/i.test(ua) ? "Linux" : "";
  const br = /Edg(e|A|iOS)?\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /Firefox\/|FxiOS/i.test(ua) ? "Firefox" : /Chrome\/|CriOS/i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "";
  return {
    fp: sha(br + "|" + os).slice(0, 8),
    label: [ br, os ].filter(Boolean).join(" روی ") || "دستگاه ناشناس"
  };
}

function getDevice(req, res) {
  if (req._mcDevice) return req._mcDevice;
  const ua = req.headers["user-agent"] || "";
  const d = describeUa(ua);
  const isBrowser = /Mozilla\//i.test(ua);
  let dev;
  const hdr = req.headers["x-device-id"];
  if (typeof hdr === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(hdr)) {
    dev = {
      key: "h:" + hdr,
      label: isBrowser ? d.label : "اپ مانهواچی"
    };
  } else {
    const raw = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
    let id = null;
    if (raw) {
      const dot = raw.lastIndexOf(".");
      const cand = dot > 0 ? raw.slice(0, dot) : "";
      if (/^[a-f0-9-]{36}$/i.test(cand) && safeEq(raw.slice(dot + 1), sign("did:" + cand))) id = cand;
    }
    if (id) {
      dev = {
        key: `c:${id}:${d.fp}`,
        label: d.label
      };
    } else if (!isBrowser) {
      dev = {
        key: "u:" + sha(ua).slice(0, 24),
        label: "اپ مانهواچی"
      };
    } else {
      id = crypto.randomUUID();
      if (res && !res.headersSent && typeof res.cookie === "function") {
        res.cookie(DEVICE_COOKIE, `${id}.${sign("did:" + id)}`, {
          maxAge: DEVICE_COOKIE_MAX_AGE_MS,
          httpOnly: true,
          sameSite: "lax",
          secure: !!req.secure,
          path: "/"
        });
      }
      dev = {
        key: `c:${id}:${d.fp}`,
        label: d.label
      };
    }
  }
  dev.ip = req.ip || "";
  req._mcDevice = dev;
  return dev;
}

function maskIp(ip) {
  ip = String(ip || "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split(".").slice(0, 2).join(".") + ".*.*";
  if (ip.includes(":")) return ip.split(":").slice(0, 2).join(":") + ":*";
  return "";
}

function publicDevice(row, currentId) {
  return {
    id: row.id,
    label: row.label || "دستگاه ناشناس",
    last_seen_at: new Date(row.last_seen_at).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    ip_hint: maskIp(row.ip),
    current: currentId != null && row.id === currentId
  };
}

const isExempt = uid => EXEMPT.has(String(uid).toLowerCase());

function registerSession(userId, dev, accessToken, {allowReactivate: allowReactivate}) {
  open();
  const now = Date.now();
  const cutoff = now - INACTIVE_MS;
  const row = stmts.getRow.get(userId, dev.key);
  if (row && row.revoked_at && !allowReactivate) return {
    ok: false,
    reason: "revoked"
  };
  const isActive = row && !row.revoked_at && row.last_seen_at >= cutoff;
  if (!isActive && stmts.countActive.get(userId, cutoff).n >= MAX_DEVICES) {
    return {
      ok: false,
      reason: "limit"
    };
  }
  let id;
  if (row) {
    id = row.id;
    if (row.revoked_at) stmts.reactivate.run(dev.label, dev.ip, now, id); else stmts.touch.run(dev.label, dev.ip, now, id);
  } else {
    id = Number(stmts.insert.run(userId, dev.key, dev.label, dev.ip, now, now).lastInsertRowid);
  }
  const p = jwtPayload(accessToken);
  stmts.addToken.run(sha(accessToken), id, p && typeof p.exp === "number" ? p.exp : Math.floor(now / 1e3) + 3600);
  return {
    ok: true,
    id: id
  };
}

function tokenState(token) {
  if (!ENABLED || !mounted || !token) return {
    state: "unknown"
  };
  try {
    open();
    const info = stmts.tokenInfo.get(sha(token));
    if (!info) return {
      state: "unknown"
    };
    if (info.revoked_at) return {
      state: "revoked",
      id: info.id,
      userId: info.user_id
    };
    const now = Date.now();
    if (now - info.last_seen_at > TOKEN_TOUCH_EVERY_MS) stmts.touchOnly.run(now, info.id);
    return {
      state: "ok",
      id: info.id,
      userId: info.user_id
    };
  } catch (e) {
    console.error("[deviceLimit] tokenState:", e.message);
    return {
      state: "unknown"
    };
  }
}

function isRevoked(token) {
  return tokenState(token).state === "revoked";
}

function releasesLeft(userId) {
  open();
  return Math.max(0, RELEASES_PER_DAY - stmts.countReleases.get(userId, Date.now() - 864e5).n);
}

function userRevoke(userId, deviceId) {
  open();
  if (releasesLeft(userId) <= 0) return "limit";
  const r = stmts.revoke.run(Date.now(), "user", Number(deviceId), userId);
  if (!r.changes) return "notfound";
  stmts.addRelease.run(userId, Date.now());
  return "ok";
}

function revokeAllForUser(userId, reason = "admin", exceptDeviceId = null) {
  if (!ENABLED || !mounted) return 0;
  open();
  if (exceptDeviceId == null) return stmts.revokeAll.run(Date.now(), reason, userId).changes;
  const rows = stmts.listActive.all(userId, 0);
  let n = 0;
  for (const r of rows) if (r.id !== exceptDeviceId) n += stmts.revoke.run(Date.now(), reason, r.id, userId).changes;
  return n;
}

function captureBody(res, handler) {
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const chunks = [];
  const push = (c, enc) => {
    if (c == null || c === "") return;
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c), typeof enc === "string" ? enc : "utf8"));
  };
  res.write = (c, enc, cb) => {
    push(c, enc);
    const f = typeof enc === "function" ? enc : cb;
    if (typeof f === "function") f();
    return true;
  };
  res.end = (c, enc, cb) => {
    if (typeof c === "function") {
      cb = c;
      c = null;
      enc = null;
    } else if (typeof enc === "function") {
      cb = enc;
      enc = null;
    }
    push(c, enc);
    res.write = origWrite;
    res.end = origEnd;
    let body = Buffer.concat(chunks);
    try {
      const r = handler(body);
      if (r) {
        if (r.status) res.statusCode = r.status;
        if (r.headers) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
        if (r.json !== undefined) {
          body = Buffer.from(JSON.stringify(r.json));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        } else if (r.body !== undefined) {
          body = Buffer.from(r.body);
        }
        res.removeHeader("ETag");
        res.setHeader("Content-Length", body.length);
      }
    } catch (e) {
      console.error("[deviceLimit] intercept:", e);
    }
    return origEnd(body, cb);
  };
}

function setReleaseCookie(req, res, userId) {
  const payload = Buffer.from(JSON.stringify({
    u: userId,
    e: Date.now() + RELEASE_TTL_MS
  })).toString("base64url");
  res.cookie(RELEASE_COOKIE, `${payload}.${sign("dl:" + payload)}`, {
    maxAge: RELEASE_TTL_MS,
    httpOnly: true,
    sameSite: "strict",
    secure: !!req.secure,
    path: "/api/devices"
  });
}

function readReleaseCookie(req) {
  const raw = parseCookies(req.headers.cookie)[RELEASE_COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  if (!safeEq(raw.slice(dot + 1), sign("dl:" + payload))) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return o && typeof o.u === "string" && o.e > Date.now() ? o.u : null;
  } catch {
    return null;
  }
}

function limitBody(kind, userId, res, req) {
  if (kind === "password" && userId) setReleaseCookie(req, res, userId);
  return {
    error: "device_limit",
    error_code: "device_limit",
    code: 403,
    msg: MSG_LIMIT,
    message: MSG_LIMIT,
    error_description: MSG_LIMIT
  };
}

function handleSession(req, res, kind, body) {
  const ct = String(res.getHeader("Content-Type") || "");
  let access = null, refresh = null, uid = null, fromRedirect = false;
  if (res.statusCode >= 200 && res.statusCode < 300 && /json/i.test(ct)) {
    let j;
    try {
      j = JSON.parse(body.toString("utf8"));
    } catch {
      return null;
    }
    const s = j && j.access_token ? j : j && j.session && j.session.access_token ? j.session : null;
    if (!s) return null;
    access = s.access_token;
    refresh = s.refresh_token;
    uid = s.user && s.user.id || j.user && j.user.id || (jwtPayload(access) || {}).sub;
  } else if (res.statusCode >= 300 && res.statusCode < 400) {
    const loc = String(res.getHeader("Location") || "");
    const m = loc.match(/[#&?]access_token=([^&]+)/);
    if (!m) return null;
    access = decodeURIComponent(m[1]);
    uid = (jwtPayload(access) || {}).sub;
    fromRedirect = true;
  } else {
    return null;
  }
  if (!access || !uid || isExempt(uid)) return null;
  const dev = getDevice(req, res);
  const r = registerSession(uid, dev, access, {
    allowReactivate: kind !== "refresh"
  });
  if (r.ok) return null;
  console.warn(`[deviceLimit] رد شد: user=${uid} reason=${r.reason} kind=${kind} device="${dev.label}"`);
  if (fromRedirect) return {
    status: 302,
    headers: {
      Location: "/?action=login&device_limit=1"
    },
    body: ""
  };
  if (kind === "refresh") {
    const msg = r.reason === "revoked" ? MSG_REVOKED : MSG_LIMIT;
    return {
      status: 400,
      json: {
        error: "invalid_grant",
        error_code: "refresh_token_not_found",
        error_description: "Invalid Refresh Token: device session revoked",
        msg: msg,
        message: msg
      }
    };
  }
  return {
    status: 403,
    json: limitBody(kind, uid, res, req)
  };
}

function authMiddleware(req, res, next) {
  if (!ENABLED) return next();
  try {
    open();
    const p = req.path;
    const token = bearer(req);
    if (token && p !== "/logout" && tokenState(token).state === "revoked") {
      return res.status(401).json({
        code: 401,
        error_code: "session_revoked",
        msg: MSG_REVOKED,
        message: MSG_REVOKED
      });
    }
    if (req.method === "POST" && p === "/logout" && token) {
      res.on("finish", () => {
        try {
          if (res.statusCode >= 400) return;
          const st = tokenState(token);
          if (st.state === "ok") stmts.revoke.run(Date.now(), "logout", st.id, st.userId);
        } catch (e) {
          console.error("[deviceLimit] logout:", e.message);
        }
      });
      return next();
    }
    const isTokenRoute = req.method === "POST" && p === "/token";
    const isSignup = req.method === "POST" && p === "/signup";
    const isVerify = (req.method === "POST" || req.method === "GET") && p === "/verify";
    if (isTokenRoute || isSignup || isVerify) {
      const grant = String(req.query.grant_type || "");
      const kind = isTokenRoute ? grant === "refresh_token" ? "refresh" : grant === "password" ? "password" : "other" : "other";
      captureBody(res, body => handleSession(req, res, kind, body));
    }
  } catch (e) {
    console.error("[deviceLimit] middleware:", e);
  }
  next();
}

function restGuard(req, res, next) {
  if (!ENABLED) return next();
  const token = bearer(req);
  if (token && tokenState(token).state === "revoked") {
    return res.status(401).json({
      code: "PGRST301",
      error_code: "session_revoked",
      message: MSG_REVOKED,
      msg: MSG_REVOKED
    });
  }
  next();
}

const hits = new Map;

function rateOk(key, max, windowMs) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) {
    if (hits.size > 5e3) hits.clear();
    hits.set(key, {
      n: 1,
      reset: now + windowMs
    });
    return true;
  }
  return ++e.n <= max;
}

async function userFromBearer(token) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(1e4)
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? u : null;
}

function createRouter(express) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ENABLED) return res.status(404).json({
      error: "disabled"
    });
    if (!rateOk("ip:" + req.ip, 40, 6e4)) return res.status(429).json({
      error: "تعداد درخواست‌ها زیاد است. کمی صبر کن."
    });
    next();
  });
  router.use(express.json({
    limit: "2kb"
  }));
  const csrf = (req, res) => {
    if (req.method === "POST" && req.headers["x-requested-with"] !== "mc") {
      res.status(400).json({
        error: "درخواست نامعتبر است."
      });
      return false;
    }
    return true;
  };
  router.get("/blocked", (req, res) => {
    const uid = readReleaseCookie(req);
    if (!uid) return res.status(401).json({
      error: "مجوز منقضی شده؛ دوباره رمز را وارد کن."
    });
    open();
    const rows = stmts.listActive.all(uid, Date.now() - INACTIVE_MS);
    res.json({
      max: MAX_DEVICES,
      releasesLeft: releasesLeft(uid),
      devices: rows.map(r => publicDevice(r, null))
    });
  });
  router.post("/release", (req, res) => {
    if (!csrf(req, res)) return;
    const uid = readReleaseCookie(req);
    if (!uid) return res.status(401).json({
      error: "مجوز منقضی شده؛ دوباره رمز را وارد کن."
    });
    const out = userRevoke(uid, req.body && req.body.id);
    if (out === "limit") return res.status(429).json({
      error: `امروز بیش از ${fa(RELEASES_PER_DAY)} بار دستگاه خارج کرده‌ای. فردا دوباره امتحان کن یا با پشتیبانی تماس بگیر.`
    });
    if (out === "notfound") return res.status(404).json({
      error: "این دستگاه پیدا نشد."
    });
    res.json({
      ok: true,
      releasesLeft: releasesLeft(uid)
    });
  });
  async function authed(req, res) {
    const token = bearer(req);
    if (!token) {
      res.status(401).json({
        error: "وارد حساب شو."
      });
      return null;
    }
    if (tokenState(token).state === "revoked") {
      res.status(401).json({
        error: MSG_REVOKED,
        code: "session_revoked"
      });
      return null;
    }
    const user = await userFromBearer(token).catch(() => null);
    if (!user) {
      res.status(401).json({
        error: "نشست نامعتبر است."
      });
      return null;
    }
    return {
      user: user,
      st: tokenState(token)
    };
  }
  router.get("/", async (req, res) => {
    const a = await authed(req, res);
    if (!a) return;
    open();
    const rows = stmts.listActive.all(a.user.id, Date.now() - INACTIVE_MS);
    res.json({
      max: MAX_DEVICES,
      releasesLeft: releasesLeft(a.user.id),
      devices: rows.map(r => publicDevice(r, a.st.id))
    });
  });
  router.post("/revoke", async (req, res) => {
    if (!csrf(req, res)) return;
    const a = await authed(req, res);
    if (!a) return;
    const id = Number(req.body && req.body.id);
    if (a.st.id != null && id === a.st.id) return res.status(400).json({
      error: "برای خروج از همین دستگاه از دکمه‌ی «خروج از حساب» استفاده کن."
    });
    const out = userRevoke(a.user.id, id);
    if (out === "limit") return res.status(429).json({
      error: `امروز بیش از ${fa(RELEASES_PER_DAY)} بار دستگاه خارج کرده‌ای. فردا دوباره امتحان کن.`
    });
    if (out === "notfound") return res.status(404).json({
      error: "این دستگاه پیدا نشد."
    });
    res.json({
      ok: true,
      releasesLeft: releasesLeft(a.user.id)
    });
  });
  return router;
}

function mount(app, express) {
  if (!ENABLED) {
    console.warn("[deviceLimit] غیرفعال است (DEVICE_LIMIT=0)");
    return;
  }
  open();
  mounted = true;
  app.use("/auth/v1", authMiddleware);
  app.use("/rest/v1", restGuard);
  app.use("/api/devices", createRouter(express));
  console.log(`[deviceLimit] فعال: حداکثر ${MAX_DEVICES} دستگاه برای هر حساب`);
}

module.exports = {
  mount: mount,
  isRevoked: isRevoked,
  revokeAllForUser: revokeAllForUser,
  _open: open,
  revokeAllForUserForce: (uid, reason = "admin") => {
    open();
    return stmts.revokeAll.run(Date.now(), reason, uid).changes;
  },
  _listActive: uid => {
    open();
    return stmts.listActive.all(uid, Date.now() - INACTIVE_MS);
  },
  _revokeById: (uid, id, reason = "admin") => {
    open();
    return stmts.revoke.run(Date.now(), reason, Number(id), uid).changes;
  },
  MAX_DEVICES: MAX_DEVICES
};
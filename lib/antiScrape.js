"use strict";

const fs = require("fs");

const net = require("net");

const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

const BLOCK_FILE = path.join(DATA_DIR, "blocklist.json");

const EVENT_FILE = path.join(DATA_DIR, "security-events.jsonl");

const PAGE = path.join(__dirname, "..", "public", "security-admin.html");

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const CFG = {
  maxChaptersHour: num(process.env.AS_MAX_CHAPTERS_HOUR, 40),
  maxChaptersDay: num(process.env.AS_MAX_CHAPTERS_DAY, 150),
  maxManhwasHour: num(process.env.AS_MAX_MANHWAS_HOUR, 15),
  ipFactor: num(process.env.AS_IP_FACTOR, 3),
  imgBurstPerMin: num(process.env.AS_IMG_BURST_PER_MIN, 1500),
  botHitsBeforeStrike: num(process.env.AS_BOT_HITS, 5),
  blockBots: process.env.AS_BLOCK_BOT_UA !== "0",
  dryRun: process.env.AS_DRY_RUN === "1"
};

const STRIKE_MINUTES = [ 30, 6 * 60, 24 * 60, 7 * 24 * 60 ];

const AUTO_IP_MAX_MINUTES = 120;

const BOT_UA_RE = /(python-requests|python-urllib|python\/|aiohttp|httpx|urllib3|\bcurl\/|\bwget\/|go-http-client|libwww-perl|scrapy|node-fetch|undici|axios\/|\bgot \(|\bjava\/|apache-httpclient|headlesschrome|phantomjs|selenium|puppeteer|playwright|guzzle|postmanruntime|insomnia|colly|mechanize|jsdom|\bphp\/|\bscraper|\bspider|\bcrawl)/i;

const blocks = new Map;

const allow = new Map;

const strikes = new Map;

let cidrs = [];

function isPrivateIp(ip) {
  if (!ip) return false;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
  }
  const l = String(ip).toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

let warnedPrivate = false;

function warnPrivateIp(req) {
  if (warnedPrivate) return;
  warnedPrivate = true;
  console.warn("[antiScrape] ⚠️ req.ip یک IP داخلی/پراکسی است (" + req.ip + ") و x-forwarded-for=" + (req.headers["x-forwarded-for"] || "-") + " — مقدار trust proxy در server.js را با تعداد لایه‌های واقعی پراکسی هماهنگ کن. تا آن موقع بلاک/سقف IP روی این آدرس اعمال نمی‌شود.");
  logEvent("proxy-ip-suspect", {
    ip: req.ip,
    xff: String(req.headers["x-forwarded-for"] || "").slice(0, 120)
  });
}

function ipv4ToInt(ip) {
  const p = ip.split(".").map(Number);
  return (p[0] << 24 >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function parseCidr(v) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(v));
  if (!m || !net.isIPv4(m[1])) return null;
  const bits = Number(m[2]);
  if (bits < 8 || bits > 32) return null;
  const mask = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
  return {
    base: (ipv4ToInt(m[1]) & mask) >>> 0,
    mask: mask,
    bits: bits
  };
}

function rebuildCidrs() {
  cidrs = [];
  for (const [k, e] of blocks) {
    if (e.type !== "cidr") continue;
    const c = parseCidr(e.value);
    if (c) cidrs.push({
      ...c,
      key: k
    });
  }
}

function loadFiles() {
  try {
    const raw = JSON.parse(fs.readFileSync(BLOCK_FILE, "utf8"));
    for (const e of raw.blocks || []) blocks.set(`${e.type}:${e.value}`, e);
    for (const e of raw.allow || []) allow.set(`${e.type}:${e.value}`, e);
  } catch (e) {}
  if (process.env.AS_KEEP_AUTO !== "1") {
    let purged = 0;
    for (const [k, e] of blocks) if (e && e.auto) {
      blocks.delete(k);
      purged++;
    }
    if (purged) {
      console.log("[antiScrape] " + purged + " بلاک خودکار قدیمی پاک شد");
      save();
    }
  }
  rebuildCidrs();
}

let saveTimer = null;

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, {
        recursive: true
      });
      const tmp = BLOCK_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({
        blocks: [ ...blocks.values() ],
        allow: [ ...allow.values() ]
      }, null, 1));
      fs.renameSync(tmp, BLOCK_FILE);
    } catch (e) {
      console.error("[antiScrape] ذخیره‌ی بلاک‌لیست ناموفق:", e.message);
    }
  }, 300);
  if (saveTimer.unref) saveTimer.unref();
}

const events = [];

function logEvent(kind, info) {
  const ev = {
    t: (new Date).toISOString(),
    kind: kind,
    ...info
  };
  events.push(ev);
  if (events.length > 300) events.shift();
  try {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
    try {
      if (fs.statSync(EVENT_FILE).size > 5 * 1024 * 1024) fs.renameSync(EVENT_FILE, EVENT_FILE + ".1");
    } catch (e) {}
    fs.appendFile(EVENT_FILE, JSON.stringify(ev) + "\n", () => {});
  } catch (e) {}
}

function entryActive(e) {
  return e && (!e.until || e.until > Date.now());
}

function isBlocked({ip: ip, guestId: guestId, userId: userId}) {
  const check = (type, value) => {
    if (!value) return null;
    const k = `${type}:${value}`;
    const e = blocks.get(k);
    if (!e) return null;
    if (entryActive(e)) return e;
    blocks.delete(k);
    save();
    return null;
  };
  let e = check("ip", ip) || check("guest", guestId) || check("user", userId);
  if (e) return e;
  if (ip && net.isIPv4(ip) && cidrs.length) {
    const n = ipv4ToInt(ip);
    for (const c of cidrs) {
      if ((n & c.mask) >>> 0 === c.base) {
        const ent = blocks.get(c.key);
        if (entryActive(ent)) return ent;
      }
    }
  }
  return null;
}

function isAllowed({ip: ip, userId: userId}) {
  return !!(userId && allow.has(`user:${userId}`) || ip && allow.has(`ip:${ip}`));
}

function addBlock({type: type, value: value, reason: reason, minutes: minutes = 0, auto: auto = false, by: by = "admin"}) {
  const e = {
    type: type,
    value: String(value),
    reason: String(reason || "").slice(0, 200),
    at: Date.now(),
    until: minutes > 0 ? Date.now() + minutes * 6e4 : 0,
    auto: !!auto,
    by: by
  };
  blocks.set(`${type}:${e.value}`, e);
  if (type === "cidr") rebuildCidrs();
  save();
  logEvent(auto ? "auto-block" : "block", {
    type: type,
    value: e.value,
    reason: e.reason,
    until: e.until
  });
  return e;
}

function removeBlock(type, value) {
  const ok = blocks.delete(`${type}:${value}`);
  if (type === "cidr") rebuildCidrs();
  strikes.delete(`${type}:${value}`);
  if (ok) {
    save();
    logEvent("unblock", {
      type: type,
      value: value
    });
  }
  return ok;
}

function strike({ip: ip, guestId: guestId, userId: userId}, reason) {
  const primary = userId ? `user:${userId}` : guestId ? `guest:${guestId}` : `ip:${ip}`;
  const s = strikes.get(primary);
  const fresh = s && Date.now() - s.last < 30 * 864e5;
  const n = (fresh ? s.n : 0) + 1;
  strikes.set(primary, {
    n: n,
    last: Date.now()
  });
  const minutes = STRIKE_MINUTES[Math.min(n, STRIKE_MINUTES.length) - 1];
  if (CFG.dryRun) {
    logEvent("dry-run-block", {
      ip: ip,
      guestId: guestId,
      userId: userId,
      reason: reason,
      minutes: minutes
    });
    return {
      minutes: minutes,
      n: n,
      dry: true
    };
  }
  if (userId) addBlock({
    type: "user",
    value: userId,
    reason: reason,
    minutes: minutes,
    auto: true,
    by: "auto"
  });
  if (guestId) addBlock({
    type: "guest",
    value: guestId,
    reason: reason,
    minutes: minutes,
    auto: true,
    by: "auto"
  });
  if (!userId && !guestId && ip) {
    if (isPrivateIp(ip) || allow.has(`ip:${ip}`)) logEvent("block-skipped", {
      ip: ip,
      reason: reason,
      why: isPrivateIp(ip) ? "private-ip" : "allowlist"
    }); else addBlock({
      type: "ip",
      value: ip,
      reason: reason,
      minutes: Math.min(minutes, AUTO_IP_MAX_MINUTES),
      auto: true,
      by: "auto"
    });
  }
  return {
    minutes: minutes,
    n: n
  };
}

const windows = new Map;

const botHits = new Map;

const imgHits = new Map;

const ipLogAt = new Map;

function pruneMaps() {
  const now = Date.now();
  for (const [k, arr] of windows) {
    while (arr.length && now - arr[0].t > 864e5) arr.shift();
    if (!arr.length) windows.delete(k);
  }
  for (const [k, arr] of botHits) {
    while (arr.length && now - arr[0] > 6e5) arr.shift();
    if (!arr.length) botHits.delete(k);
  }
  for (const [k, v] of imgHits) if (now - v.start > 12e4) imgHits.delete(k);
  for (const [k, t] of ipLogAt) if (now - t > 36e5) ipLogAt.delete(k);
  for (const [k, v] of strikes) if (now - v.last > 30 * 864e5) strikes.delete(k);
}

const pruner = setInterval(pruneMaps, 5 * 6e4);

if (pruner.unref) pruner.unref();

function distinctStats(arr, since) {
  const ch = new Set, mh = new Set;
  for (const x of arr) {
    if (x.t >= since) {
      ch.add(x.slug + ":" + x.num);
      mh.add(x.slug);
    }
  }
  return {
    chapters: ch.size,
    manhwas: mh.size
  };
}

let readGuestId = () => null;

function init(opts = {}) {
  if (typeof opts.readGuestId === "function") readGuestId = opts.readGuestId;
}

function blockedBody(e) {
  return {
    error: "دسترسی شما به این سایت مسدود شده است. اگر فکر می‌کنید اشتباه شده، به پشتیبانی پیام بدهید.",
    code: "BLOCKED",
    until: e && e.until ? new Date(e.until).toISOString() : null
  };
}

const BLOCK_HTML = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>دسترسی مسدود است</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#e5e5e5;font-family:Tahoma,sans-serif;text-align:center;padding:24px"><div><h1 style="font-size:22px;color:#f87171">دسترسی مسدود است</h1><p style="color:#a3a3a3;line-height:1.9">درخواست‌های این دستگاه یا شبکه شبیه ابزارهای کپی‌برداری بود و موقتاً مسدود شد.<br>اگر کاربر عادی هستید و اشتباهی رخ داده، از طریق پشتیبانی یا تلگرام مانهواچی پیام بدهید.</p></div></body></html>`;

function gate(req, res, next) {
  const p = req.path;
  if (p === "/security-admin" || p.startsWith("/api/security-admin/")) return next();
  if (isPrivateIp(req.ip)) warnPrivateIp(req);
  if (isAllowed({
    ip: req.ip
  })) return next();
  const guestId = readGuestId(req);
  const e = isBlocked({
    ip: isPrivateIp(req.ip) ? null : req.ip,
    guestId: guestId
  });
  if (!e) return next();
  res.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex"
  });
  const wantsHtml = String(req.headers.accept || "").includes("text/html") && req.method === "GET" && !p.startsWith("/api/");
  if (wantsHtml) return res.status(403).type("html").send(BLOCK_HTML);
  return res.status(403).json(blockedBody(e));
}

function noteBotHit(req, reason) {
  const ip = req.ip;
  const arr = botHits.get(ip) || [];
  arr.push(Date.now());
  botHits.set(ip, arr);
  if (arr.length >= CFG.botHitsBeforeStrike) {
    botHits.delete(ip);
    const r = strike({
      ip: ip,
      guestId: readGuestId(req)
    }, reason);
    logEvent("bot", {
      ip: ip,
      ua: String(req.headers["user-agent"] || "").slice(0, 120),
      reason: reason,
      blockedMinutes: r.minutes
    });
  }
}

function looksLikeBot(req) {
  if (!CFG.blockBots) return false;
  const ua = String(req.headers["user-agent"] || "");
  return !ua || ua.length < 8 || BOT_UA_RE.test(ua);
}

function imageGuard(req, res, next) {
  const ip = req.ip;
  if (isAllowed({
    ip: ip
  })) return next();
  if (looksLikeBot(req)) {
    noteBotHit(req, "ابزار اسکرپ هنگام گرفتن عکس چپتر");
    return res.status(403).json({
      error: "درخواست نامعتبر",
      code: "BOT"
    });
  }
  if (isPrivateIp(ip)) return next();
  const now = Date.now();
  const h = imgHits.get(ip);
  if (!h || now - h.start > 6e4) imgHits.set(ip, {
    start: now,
    count: 1
  }); else if (++h.count > CFG.imgBurstPerMin) {
    if (h.count === CFG.imgBurstPerMin + 1) logEvent("img-burst", {
      ip: ip,
      count: h.count
    });
    res.set("Retry-After", String(Math.max(1, Math.ceil((h.start + 6e4 - now) / 1e3))));
    return res.status(429).json({
      error: "تعداد درخواست عکس زیاد است؛ کمی صبر کنید.",
      code: "IMG_RATE"
    });
  }
  next();
}

function noteChapter({req: req, userId: userId, slug: slug, chapterNum: chapterNum}) {
  const ip = req.ip;
  const guestId = readGuestId(req);
  const who = {
    ip: ip,
    guestId: guestId,
    userId: userId
  };
  const b = isBlocked({
    ip: isPrivateIp(ip) ? null : ip,
    guestId: guestId,
    userId: userId
  });
  if (b) return {
    ok: false,
    status: 403,
    body: blockedBody(b)
  };
  if (isAllowed(who)) return {
    ok: true
  };
  if (looksLikeBot(req)) {
    const r = strike(who, "ابزار اسکرپ هنگام درخواست چپتر");
    logEvent("bot", {
      ip: ip,
      userId: userId,
      guestId: guestId,
      ua: String(req.headers["user-agent"] || "").slice(0, 120),
      slug: slug,
      blockedMinutes: r.minutes
    });
    return {
      ok: false,
      status: 403,
      body: {
        error: "درخواست نامعتبر",
        code: "BOT"
      }
    };
  }
  const now = Date.now();
  const privateIp = isPrivateIp(ip);
  if (privateIp) warnPrivateIp(req);
  const identified = !!(userId || guestId);
  const keys = [ {
    k: userId ? `u:${userId}` : guestId ? `g:${guestId}` : `i:${ip}`,
    f: identified ? 1 : CFG.ipFactor * 3,
    enforce: !(privateIp && !identified)
  } ];
  if (ip && identified && !privateIp) keys.push({
    k: `i:${ip}`,
    f: CFG.ipFactor * 3,
    enforce: false
  });
  const seen = new Set;
  for (const {k: k, f: f, enforce: enforce} of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    let arr = windows.get(k);
    if (!arr) {
      if (windows.size > 5e4) pruneMaps();
      arr = [];
      windows.set(k, arr);
    }
    while (arr.length && now - arr[0].t > 864e5) arr.shift();
    arr.push({
      t: now,
      slug: slug,
      num: chapterNum
    });
    if (arr.length > 3e3) arr.splice(0, arr.length - 3e3);
    const h = distinctStats(arr, now - 36e5);
    const d = distinctStats(arr, now - 864e5);
    let why = null;
    if (h.chapters > CFG.maxChaptersHour * f) why = `${h.chapters} چپتر متفاوت در یک ساعت`; else if (h.manhwas > CFG.maxManhwasHour * f) why = `${h.manhwas} مانهوای متفاوت در یک ساعت`; else if (d.chapters > CFG.maxChaptersDay * f) why = `${d.chapters} چپتر متفاوت در یک روز`;
    if (why) {
      if (!enforce) {
        const lk = "iplog:" + k;
        const last = ipLogAt.get(lk) || 0;
        if (now - last > 6e5) {
          ipLogAt.set(lk, now);
          logEvent("ip-heavy", {
            ip: ip,
            why: why
          });
        }
        continue;
      }
      const r = strike(who, "رفتار اسکرپ: " + why);
      logEvent("scrape-suspect", {
        ip: ip,
        userId: userId,
        guestId: guestId,
        why: why,
        blockedMinutes: r.minutes,
        ua: String(req.headers["user-agent"] || "").slice(0, 120)
      });
      if (r.dry) continue;
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: r.minutes * 60,
        body: {
          error: "فعالیت شما غیرعادی تشخیص داده شد و موقتاً محدود شدید.",
          code: "SCRAPING_SUSPECTED"
        }
      };
    }
  }
  return {
    ok: true
  };
}

function createRouter({adminAuth: adminAuth, express: express}) {
  const router = express.Router();
  router.get("/security-admin", (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    });
    res.sendFile(PAGE);
  });
  const json = express.json({
    limit: "5kb"
  });
  router.get("/api/security-admin/state", adminAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    res.json({
      you: req.ip,
      youArePrivate: isPrivateIp(req.ip),
      dryRun: CFG.dryRun,
      config: CFG,
      blocks: [ ...blocks.values() ].filter(entryActive).sort((a, b) => b.at - a.at),
      allow: [ ...allow.values() ],
      events: events.slice(-100).reverse(),
      active: {
        clients: windows.size
      },
      now: now
    });
  });
  function parseTarget(body, forAllow) {
    const type = String(body.type || "");
    const value = String(body.value || "").trim();
    if (forAllow ? ![ "ip", "user" ].includes(type) : ![ "ip", "cidr", "guest", "user" ].includes(type)) return {
      err: "نوع نامعتبر"
    };
    if (type === "ip" && !net.isIP(value)) return {
      err: "IP نامعتبر"
    };
    if (type === "cidr" && !parseCidr(value)) return {
      err: "بازه‌ی IPv4 نامعتبر (مثل 1.2.3.0/24؛ حداقل /8)"
    };
    if (type === "guest" && !/^[0-9a-f-]{36}$/i.test(value)) return {
      err: "شناسه‌ی مهمان نامعتبر"
    };
    if (type === "user" && !/^[\w.@-]{1,80}$/.test(value)) return {
      err: "شناسه‌ی کاربر نامعتبر"
    };
    return {
      type: type,
      value: value
    };
  }
  router.get("/api/security-admin/user", adminAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (!q) return res.status(400).json({
      message: "عبارت جستجو خالی است"
    });
    let S;
    try {
      S = require("./localdb/sqlite");
    } catch (e) {
      return res.status(503).json({
        message: "دیتابیس محلی در دسترس نیست"
      });
    }
    try {
      const base = "SELECT p.id AS id, p.full_name AS name, p.is_vip AS vip, COALESCE(c.phone, a.phone) AS phone, COALESCE(c.email, a.email) AS email FROM profiles p LEFT JOIN profile_contacts c ON c.user_id = p.id LEFT JOIN auth_users a ON a.id = p.id";
      let rows;
      const digits = q.replace(/\D/g, "");
      if (/^[\w-]{16,}$/.test(q) && !/^\d+$/.test(q)) rows = S.all(base + " WHERE p.id = ? LIMIT 5", [ q ]); else if (digits.length >= 7) rows = S.all(base + " WHERE c.phone LIKE ? OR a.phone LIKE ? LIMIT 5", [ "%" + digits.slice(-10) + "%", "%" + digits.slice(-10) + "%" ]); else rows = S.all(base + " WHERE p.full_name LIKE ? LIMIT 5", [ "%" + q + "%" ]);
      logEvent("user-lookup", {
        value: q.slice(0, 40)
      });
      res.json({
        users: rows || []
      });
    } catch (e) {
      res.status(500).json({
        message: "خطا در جستجو: " + e.message
      });
    }
  });
  router.post("/api/security-admin/block", adminAuth, json, (req, res) => {
    const t = parseTarget(req.body || {}, false);
    if (t.err) return res.status(400).json({
      message: t.err
    });
    if (t.type === "ip" && t.value === req.ip) return res.status(400).json({
      message: "این IP خودِ شماست؛ بلاک نشد."
    });
    if (t.type === "cidr") {
      const c = parseCidr(t.value);
      if (net.isIPv4(req.ip) && (ipv4ToInt(req.ip) & c.mask) >>> 0 === c.base) return res.status(400).json({
        message: "IP شما داخل این بازه است؛ بلاک نشد."
      });
    }
    const minutes = Math.max(0, Math.min(Number(req.body.minutes) || 0, 365 * 24 * 60));
    const e = addBlock({
      ...t,
      reason: req.body.reason || "دستی",
      minutes: minutes,
      by: "admin"
    });
    res.json({
      ok: true,
      entry: e
    });
  });
  router.get("/api/security-admin/wm", adminAuth, (req, res) => {
    res.set("Cache-Control", "no-store");
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (!q) return res.status(400).json({
      message: "کد/gid/IP/userId را وارد کن"
    });
    const r = require("./wmRegistry").lookup(q);
    const blockedNow = {};
    r.gids.forEach(g => {
      blockedNow[g] = !!isBlocked({
        guestId: g
      });
    });
    res.json({
      ...r,
      blockedNow: blockedNow
    });
  });
  router.post("/api/security-admin/wm-block", adminAuth, json, (req, res) => {
    const q = String((req.body || {}).q || "").trim().slice(0, 80);
    if (!q) return res.status(400).json({
      message: "کد/gid/IP/userId را وارد کن"
    });
    const r = require("./wmRegistry").lookup(q);
    if (!r.rows) return res.status(404).json({
      message: "چیزی با این مقدار در wm-codes پیدا نشد"
    });
    const minutes = Math.max(0, Math.min(Number(req.body.minutes) || 0, 365 * 24 * 60));
    const reason = String(req.body.reason || "دزدی محتوا (واترمارک)").slice(0, 200);
    const done = [];
    r.gids.forEach(g => {
      addBlock({
        type: "guest",
        value: g,
        reason: reason,
        minutes: minutes,
        by: "admin"
      });
      done.push("guest:" + g);
    });
    r.userIds.forEach(u => {
      addBlock({
        type: "user",
        value: u,
        reason: reason,
        minutes: minutes,
        by: "admin"
      });
      done.push("user:" + u);
    });
    if (req.body.includeIps) {
      r.ips.forEach(ip => {
        if (ip === req.ip || isPrivateIp(ip) || allow.has("ip:" + ip)) return;
        addBlock({
          type: "ip",
          value: ip,
          reason: reason,
          minutes: Math.min(minutes || AUTO_IP_MAX_MINUTES, AUTO_IP_MAX_MINUTES),
          by: "admin"
        });
        done.push("ip:" + ip);
      });
    }
    res.json({
      ok: true,
      blocked: done,
      summary: r
    });
  });
  router.post("/api/security-admin/unblock", adminAuth, json, (req, res) => {
    const t = parseTarget(req.body || {}, false);
    if (t.err) return res.status(400).json({
      message: t.err
    });
    res.json({
      ok: removeBlock(t.type, t.value)
    });
  });
  router.post("/api/security-admin/allow", adminAuth, json, (req, res) => {
    const t = parseTarget(req.body || {}, true);
    if (t.err) return res.status(400).json({
      message: t.err
    });
    allow.set(`${t.type}:${t.value}`, {
      ...t,
      at: Date.now(),
      note: String(req.body.note || "").slice(0, 100)
    });
    save();
    res.json({
      ok: true
    });
  });
  router.post("/api/security-admin/unallow", adminAuth, json, (req, res) => {
    const t = parseTarget(req.body || {}, true);
    if (t.err) return res.status(400).json({
      message: t.err
    });
    const ok = allow.delete(`${t.type}:${t.value}`);
    if (ok) save();
    res.json({
      ok: ok
    });
  });
  return router;
}

loadFiles();

module.exports = {
  init: init,
  gate: gate,
  imageGuard: imageGuard,
  noteChapter: noteChapter,
  createRouter: createRouter,
  isBlocked: isBlocked,
  addBlock: addBlock,
  removeBlock: removeBlock,
  CFG: CFG
};
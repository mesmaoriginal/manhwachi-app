"use strict";

const crypto = require("crypto");

let sharp = null;

try {
  sharp = require("sharp");
} catch (_) {
  sharp = null;
}

const {requireSecret: requireSecret} = require("./requireSecret");

const ENABLED = process.env.OFFLINE_ENABLED !== "0";

const LICENSE_MS = num(process.env.OFFLINE_LICENSE_DAYS, 7) * 864e5;

const MAX_AGE_MS = num(process.env.OFFLINE_MAX_AGE_DAYS, 30) * 864e5;

const MAX_DEVICES = num(process.env.OFFLINE_MAX_DEVICES, 3);

const MAX_PER_DAY = num(process.env.OFFLINE_MAX_PER_DAY, 40);

const WM_EVERY_PX = Math.max(500, num(process.env.OFFLINE_WM_EVERY_PX, 1e4));

const WM_MIN_PER_PAGE = process.env.OFFLINE_WM_MIN_PER_PAGE !== "0";

const WM_ALPHA = Math.min(.9, Math.max(.1, num(process.env.OFFLINE_WM_ALPHA, .4)));

const REVOKE_BEFORE = num(process.env.OFFLINE_REVOKE_BEFORE, 0);

const RENEW_GRACE_MS = 14 * 864e5;

const MAX_FETCH_PER_PAGE = 3;

const MAX_CONCURRENT_JOBS = 3;

const MAX_INFLIGHT_PER_USER = 4;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

let MASTER = null;

let SIGN_KEY = null;

function initKeys() {
  if (MASTER) return;
  MASTER = Buffer.from(requireSecret("OFFLINE_SECRET", "[offline]", "با هر ری‌استارت، همه‌ی چپترهای دانلودشده‌ی کاربران بی‌مصرف می‌شوند (کلیدشان عوض می‌شود)."));
  SIGN_KEY = Buffer.from(crypto.hkdfSync("sha256", MASTER, "mc-offline-salt", "sign", 32));
}

function contentKey(c) {
  return Buffer.from(crypto.hkdfSync("sha256", MASTER, Buffer.from(c.lid, "hex"), `mc-offline-v1|${c.uid}|${c.did}|${c.slug}|${c.ch}`, 32));
}

function signToken(claims) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = crypto.createHmac("sha256", SIGN_KEY).update("v1." + body).digest("base64url");
  return `v1.${body}.${sig}`;
}

function verifyToken(t) {
  if (typeof t !== "string" || t.length > 2048) return null;
  const p = t.split(".");
  if (p.length !== 3 || p[0] !== "v1") return null;
  const want = crypto.createHmac("sha256", SIGN_KEY).update("v1." + p[1]).digest("base64url");
  const a = Buffer.from(p[2]);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(p[1], "base64url").toString());
    if (!c || typeof c !== "object" || !/^[a-f0-9]{32}$/.test(c.lid || "")) return null;
    return c;
  } catch {
    return null;
  }
}

const GLYPH_SRC = {
  0: ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  1: "..#../.##../..#../..#../..#../..#../.###.",
  2: ".###./#...#/....#/...#./..#../.#.../#####",
  3: "#####/...#./..#../...#./....#/#...#/.###.",
  4: "...#./..##./.#.#./#..#./#####/...#./...#.",
  5: "#####/#..../####./....#/....#/#...#/.###.",
  6: "..##./.#.../#..../####./#...#/#...#/.###.",
  7: "#####/....#/...#./..#../.#.../.#.../.#...",
  8: ".###./#...#/#...#/.###./#...#/#...#/.###.",
  9: ".###./#...#/#...#/.####/....#/...#./.##..",
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "###../#..#./#...#/#...#/#...#/#..#./###..",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.####",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: ".###./..#../..#../..#../..#../..#../.###.",
  J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/#...#/##..#/#.#.#/#..##/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  "@": ".###./#...#/#.###/#.#.#/#.###/#..../.###.",
  ".": "...../...../...../...../...../.##../.##..",
  ":": "...../.##../.##../...../.##../.##../.....",
  "+": "...../..#../..#../#####/..#../..#../.....",
  _: "...../...../...../...../...../...../#####",
  "-": "...../...../...../#####/...../...../.....",
  " ": "...../...../...../...../...../...../.....",
  "?": ".###./#...#/....#/...#./..#../...../..#.."
};

const GLYPHS = new Map;

for (const [ch, src] of Object.entries(GLYPH_SRC)) {
  GLYPHS.set(ch, src.split("/").map(r => [ ...r ].map(c => c === "#")));
}

function renderTextRGBA(text, scale, alpha) {
  const t = String(text).toUpperCase().replace(/[^A-Z0-9@.:+_\- ]/g, "?");
  const r = Math.max(1, Math.floor(scale / 2));
  const textW = (t.length * 6 - 1) * scale;
  const textH = 7 * scale;
  const W = textW + 2 * r;
  const H = textH + 2 * r;
  const mask = new Uint8Array(W * H);
  [ ...t ].forEach((c, idx) => {
    const g = GLYPHS.get(c) || GLYPHS.get("?");
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
      if (!g[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        mask[(r + y * scale + dy) * W + (r + (idx * 6 + x) * scale + dx)] = 1;
      }
    }
  });
  const out = Buffer.alloc(W * H * 4);
  const aW = Math.round(255 * alpha);
  const aD = Math.round(255 * alpha * .8);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (mask[y * W + x]) {
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = aW;
      continue;
    }
    let dark = false;
    for (let dy = -r; dy <= r && !dark; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < W && mask[yy * W + xx]) {
          dark = true;
          break;
        }
      }
    }
    if (dark) out[o + 3] = aD;
  }
  return {
    data: out,
    width: W,
    height: H
  };
}

function watermarkLayers(width, height, text, lid, pageIdx) {
  const seed = crypto.createHash("sha256").update(`${lid}|${pageIdx}`).digest();
  let scale = Math.min(5, Math.max(2, Math.round(width / 400)));
  let img = renderTextRGBA(text, scale, WM_ALPHA);
  while (img.width > width * .94 && scale > 1) {
    scale -= 1;
    img = renderTextRGBA(text, scale, WM_ALPHA);
  }
  if (img.width >= width || img.height >= height) return [];
  const spots = [];
  const first = seed.readUInt32BE(0) % WM_EVERY_PX + 0;
  for (let y = first; y + img.height < height; y += WM_EVERY_PX) spots.push(y);
  if (!spots.length && WM_MIN_PER_PAGE) {
    spots.push(Math.floor(seed.readUInt32BE(4) / 4294967295 * Math.max(0, height - img.height - 4)) + 2);
  }
  return spots.map((y, k) => {
    const s = seed[8 + k % 20] / 255;
    return {
      input: img.data,
      raw: {
        width: img.width,
        height: img.height,
        channels: 4
      },
      left: Math.floor(s * (width - img.width)),
      top: Math.max(0, Math.min(height - img.height, y))
    };
  });
}

async function watermarkAndEncode(buf, text, lid, pageIdx) {
  const meta = await sharp(buf, {
    failOn: "none",
    limitInputPixels: 12e7
  }).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) throw new Error("bad image");
  let p = sharp(buf, {
    failOn: "none",
    limitInputPixels: 12e7
  }).composite(watermarkLayers(w, h, text, lid, pageIdx));
  p = w > 16e3 || h > 16e3 ? p.jpeg({
    quality: 86
  }) : p.webp({
    quality: 82,
    effort: 3
  });
  const {data: data, info: info} = await p.toBuffer({
    resolveWithObject: true
  });
  return {
    data: data,
    w: info.width,
    h: info.height
  };
}

function encryptPage(key, lid, i, n, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`${lid}|${i}|${n}`));
  const ct = Buffer.concat([ c.update(plain), c.final() ]);
  return Buffer.concat([ iv, ct, c.getAuthTag() ]);
}

const users = new Map;

const fetchCounts = new Map;

function userState(uid) {
  let s = users.get(uid);
  if (!s) users.set(uid, s = {
    devices: new Set,
    dayStart: Date.now(),
    dayCount: 0,
    inflight: 0
  });
  if (Date.now() - s.dayStart > 864e5) {
    s.dayStart = Date.now();
    s.dayCount = 0;
  }
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [lid, v] of fetchCounts) if (v.exp < now) fetchCounts.delete(lid);
  if (users.size > 2e4) users.clear();
}, 36e5).unref();

let activeJobs = 0;

const waiters = [];

async function withSlot(fn) {
  if (activeJobs >= MAX_CONCURRENT_JOBS) await new Promise(r => waiters.push(r));
  activeJobs++;
  try {
    return await fn();
  } finally {
    activeJobs--;
    const w = waiters.shift();
    if (w) w();
  }
}

const listCache = new Map;

function trailingNum(s) {
  const m = String(s).split("?")[0].match(/(\d+)(?=\.\w+$)/);
  return m ? parseInt(m[1], 10) : null;
}

async function getPageList(deps, slug, ch, episode) {
  const ck = `${slug}|${ch}`;
  const hit = listCache.get(ck);
  if (hit && Date.now() - hit.at < 5 * 6e4) return hit.items;
  const urls = await deps.buildSignedUrls(slug, ch, episode.images) || [];
  let items = [];
  for (const u of urls) {
    let pathname = "";
    try {
      pathname = new URL(u, "http://local.invalid").pathname;
    } catch {
      continue;
    }
    if (pathname.startsWith("/chapter-image/")) {
      const key = decodeURIComponent(pathname.slice("/chapter-image/".length));
      if (key.includes("..") || key.includes("\\")) continue;
      items.push({
        kind: "key",
        key: key,
        sortKey: trailingNum(key)
      });
    } else if (/^https?:\/\//i.test(u)) {
      items.push({
        kind: "url",
        url: u,
        sortKey: trailingNum(u)
      });
    }
  }
  if (items.length && items.every(x => x.sortKey !== null)) items.sort((a, b) => a.sortKey - b.sortKey);
  if (items.every(x => x.kind === "key")) listCache.set(ck, {
    at: Date.now(),
    items: items
  });
  return items;
}

async function loadRaw(deps, item) {
  if (item.kind === "key") return (await deps.getCachedImage(item.key)).buffer;
  const r = await fetch(item.url, {
    signal: AbortSignal.timeout(15e3)
  });
  if (!r.ok) throw new Error("remote " + r.status);
  const ab = await r.arrayBuffer();
  if (ab.byteLength > 30 * 1024 * 1024) throw new Error("too big");
  return Buffer.from(ab);
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function fail(res, status, code, error) {
  return res.status(status).json({
    error: error,
    code: code
  });
}

function entitled(ctx, episode) {
  return !!(ctx && ctx.isPremium) && !!episode;
}

function whoText(user) {
  const code = String(user.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  const phone = user.phone ? "+" + String(user.phone).replace(/^\+/, "") : "";
  const base = String(user.email || phone || "").toLowerCase().slice(0, 48);
  return base ? `${base} ${code}` : code;
}

const SLUG_RE = /^[A-Za-z0-9._-]{1,120}$/;

const DID_RE = /^[A-Za-z0-9_-]{16,64}$/;

function mount(app, deps) {
  initKeys();
  for (const k of [ "getAuthContext", "buildSignedUrls", "findEpisode", "getCachedImage" ]) {
    if (typeof deps[k] !== "function") throw new Error(`offlineVault: dependency "${k}" missing`);
  }
  if (!sharp) console.warn("[offline] ⚠️ پکیج sharp نصب نیست → دانلود آفلاین غیرفعال است (npm i sharp)");
  app.use("/api/offline", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!ENABLED) return fail(res, 503, "OFFLINE_DISABLED", "دانلود آفلاین موقتاً غیرفعال است.");
    next();
  });
  async function auth(req, res) {
    const t = bearer(req);
    if (!t) {
      fail(res, 401, "AUTH_REQUIRED", "برای دانلود آفلاین باید وارد حساب شوید.");
      return null;
    }
    let ctx;
    try {
      ctx = await deps.getAuthContext(t);
    } catch (e) {
      fail(res, 503, "AUTH_UNAVAILABLE", "سرویس احراز هویت موقتاً در دسترس نیست.");
      return null;
    }
    if (!ctx || !ctx.user || !ctx.user.id) {
      fail(res, 401, "AUTH_REQUIRED", "نشست شما نامعتبر است، دوباره وارد شوید.");
      return null;
    }
    return ctx;
  }
  app.post("/api/offline/license", async (req, res) => {
    try {
      const ctx = await auth(req, res);
      if (!ctx) return;
      if (!sharp) return fail(res, 503, "OFFLINE_UNAVAILABLE", "دانلود آفلاین هنوز روی سرور آماده نیست.");
      const {slug: slug, chapterNum: chapterNum, did: did} = req.body || {};
      const ch = Number.parseInt(chapterNum, 10);
      if (!SLUG_RE.test(String(slug || "")) || !Number.isInteger(ch) || ch < 0 || ch > 99999 || !DID_RE.test(String(did || ""))) return fail(res, 400, "BAD_REQUEST", "پارامترهای ناقص یا نامعتبر.");
      const episode = deps.findEpisode(slug, ch);
      if (!episode) return fail(res, 404, "NOT_FOUND", "چپتر پیدا نشد.");
      if (!entitled(ctx, episode)) return fail(res, 403, "PREMIUM_REQUIRED", "دانلود آفلاین فقط برای دارندگان اشتراک پرمیوم فعال است.");
      const st = userState(ctx.user.id);
      if (!st.devices.has(did) && st.devices.size >= MAX_DEVICES) return fail(res, 403, "OFFLINE_DEVICE_LIMIT", `هر حساب حداکثر روی ${MAX_DEVICES} دستگاه می‌تواند دانلود آفلاین داشته باشد.`);
      if (st.dayCount >= MAX_PER_DAY) return fail(res, 429, "OFFLINE_DAILY_LIMIT", "به سقف دانلود روزانه رسیدید. فردا دوباره تلاش کنید.");
      const items = await getPageList(deps, slug, ch, episode);
      if (!items.length) return fail(res, 404, "NO_PAGES", "تصاویری برای این چپتر یافت نشد.");
      const now = Date.now();
      const claims = {
        uid: ctx.user.id,
        did: did,
        slug: slug,
        ch: ch,
        n: items.length,
        lid: crypto.randomBytes(16).toString("hex"),
        wm: whoText(ctx.user),
        iat0: now,
        exp: now + LICENSE_MS
      };
      st.devices.add(did);
      st.dayCount++;
      console.log(`[offline] license uid=${claims.uid} lid=${claims.lid} ${slug}#${ch} pages=${claims.n}`);
      return res.json({
        token: signToken(claims),
        key: contentKey(claims).toString("base64"),
        lid: claims.lid,
        n: claims.n,
        exp: claims.exp
      });
    } catch (e) {
      console.error("[offline] license", e);
      return fail(res, 500, "SERVER_ERROR", "خطای داخلی سرور.");
    }
  });
  app.post("/api/offline/page", async (req, res) => {
    let st = null;
    try {
      const ctx = await auth(req, res);
      if (!ctx) return;
      if (!sharp) return fail(res, 503, "OFFLINE_UNAVAILABLE", "دانلود آفلاین هنوز روی سرور آماده نیست.");
      const c = verifyToken((req.body || {}).token);
      const i = Number.parseInt((req.body || {}).i, 10);
      if (!c || c.uid !== ctx.user.id || c.iat0 < REVOKE_BEFORE || Date.now() > c.exp) return fail(res, 403, "LICENSE_INVALID", "مجوز نامعتبر یا منقضی است.");
      if (!Number.isInteger(i) || i < 0 || i >= c.n) return fail(res, 400, "BAD_REQUEST", "شماره‌ی صفحه نامعتبر است.");
      const episode = deps.findEpisode(c.slug, c.ch);
      if (!episode || !entitled(ctx, episode)) return fail(res, 403, "PREMIUM_REQUIRED", "اشتراک پرمیوم شما برای این چپتر معتبر نیست.");
      let fc = fetchCounts.get(c.lid);
      if (!fc) fetchCounts.set(c.lid, fc = {
        exp: c.exp,
        byPage: new Map
      });
      const used = fc.byPage.get(i) || 0;
      if (used >= MAX_FETCH_PER_PAGE) return fail(res, 429, "PAGE_LIMIT", "این صفحه قبلاً دریافت شده است.");
      st = userState(ctx.user.id);
      if (st.inflight >= MAX_INFLIGHT_PER_USER) {
        res.setHeader("Retry-After", "1");
        st = null;
        return fail(res, 429, "BUSY", "درخواست هم‌زمان زیاد است.");
      }
      st.inflight++;
      fc.byPage.set(i, used + 1);
      const items = await getPageList(deps, c.slug, c.ch, episode);
      if (items.length !== c.n) return fail(res, 409, "CHAPTER_CHANGED", "چپتر تغییر کرده است؛ دوباره دانلود کنید.");
      const raw = await loadRaw(deps, items[i]);
      const {data: data, w: w, h: h} = await withSlot(() => watermarkAndEncode(raw, c.wm, c.lid, i));
      const enc = encryptPage(contentKey(c), c.lid, i, c.n, data);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Mc-Dim", `${w}x${h}`);
      res.setHeader("Content-Length", enc.length);
      return res.end(enc);
    } catch (e) {
      console.error("[offline] page", e && e.message);
      if (!res.headersSent) return fail(res, 500, "SERVER_ERROR", "خطای داخلی سرور.");
    } finally {
      if (st) st.inflight = Math.max(0, st.inflight - 1);
    }
  });
  app.post("/api/offline/renew", async (req, res) => {
    try {
      const ctx = await auth(req, res);
      if (!ctx) return;
      const c = verifyToken((req.body || {}).token);
      const revoke = (code, msg) => res.status(403).json({
        error: msg,
        code: code,
        revoke: true
      });
      if (!c || c.uid !== ctx.user.id || c.iat0 < REVOKE_BEFORE) return revoke("LICENSE_INVALID", "مجوز نامعتبر است.");
      const now = Date.now();
      if (now > c.exp + RENEW_GRACE_MS || now > c.iat0 + MAX_AGE_MS) return revoke("LICENSE_EXPIRED", "مجوز منقضی شده؛ چپتر را دوباره دانلود کنید.");
      const episode = deps.findEpisode(c.slug, c.ch);
      if (!episode) return revoke("NOT_FOUND", "این چپتر دیگر در سایت نیست.");
      if (!entitled(ctx, episode)) return revoke("PREMIUM_REQUIRED", "اشتراک پرمیوم شما منقضی شده است.");
      const next = {
        ...c,
        exp: Math.min(now + LICENSE_MS, c.iat0 + MAX_AGE_MS)
      };
      return res.json({
        token: signToken(next),
        exp: next.exp
      });
    } catch (e) {
      console.error("[offline] renew", e);
      return fail(res, 500, "SERVER_ERROR", "خطای داخلی سرور.");
    }
  });
}

module.exports = {
  mount: mount,
  _t: {
    signToken: signToken,
    verifyToken: verifyToken,
    contentKey: contentKey,
    encryptPage: encryptPage,
    renderTextRGBA: renderTextRGBA,
    watermarkLayers: watermarkLayers,
    watermarkAndEncode: watermarkAndEncode,
    initKeys: initKeys,
    whoText: whoText
  }
};
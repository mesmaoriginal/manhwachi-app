// lib/halloweenWheel.js — چرخونه‌ی هالووین مانهواچی
// هر کاربر فقط یک‌بار می‌چرخونه؛ جایزه همیشه سمت سرور انتخاب می‌شه (کلاینت فقط انیمیشن نشون می‌ده).
// ذخیره‌سازی: data/halloween-spins.jsonl (append-only، بدون نیاز به جدول جدید در Supabase).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const END = new Date(process.env.HALLOWEEN_END || "2026-11-01T00:00:00+03:30").getTime(); // پایان شب ۳۱ اکتبر به وقت ایران
const COUPON_DAYS = Number(process.env.HALLOWEEN_COUPON_DAYS) || 14; // مهلت استفاده از کد تخفیف بعد از چرخش
// همیشه کنار data.json (پوشه‌ی دیسک‌دار) ذخیره می‌شه: اگه DATA_JSON_PATH ست باشه همون پوشه، وگرنه <پروژه>/data
// (متغیر HALLOWEEN_DATA دیگه استفاده نمی‌شه تا فایل اشتباهی بیرون از دیسک پایدار نره)
const DATA_DIR = process.env.DATA_JSON_PATH ? path.dirname(path.resolve(process.env.DATA_JSON_PATH)) : path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "halloween-spins.jsonl");

// w = وزن از ۱۰۰۰ (۳۵٪ = ۳۵۰). ترتیب آرایه = ترتیب قطاع‌ها روی چرخ.
const D = (id, label, w, o) => ({ id, label, w, ...o });
const PRIZES = {
  free: [
    D("f_m20", "۲۰٪ تخفیف اشتراک ماهانه", 350, { kind: "discount", percent: 20, plan: "monthly" }),
    D("f_d1", "۱ روز اشتراک رایگان", 300, { kind: "days", days: 1 }),
    D("f_w", "اشتراک هفتگی رایگان", 3, { kind: "days", days: 7, rare: true }),
    D("f_d2", "۲ روز اشتراک رایگان", 250, { kind: "days", days: 2 }),
    D("f_q20", "۲۰٪ تخفیف اشتراک سه‌ماهه", 97, { kind: "discount", percent: 20, plan: "quarterly" }),
  ],
  sub: [
    D("s_d4", "۴ روز اشتراک اضافه", 350, { kind: "days", days: 4 }),
    D("s_m20", "۲۰٪ تخفیف اشتراک ماهانه", 250, { kind: "discount", percent: 20, plan: "monthly" }),
    D("s_q40", "۴۰٪ تخفیف اشتراک سه‌ماهه", 3, { kind: "discount", percent: 40, plan: "quarterly", rare: true }),
    D("s_q20", "۲۰٪ تخفیف اشتراک سه‌ماهه", 250, { kind: "discount", percent: 20, plan: "quarterly" }),
    D("s_d5", "۵ روز اشتراک اضافه", 147, { kind: "days", days: 5 }),
  ],
};
const BY_ID = Object.fromEntries([...PRIZES.free, ...PRIZES.sub].map((p) => [p.id, p]));
const pub = (p) => ({ id: p.id, label: p.label, kind: p.kind, rare: !!p.rare });
const planKind = (pl) => { const d = (pl.days || 0) + (pl.months || 0) * 30; return d >= 28 && d <= 31 ? "monthly" : d >= 88 && d <= 93 ? "quarterly" : null; };

module.exports = function createHalloween({ getAuthContext, supabaseUrl, adminHeaders, invalidateAuthCache, rateLimit, getPlan }) {
  const spins = new Map(); // userId -> { p, t, exp, grant, used }
  const devices = new Map(); // کلید دستگاه (کوکی/localStorage) -> userId اولین چرخاننده
  const blocked = new Set(); // حساب‌هایی که با دستگاهِ استفاده‌شده‌ی یک حساب دیگه چرخیدن ⇒ خنثی
  const tracks = new Map(); // trackId -> userId (پرداخت‌هایی که با کد تخفیف شروع شدن)

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  console.log("[halloween] data file:", FILE);
  if (fs.existsSync(FILE)) {
    for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line), r = spins.get(e.u);
        if (e.type === "spin") spins.set(e.u, { p: e.p, t: e.t, exp: e.exp, grant: e.grant, used: false });
        else if (e.type === "grant" && r) r.grant = "done";
        else if (e.type === "dev") (e.d || []).forEach((k) => devices.set(k, e.u));
        else if (e.type === "block") blocked.add(e.u);
        else if (e.type === "res") tracks.set(e.track, e.u);
        else if (e.type === "used" && r) r.used = true;
      } catch {}
    }
  }
  const log = (e) => fs.appendFileSync(FILE, JSON.stringify(e) + "\n");

  async function grantDays(userId, days) {
    const base = `${supabaseUrl}/rest/v1/profiles`, json = { "Content-Type": "application/json" };
    const cur = (await (await fetch(`${base}?id=eq.${userId}&select=vip_until`, { headers: adminHeaders() })).json())[0];
    const d = cur?.vip_until && new Date(cur.vip_until) > new Date() ? new Date(cur.vip_until) : new Date();
    d.setDate(d.getDate() + days);
    const body = JSON.stringify({ is_vip: true, vip_until: d.toISOString() });
    const up = await fetch(`${base}?id=eq.${userId}`, { method: "PATCH", headers: adminHeaders({ ...json, Prefer: "return=representation" }), body });
    const rows = up.ok ? await up.json() : null;
    if (!Array.isArray(rows) || !rows.length) {
      const ins = await fetch(base, { method: "POST", headers: adminHeaders({ ...json, Prefer: "resolution=merge-duplicates,return=representation" }), body: JSON.stringify([{ id: userId, is_vip: true, vip_until: d.toISOString() }]) });
      if (!ins.ok) throw new Error("profile upsert failed");
    }
    invalidateAuthCache(userId);
  }

  async function settle(userId) { // اعمال جایزه‌ی روزی؛ اگه قبلاً خطا خورده بود دوباره تلاش می‌کنه
    const r = spins.get(userId), p = r && BY_ID[r.p];
    if (!p || r.grant !== "pending") return;
    try { await grantDays(userId, p.days); r.grant = "done"; log({ type: "grant", u: userId }); }
    catch (e) { console.error("[halloween] grant failed", userId, e.message); }
  }

  // شناسه‌ی دستگاه: کوکی httpOnly (سمت سرور) + شناسه‌ی localStorage که کلاینت می‌فرسته
  const devKeys = (req, res) => {
    const m = /(?:^|;\s*)hwd=([0-9a-f-]{20,64})/.exec(req.headers.cookie || "");
    const c = m ? m[1] : crypto.randomUUID();
    if (!m) res.setHeader("Set-Cookie", `hwd=${c}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}`);
    const l = String(req.headers["x-hw-dev"] || ""), keys = ["c:" + c];
    if (/^[0-9a-f-]{20,64}$/.test(l)) keys.push("l:" + l);
    return keys;
  };
  const tokenOf = (req) => (req.headers.authorization || "").replace(/^Bearer /, "") || null;
  const view = (r) => {
    if (!r) return null;
    const p = BY_ID[r.p];
    return { prize: pub(p), pending: r.grant === "pending", coupon: p.kind === "discount" ? { percent: p.percent, plan: p.plan, expires: r.exp, used: r.used, expired: Date.now() > r.exp } : null };
  };

  const router = express.Router();

  router.get("/me", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const out = { now: Date.now(), end: END, open: Date.now() < END, loggedIn: false, isVip: false, prizes: PRIZES.free.map(pub), spin: null };
    const t = tokenOf(req);
    if (t) {
      try {
        const ctx = await getAuthContext(t);
        if (ctx) {
          out.loggedIn = true; out.isVip = ctx.isVip;
          out.prizes = (ctx.isVip ? PRIZES.sub : PRIZES.free).map(pub);
          const keys = devKeys(req, res), mine = spins.get(ctx.user.id);
          out.blocked = blocked.has(ctx.user.id);
          out.deviceUsed = !mine && keys.some((k) => devices.has(k) && devices.get(k) !== ctx.user.id);
          if (mine) { await settle(ctx.user.id); out.spin = view(mine); out.prizes = (BY_ID[mine.p].id[0] === "s" ? PRIZES.sub : PRIZES.free).map(pub); }
        }
      } catch (e) { console.error("[halloween/me]", e.message); }
    }
    res.json(out);
  });

  router.post("/spin", async (req, res) => {
    try {
      const lim = await rateLimit(`halloween-spin:${req.ip}`, { maxBurst: 6, maxSustained: 30 });
      if (!lim.allowed) return res.status(429).json({ error: "درخواست‌ها زیاده؛ کمی صبر کن." });
      if (Date.now() >= END) return res.status(403).json({ error: "هالووین تموم شد 👻" });
      const t = tokenOf(req);
      if (!t) return res.status(401).json({ error: "اول وارد حساب بشو." });
      const ctx = await getAuthContext(t);
      if (!ctx) return res.status(401).json({ error: "نشست نامعتبره؛ دوباره وارد شو." });
      const uid = ctx.user.id;

      // از اینجا تا spins.set هیچ await نیست ⇒ دو درخواست هم‌زمان نمی‌تونن هر دو برنده بشن
      const keys = devKeys(req, res);
      if (blocked.has(uid)) return res.status(403).json({ error: "این حساب از چرخونه کنار گذاشته شده.", blocked: true });
      if (spins.has(uid)) {
        keys.filter((k) => !devices.has(k)).forEach((k) => devices.set(k, uid));
        log({ type: "dev", u: uid, d: keys });
        return res.status(409).json({ error: "تو قبلاً چرخوندی!", spin: view(spins.get(uid)) });
      }
      if (keys.some((k) => devices.has(k) && devices.get(k) !== uid)) { // این دستگاه قبلاً با حساب دیگه‌ای چرخونده
        blocked.add(uid); log({ type: "block", u: uid, d: keys });
        return res.status(403).json({ error: "از این دستگاه قبلاً با یک حساب دیگه چرخونده شده؛ این حساب هم از چرخونه کنار گذاشته شد.", blocked: true });
      }
      const set = ctx.isVip ? PRIZES.sub : PRIZES.free;
      let n = crypto.randomInt(1000), prize = set[set.length - 1];
      for (const p of set) { if (n < p.w) { prize = p; break; } n -= p.w; }
      const rec = { p: prize.id, t: Date.now(), exp: Date.now() + COUPON_DAYS * 864e5, grant: prize.kind === "days" ? "pending" : "n/a", used: false };
      spins.set(uid, rec);
      keys.forEach((k) => devices.set(k, uid));
      log({ type: "dev", u: uid, d: keys });
      log({ type: "spin", u: uid, p: rec.p, t: rec.t, exp: rec.exp, grant: rec.grant });

      await settle(uid);
      res.json({ index: set.indexOf(prize), spin: view(rec) });
    } catch (e) {
      console.error("[halloween/spin]", e);
      res.status(500).json({ error: "خطای سرور؛ دوباره امتحان کن." });
    }
  });

  router.get("/coupon", async (req, res) => { // برای vip.html: قیمت‌های تخفیف‌خورده‌ی همین کاربر
    res.setHeader("Cache-Control", "no-store");
    const out = { open: Date.now() < END, loggedIn: false, spun: false, coupon: null, items: {} };
    try {
      const t = tokenOf(req), ctx = t && (await getAuthContext(t));
      if (ctx) {
        out.loggedIn = true;
        const mine = spins.get(ctx.user.id), v = view(mine);
        out.spun = !!mine;
        if (v && v.coupon && !v.coupon.used && !v.coupon.expired && !blocked.has(ctx.user.id)) {
          out.coupon = v.coupon;
          for (const k of String(req.query.keys || "").split(",").slice(0, 10)) {
            const pl = getPlan(k); if (!pl) continue;
            const q = api.quote(ctx.user.id, pl); if (q.discounted) out.items[k] = q.amount;
          }
        }
      }
    } catch (e) { console.error("[halloween/coupon]", e.message); }
    res.json(out);
  });

  const api = {
    router,
    // قیمت نهایی (ریال) برای /purchase/request
    quote(userId, plan) {
      const r = spins.get(userId), p = r && BY_ID[r.p];
      if (blocked.has(userId) || !p || p.kind !== "discount" || r.used || Date.now() > r.exp || planKind(plan) !== p.plan) return { amount: plan.amount, discounted: false };
      return { amount: Math.max(1000, Math.round((plan.amount * (100 - p.percent)) / 100 / 1000) * 1000), discounted: true };
    },
    reserve(userId, trackId) { tracks.set(trackId, userId); log({ type: "res", u: userId, track: trackId }); },
    onPaid(trackId) { // فقط بعد از پرداخت موفق، کد مصرف می‌شه
      const uid = tracks.get(String(trackId)), r = uid && spins.get(uid);
      if (r && !r.used) { r.used = true; log({ type: "used", u: uid, track: String(trackId) }); }
    },
  };
  return api;
};

// routes/userServiceRouter.js
//
//  • پشتیبانی/تیکت  → برای «همه‌ی کاربرانِ واردشده» (اشتراک لازم نیست).
//    تیکت کاربر پرمیوم فقط یک پرچم priority=1 می‌گیرد تا ادمین بتواند اول آن‌ها را ببیند.
//  • درخواست مانهوا → فقط «اشتراک پرمیوم فعال».
//
// جدول‌ها: support_tickets و manhwa_requests (lib/localdb/schema.json). نوشتن فقط از همین مسیرهاست
// (policies.js برای کاربر فقط خواندنِ ردیف‌های خودش را اجازه می‌دهد).
// ادمین: همان TEAM_ADMIN_IDS (فهرست UUID کاربران، جداشده با کاما) که پنل تیم استفاده می‌کند.

const express = require("express");

const TICKET_MAX_OPEN = 3;       // هر کاربر هم‌زمان حداکثر ۳ تیکتِ بی‌پاسخ
const TICKET_MAX_PER_DAY = 10;
const REQUEST_MAX_PENDING = 3;   // درخواست مانهوای در انتظار بررسی
const REQUEST_MAX_PER_30D = 8;
const DAY_MS = 86400000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

module.exports = function ({ getAuthContext, supabaseUrl, adminHeaders }) {
  const router = express.Router();
  router.use(express.json({ limit: "20kb" }));

  const adminIds = (process.env.TEAM_ADMIN_IDS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdminUser = (u) => adminIds.includes(String(u.id).toLowerCase());

  async function sb(q, opts = {}) {
    const r = await fetch(`${supabaseUrl}/rest/v1/${q}`, {
      ...opts,
      headers: adminHeaders({ "Content-Type": "application/json", ...(opts.headers || {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  // احراز هویت: ctx = { user, sub, ... }
  async function authed(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "برای این بخش باید وارد حساب شوید.", code: "AUTH_REQUIRED" });
    try {
      const ctx = await getAuthContext(token);
      if (!ctx) return res.status(401).json({ error: "نشست شما نامعتبر است، دوباره وارد شوید.", code: "AUTH_REQUIRED" });
      req.ctx = ctx;
      req.user = ctx.user;
      next();
    } catch (e) {
      console.error("[userService] auth:", e.message);
      res.status(503).json({ error: "موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کنید." });
    }
  }
  function adminOnly(req, res, next) {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: "دسترسی ندارید." });
    next();
  }
  const fail = (res, e) => {
    console.error("[userService]", e.message);
    res.status(500).json({ error: "خطای داخلی سرور" });
  };

  // ───────────────────────── پشتیبانی (همه) ─────────────────────────
  router.get("/support/tickets", authed, async (req, res) => {
    try {
      const rows = await sb(`support_tickets?user_id=eq.${encodeURIComponent(req.user.id)}&order=created_at.desc&limit=30&select=id,subject,message,status,reply,created_at,replied_at,user_read_at`);
      res.json(rows.map((r) => ({ ...r, unread: !!r.reply && !r.user_read_at })));
    } catch (e) { fail(res, e); }
  });

  router.post("/support/tickets", authed, async (req, res) => {
    try {
      const subject = clean(req.body?.subject, 120);
      const message = clean(req.body?.message, 2000);
      if (subject.length < 3) return res.status(400).json({ error: "موضوع را بنویسید (حداقل ۳ حرف)." });
      if (message.length < 10) return res.status(400).json({ error: "متن پیام خیلی کوتاه است (حداقل ۱۰ حرف)." });

      const since = new Date(Date.now() - DAY_MS).toISOString();
      const recent = await sb(`support_tickets?user_id=eq.${encodeURIComponent(req.user.id)}&created_at=gte.${encodeURIComponent(since)}&select=id,status,reply`);
      if (recent.length >= TICKET_MAX_PER_DAY) return res.status(429).json({ error: "امروز به سقف تعداد تیکت رسیده‌اید. فردا دوباره امتحان کنید." });
      const open = recent.filter((t) => t.status === "open" && !t.reply).length;
      if (open >= TICKET_MAX_OPEN) return res.status(429).json({ error: `شما ${TICKET_MAX_OPEN} تیکت بی‌پاسخ دارید؛ لطفاً منتظر پاسخ بمانید.` });

      const rows = await sb("support_tickets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ user_id: req.user.id, subject, message, priority: req.ctx.sub.isPremium ? 1 : 0, status: "open" }]),
      });
      res.json({ ok: true, id: rows?.[0]?.id });
    } catch (e) { fail(res, e); }
  });

  router.post("/support/tickets/:id/read", authed, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر" });
      await sb(`support_tickets?id=eq.${req.params.id}&user_id=eq.${encodeURIComponent(req.user.id)}`, {
        method: "PATCH", body: JSON.stringify({ user_read_at: new Date().toISOString() }),
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ادمین: فهرست (اول اولویت‌دارها و بی‌پاسخ‌ها) و پاسخ
  router.get("/support/admin/tickets", authed, adminOnly, async (req, res) => {
    try {
      const rows = await sb("support_tickets?order=created_at.desc&limit=200&select=*");
      rows.sort((a, b) => (a.reply ? 1 : 0) - (b.reply ? 1 : 0) || b.priority - a.priority);
      res.json(rows);
    } catch (e) { fail(res, e); }
  });
  router.post("/support/admin/tickets/:id/reply", authed, adminOnly, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر" });
      const reply = clean(req.body?.reply, 2000);
      if (reply.length < 2) return res.status(400).json({ error: "متن پاسخ خالی است." });
      await sb(`support_tickets?id=eq.${req.params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reply, status: "answered", replied_at: new Date().toISOString(), user_read_at: null }),
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ───────────────────────── درخواست مانهوا (فقط پرمیوم) ─────────────────────────
  function premiumOnly(req, res, next) {
    if (!req.ctx.sub.canRequestManhwa) {
      return res.status(403).json({ error: "درخواست مانهوا فقط برای دارندگان اشتراک پرمیوم فعال است.", code: "PREMIUM_REQUIRED" });
    }
    next();
  }

  router.get("/manhwa-requests", authed, async (req, res) => {
    try {
      const rows = await sb(`manhwa_requests?user_id=eq.${encodeURIComponent(req.user.id)}&order=created_at.desc&limit=30&select=id,title,link,note,status,admin_note,created_at,decided_at`);
      res.json({ canRequest: !!req.ctx.sub.canRequestManhwa, items: rows });
    } catch (e) { fail(res, e); }
  });

  router.post("/manhwa-requests", authed, premiumOnly, async (req, res) => {
    try {
      const title = clean(req.body?.title, 150);
      const note = clean(req.body?.note, 500);
      let link = clean(req.body?.link, 300);
      if (title.length < 2) return res.status(400).json({ error: "نام مانهوا را بنویسید." });
      if (link && !/^https?:\/\/\S+$/i.test(link)) return res.status(400).json({ error: "لینک باید با http:// یا https:// شروع شود." });
      if (!link) link = null;

      const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
      const recent = await sb(`manhwa_requests?user_id=eq.${encodeURIComponent(req.user.id)}&created_at=gte.${encodeURIComponent(since)}&select=id,status`);
      if (recent.length >= REQUEST_MAX_PER_30D) return res.status(429).json({ error: "در ۳۰ روز گذشته به سقف تعداد درخواست رسیده‌اید." });
      if (recent.filter((r) => r.status === "pending").length >= REQUEST_MAX_PENDING) {
        return res.status(429).json({ error: `شما ${REQUEST_MAX_PENDING} درخواست در انتظار بررسی دارید؛ لطفاً منتظر نتیجه بمانید.` });
      }
      const rows = await sb("manhwa_requests", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ user_id: req.user.id, title, link, note: note || null, status: "pending" }]),
      });
      res.json({ ok: true, id: rows?.[0]?.id });
    } catch (e) { fail(res, e); }
  });

  // ادمین: فهرست و تصمیم (accepted | rejected | done)
  router.get("/manhwa-requests/admin", authed, adminOnly, async (req, res) => {
    try { res.json(await sb("manhwa_requests?order=created_at.desc&limit=200&select=*")); } catch (e) { fail(res, e); }
  });
  router.post("/manhwa-requests/admin/:id/decide", authed, adminOnly, async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر" });
      const status = String(req.body?.status || "");
      if (!["accepted", "rejected", "done"].includes(status)) return res.status(400).json({ error: "وضعیت نامعتبر" });
      await sb(`manhwa_requests?id=eq.${req.params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, admin_note: clean(req.body?.note, 300) || null, decided_at: new Date().toISOString() }),
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  return router;
};

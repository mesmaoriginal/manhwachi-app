// team/teamRouter.js — سیستم کار تیمی (تایپیست / تغییر فونت / مترجم / کلینر) + توکن
// قیمت هر توکن فقط سمت سرور (TEAM_TOMAN_PER_TOKEN) تعیین می‌شود و هرگز برای کارمندها نمایش داده نمی‌شود؛ کارمند فقط تومان می‌بیند. فایل‌ها (zip/docx) در باکت S3 (PARSPACK_BUCKET) زیر پوشه‌ی TEAM_S3_PREFIX (پیش‌فرض team-files) ذخیره می‌شن.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeIranPhone } = require("../lib/phone");
const os = require("os");
const { pipeline } = require("stream/promises");
const yauzl = require("yauzl");
const { GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const banner = require("../lib/teamBanner");
const { Upload } = require("@aws-sdk/lib-storage");
const { s3 } = require("../lib/chapterCache"); // همان کلاینت S3 (ParsPack) که بقیه‌ی سایت استفاده می‌کند

const ROLES = { typist: "تایپیست", font: "تغییر دهنده فونت", translator: "مترجم", cleaner: "کلینر" };
const TOMAN_PER_TOKEN = Math.max(1, Number(process.env.TEAM_TOMAN_PER_TOKEN) || 1000); // قیمت هر توکن (تومان). فقط همین‌جا/ENV عوض می‌شود؛ به کلاینتِ کارمند نمی‌رود
const MIN_WITHDRAW_TOKENS = Math.max(1, Number(process.env.TEAM_MIN_WITHDRAW_TOKENS) || 150); // حداقل توکن برای برداشت
const SUPPORT_MAX_OPEN = 3; // هر کارمند حداکثر ۳ تیکتِ بی‌پاسخ
const toman = (tokens) => Math.round(Number(tokens) * TOMAN_PER_TOKEN);
const fmt = (n) => Number(n).toLocaleString("fa-IR");
const latinDigits = (x) => String(x || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
// قوانین هر نقش: source = ادمین فایل zip ورودی می‌دهد | text = لینک/پیام/نام کار اجباری | address = آدرس اجباری
// کارمند در همه‌ی نقش‌ها فقط یک zip (حداکثر ۱۰۰ مگابایت) تحویل می‌دهد.
const ROLE_RULES = {
  typist: { source: true, text: false, address: false, result: "zip" },
  cleaner: { source: true, text: false, address: false, result: "zip" },
  font: { source: true, text: false, address: true, result: "zip" },
  translator: { source: false, text: true, address: false, result: "docx" }, // مترجم فایل Word تحویل می‌دهد
};
const safeName = (s) => String(s || "task").replace(/[^\w\-. \u0600-\u06FF]/g, "_").slice(0, 60);
const dlName = (t, kind, f) => `${safeName(t.label)}${kind === "result" ? "-result" : ""}${path.extname(f)}`;
const MAX_ACTIVE_PER_USER = 3; // هر نفر هم‌زمان حداکثر ۳ کار باز
const MAX_IN_PROGRESS = 1; // هم‌زمان فقط یک کار «در حال انجام»؛ بعد از تحویل (حتی تایید‌نشده) می‌تواند کار بعدی را بردارد، تا سقف MAX_ACTIVE_PER_USER
const claimBusy = new Set(); // قفل کوتاه برای جلوگیری از دو درخواست هم‌زمانِ برداشتن
const MAX_ZIP = 100 * 1024 * 1024; // ۱۰۰ مگابایت
const CLAIM_HOURS = Number(process.env.TEAM_CLAIM_HOURS || 72);            // کار برداشته‌شده‌ی تحویل‌نشده بعد از این مدت خودکار آزاد می‌شود (۰ = خاموش)
const AUTO_APPROVE_HOURS = Number(process.env.TEAM_AUTO_APPROVE_HOURS || 0); // تحویل‌های بررسی‌نشده بعد از این مدت خودکار تایید می‌شوند (۰ = خاموش)
// ---- سیستم پاداش / جریمه ----
// مهلت تحویل از لحظه‌ی «برداشتن کار» حساب می‌شود.
const DEADLINE_H = Number(process.env.TEAM_DEADLINE_HOURS || 24); // مهلت عادی
const GRACE_H = Number(process.env.TEAM_GRACE_HOURS || 12);       // ۱۲ ساعت بعدش: ۳ توکن کسر؛ بعد از آن: آزادسازی + کسر کل توکن کار
const FAST_H = Number(process.env.TEAM_FAST_HOURS || 4);          // تحویل زیر این مدت = پاداش سرعت
const FLAT = { mode: "flat", quality: 2, speed: 3, bad: 2, late: 3 };        // تایپیست / فونت: مقدار ثابت توکن
const MULT = { mode: "mult", quality: 0.10, speed: 0.15, bad: 2, late: 3 };  // مترجم / کلینر: ضریب ۱.۱ و ۱.۱۵ (گرد می‌شود)
const PAY = { typist: FLAT, font: FLAT, translator: MULT, cleaner: MULT };
const BASE_RANGE = { typist: [20, 20], font: [20, 20], translator: [12, 15] }; // حقوق پایه؛ کلینر محدودیتی ندارد
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIR = process.env.TEAM_FILES_DIR || path.join(__dirname, "..", "team_files");
fs.mkdirSync(DIR, { recursive: true }); // فقط برای فایل‌های قدیمی که قبل از انتقال به S3 آپلود شده‌اند
// ---- ذخیره‌سازی در S3: همه‌ی فایل‌های تیم داخل یک پوشه‌ی مشخص باکت ----
// ساختار کلید: <PREFIX>/<role>/<taskId>/<source|result>-<uuid>.<zip|docx>
const BUCKET = process.env.PARSPACK_BUCKET;
const PREFIX = (process.env.TEAM_S3_PREFIX || "team-files").replace(/^\/+|\/+$/g, "");
if (!BUCKET) console.warn("[team] PARSPACK_BUCKET تنظیم نشده؛ آپلود فایل تیم کار نمی‌کند");
const TMP = path.join(os.tmpdir(), "team_tmp"); // موقت: اعتبارسنجی قبل از آپلود + کش پیش‌نمایش
fs.mkdirSync(TMP, { recursive: true });
const MIME = { zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const IMG_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const IMG_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
const MAX_ENTRY = 60 * 1024 * 1024; // سقف حجم هر تصویر داخل zip برای پیش‌نمایش
const kindOf = (q) => (["result", "extra"].includes(q) ? q : "source");

module.exports = function ({ getAuthContext, supabaseUrl, adminHeaders }) {
  const router = express.Router();
  const adminIds = (process.env.TEAM_ADMIN_IDS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdminUser = (u) => adminIds.includes(String(u.id).toLowerCase()) || (u.email && adminIds.includes(String(u.email).toLowerCase()));

  async function sb(q, opts = {}) {
    const r = await fetch(`${supabaseUrl}/rest/v1/${q}`, {
      ...opts,
      headers: adminHeaders({ "Content-Type": "application/json", ...(opts.headers || {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const patch = (q, body) => sb(q, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  const sum = (rows) => (rows || []).reduce((a, r) => a + r.tokens, 0);
  const balanceOf = async (uid) => sum(await sb(`team_ledger?user_id=eq.${uid}&select=tokens`));
  const pendingTokens = async (uid) => sum(await sb(`team_withdrawals?user_id=eq.${uid}&status=eq.pending&select=tokens`));
  // قوانین به تومان (برای نمایش به کارمند؛ نرخ توکن در آن نیست)
  const workerRules = () => ({
    deadlineH: DEADLINE_H, graceH: GRACE_H, fastH: FAST_H,
    base: { flat: toman(BASE_RANGE.typist[0]), translator: [toman(BASE_RANGE.translator[0]), toman(BASE_RANGE.translator[1])] },
    qualityFlat: toman(FLAT.quality), speedFlat: toman(FLAT.speed), bad: toman(FLAT.bad), late: toman(FLAT.late),
    multQuality: Math.round((1 + MULT.quality) * 100) / 100, multSpeed: Math.round((1 + MULT.speed) * 100) / 100,
  });
  const dueAt = (t, h) => (t.status === "claimed" && t.first_claimed_at && !t.first_submitted_at ? new Date(new Date(t.first_claimed_at).getTime() + h * 36e5).toISOString() : null);
  // نمای کارمند: فقط برچسب عمومی (CH1). عنوان داخلی هرگز نمی‌رود؛ توضیح/آدرس فقط بعد از برداشتن کار.
  const pubWorker = (t, mine) => ({
    id: t.id, role: t.role, label: t.label || "کار", reward_toman: toman(t.reward_tokens), status: t.status,
    has_source: mine && !!t.source_file, has_extra: mine && !!t.extra_file, description: mine ? t.description : null,
    address: mine ? t.address : null, admin_note: mine ? t.admin_note : null,
    deadline_at: mine ? dueAt(t, DEADLINE_H) : null, hard_deadline_at: mine ? dueAt(t, DEADLINE_H + GRACE_H) : null,
  });
  const pubAdmin = (t) => ({
    id: t.id, role: t.role, title: t.title, label: t.label, description: t.description, address: t.address,
    reward_tokens: t.reward_tokens, status: t.status, has_source: !!t.source_file, has_extra: !!t.extra_file, has_result: !!t.result_file, chapter_id: t.chapter_id,
    admin_note: t.admin_note, assignee: t.assignee, created_at: t.created_at, claimed_at: t.claimed_at, submitted_at: t.submitted_at,
    first_claimed_at: t.first_claimed_at, first_submitted_at: t.first_submitted_at, quality: t.quality,
  });
  const fail = (res, e, code = 500) => { console.error("[team]", e.message || e); res.status(code).json({ error: "خطای داخلی سرور." }); };

  // ---------- پاداش / جریمه ----------
  const ledgerAdd = (rows) => sb("team_ledger", { method: "POST", body: JSON.stringify(rows.map((r) => ({ kind: "adjust", ...r }))) });
  const notify = (user_id, task_id, message, level) =>
    sb("team_tickets", { method: "POST", body: JSON.stringify([{ user_id, task_id: task_id || null, message, level }]) }).catch((e) => console.error("[team] ticket:", e.message));
  // تعدیل‌های زمان/کیفیت روی پایه‌ی حقوق (پایه را خود approve_team_task می‌پردازد)
  function adjustments(t, quality) {
    const p = PAY[t.role] || FLAT, flat = p.mode === "flat";
    const amt = (v) => (flat ? v : Math.round(t.reward_tokens * v));
    const bad = t.quality === "bad", lines = [];
    if (quality === "high" && !bad) lines.push({ tokens: amt(p.quality), note: "پاداش کیفیت بالا" });
    const fc = t.first_claimed_at, fs = t.first_submitted_at || t.submitted_at;
    if (fc && fs) {
      const h = (new Date(fs) - new Date(fc)) / 36e5;
      if (h < FAST_H && !bad) lines.push({ tokens: amt(p.speed), note: `پاداش سرعت (زیر ${FAST_H} ساعت)` });
      else if (h > DEADLINE_H) lines.push({ tokens: -p.late, note: `جریمه‌ی تاخیر (بیش از ${DEADLINE_H} ساعت)` });
    }
    return lines.filter((l) => l.tokens);
  }
  async function settle(id, quality) {
    const t = (await sb(`team_tasks?id=eq.${id}&select=*`))[0];
    if (!t || !t.assignee) return 0;
    const lines = adjustments(t, quality);
    if (lines.length) await ledgerAdd(lines.map((l) => ({ user_id: t.assignee, tokens: l.tokens, note: `${l.note} — ${t.label}` })));
    if (quality === "high" && t.quality !== "bad") await patch(`team_tasks?id=eq.${id}`, { quality: "high" });
    return lines.reduce((a, l) => a + l.tokens, 0);
  }
  // وقتی ترجمه و کلین یک چپتر هر دو تایید شدند، کار تایپیست (فایل کلین + Word ترجمه) خودکار ساخته می‌شود
  async function advanceChapter(chapterId) {
    if (!chapterId) return;
    const ch = (await sb(`team_chapters?id=eq.${chapterId}&select=*`))[0];
    if (!ch) return;
    const ts = await sb(`team_tasks?chapter_id=eq.${chapterId}&select=*`);
    const tr = ts.find((t) => t.role === "translator"), cl = ts.find((t) => t.role === "cleaner"), ty = ts.find((t) => t.role === "typist");
    if (ty || !tr || tr.status !== "approved" || (cl && cl.status !== "approved")) return;
    try {
      await sb("team_tasks", {
        method: "POST",
        body: JSON.stringify([{
          role: "typist", chapter_id: chapterId, title: `${ch.title} — تایپ`, label: ch.label, reward_tokens: ch.typist_reward,
          status: cl ? "open" : "draft", // بدون مرحله‌ی کلین، ادمین باید zip تصاویر را بدهد
          source_file: cl ? cl.result_file : null, extra_file: tr.result_file,
        }]),
      });
    } catch (e) { if (!/23505|duplicate/i.test(e.message)) throw e; }
  }
  // ---------- ساخت بنر چپتر (بعد از تایید آخرین کار تایپیست؛ هرگز تایید/پرداخت را خراب نمی‌کند) ----------
  const bannerBusy = new Set();
  async function makeBanner(chapterId) {
    if (bannerBusy.has(chapterId)) return;
    bannerBusy.add(chapterId);
    try {
      const ch = (await sb(`team_chapters?id=eq.${chapterId}&select=*`))[0];
      if (!ch) return;
      const ts = await sb(`team_tasks?chapter_id=eq.${chapterId}&select=role,assignee`);
      const ids = [...new Set(ts.map((t) => t.assignee).filter(Boolean))];
      const mem = ids.length ? await sb(`team_members?user_id=in.(${ids.join(",")})&select=user_id,display_name,banner_name`) : [];
      const nm = Object.fromEntries(mem.map((m) => [m.user_id, String(m.banner_name || m.display_name || "").trim()]));
      const names = {};
      for (const r of ["translator", "cleaner", "typist"]) { const t = ts.find((x) => x.role === r); names[r] = t && t.assignee ? nm[t.assignee] || "" : ""; }
      let cover = null;
      if (ch.manhwa_id) { const mh = (await sb(`team_manhwas?id=eq.${ch.manhwa_id}&select=image_file`))[0]; cover = (mh && mh.image_file) || null; }
      const png = await banner.buildBanner({ names, coverKey: cover });
      const key = `${PREFIX}/chapters/${chapterId}/banner-${crypto.randomUUID()}.png`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: png, ContentType: "image/png" }));
      await patch(`team_chapters?id=eq.${chapterId}`, { banner_file: key, banner_note: cover ? null : "تصویر مانهوا ندارد؛ بنر بدون تصویر ساخته شد." });
      if (ch.banner_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: ch.banner_file })).catch(() => {});
    } catch (e) {
      console.error("[team] banner:", e.message);
      await patch(`team_chapters?id=eq.${chapterId}`, { banner_note: String(e.message).slice(0, 300) }).catch(() => {});
    } finally { bannerBusy.delete(chapterId); }
  }
  // تصویر مانهوا (JPG/PNG/WebP، حداکثر ۳۰ مگابایت) → S3
  const MAX_IMG = 30 * 1024 * 1024;
  async function saveImage(req, manhwaId) {
    const full = path.join(TMP, crypto.randomUUID() + ".img");
    try {
      let size = 0;
      await pipeline(req, new (require("stream").Transform)({ transform(c, _e, cb) { size += c.length; size > MAX_IMG ? cb(new Error("TOO_BIG")) : cb(null, c); } }), fs.createWriteStream(full, { flags: "wx" }));
      let meta;
      try { meta = await sharp(full).metadata(); } catch { throw Object.assign(new Error("فایل تصویر معتبر نیست."), { user: true }); }
      const ext = { jpeg: "jpg", png: "png", webp: "webp" }[meta.format];
      if (!ext) throw Object.assign(new Error("فقط JPG، PNG یا WebP قابل قبوله."), { user: true });
      const key = `${PREFIX}/manhwas/${manhwaId}/cover-${crypto.randomUUID()}.${ext}`;
      await new Upload({ client: s3, partSize: 25 * 1024 * 1024, queueSize: 2, params: { Bucket: BUCKET, Key: key, Body: fs.createReadStream(full), ContentType: "image/" + meta.format } }).done();
      return key;
    } catch (e) {
      if (e.message === "TOO_BIG") throw Object.assign(new Error("حجم تصویر بیشتر از ۳۰ مگابایته."), { user: true });
      throw e;
    } finally { await fs.promises.unlink(full).catch(() => {}); }
  }
  const sendS3 = async (res, key, type, filename) => {
    try {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      res.set({ "Content-Type": type, "Cache-Control": "private, max-age=300", ...(filename ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` } : {}) });
      await pipeline(o.Body, res);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return res.status(404).json({ error: "فایل پیدا نشد." });
      fail(res, e);
    }
  };

  // تایید اتمیک + پرداخت توکن + حرکت دادن چپتر در زنجیره
  async function approveTask(id, quality = "normal") {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/approve_team_task`, {
      method: "POST", headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ p_task: id }), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(await r.text());
    const out = await r.json();
    if (!out.ok) return out;
    try { out.adjust = await settle(id, quality); } catch (e) { console.error("[team] settle:", e.message); out.adjust = 0; }
    const t = (await sb(`team_tasks?id=eq.${id}&select=chapter_id,role`))[0];
    if (t && t.chapter_id) {
      if (t.role === "typist") { await patch(`team_chapters?id=eq.${t.chapter_id}`, { status: "done" }); makeBanner(t.chapter_id).catch(() => {}); }
      else await advanceChapter(t.chapter_id);
    }
    return out;
  }

  // ---------- احراز هویت (همون توکن Supabase سایت) ----------
  router.use(async (req, res, next) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "ابتدا وارد حساب شوید." });
    try {
      const ctx = await getAuthContext(token);
      if (!ctx) return res.status(401).json({ error: "نشست نامعتبر است. دوباره وارد شوید." });
      req.user = ctx.user;
      req.isAdmin = isAdminUser(ctx.user);
      const rows = await sb(`team_members?user_id=eq.${ctx.user.id}&select=*`);
      req.member = rows[0] && rows[0].active ? rows[0] : null;
      next();
    } catch (e) { fail(res, e, 503); }
  });
  const needMember = (req, res, next) => (req.member ? next() : res.status(403).json({ error: "حساب شما عضو تیم نیست. با ادمین هماهنگ کنید." }));
  const needAdmin = (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ error: "دسترسی ادمین لازم است." }));

  // ---------- دریافت فایل: stream روی دیسک موقت → اعتبارسنجی → آپلود در S3 → حذف موقت ----------
  async function saveZip(req, ext, taskId, role, kind) {
    const len = Number(req.headers["content-length"] || 0);
    if (!len || len > MAX_ZIP) throw Object.assign(new Error("حجم فایل نامعتبر است (حداکثر ۱۰۰ مگابایت)."), { user: true });
    const full = path.join(TMP, crypto.randomUUID() + "." + ext);
    const ws = fs.createWriteStream(full, { flags: "wx" });
    let size = 0;
    let head = Buffer.alloc(0);
    try {
      await new Promise((resolve, reject) => {
        req.on("data", (c) => {
          size += c.length;
          if (head.length < 4) head = Buffer.concat([head, c]).subarray(0, 4);
          if (size > MAX_ZIP) { reject(new Error("TOO_BIG")); req.destroy(); }
        });
        req.on("error", reject);
        req.on("aborted", () => reject(new Error("ABORTED")));
        ws.on("error", reject);
        ws.on("finish", resolve);
        req.pipe(ws);
      });
      const bad = ext === "docx" ? "فایل باید یک سند Word با پسوند docx باشد." : "فایل باید یک zip معتبر باشد.";
      if (head.toString("hex") !== "504b0304") throw Object.assign(new Error(bad), { user: true });
      if (ext === "docx") { // docx هم یک zip است؛ باید داخلش word/document.xml باشد
        const n = Math.min(size, 262144);
        const buf = Buffer.alloc(n);
        const fh = await fs.promises.open(full, "r");
        await fh.read(buf, 0, n, size - n);
        await fh.close();
        if (!buf.includes("word/document.xml")) throw Object.assign(new Error(bad), { user: true });
      }
      const key = `${PREFIX}/${role}/${taskId}/${kind}-${crypto.randomUUID()}.${ext}`;
      // partSize بزرگ = تعداد درخواست کمتر به باکت (سقف درخواست در دقیقه)
      await new Upload({
        client: s3, partSize: 25 * 1024 * 1024, queueSize: 2,
        params: { Bucket: BUCKET, Key: key, Body: fs.createReadStream(full), ContentType: MIME[ext] },
      }).done();
      return key;
    } catch (e) {
      ws.destroy();
      throw e;
    } finally {
      await fs.promises.unlink(full).catch(() => {});
    }
  }
  // فایل فقط وقتی پاک می‌شود که هیچ کار دیگری (مثلاً کار تایپیستی که فایل کلین/ترجمه را به ارث برده) به آن اشاره نکند
  // کلید شامل «/» یعنی در S3 است؛ بدون «/» یعنی فایل قدیمیِ روی دیسک.
  const rmFile = async (n) => {
    if (!n) return;
    try {
      if ((await sb(`team_tasks?or=(source_file.eq.${n},result_file.eq.${n},extra_file.eq.${n})&select=id&limit=1`)).length) return;
    } catch { return; }
    if (n.includes("/")) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: n })).catch((e) => console.error("[team] s3 delete:", e.message));
    else await fs.promises.unlink(path.join(DIR, path.basename(n))).catch(() => {});
  };
  // دانلود: از S3 مستقیم استریم می‌شود (یا از دیسک برای فایل‌های قدیمی)
  async function sendFile(res, t, kind) {
    const f = t && t[kind + "_file"];
    if (!f) return res.status(404).json({ error: "فایلی وجود ندارد." });
    const name = dlName(t, kind, f);
    if (!f.includes("/")) return res.download(path.join(DIR, path.basename(f)), name);
    try {
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: f }));
      res.set({
        "Content-Type": o.ContentType || "application/octet-stream",
        ...(o.ContentLength ? { "Content-Length": o.ContentLength } : {}),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      });
      await pipeline(o.Body, res);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return res.status(404).json({ error: "فایل در فضای ابری پیدا نشد." });
      fail(res, e);
    }
  }
  // کپی محلی موقت برای پیش‌نمایش (یک بار از S3 گرفته و ~۳۰ دقیقه کش می‌شود)
  const inflight = new Map();
  async function localCopy(f) {
    if (!f.includes("/")) return path.join(DIR, path.basename(f));
    const p = path.join(TMP, "c_" + crypto.createHash("sha1").update(f).digest("hex") + path.extname(f));
    if (fs.existsSync(p)) { const now = new Date(); fs.utimesSync(p, now, now); return p; }
    if (!inflight.has(p)) {
      inflight.set(p, (async () => {
        const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: f }));
        const part = p + ".part";
        await pipeline(o.Body, fs.createWriteStream(part));
        await fs.promises.rename(part, p);
      })().finally(() => inflight.delete(p)));
    }
    await inflight.get(p);
    return p;
  }
  function listZip(p) {
    return new Promise((ok, no) => yauzl.open(p, { lazyEntries: true }, (err, z) => {
      if (err) return no(err);
      const images = []; let others = 0, idx = -1;
      z.on("entry", (en) => {
        idx++;
        const base = en.fileName.split("/").pop();
        if (!(/\/$/.test(en.fileName) || en.fileName.startsWith("__MACOSX/") || base.startsWith("."))) {
          if (IMG_RE.test(base)) images.push({ i: idx, name: en.fileName, size: en.uncompressedSize }); else others++;
        }
        z.readEntry();
      });
      z.on("end", () => {
        z.close();
        images.sort((x, y) => x.name.localeCompare(y.name, "en", { numeric: true }));
        ok({ images: images.slice(0, 300), total: images.length, others });
      });
      z.on("error", no);
      z.readEntry();
    }));
  }
  const upErr = (res, e) => (e.user ? res.status(400).json({ error: e.message }) : fail(res, e));

  // ================== کاربر عادی ==================
  router.get("/me", async (req, res) => {
    try {
      const out = { isAdmin: req.isAdmin, member: req.member ? { roles: req.member.roles, name: req.member.display_name } : null, roles: ROLES };
      if (req.member) {
        const [bal, pend] = await Promise.all([balanceOf(req.user.id), pendingTokens(req.user.id).catch(() => 0)]);
        const avail = Math.max(0, bal - pend);
        Object.assign(out, {
          balanceToman: toman(bal), pendingToman: toman(pend), availableToman: toman(avail),
          minWithdrawToman: toman(MIN_WITHDRAW_TOKENS), canWithdraw: avail >= MIN_WITHDRAW_TOKENS, rules: workerRules(),
        });
      }
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  router.get("/summary", needMember, async (req, res) => {
    try {
      const [open, mine] = await Promise.all([
        sb("team_tasks?status=eq.open&select=role"),
        sb(`team_tasks?assignee=eq.${req.user.id}&status=in.(claimed,submitted)&select=role,status`),
      ]);
      const out = {};
      for (const k of Object.keys(ROLES)) {
        out[k] = {
          allowed: req.member.roles.includes(k),
          open: open.filter((t) => t.role === k).length,
          mine: mine.filter((t) => t.role === k).length,
        };
      }
      out.slots = { max: MAX_ACTIVE_PER_USER, claimed: mine.filter((t) => t.status === "claimed").length, submitted: mine.filter((t) => t.status === "submitted").length };
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  router.get("/tasks", needMember, async (req, res) => {
    const role = String(req.query.role || "");
    if (!ROLES[role]) return res.status(400).json({ error: "نقش نامعتبر است." });
    if (!req.member.roles.includes(role)) return res.status(403).json({ error: "این نقش برای شما فعال نیست." });
    try {
      const rows = await sb(`team_tasks?status=eq.open&role=eq.${role}&order=created_at.asc&limit=50&select=*`);
      res.json(rows.map((t) => pubWorker(t, false)));
    } catch (e) { fail(res, e); }
  });

  router.get("/my-tasks", needMember, async (req, res) => {
    try {
      const rows = await sb(`team_tasks?assignee=eq.${req.user.id}&order=created_at.desc&limit=60&select=*`);
      res.json(rows.map((t) => pubWorker(t, true)));
    } catch (e) { fail(res, e); }
  });

  // تیکت‌های ادمین برای خود کارمند (فقط برچسب عمومی کار، نه عنوان داخلی)
  router.get("/tickets", needMember, async (req, res) => {
    try {
      const rows = await sb(`team_tickets?user_id=eq.${req.user.id}&order=created_at.desc&limit=30&select=*`);
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries((await sb(`team_tasks?id=in.(${ids.join(",")})&select=id,label`)).map((t) => [t.id, t.label])) : {};
      res.json(rows.map((r) => ({ id: r.id, message: r.message, level: r.level, created_at: r.created_at, read_at: r.read_at, label: r.task_id ? lab[r.task_id] || null : null })));
    } catch (e) { fail(res, e); }
  });
  router.post("/tickets/:id/read", needMember, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      await patch(`team_tickets?id=eq.${req.params.id}&user_id=eq.${req.user.id}&read_at=is.null`, { read_at: new Date().toISOString() });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- برداشت (درخواست کارمند) ----------
  const wdBusy = new Set();
  router.get("/withdrawals", needMember, async (req, res) => {
    try {
      const rows = await sb(`team_withdrawals?user_id=eq.${req.user.id}&order=created_at.desc&limit=20&select=id,tokens,toman_per_token,status,admin_note,created_at,decided_at`);
      res.json(rows.map((r) => ({ id: r.id, toman: r.tokens * r.toman_per_token, status: r.status, admin_note: r.admin_note, created_at: r.created_at, decided_at: r.decided_at })));
    } catch (e) { fail(res, e); }
  });
  router.post("/withdraw", needMember, async (req, res) => {
    const uid = req.user.id, b = req.body || {};
    const account = latinDigits(b.account).replace(/[\s-]/g, "").toUpperCase();
    if (!/^\d{16}$/.test(account) && !/^IR\d{24}$/.test(account)) return res.status(400).json({ error: "شماره کارت (۱۶ رقم) یا شماره شبا (IR و ۲۴ رقم) معتبر وارد کن." });
    if (wdBusy.has(uid)) return res.status(429).json({ error: "درخواست قبلی هنوز در حال انجام است." });
    wdBusy.add(uid);
    try {
      const avail = (await balanceOf(uid)) - (await pendingTokens(uid));
      const want = Number(latinDigits(b.amount_toman));
      const tokens = want > 0 ? Math.floor(want / TOMAN_PER_TOKEN) : avail; // بدون مبلغ = کل موجودیِ قابل برداشت
      if (avail < MIN_WITHDRAW_TOKENS) return res.status(400).json({ error: `موجودی قابل برداشتت هنوز به حداقل برداشت (${fmt(toman(MIN_WITHDRAW_TOKENS))} تومان) نرسیده.` });
      if (tokens < MIN_WITHDRAW_TOKENS) return res.status(400).json({ error: `حداقل مبلغ برداشت ${fmt(toman(MIN_WITHDRAW_TOKENS))} تومان است.` });
      if (tokens > avail) return res.status(400).json({ error: "مبلغ از موجودی قابل برداشتت بیشتره." });
      try {
        await sb("team_withdrawals", { method: "POST", body: JSON.stringify([{ user_id: uid, tokens, toman_per_token: TOMAN_PER_TOKEN, account }]) });
      } catch (e) {
        if (/23505|duplicate/i.test(e.message)) return res.status(409).json({ error: "یک درخواست برداشتِ در حال بررسی داری؛ تا نتیجه‌اش مشخص نشه درخواست جدید نمی‌تونی بدی." });
        throw e;
      }
      res.json({ ok: true, toman: toman(tokens) });
    } catch (e) { fail(res, e); } finally { wdBusy.delete(uid); }
  });

  // ---------- تیکت کارمند به ادمین ----------
  router.get("/support", needMember, async (req, res) => {
    try {
      const rows = await sb(`team_support?user_id=eq.${req.user.id}&order=created_at.desc&limit=30&select=*`);
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries((await sb(`team_tasks?id=in.(${ids.join(",")})&select=id,label`)).map((t) => [t.id, t.label])) : {};
      res.json(rows.map((r) => ({ id: r.id, message: r.message, reply: r.reply, status: r.status, created_at: r.created_at, replied_at: r.replied_at, label: r.task_id ? lab[r.task_id] || null : null, unread: !!r.reply && !r.user_read_at })));
    } catch (e) { fail(res, e); }
  });
  router.post("/support", needMember, async (req, res) => {
    const b = req.body || {}, uid = req.user.id;
    const message = String(b.message || "").trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: "متن تیکت را بنویس." });
    try {
      let taskId = null;
      if (b.task_id) {
        if (!UUID_RE.test(String(b.task_id))) return res.status(400).json({ error: "شناسه‌ی کار نامعتبر است." });
        const t = (await sb(`team_tasks?id=eq.${b.task_id}&assignee=eq.${uid}&select=id`))[0];
        if (!t) return res.status(404).json({ error: "این کار برای تو نیست." });
        taskId = t.id;
      }
      const open = await sb(`team_support?user_id=eq.${uid}&status=eq.open&select=id`);
      if (open.length >= SUPPORT_MAX_OPEN) return res.status(429).json({ error: `${SUPPORT_MAX_OPEN} تیکت بی‌پاسخ داری؛ صبر کن ادمین جواب بده.` });
      await sb("team_support", { method: "POST", body: JSON.stringify([{ user_id: uid, task_id: taskId, message }]) });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  router.post("/support/:id/read", needMember, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      await patch(`team_support?id=eq.${req.params.id}&user_id=eq.${req.user.id}&reply=not.is.null&user_read_at=is.null`, { user_read_at: new Date().toISOString() });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.post("/tasks/:id/claim", needMember, async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=role`))[0];
      if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
      if (!req.member.roles.includes(t.role)) return res.status(403).json({ error: "این نقش برای شما فعال نیست." });
      const uid = req.user.id;
      if (claimBusy.has(uid)) return res.status(429).json({ error: "درخواست قبلی هنوز در حال انجام است." });
      claimBusy.add(uid); res.once("close", () => claimBusy.delete(uid));
      const active = await sb(`team_tasks?assignee=eq.${uid}&status=in.(claimed,submitted)&select=id,status`);
      if (active.filter((a) => a.status === "claimed").length >= MAX_IN_PROGRESS) {
        return res.status(429).json({ error: "همزمان فقط یک کار در حال انجام داری. اول همون رو تحویل بده، بعد می‌تونی کار بعدی رو برداری." });
      }
      if (active.length >= MAX_ACTIVE_PER_USER) {
        return res.status(429).json({ error: `${MAX_ACTIVE_PER_USER} کارت در جریانه (در انتظار تایید). بعد از تایید یکی‌شون می‌تونی کار جدید برداری.` });
      }
      // برداشتن اتمیک: فقط اگه هنوز open باشه
      const rows = await patch(`team_tasks?id=eq.${id}&status=eq.open`, {
        status: "claimed", assignee: req.user.id, claimed_at: new Date().toISOString(), first_claimed_at: new Date().toISOString(), first_submitted_at: null, quality: null, admin_note: null,
      });
      if (!rows.length) return res.status(409).json({ error: "این کار همین الان توسط شخص دیگری برداشته شد." });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // تحویل کار (zip خام در بدنه‌ی PUT)
  router.put("/tasks/:id/upload", needMember, async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&assignee=eq.${req.user.id}&status=eq.claimed&select=role,result_file,first_claimed_at,first_submitted_at`))[0];
      if (!t) return res.status(404).json({ error: "این کار در حالت تحویل نیست." });
      // بعد از ۳۶ ساعت (برای اولین تحویل) کار دیگر مال او نیست: جارو آزادش می‌کند و جریمه ثبت می‌شود
      if (!t.first_submitted_at && t.first_claimed_at && Date.now() - new Date(t.first_claimed_at) > (DEADLINE_H + GRACE_H) * 36e5) {
        await sweep();
        return res.status(410).json({ error: `مهلت ${DEADLINE_H + GRACE_H} ساعته‌ی این کار تمام شده؛ کار آزاد و جریمه ثبت شد.` });
      }
      const name = await saveZip(req, ROLE_RULES[t.role].result, id, t.role, "result");
      const rows = await patch(`team_tasks?id=eq.${id}&assignee=eq.${req.user.id}&status=eq.claimed`, {
        status: "submitted", result_file: name, submitted_at: new Date().toISOString(), first_submitted_at: t.first_submitted_at || new Date().toISOString(),
      });
      if (!rows.length) { await rmFile(name); return res.status(409).json({ error: "وضعیت کار تغییر کرده است." }); }
      await rmFile(t.result_file);
      let auto = false;
      if (req.member.auto_approve) {
        try { auto = !!(await approveTask(id)).ok; } catch (e) { console.error("[team] auto-approve:", e.message); }
      }
      res.json({ ok: true, auto });
    } catch (e) { upErr(res, e); }
  });

  router.get("/tasks/:id/download", needMember, async (req, res) => {
    const id = req.params.id;
    const kind = ["result", "extra"].includes(req.query.kind) ? req.query.kind : "source";
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=*`))[0];
      if (!t || (t.assignee !== req.user.id)) return res.status(403).json({ error: "دسترسی ندارید." });
      await sendFile(res, t, kind);
    } catch (e) { fail(res, e); }
  });

  // ================== ادمین ==================
  const admin = express.Router();
  admin.use(needAdmin);

  admin.get("/overview", async (req, res) => {
    try {
      const [tasks, members, ledger, chapters, manhwas, wdPend, supOpen] = await Promise.all([
        sb("team_tasks?order=created_at.desc&limit=1000&select=*"),
        sb("team_members?select=*&order=created_at.desc"),
        sb("team_ledger?select=user_id,tokens,kind"),
        sb("team_chapters?order=created_at.desc&limit=300&select=*"),
        sb("team_manhwas?order=created_at.desc&select=id,name,image_file"),
        sb("team_withdrawals?status=eq.pending&select=tokens").catch(() => []), // اگر SQL هنوز اجرا نشده، پنل خراب نشود
        sb("team_support?status=eq.open&select=id").catch(() => []),
      ]);
      const bal = {};
      let rewarded = 0, cashedOut = 0;
      ledger.forEach((l) => {
        bal[l.user_id] = (bal[l.user_id] || 0) + l.tokens;
        if (l.kind === "reward") rewarded += l.tokens;
        if (l.kind === "payout") cashedOut -= l.tokens;
      });
      const name = Object.fromEntries(members.map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      const done = {};
      tasks.forEach((t) => { if (t.status === "approved" && t.assignee) done[t.assignee] = (done[t.assignee] || 0) + 1; });
      res.json({
        tomanPerToken: TOMAN_PER_TOKEN, rules: ROLE_RULES, roles: ROLES, chapters,
        pay: { deadlineH: DEADLINE_H, graceH: GRACE_H, fastH: FAST_H, roles: PAY, baseRange: BASE_RANGE },
        manhwas: manhwas.map((m) => ({ id: m.id, name: m.name, has_image: !!m.image_file })), bannerBusy: [...bannerBusy], bannerReady: banner.configured(),
        auto: { claimHours: CLAIM_HOURS, autoApproveHours: AUTO_APPROVE_HOURS },
        stats: { rewarded, cashedOut, owed: Object.values(bal).reduce((a, b) => a + b, 0) },
        pending: { withdrawals: wdPend.length, withdrawTokens: sum(wdPend), support: supOpen.length },
        minWithdrawTokens: MIN_WITHDRAW_TOKENS,
        tasks: tasks.map((t) => ({ ...pubAdmin(t), worker: t.assignee ? name[t.assignee] || t.assignee.slice(0, 8) : null })),
        members: members.map((m) => ({ user_id: m.user_id, name: m.display_name, roles: m.roles, active: m.active, balance: bal[m.user_id] || 0, done: done[m.user_id] || 0, auto_approve: !!m.auto_approve, banner_name: m.banner_name || "" })),
      });
    } catch (e) { fail(res, e); }
  });

  function cleanTask(role, b) {
    const rule = ROLE_RULES[role];
    const title = String(b.title || "").trim().slice(0, 200);
    const label = String(b.label || "").trim().slice(0, 60);
    const description = String(b.description || "").trim().slice(0, 2000);
    const address = String(b.address || "").trim().slice(0, 500);
    const tokens = parseInt(b.reward_tokens, 10);
    if (!title || !label) return { err: "عنوان داخلی و برچسب عمومی (مثلاً CH1) را وارد کن." };
    if (!(tokens > 0 && tokens <= 100000)) return { err: "تعداد توکن نامعتبر است." };
    const rg = BASE_RANGE[role];
    if (rg && (tokens < rg[0] || tokens > rg[1])) return { err: rg[0] === rg[1] ? `حقوق ${ROLES[role]} ثابت و ${rg[0]} توکن است.` : `حقوق ${ROLES[role]} باید بین ${rg[0]} تا ${rg[1]} توکن باشد.` };
    if (rule.text && !description) return { err: "برای مترجم، لینک/پیام/نام کار را بنویس." };
    if (rule.address && !address) return { err: "برای تغییر دهنده فونت، آدرس لازم است." };
    return { v: { title, label, description, address: rule.address ? address : null, reward_tokens: tokens } };
  }

  admin.post("/tasks", async (req, res) => {
    const role = (req.body || {}).role;
    if (!ROLES[role]) return res.status(400).json({ error: "نقش نامعتبر است." });
    const c = cleanTask(role, req.body);
    if (c.err) return res.status(400).json({ error: c.err });
    try {
      // نقش‌هایی که فایل ورودی می‌خواهند تا آپلود فایل «پیش‌نویس» می‌مانند و برای کارمندها دیده نمی‌شوند
      const status = ROLE_RULES[role].source ? "draft" : "open";
      const rows = await sb("team_tasks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ role, status, ...c.v }]) });
      res.json({ ok: true, id: rows[0].id, status });
    } catch (e) { fail(res, e); }
  });

  admin.patch("/tasks/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=role,status`))[0];
      if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
      if (t.status === "approved") return res.status(409).json({ error: "کار تاییدشده قابل ویرایش نیست." });
      const c = cleanTask(t.role, req.body || {});
      if (c.err) return res.status(400).json({ error: c.err });
      await patch(`team_tasks?id=eq.${id}`, c.v);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.put("/tasks/:id/source", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=role,status,source_file`))[0];
      if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
      if (!ROLE_RULES[t.role].source) return res.status(400).json({ error: "این نقش فایل ورودی ندارد." });
      const name = await saveZip(req, "zip", id, t.role, "source");
      await patch(`team_tasks?id=eq.${id}`, { source_file: name, status: t.status === "draft" ? "open" : t.status });
      await rmFile(t.source_file);
      res.json({ ok: true });
    } catch (e) { upErr(res, e); }
  });

  admin.get("/tasks/:id/download", async (req, res) => {
    const id = req.params.id;
    const kind = ["result", "extra"].includes(req.query.kind) ? req.query.kind : "source";
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=*`))[0];
      await sendFile(res, t, kind);
    } catch (e) { fail(res, e); }
  });

  // ---------- پیش‌نمایش برای ادمین: فهرست تصاویر zip یا متن docx ----------
  admin.get("/tasks/:id/preview", async (req, res) => {
    const id = req.params.id, kind = kindOf(req.query.kind);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=*`))[0];
      const f = t && t[kind + "_file"];
      if (!f) return res.status(404).json({ error: "فایلی وجود ندارد." });
      const p = await localCopy(f);
      if (/\.docx$/i.test(f)) {
        const r = await require("mammoth").convertToHtml({ path: p });
        return res.json({ type: "docx", html: String(r.value).slice(0, 2_000_000) });
      }
      res.json({ type: "zip", ...(await listZip(p)) });
    } catch (e) { fail(res, e); }
  });
  // یک تصویر از داخل zip (فقط فرمت‌های عکس؛ svg عمداً مجاز نیست)
  admin.get("/tasks/:id/preview/entry", async (req, res) => {
    const id = req.params.id, kind = kindOf(req.query.kind), want = parseInt(req.query.i, 10);
    if (!UUID_RE.test(id) || !(want >= 0)) return res.status(400).json({ error: "درخواست نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&select=*`))[0];
      const f = t && t[kind + "_file"];
      if (!f) return res.status(404).json({ error: "فایلی وجود ندارد." });
      const p = await localCopy(f);
      yauzl.open(p, { lazyEntries: true }, (err, z) => {
        if (err) return fail(res, err);
        let idx = -1, found = false;
        z.on("entry", (en) => {
          idx++;
          if (idx !== want) return z.readEntry();
          found = true;
          const ext = en.fileName.split(".").pop().toLowerCase();
          if (/\/$/.test(en.fileName) || !IMG_MIME[ext] || en.uncompressedSize > MAX_ENTRY) { z.close(); return res.status(400).json({ error: "این فایل قابل پیش‌نمایش نیست." }); }
          z.openReadStream(en, (e, rs) => {
            if (e) { z.close(); return fail(res, e); }
            res.set({ "Content-Type": IMG_MIME[ext], "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" });
            rs.on("end", () => z.close());
            rs.on("error", () => { z.close(); res.destroy(); });
            rs.pipe(res);
          });
        });
        z.on("end", () => { if (!found && !res.headersSent) res.status(404).json({ error: "تصویر پیدا نشد." }); });
        z.on("error", (e) => { if (!res.headersSent) fail(res, e); });
        z.readEntry();
      });
    } catch (e) { fail(res, e); }
  });

  // پس گرفتن کار از کارمند (کند/غایب) و برگرداندن به لیست آزاد
  admin.post("/tasks/:id/release", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = (await sb(`team_tasks?id=eq.${id}&status=in.(claimed,submitted)&select=result_file`))[0];
      if (!t) return res.status(409).json({ error: "این کار در دست کارمند نیست." });
      const rows = await patch(`team_tasks?id=eq.${id}&status=in.(claimed,submitted)`, {
        status: "open", assignee: null, claimed_at: null, submitted_at: null, first_claimed_at: null, first_submitted_at: null, quality: null, result_file: null, admin_note: null,
      });
      if (rows.length) await rmFile(t.result_file);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.delete("/tasks/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const rows = await sb(`team_tasks?id=eq.${id}&status=in.(draft,open)`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (!rows.length) return res.status(409).json({ error: "فقط کار پیش‌نویس یا آزاد قابل حذف است. برای بقیه اول «پس گرفتن» را بزن." });
      await rmFile(rows[0].source_file);
      await rmFile(rows[0].extra_file);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ثبت یک چپتر = ساخت خودکار کار مترجم + کار کلینر (تایپیست بعداً خودکار ساخته می‌شود)
  admin.post("/chapters", async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim().slice(0, 200), label = String(b.label || "").trim().slice(0, 60);
    const note = String(b.translator_note || "").trim().slice(0, 2000);
    const tr = parseInt(b.translator_reward, 10), cl = parseInt(b.cleaner_reward, 10) || 0, ty = parseInt(b.typist_reward, 10);
    if (!title || !label) return res.status(400).json({ error: "عنوان داخلی و برچسب (مثلاً CH1) لازم است." });
    if (!note) return res.status(400).json({ error: "لینک/پیام/نام کار برای مترجم لازم است." });
    if (!(tr > 0 && ty > 0 && cl >= 0) || Math.max(tr, cl, ty) > 100000) return res.status(400).json({ error: "توکن‌های هر مرحله را درست وارد کن (کلین می‌تواند ۰ باشد)." });
    for (const [r, v] of [["translator", tr], ["typist", ty]]) { const g = BASE_RANGE[r]; if (v < g[0] || v > g[1]) return res.status(400).json({ error: g[0] === g[1] ? `حقوق ${ROLES[r]} ثابت و ${g[0]} توکن است.` : `حقوق ${ROLES[r]} باید بین ${g[0]} تا ${g[1]} توکن باشد.` }); }
    try {
      const ch = (await sb("team_chapters", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ title, label, typist_reward: ty, manhwa_id: UUID_RE.test(String(b.manhwa_id || "")) ? b.manhwa_id : null }]) }))[0];
      const rows = [{ role: "translator", chapter_id: ch.id, title: `${title} — ترجمه`, label, description: note, reward_tokens: tr, status: "open" }];
      if (cl > 0) rows.push({ role: "cleaner", chapter_id: ch.id, title: `${title} — کلین`, label, reward_tokens: cl, status: "draft" });
      const made = await sb("team_tasks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(rows) });
      const c = made.find((t) => t.role === "cleaner");
      res.json({ ok: true, cleaner_task_id: c ? c.id : null });
    } catch (e) { fail(res, e); }
  });

  admin.delete("/chapters/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const ts = await sb(`team_tasks?chapter_id=eq.${id}&select=id,status,source_file,extra_file`);
      if (ts.some((t) => !["draft", "open"].includes(t.status))) return res.status(409).json({ error: "این چپتر کار در جریان یا تمام‌شده دارد؛ حذف نمی‌شود." });
      const chb = (await sb(`team_chapters?id=eq.${id}&select=banner_file`))[0];
      await sb(`team_tasks?chapter_id=eq.${id}`, { method: "DELETE" });
      await sb(`team_chapters?id=eq.${id}`, { method: "DELETE" });
      if (chb && chb.banner_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chb.banner_file })).catch(() => {});
      for (const t of ts) { await rmFile(t.source_file); await rmFile(t.extra_file); }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.get("/ledger", async (req, res) => {
    const uid = req.query.user_id;
    try {
      res.json(await sb(`team_ledger?order=id.desc&limit=200${UUID_RE.test(String(uid)) ? `&user_id=eq.${uid}` : ""}&select=*`));
    } catch (e) { fail(res, e); }
  });

  admin.post("/adjust", async (req, res) => {
    const { user_id } = req.body || {};
    const tokens = parseInt((req.body || {}).tokens, 10);
    const note = String((req.body || {}).note || "").trim().slice(0, 200);
    if (!UUID_RE.test(String(user_id)) || !tokens || Math.abs(tokens) > 100000 || !note) return res.status(400).json({ error: "عضو، تعداد توکن (مثبت/منفی) و دلیل لازم است." });
    try {
      if (tokens < 0 && (await balanceOf(user_id)) + tokens < 0) return res.status(400).json({ error: "موجودی کافی نیست." });
      await sb("team_ledger", { method: "POST", body: JSON.stringify([{ user_id, tokens, kind: "adjust", note }]) });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.patch("/members/:uid", async (req, res) => {
    if (!UUID_RE.test(req.params.uid)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const b = req.body || {}, upd = {};
    if (Array.isArray(b.roles)) { upd.roles = b.roles.filter((r) => ROLES[r]); if (!upd.roles.length) return res.status(400).json({ error: "حداقل یک نقش لازم است." }); }
    if (typeof b.active === "boolean") upd.active = b.active;
    if (typeof b.auto_approve === "boolean") upd.auto_approve = b.auto_approve;
    if (typeof b.name === "string") upd.display_name = b.name.trim().slice(0, 80);
    if (typeof b.banner_name === "string") upd.banner_name = b.banner_name.trim().slice(0, 80) || null;
    try { await patch(`team_members?user_id=eq.${req.params.uid}`, upd); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  admin.post("/tasks/:id/approve", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const out = await approveTask(req.params.id, (req.body || {}).quality === "high" ? "high" : "normal");
      if (!out.ok) return res.status(409).json({ error: "این کار در انتظار تایید نیست (شاید قبلاً تایید شده)." });
      res.json({ ok: true, tokens: out.tokens, adjust: out.adjust || 0 });
    } catch (e) { fail(res, e); }
  });

  admin.post("/tasks/:id/reject", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const note = String((req.body || {}).note || "").trim().slice(0, 500);
    if (!note) return res.status(400).json({ error: "دلیل نیاز به اصلاح را بنویس." });
    try {
      const penalty = !!(req.body || {}).penalty; // کیفیت بد: کسر توکن + برگشت برای اصلاح
      const rows = await patch(`team_tasks?id=eq.${req.params.id}&status=eq.submitted`, { status: "claimed", admin_note: note, claimed_at: new Date().toISOString(), ...(penalty ? { quality: "bad" } : {}) });
      if (!rows.length) return res.status(409).json({ error: "این کار در انتظار تایید نیست." });
      const tk = rows[0], cut = penalty ? (PAY[tk.role] || FLAT).bad : 0;
      if (penalty && tk.assignee) {
        await ledgerAdd([{ user_id: tk.assignee, tokens: -cut, note: `جریمه‌ی کیفیت بد — ${tk.label}` }]);
        await notify(tk.assignee, tk.id, `کیفیت کار ${tk.label} پایین بود؛ ${fmt(toman(cut))} تومان کسر شد و برای اصلاح برگشت: ${note}`, "warning");
      }
      res.json({ ok: true, penalty: cut });
    } catch (e) { fail(res, e); }
  });

  // ---------- بنر چپتر ----------
  admin.post("/chapters/:id/banner", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      if (!banner.configured()) return res.status(400).json({ error: "تنظیمات Adobe (ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET) روی سرور نیست." });
      const ch = (await sb(`team_chapters?id=eq.${req.params.id}&select=id`))[0];
      if (!ch) return res.status(404).json({ error: "چپتر پیدا نشد." });
      if (bannerBusy.has(ch.id)) return res.status(409).json({ error: "بنر همین الان در حال ساخت است." });
      makeBanner(ch.id).catch(() => {});
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  admin.get("/chapters/:id/banner", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const ch = (await sb(`team_chapters?id=eq.${req.params.id}&select=label,banner_file`))[0];
      if (!ch || !ch.banner_file) return res.status(404).json({ error: "بنر هنوز ساخته نشده." });
      await sendS3(res, ch.banner_file, "image/png", req.query.dl ? `${safeName(ch.label)}-banner.png` : null);
    } catch (e) { fail(res, e); }
  });

  // ---------- مانهواها (تصویر زیر بنر) ----------
  admin.post("/manhwas", async (req, res) => {
    const name = String((req.body || {}).name || "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "نام مانهوا را بنویس." });
    try { await sb("team_manhwas", { method: "POST", body: JSON.stringify([{ name }]) }); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });
  admin.put("/manhwas/:id/image", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const m = (await sb(`team_manhwas?id=eq.${id}&select=image_file`))[0];
      if (!m) return res.status(404).json({ error: "مانهوا پیدا نشد." });
      const key = await saveImage(req, id);
      await patch(`team_manhwas?id=eq.${id}`, { image_file: key });
      if (m.image_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: m.image_file })).catch(() => {});
      res.json({ ok: true });
    } catch (e) { upErr(res, e); }
  });
  admin.get("/manhwas/:id/image", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const m = (await sb(`team_manhwas?id=eq.${req.params.id}&select=image_file`))[0];
      if (!m || !m.image_file) return res.status(404).json({ error: "تصویری ثبت نشده." });
      await sendS3(res, m.image_file, "image/" + (m.image_file.split(".").pop() === "jpg" ? "jpeg" : m.image_file.split(".").pop()), null);
    } catch (e) { fail(res, e); }
  });
  admin.delete("/manhwas/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      if ((await sb(`team_chapters?manhwa_id=eq.${id}&select=id&limit=1`)).length) return res.status(409).json({ error: "چپترهایی به این مانهوا وصل‌اند؛ حذف نمی‌شود." });
      const rows = await sb(`team_manhwas?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (rows[0] && rows[0].image_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rows[0].image_file })).catch(() => {});
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- تیکت: ادمین به کارمند پیام/هشدار/تشویق می‌فرستد ----------
  admin.post("/tickets", async (req, res) => {
    const b = req.body || {};
    const message = String(b.message || "").trim().slice(0, 1000);
    const level = ["warning", "info", "praise"].includes(b.level) ? b.level : "warning";
    if (!message) return res.status(400).json({ error: "متن تیکت را بنویس." });
    try {
      let uid = b.user_id, taskId = null;
      if (b.task_id) {
        if (!UUID_RE.test(String(b.task_id))) return res.status(400).json({ error: "شناسه‌ی کار نامعتبر است." });
        const t = (await sb(`team_tasks?id=eq.${b.task_id}&select=id,assignee`))[0];
        if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
        taskId = t.id; uid = t.assignee || uid; // گیرنده = کسی که کار دست اوست
      }
      if (!UUID_RE.test(String(uid))) return res.status(400).json({ error: "گیرنده‌ی تیکت مشخص نیست." });
      await sb("team_tickets", { method: "POST", body: JSON.stringify([{ user_id: uid, task_id: taskId, message, level }]) });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  admin.get("/tickets", async (req, res) => {
    try {
      const rows = await sb("team_tickets?order=created_at.desc&limit=100&select=*");
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries((await sb(`team_tasks?id=in.(${ids.join(",")})&select=id,label`)).map((t) => [t.id, t.label])) : {};
      const mem = Object.fromEntries((await sb("team_members?select=user_id,display_name")).map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      res.json(rows.map((r) => ({ ...r, name: mem[r.user_id] || r.user_id.slice(0, 8), label: r.task_id ? lab[r.task_id] || null : null })));
    } catch (e) { fail(res, e); }
  });
  admin.delete("/tickets/:id", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try { await sb(`team_tickets?id=eq.${req.params.id}`, { method: "DELETE" }); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  // ---------- برداشت‌ها (ادمین) ----------
  admin.get("/withdrawals", async (req, res) => {
    try {
      const rows = await sb("team_withdrawals?order=created_at.desc&limit=100&select=*");
      const mem = Object.fromEntries((await sb("team_members?select=user_id,display_name")).map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      res.json(rows.map((r) => ({ ...r, name: mem[r.user_id] || r.user_id.slice(0, 8), toman: r.tokens * r.toman_per_token })));
    } catch (e) { fail(res, e); }
  });
  // «پرداخت شد»: بعد از واریز واقعی پول؛ توکن از حساب کم می‌شود (kind=payout مثل تسویه‌ی دستی)
  admin.post("/withdrawals/:id/pay", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const note = String((req.body || {}).note || "").trim().slice(0, 300) || null;
    try {
      const w = (await sb(`team_withdrawals?id=eq.${req.params.id}&select=*`))[0];
      if (!w || w.status !== "pending") return res.status(409).json({ error: "این درخواست در انتظار بررسی نیست." });
      if ((await balanceOf(w.user_id)) < w.tokens) return res.status(400).json({ error: "موجودی عضو از مبلغ درخواست کمتر شده؛ درخواست را رد کن یا موجودی را اصلاح کن." });
      const rows = await patch(`team_withdrawals?id=eq.${w.id}&status=eq.pending`, { status: "paid", admin_note: note, decided_at: new Date().toISOString() });
      if (!rows.length) return res.status(409).json({ error: "این درخواست همین الان بررسی شد." });
      const amount = w.tokens * w.toman_per_token;
      try {
        await sb("team_ledger", { method: "POST", body: JSON.stringify([{ user_id: w.user_id, tokens: -w.tokens, kind: "payout", note: `برداشت ${amount} تومان` }]) });
      } catch (e) { await patch(`team_withdrawals?id=eq.${w.id}`, { status: "pending", decided_at: null }).catch(() => {}); throw e; }
      await notify(w.user_id, null, `برداشت ${fmt(amount)} تومان انجام شد.${note ? " " + note : ""}`, "info");
      res.json({ ok: true, toman: amount });
    } catch (e) { fail(res, e); }
  });
  admin.post("/withdrawals/:id/reject", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const note = String((req.body || {}).note || "").trim().slice(0, 300);
    if (!note) return res.status(400).json({ error: "دلیل رد را بنویس." });
    try {
      const rows = await patch(`team_withdrawals?id=eq.${req.params.id}&status=eq.pending`, { status: "rejected", admin_note: note, decided_at: new Date().toISOString() });
      if (!rows.length) return res.status(409).json({ error: "این درخواست در انتظار بررسی نیست." });
      await notify(rows[0].user_id, null, `درخواست برداشت ${fmt(rows[0].tokens * rows[0].toman_per_token)} تومان رد شد: ${note}`, "warning");
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- تیکت‌های کارمندها (ادمین) ----------
  admin.get("/support", async (req, res) => {
    try {
      const rows = await sb("team_support?order=created_at.desc&limit=100&select=*");
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries((await sb(`team_tasks?id=in.(${ids.join(",")})&select=id,label,title`)).map((t) => [t.id, `${t.label} — ${t.title}`])) : {};
      const mem = Object.fromEntries((await sb("team_members?select=user_id,display_name")).map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      res.json(rows.map((r) => ({ ...r, name: mem[r.user_id] || r.user_id.slice(0, 8), task: r.task_id ? lab[r.task_id] || null : null })));
    } catch (e) { fail(res, e); }
  });
  admin.post("/support/:id/reply", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const message = String((req.body || {}).message || "").trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: "متن پاسخ را بنویس." });
    try {
      const rows = await patch(`team_support?id=eq.${req.params.id}`, { reply: message, status: "answered", replied_at: new Date().toISOString(), user_read_at: null });
      if (!rows.length) return res.status(404).json({ error: "تیکت پیدا نشد." });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  admin.delete("/support/:id", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try { await sb(`team_support?id=eq.${req.params.id}`, { method: "DELETE" }); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  // افزودن/ویرایش عضو با ایمیل یا شماره موبایل
  admin.post("/members", async (req, res) => {
    const { identifier, name, roles } = req.body || {};
    const rl = Array.isArray(roles) ? roles.filter((r) => ROLES[r]) : [];
    const idf = String(identifier || "").trim();
    if (!idf || !rl.length) return res.status(400).json({ error: "ایمیل/شماره و حداقل یک نقش لازم است." });
    try {
      const isEmail = idf.includes("@");
      const phone = isEmail ? null : normalizeIranPhone(idf);
      if (!isEmail && !phone) return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/find_auth_user`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ p_phone: phone, p_email: isEmail ? idf.toLowerCase() : null }),
        signal: AbortSignal.timeout(10_000),
      });
      const user = r.ok ? (await r.json())[0] : null;
      if (!user) return res.status(404).json({ error: "کاربری با این مشخصات در سایت ثبت‌نام نکرده است." });
      await sb("team_members", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{ user_id: user.id, display_name: String(name || idf).slice(0, 80), roles: rl, active: true }]),
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.delete("/members/:uid", async (req, res) => {
    if (!UUID_RE.test(req.params.uid)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try { await patch(`team_members?user_id=eq.${req.params.uid}`, { active: false }); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  // ثبت تسویه (کسر توکن بعد از پرداخت واقعی پول به عضو)
  admin.post("/payout", async (req, res) => {
    const { user_id } = req.body || {};
    const tokens = parseInt((req.body || {}).tokens, 10);
    if (!UUID_RE.test(String(user_id)) || !(tokens > 0)) return res.status(400).json({ error: "ورودی نامعتبر است." });
    try {
      if ((await balanceOf(user_id)) < tokens) return res.status(400).json({ error: "موجودی کافی نیست." });
      await sb("team_ledger", {
        method: "POST",
        body: JSON.stringify([{ user_id, tokens: -tokens, kind: "payout", note: `تسویه ${tokens * TOMAN_PER_TOKEN} تومان` }]),
      });
      res.json({ ok: true, toman: tokens * TOMAN_PER_TOKEN });
    } catch (e) { fail(res, e); }
  });

  // جارو: آزادسازی کارهای رهاشده + (اختیاری) تایید خودکار تحویل‌های بررسی‌نشده
  async function sweep() {
    try {
      // بعد از ۳۶ ساعت بدون اولین تحویل: آزادسازی + کسر کل توکن کار از کارمند
      {
        const cut = encodeURIComponent(new Date(Date.now() - (DEADLINE_H + GRACE_H) * 36e5).toISOString());
        const over = await sb(`team_tasks?status=eq.claimed&first_submitted_at=is.null&first_claimed_at=lt.${cut}&select=id,assignee,reward_tokens,label`);
        for (const t of over) {
          const rows = await patch(`team_tasks?id=eq.${t.id}&status=eq.claimed&first_submitted_at=is.null`, { status: "open", assignee: null, claimed_at: null, first_claimed_at: null, quality: null, admin_note: null });
          if (!rows.length || !t.assignee) continue;
          await ledgerAdd([{ user_id: t.assignee, tokens: -t.reward_tokens, note: `جریمه‌ی عدم تحویل در ${DEADLINE_H + GRACE_H} ساعت (کسر کل توکن کار) — ${t.label}` }]);
          await notify(t.assignee, null, `کار ${t.label} را در ${DEADLINE_H + GRACE_H} ساعت تحویل ندادی؛ کار آزاد شد و ${fmt(toman(t.reward_tokens))} تومان کسر شد.`, "warning");
          console.log(`[team] کار ${t.label} بعد از مهلت آزاد و جریمه شد`);
        }
      }
      if (CLAIM_HOURS > 0) {
        const cut = encodeURIComponent(new Date(Date.now() - CLAIM_HOURS * 36e5).toISOString());
        const freed = await patch(`team_tasks?status=eq.claimed&claimed_at=lt.${cut}`, { status: "open", assignee: null, claimed_at: null, first_claimed_at: null, first_submitted_at: null, quality: null, admin_note: null });
        if (freed.length) console.log(`[team] ${freed.length} کار رهاشده خودکار آزاد شد`);
      }
      if (AUTO_APPROVE_HOURS > 0) {
        const cut = encodeURIComponent(new Date(Date.now() - AUTO_APPROVE_HOURS * 36e5).toISOString());
        for (const t of await sb(`team_tasks?status=eq.submitted&submitted_at=lt.${cut}&select=id`)) {
          await approveTask(t.id).catch((e) => console.error("[team] auto-approve sweep:", e.message));
        }
      }
    } catch (e) { console.error("[team] sweep:", e.message); }
  }
  // پاکسازی کپی‌های موقت (کش پیش‌نمایش و آپلودهای نیمه‌کاره) قدیمی‌تر از ۳۰ دقیقه
  function cleanTmp() {
    fs.readdir(TMP, (e, names) => {
      if (e) return;
      for (const n of names) {
        const f = path.join(TMP, n);
        fs.stat(f, (er, st) => { if (!er && Date.now() - st.mtimeMs > 30 * 60 * 1000) fs.unlink(f, () => {}); });
      }
    });
  }
  setInterval(cleanTmp, 10 * 60 * 1000).unref();
  cleanTmp();
  setInterval(sweep, 5 * 60 * 1000).unref();
  setTimeout(sweep, 60 * 1000).unref();

  router.use("/admin", admin);
  return router;
};

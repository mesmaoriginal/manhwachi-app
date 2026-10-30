// team/teamRouter.js — سیستم کار تیمی (تایپیست / تغییر فونت / مترجم / کلینر) + توکن
// قیمت هر توکن فقط سمت سرور (TEAM_TOMAN_PER_TOKEN) تعیین می‌شود؛ کارمند در همه‌جا توکن می‌بیند و تومان فقط در تب برداشت. فایل‌ها (zip/docx) در باکت S3 (PARSPACK_BUCKET) زیر پوشه‌ی TEAM_S3_PREFIX (پیش‌فرض team-files) ذخیره می‌شن.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeIranPhone } = require("../lib/phone");
const os = require("os");
const { pipeline } = require("stream/promises");
const yauzl = require("yauzl");
const { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const banner = require("../lib/teamBanner");
const db = require("../lib/teamDb"); // دسترسی مستقیم به SQLite؛ هیچ ارتباطی با Supabase یا /rest/v1 ندارد
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
const PART_SIZE = 10 * 1024 * 1024; // اندازه‌ی هر تکه در آپلود تکه‌تکه (حداقل S3 = ۵ مگابایت)
const MAX_PARTS = Math.ceil(MAX_ZIP / PART_SIZE) + 1;
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
// «اسم روی بنر» یک عضو: اسم خودش؛ اگر نداشت نام نمایشی، به‌شرطی که ایمیل/شماره نباشد (هویت کسی روی بنر نیفتد)
const cleanBannerName = (x) => String(x || "").replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
const looksLikeId = (x) => /@/.test(x) || (x.replace(/\D/g, "").length >= 7 && x.replace(/\D/g, "").length >= x.length * 0.6);
const bannerNameOf = (m) => { const own = cleanBannerName(m && m.banner_name); if (own) return own; const dn = cleanBannerName(m && m.display_name); return dn && !looksLikeId(dn) ? dn : ""; };
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

// فقط getAuthContext لازم است (تبدیل توکن ورود سایت به کاربر). پارامترهای قدیمی supabaseUrl/adminHeaders دیگر استفاده نمی‌شوند و نادیده گرفته می‌شوند.
module.exports = function ({ getAuthContext }) {
  const router = express.Router();
  const adminIds = (process.env.TEAM_ADMIN_IDS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // 🔒 فقط با شناسه‌ی کاربر (UUID). تطبیق با ایمیل حذف شد تا ایمیل تأییدنشده/مشابه، ادمین حساب نشود.
  const isAdminUser = (u) => adminIds.includes(String(u.id).toLowerCase());
  try { db.ready(); } catch (e) { console.warn("[team] آماده‌سازی دیتابیس به تعویق افتاد (اولین درخواست دوباره تلاش می‌کند):", e.message); }

  const sum = (rows) => (rows || []).reduce((a, r) => a + r.tokens, 0);
  const balanceOf = async (uid) => db.get("SELECT COALESCE(SUM(tokens),0) AS s FROM team_ledger WHERE user_id=?", [uid]).s;
  const pendingTokens = async (uid) => db.get("SELECT COALESCE(SUM(tokens),0) AS s FROM team_withdrawals WHERE user_id=? AND status='pending'", [uid]).s;
  // قوانین به تومان (برای نمایش به کارمند؛ نرخ توکن در آن نیست)
  const workerRules = () => ({
    deadlineH: DEADLINE_H, graceH: GRACE_H, fastH: FAST_H,
    base: { flat: BASE_RANGE.typist[0], translator: [BASE_RANGE.translator[0], BASE_RANGE.translator[1]] },
    qualityFlat: FLAT.quality, speedFlat: FLAT.speed, bad: FLAT.bad, late: FLAT.late,
    multQuality: Math.round((1 + MULT.quality) * 100) / 100, multSpeed: Math.round((1 + MULT.speed) * 100) / 100,
  });
  const dueAt = (t, h) => (t.status === "claimed" && t.first_claimed_at && !t.first_submitted_at ? new Date(new Date(t.first_claimed_at).getTime() + h * 36e5).toISOString() : null);
  // نمای کارمند: فقط برچسب عمومی (CH1). عنوان داخلی هرگز نمی‌رود؛ توضیح/آدرس فقط بعد از برداشتن کار.
  const pubWorker = (t, mine) => ({
    id: t.id, role: t.role, label: t.label || "کار", reward_tokens: t.reward_tokens, status: t.status,
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
  const ledgerAdd = async (rows) => db.tx(() => rows.forEach((r) => db.insert("team_ledger", { kind: "adjust", ...r })));
  const notify = async (user_id, task_id, message, level) => {
    try { db.insert("team_tickets", { user_id, task_id: task_id || null, message, level }); } catch (e) { console.error("[team] ticket:", e.message); }
  };
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
    const t = db.get("SELECT * FROM team_tasks WHERE id=?", [id], "team_tasks");
    if (!t || !t.assignee) return 0;
    const lines = adjustments(t, quality);
    if (lines.length) await ledgerAdd(lines.map((l) => ({ user_id: t.assignee, tokens: l.tokens, note: `${l.note} — ${t.label}` })));
    if (quality === "high" && t.quality !== "bad") db.update("team_tasks", { quality: "high" }, "id=?", [id]);
    return lines.reduce((a, l) => a + l.tokens, 0);
  }
  // وقتی ترجمه و کلین یک چپتر هر دو تایید شدند، کار تایپیست (فایل کلین + Word ترجمه) خودکار ساخته می‌شود
  async function advanceChapter(chapterId) {
    if (!chapterId) return;
    const ch = db.get("SELECT * FROM team_chapters WHERE id=?", [chapterId]);
    if (!ch) return;
    const ts = db.all("SELECT * FROM team_tasks WHERE chapter_id=?", [chapterId], "team_tasks");
    const tr = ts.find((t) => t.role === "translator"), cl = ts.find((t) => t.role === "cleaner"), ty = ts.find((t) => t.role === "typist");
    if (ty || !tr || tr.status !== "approved" || (cl && cl.status !== "approved")) return;
    try {
      db.insert("team_tasks", {
        role: "typist", chapter_id: chapterId, title: `${ch.title} — تایپ`, label: ch.label, reward_tokens: ch.typist_reward,
        status: cl ? "open" : "draft", // بدون مرحله‌ی کلین، ادمین باید zip تصاویر را بدهد
        source_file: cl ? cl.result_file : null, extra_file: tr.result_file,
      });
    } catch (e) { if (!db.isUnique(e)) throw e; }
  }
  // ---------- ساخت بنر چپتر (بعد از تایید آخرین کار تایپیست؛ هرگز تایید/پرداخت را خراب نمی‌کند) ----------
  const bannerBusy = new Set();
  async function makeBanner(chapterId) {
    if (bannerBusy.has(chapterId)) return;
    bannerBusy.add(chapterId);
    try {
      const ch = db.get("SELECT * FROM team_chapters WHERE id=?", [chapterId]);
      if (!ch) return;
      const ts = db.all("SELECT role, assignee FROM team_tasks WHERE chapter_id=?", [chapterId]);
      const ids = [...new Set(ts.map((t) => t.assignee).filter(Boolean))];
      const mem = ids.length ? db.all(`SELECT user_id, display_name, banner_name FROM team_members WHERE user_id IN (${db.ph(ids)})`, ids) : [];
      const nm = Object.fromEntries(mem.map((m) => [m.user_id, bannerNameOf(m)]));
      const names = {};
      for (const r of ["translator", "cleaner", "typist"]) { const t = ts.find((x) => x.role === r); names[r] = t && t.assignee ? nm[t.assignee] || "" : ""; }
      // مترجم و کلینر ثابت‌اند (هانا / سهراب). تایپیست = «اسم روی بنر» همان کسی که این کار را انجام داده؛
      // فقط اگر کاری/کارمندی نبود (چپترهای قدیمی) اسمِ دستیِ ذخیره‌شده روی چپتر استفاده می‌شود.
      names.translator = banner.NAMES.translator;
      names.cleaner = banner.NAMES.cleaner;
      names.typist = names.typist || String(ch.banner_typist || "").trim();
      let cover = null;
      if (ch.manhwa_id) { const mh = db.get("SELECT image_file FROM team_manhwas WHERE id=?", [ch.manhwa_id]); cover = (mh && mh.image_file) || null; }
      const png = await banner.buildBanner({ names, coverKey: cover });
      const key = `${PREFIX}/chapters/${chapterId}/banner-${crypto.randomUUID()}.png`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: png, ContentType: "image/png" }));
      db.update("team_chapters", { banner_file: key, banner_note: cover ? null : "تصویر مانهوا ندارد؛ بنر بدون تصویر ساخته شد." }, "id=?", [chapterId]);
      if (ch.banner_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: ch.banner_file })).catch(() => {});
    } catch (e) {
      console.error("[team] banner:", e.message);
      try { db.update("team_chapters", { banner_note: String(e.message).slice(0, 300) }, "id=?", [chapterId]); } catch {}
    } finally { bannerBusy.delete(chapterId); }
  }
  // ---------- مانهواهای خودِ سایت (data.json) ----------
  const siteData = () => { try { return require("../lib/dataStore").getData() || {}; } catch (e) { console.error("[team] dataStore:", e.message); return {}; } };
  // ردیف team_manhwas برای یک مانهوای سایت؛ اگر نبود می‌سازد (کاور بنر و چپترهای تیمی به همین ردیف وصل می‌شوند)
  async function ensureManhwa(slug) {
    const all = siteData(), d = Object.prototype.hasOwnProperty.call(all, slug) ? all[slug] : null;
    if (!d || typeof d !== "object") return null;
    const find = async () => db.get("SELECT id, image_file FROM team_manhwas WHERE slug=?", [slug]);
    let row = await find();
    if (row) return row;
    try {
      row = db.insert("team_manhwas", { name: String(d.title_fa || d.title_en || slug).slice(0, 120), slug });
    } catch (e) { if (!db.isUnique(e)) throw e; row = await find(); }
    return row;
  }
  function mergeManhwas(rows, chapters) {
    const site = siteData(), bySlug = new Map(rows.filter((x) => x.slug).map((x) => [x.slug, x]));
    const cnt = {};
    chapters.forEach((c) => { if (c.manhwa_id) cnt[c.manhwa_id] = (cnt[c.manhwa_id] || 0) + 1; });
    const out = Object.entries(site).filter(([, m]) => m && typeof m === "object").map(([slug, m]) => {
      const row = bySlug.get(slug), eps = Array.isArray(m.episodes) ? m.episodes : [];
      return {
        id: row ? row.id : null, slug, site: true, name: m.title_fa || m.title_en || slug, name_en: m.title_en || "",
        site_cover: m.cover_image ? `/manhwas/${encodeURIComponent(slug)}/${encodeURIComponent(m.cover_image)}` : null,
        has_image: !!(row && row.image_file), source_url: (row && row.source_url) || "", episodes: eps.length, last_ep: eps.reduce((a, e) => Math.max(a, Number(e.num) || 0), 0), team_chapters: row ? cnt[row.id] || 0 : 0,
      };
    });
    out.sort((a, b) => b.team_chapters - a.team_chapters);
    rows.filter((x) => !x.slug || !site[x.slug]).forEach((x) => out.push({ id: x.id, slug: null, site: false, name: x.name, name_en: "", site_cover: null, has_image: !!x.image_file, source_url: x.source_url || "", episodes: 0, last_ep: 0, team_chapters: cnt[x.id] || 0 }));
    return out;
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
  // ---------- zip نهایی: بنر همیشه اولین تصویر؛ بعدش همان فایل‌های zip تایپیست (بدون فشرده‌سازی مجدد، بدون وابستگی اضافه) ----------
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const zipLocal = (nm, method, crc, cs, us) => { const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(cs, 18); h.writeUInt32LE(us, 22); h.writeUInt16LE(nm.length, 26); return Buffer.concat([h, nm]); };
  const zipCentral = (nm, method, crc, cs, us, off) => { const h = Buffer.alloc(46); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(method, 10); h.writeUInt16LE(0, 12); h.writeUInt16LE(0x21, 14); h.writeUInt32LE(crc, 16); h.writeUInt32LE(cs, 20); h.writeUInt32LE(us, 24); h.writeUInt16LE(nm.length, 28); h.writeUInt32LE(off, 42); return Buffer.concat([h, nm]); };
  async function sendZipWithBanner(res, zipPath, bannerBuf, outName) {
    const BN = "000-banner.png";
    const z = await new Promise((ok, no) => yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (e, zf) => (e ? no(e) : ok(zf))));
    try {
      const ents = await new Promise((ok, no) => {
        const a = [];
        z.on("entry", (en) => {
          const base = en.fileName.split("/").pop();
          if (!(/\/$/.test(en.fileName) || en.fileName.startsWith("__MACOSX/") || base.startsWith(".") || en.fileName === BN || en.isEncrypted() || ![0, 8].includes(en.compressionMethod))) a.push(en);
          z.readEntry();
        });
        z.on("end", () => ok(a)); z.on("error", no); z.readEntry();
      });
      ents.sort((x, y) => x.fileName.localeCompare(y.fileName, "en", { numeric: true }));
      res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(outName)}` });
      const w = (b) => { if (res.destroyed) throw new Error("client gone"); return res.write(b) ? null : new Promise((ok) => res.once("drain", ok)); };
      const cd = []; let off = 0;
      const put = async (name, method, crc, cs, us, stream) => {
        const nm = Buffer.from(name, "utf8"), head = zipLocal(nm, method, crc, cs, us);
        cd.push(zipCentral(nm, method, crc, cs, us, off));
        await w(head); off += head.length + cs;
        await stream();
      };
      await put(BN, 0, crc32(bannerBuf), bannerBuf.length, bannerBuf.length, async () => { await w(bannerBuf); });
      for (const en of ents) {
        await put(en.fileName, en.compressionMethod, en.crc32, en.compressedSize, en.uncompressedSize, async () => {
          const rs = await new Promise((ok, no) => z.openReadStream(en, { decompress: false }, (e, s) => (e ? no(e) : ok(s))));
          for await (const c of rs) await w(c);
        });
      }
      const cdBuf = Buffer.concat(cd), eo = Buffer.alloc(22);
      eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(cd.length, 8); eo.writeUInt16LE(cd.length, 10); eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(off, 16);
      await w(cdBuf); res.end(eo);
    } finally { z.close(); }
  }
  const readBuf = async (key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToByteArray());
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
    const out = db.approveTaskTx(id);
    if (!out.ok) return out;
    try { out.adjust = await settle(id, quality); } catch (e) { console.error("[team] settle:", e.message); out.adjust = 0; }
    const t = db.get("SELECT chapter_id, role FROM team_tasks WHERE id=?", [id]);
    if (t && t.chapter_id) {
      if (t.role === "typist") { db.update("team_chapters", { status: "done" }, "id=?", [t.chapter_id]); makeBanner(t.chapter_id).catch(() => {}); }
      else await advanceChapter(t.chapter_id);
    }
    return out;
  }

  // ---------- احراز هویت (توکن ورود خود سایت؛ getAuthContext از server.js می‌آید) ----------
  router.use(async (req, res, next) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "ابتدا وارد حساب شوید." });
    try {
      const ctx = await getAuthContext(token);
      if (!ctx) return res.status(401).json({ error: "نشست نامعتبر است. دوباره وارد شوید." });
      db.ready();
      req.user = ctx.user;
      req.isAdmin = isAdminUser(ctx.user);
      const m = db.get("SELECT * FROM team_members WHERE user_id=?", [ctx.user.id], "team_members");
      req.member = m && m.active ? { ...m, roles: ["typist"] } : null; // این پنل فقط تایپ است؛ هر عضو فعال = تایپیست
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
    const t0 = Date.now();
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
      console.error("[team] upload failed:", e.message, JSON.stringify({ role, kind, taskId, contentLength: len, received: size, head: head.toString("hex"), seconds: Math.round((Date.now() - t0) / 1000) }));
      throw e;
    } finally {
      await fs.promises.unlink(full).catch(() => {});
    }
  }
  // ---------- آپلود تکه‌تکه (multipart مستقیم به S3) ----------
  // مرورگر فایل را به تکه‌های ۱۰ مگابایتی می‌شکند؛ هر تکه جدا (و با تلاش مجدد خودکار) ارسال می‌شود.
  // قطع شدن اینترنت فقط همان تکه را از نو می‌فرستد، نه کل فایل را. هیچ فایل موقتی روی دیسک سرور ساخته نمی‌شود.
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const KEY_RE = new RegExp("^" + escRe(PREFIX) + "/(typist|cleaner|font|translator)/([0-9a-f-]{36})/(source|result|extra)-[0-9a-f-]{36}\\.(zip|docx)$", "i");
  const userErr = (m, code = 400) => Object.assign(new Error(m), { user: true, code });
  async function mpInit({ role, taskId, kind, ext }, size) {
    if (!BUCKET) throw new Error("PARSPACK_BUCKET not set");
    if (!(size > 0) || size > MAX_ZIP) throw userErr("حجم فایل نامعتبر است (حداکثر ۱۰۰ مگابایت).");
    const key = `${PREFIX}/${role}/${taskId}/${kind}-${crypto.randomUUID()}.${ext}`;
    const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: MIME[ext] }));
    return { key, uploadId: r.UploadId, partSize: PART_SIZE };
  }
  async function mpPart(req) {
    const { key, uploadId } = req.query, n = parseInt(req.query.n, 10);
    const m = KEY_RE.exec(String(key || ""));
    if (!m || m[2].toLowerCase() !== String(req.params.id).toLowerCase() || !uploadId || !(n >= 1 && n <= MAX_PARTS)) throw userErr("درخواست نامعتبر است.");
    const len = Number(req.headers["content-length"] || 0);
    if (!len || len > PART_SIZE) throw userErr("اندازه‌ی تکه نامعتبر است.");
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > PART_SIZE) throw userErr("اندازه‌ی تکه نامعتبر است."); chunks.push(c); }
    if (size !== len) throw userErr("تکه ناقص رسید؛ دوباره تلاش کن.");
    const body = Buffer.concat(chunks);
    if (n === 1 && body.subarray(0, 4).toString("hex") !== "504b0304") throw userErr(m[4] === "docx" ? "فایل باید یک سند Word با پسوند docx باشد." : "فایل باید یک zip معتبر باشد.");
    const r = await s3.send(new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: n, Body: body, ContentLength: body.length }));
    return r.ETag;
  }
  async function mpAbort(key, uploadId) {
    if (KEY_RE.test(String(key || "")) && uploadId) await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })).catch(() => {});
  }
  async function mpComplete({ role, taskId, kind, ext }, b) {
    const { key, uploadId } = b || {};
    if (typeof key !== "string" || !uploadId || !key.startsWith(`${PREFIX}/${role}/${taskId}/${kind}-`) || !KEY_RE.test(key) || !key.endsWith("." + ext)) throw userErr("درخواست نامعتبر است.");
    const parts = Array.isArray(b.parts) ? b.parts : [];
    if (!parts.length || parts.length > MAX_PARTS || parts.some((p, i) => p.n !== i + 1 || typeof p.etag !== "string")) throw userErr("لیست تکه‌ها نامعتبر است.");
    try {
      await s3.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.n, ETag: p.etag })) } }));
    } catch (e) { await mpAbort(key, uploadId); throw userErr("آپلود کامل نشد؛ دوباره تلاش کن."); }
    const bad = ext === "docx" ? "فایل باید یک سند Word با پسوند docx باشد." : "فایل باید یک zip معتبر باشد.";
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!h.ContentLength || h.ContentLength > MAX_ZIP) { await rmFile(key); throw userErr("حجم فایل نامعتبر است (حداکثر ۱۰۰ مگابایت)."); }
    if (ext === "docx") {
      const n = Math.min(h.ContentLength, 262144);
      const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${h.ContentLength - n}-${h.ContentLength - 1}` }));
      const parts2 = []; for await (const c of o.Body) parts2.push(c);
      const tail = Buffer.concat(parts2);
      if (!tail.includes("word/document.xml")) { await rmFile(key); throw userErr(bad); }
    }
    return key;
  }
  // سه مسیر init / part / complete (+ abort) را روی هر روتر می‌بندد
  // ctx(req,res) → {role,taskId,kind,ext} یا null (اگر خودش پاسخ خطا داده)؛ done(req,res,ctx,key) → کارهای بعد از آپلود
  function chunkedRoutes(rt, base, mw, ctx, done) {
    const run = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { e.user ? res.status(e.code || 400).json({ error: e.message }) : fail(res, e); } };
    rt.post(`${base}/init`, mw, run(async (req, res) => { const c = await ctx(req, res); if (c) res.json(await mpInit(c, Number((req.body || {}).size))); }));
    rt.put(`${base}/part`, mw, run(async (req, res) => { res.json({ etag: await mpPart(req) }); }));
    rt.post(`${base}/complete`, mw, run(async (req, res) => { const c = await ctx(req, res); if (!c) return; const key = await mpComplete(c, req.body); await done(req, res, c, key); }));
    rt.post(`${base}/abort`, mw, run(async (req, res) => { await mpAbort((req.body || {}).key, (req.body || {}).uploadId); res.json({ ok: true }); }));
  }

  // فایل فقط وقتی پاک می‌شود که هیچ کار دیگری (مثلاً کار تایپیستی که فایل کلین/ترجمه را به ارث برده) به آن اشاره نکند
  // کلید شامل «/» یعنی در S3 است؛ بدون «/» یعنی فایل قدیمیِ روی دیسک.
  const rmFile = async (n) => {
    if (!n) return;
    try {
      if (db.get("SELECT id FROM team_tasks WHERE source_file=? OR result_file=? OR extra_file=? LIMIT 1", [n, n, n])) return;
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
      const out = { isAdmin: req.isAdmin, member: req.member ? { roles: req.member.roles, name: req.member.display_name, banner_name: cleanBannerName(req.member.banner_name), banner_default: bannerNameOf({ display_name: req.member.display_name }) } : null, roles: ROLES };
      if (req.member) {
        const [bal, pend] = await Promise.all([balanceOf(req.user.id), pendingTokens(req.user.id).catch(() => 0)]);
        const avail = Math.max(0, bal - pend);
        Object.assign(out, {
          balance: bal, pending: pend, available: avail, minWithdraw: MIN_WITHDRAW_TOKENS,
          balanceToman: toman(bal), pendingToman: toman(pend), availableToman: toman(avail),
          minWithdrawToman: toman(MIN_WITHDRAW_TOKENS), canWithdraw: avail >= MIN_WITHDRAW_TOKENS, rules: workerRules(),
        });
      }
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  // اسم روی بنر: خود تایپیست هم می‌تواند عوضش کند (ادمین هم از پنل مدیریت)
  router.patch("/me/banner-name", needMember, async (req, res) => {
    const name = cleanBannerName((req.body || {}).name);
    if (name.length < 2) return res.status(400).json({ error: "اسم روی بنر باید حداقل ۲ حرف باشد." });
    try {
      db.update("team_members", { banner_name: name }, "user_id=?", [req.user.id]);
      res.json({ ok: true, banner_name: name });
    } catch (e) { fail(res, e); }
  });

  router.get("/summary", needMember, async (req, res) => {
    try {
      const open = db.all("SELECT role FROM team_tasks WHERE status='open'");
      const mine = db.all("SELECT role, status FROM team_tasks WHERE assignee=? AND status IN ('claimed','submitted')", [req.user.id]);
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
      const rows = db.all("SELECT * FROM team_tasks WHERE status='open' AND role=? ORDER BY created_at ASC LIMIT 50", [role], "team_tasks");
      res.json(rows.map((t) => pubWorker(t, false)));
    } catch (e) { fail(res, e); }
  });

  router.get("/my-tasks", needMember, async (req, res) => {
    try {
      const rows = db.all("SELECT * FROM team_tasks WHERE assignee=? ORDER BY created_at DESC LIMIT 60", [req.user.id], "team_tasks");
      const out = rows.map((t) => pubWorker(t, true));
      // لینک سورسِ مانهوا فقط برای کارهای تایپیستِ در جریان
      try {
        const cids = [...new Set(rows.filter((t) => t.role === "typist" && t.chapter_id && t.status !== "approved").map((t) => t.chapter_id))];
        if (cids.length) {
          const chs = db.all(`SELECT id, manhwa_id FROM team_chapters WHERE id IN (${db.ph(cids)})`, cids);
          const mids = [...new Set(chs.map((c) => c.manhwa_id).filter(Boolean))];
          if (mids.length) {
            const src = new Map(db.all(`SELECT id, source_url FROM team_manhwas WHERE id IN (${db.ph(mids)})`, mids).map((m) => [m.id, m.source_url]));
            const cm = new Map(chs.map((c) => [c.id, c.manhwa_id]));
            rows.forEach((t, i) => { if (t.role === "typist" && t.chapter_id && t.status !== "approved") out[i].source_url = src.get(cm.get(t.chapter_id)) || null; });
          }
        }
      } catch (e) { console.error("[team] source_url:", e.message); }
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  // تیکت‌های ادمین برای خود کارمند (فقط برچسب عمومی کار، نه عنوان داخلی)
  router.get("/tickets", needMember, async (req, res) => {
    try {
      const rows = db.all("SELECT * FROM team_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 30", [req.user.id]);
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries(db.all(`SELECT id, label FROM team_tasks WHERE id IN (${db.ph(ids)})`, ids).map((t) => [t.id, t.label])) : {};
      res.json(rows.map((r) => ({ id: r.id, message: r.message, level: r.level, created_at: r.created_at, read_at: r.read_at, label: r.task_id ? lab[r.task_id] || null : null })));
    } catch (e) { fail(res, e); }
  });
  router.post("/tickets/:id/read", needMember, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      db.update("team_tickets", { read_at: new Date().toISOString() }, "id=? AND user_id=? AND read_at IS NULL", [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- برداشت (درخواست کارمند) ----------
  const wdBusy = new Set();
  router.get("/withdrawals", needMember, async (req, res) => {
    try {
      const rows = db.all("SELECT id, tokens, toman_per_token, status, admin_note, created_at, decided_at FROM team_withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 20", [req.user.id]);
      res.json(rows.map((r) => ({ id: r.id, tokens: r.tokens, toman: r.tokens * r.toman_per_token, status: r.status, admin_note: r.admin_note, created_at: r.created_at, decided_at: r.decided_at })));
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
      const dup = { error: "یک درخواست برداشتِ در حال بررسی داری؛ تا نتیجه‌اش مشخص نشه درخواست جدید نمی‌تونی بدی." };
      try {
        // بررسی و ثبت در یک تراکنش: هم‌زمان نمی‌شود دو درخواست در حال بررسی داشت
        const ok = db.tx(() => {
          if (db.get("SELECT 1 AS x FROM team_withdrawals WHERE user_id=? AND status='pending' LIMIT 1", [uid])) return false;
          db.insert("team_withdrawals", { user_id: uid, tokens, toman_per_token: TOMAN_PER_TOKEN, account });
          return true;
        });
        if (!ok) return res.status(409).json(dup);
      } catch (e) {
        if (db.isUnique(e)) return res.status(409).json(dup);
        throw e;
      }
      res.json({ ok: true, toman: toman(tokens) });
    } catch (e) { fail(res, e); } finally { wdBusy.delete(uid); }
  });

  // ---------- تیکت کارمند به ادمین ----------
  router.get("/support", needMember, async (req, res) => {
    try {
      const rows = db.all("SELECT * FROM team_support WHERE user_id=? ORDER BY created_at DESC LIMIT 30", [req.user.id]);
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries(db.all(`SELECT id, label FROM team_tasks WHERE id IN (${db.ph(ids)})`, ids).map((t) => [t.id, t.label])) : {};
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
        const t = db.get("SELECT id FROM team_tasks WHERE id=? AND assignee=?", [b.task_id, uid]);
        if (!t) return res.status(404).json({ error: "این کار برای تو نیست." });
        taskId = t.id;
      }
      const open = db.all("SELECT id FROM team_support WHERE user_id=? AND status='open'", [uid]);
      if (open.length >= SUPPORT_MAX_OPEN) return res.status(429).json({ error: `${SUPPORT_MAX_OPEN} تیکت بی‌پاسخ داری؛ صبر کن ادمین جواب بده.` });
      db.insert("team_support", { user_id: uid, task_id: taskId, message });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  router.post("/support/:id/read", needMember, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      db.update("team_support", { user_read_at: new Date().toISOString() }, "id=? AND user_id=? AND reply IS NOT NULL AND user_read_at IS NULL", [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.post("/tasks/:id/claim", needMember, async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT role FROM team_tasks WHERE id=?", [id]);
      if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
      if (!req.member.roles.includes(t.role)) return res.status(403).json({ error: "این نقش برای شما فعال نیست." });
      const uid = req.user.id;
      if (claimBusy.has(uid)) return res.status(429).json({ error: "درخواست قبلی هنوز در حال انجام است." });
      claimBusy.add(uid); res.once("close", () => claimBusy.delete(uid));
      const active = db.all("SELECT id, status FROM team_tasks WHERE assignee=? AND status IN ('claimed','submitted')", [uid]);
      if (active.filter((a) => a.status === "claimed").length >= MAX_IN_PROGRESS) {
        return res.status(429).json({ error: "همزمان فقط یک کار در حال انجام داری. اول همون رو تحویل بده، بعد می‌تونی کار بعدی رو برداری." });
      }
      if (active.length >= MAX_ACTIVE_PER_USER) {
        return res.status(429).json({ error: `${MAX_ACTIVE_PER_USER} کارت در جریانه (در انتظار تایید). بعد از تایید یکی‌شون می‌تونی کار جدید برداری.` });
      }
      // برداشتن اتمیک: فقط اگه هنوز open باشه
      const rows = db.update("team_tasks", {
        status: "claimed", assignee: req.user.id, claimed_at: new Date().toISOString(), first_claimed_at: new Date().toISOString(), first_submitted_at: null, quality: null, admin_note: null,
      }, "id=? AND status='open'", [id]);
      if (!rows.length) return res.status(409).json({ error: "این کار همین الان توسط شخص دیگری برداشته شد." });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // تحویل کار (zip خام در بدنه‌ی PUT)
  router.put("/tasks/:id/upload", needMember, async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT role, result_file, first_claimed_at, first_submitted_at FROM team_tasks WHERE id=? AND assignee=? AND status='claimed'", [id, req.user.id]);
      if (!t) return res.status(404).json({ error: "این کار در حالت تحویل نیست." });
      // بعد از ۳۶ ساعت (برای اولین تحویل) کار دیگر مال او نیست: جارو آزادش می‌کند و جریمه ثبت می‌شود
      if (!t.first_submitted_at && t.first_claimed_at && Date.now() - new Date(t.first_claimed_at) > (DEADLINE_H + GRACE_H) * 36e5) {
        await sweep();
        return res.status(410).json({ error: `مهلت ${DEADLINE_H + GRACE_H} ساعته‌ی این کار تمام شده؛ کار آزاد و جریمه ثبت شد.` });
      }
      const name = await saveZip(req, ROLE_RULES[t.role].result, id, t.role, "result");
      const rows = db.update("team_tasks", {
        status: "submitted", result_file: name, submitted_at: new Date().toISOString(), first_submitted_at: t.first_submitted_at || new Date().toISOString(),
      }, "id=? AND assignee=? AND status='claimed'", [id, req.user.id]);
      if (!rows.length) { await rmFile(name); return res.status(409).json({ error: "وضعیت کار تغییر کرده است." }); }
      await rmFile(t.result_file);
      let auto = false;
      if (req.member.auto_approve) {
        try { auto = !!(await approveTask(id)).ok; } catch (e) { console.error("[team] auto-approve:", e.message); }
      }
      res.json({ ok: true, auto });
    } catch (e) { upErr(res, e); }
  });

  // تحویل کار با آپلود تکه‌تکه (روش اصلی؛ مسیر قدیمی PUT بالا فقط برای سازگاری مانده)
  chunkedRoutes(router, "/tasks/:id/upload", needMember,
    async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) { res.status(400).json({ error: "شناسه نامعتبر است." }); return null; }
      const t = db.get("SELECT role, result_file, first_claimed_at, first_submitted_at FROM team_tasks WHERE id=? AND assignee=? AND status='claimed'", [id, req.user.id]);
      if (!t) { res.status(404).json({ error: "این کار در حالت تحویل نیست." }); return null; }
      if (!t.first_submitted_at && t.first_claimed_at && Date.now() - new Date(t.first_claimed_at) > (DEADLINE_H + GRACE_H) * 36e5) {
        await sweep();
        res.status(410).json({ error: `مهلت ${DEADLINE_H + GRACE_H} ساعته‌ی این کار تمام شده؛ کار آزاد و جریمه ثبت شد.` }); return null;
      }
      req.task = t;
      return { role: t.role, taskId: id, kind: "result", ext: ROLE_RULES[t.role].result };
    },
    async (req, res, c, name) => {
      const t = req.task, id = c.taskId;
      const rows = db.update("team_tasks", {
        status: "submitted", result_file: name, submitted_at: new Date().toISOString(), first_submitted_at: t.first_submitted_at || new Date().toISOString(),
      }, "id=? AND assignee=? AND status='claimed'", [id, req.user.id]);
      if (!rows.length) { await rmFile(name); return res.status(409).json({ error: "وضعیت کار تغییر کرده است." }); }
      await rmFile(t.result_file);
      let auto = false;
      if (req.member.auto_approve) {
        try { auto = !!(await approveTask(id)).ok; } catch (e) { console.error("[team] auto-approve:", e.message); }
      }
      res.json({ ok: true, auto });
    });

  router.get("/tasks/:id/download", needMember, async (req, res) => {
    const id = req.params.id;
    const kind = ["result", "extra"].includes(req.query.kind) ? req.query.kind : "source";
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT * FROM team_tasks WHERE id=?", [id], "team_tasks");
      if (!t || (t.assignee !== req.user.id)) return res.status(403).json({ error: "دسترسی ندارید." });
      await sendFile(res, t, kind);
    } catch (e) { fail(res, e); }
  });

  // ================== ادمین ==================
  const admin = express.Router();
  admin.use(needAdmin);

  admin.get("/overview", async (req, res) => {
    try {
      const tasks = db.all("SELECT * FROM team_tasks ORDER BY created_at DESC LIMIT 1000", [], "team_tasks");
      const members = db.all("SELECT * FROM team_members ORDER BY created_at DESC", [], "team_members");
      const ledger = db.all("SELECT user_id, tokens, kind FROM team_ledger");
      const chapters = db.all("SELECT * FROM team_chapters ORDER BY created_at DESC LIMIT 300");
      const manhwas = db.all("SELECT id, name, image_file, slug, source_url FROM team_manhwas ORDER BY created_at DESC");
      const wdPend = db.all("SELECT tokens FROM team_withdrawals WHERE status='pending'");
      const supOpen = db.all("SELECT id FROM team_support WHERE status='open'");
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
        manhwas: mergeManhwas(manhwas, chapters), bannerNames: { translator: banner.NAMES.translator, cleaner: banner.NAMES.cleaner }, bannerBusy: [...bannerBusy], bannerReady: banner.configured(),
        auto: { claimHours: CLAIM_HOURS, autoApproveHours: AUTO_APPROVE_HOURS },
        stats: { rewarded, cashedOut, owed: Object.values(bal).reduce((a, b) => a + b, 0) },
        pending: { withdrawals: wdPend.length, withdrawTokens: sum(wdPend), support: supOpen.length },
        minWithdrawTokens: MIN_WITHDRAW_TOKENS,
        tasks: tasks.map((t) => ({ ...pubAdmin(t), worker: t.assignee ? name[t.assignee] || t.assignee.slice(0, 8) : null })),
        members: members.map((m) => ({ user_id: m.user_id, name: m.display_name, roles: m.roles, active: m.active, balance: bal[m.user_id] || 0, done: done[m.user_id] || 0, auto_approve: !!m.auto_approve, banner_name: cleanBannerName(m.banner_name), banner_effective: bannerNameOf(m) })),
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
      const rows = [db.insert("team_tasks", { role, status, ...c.v })];
      res.json({ ok: true, id: rows[0].id, status });
    } catch (e) { fail(res, e); }
  });

  admin.patch("/tasks/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT role, status FROM team_tasks WHERE id=?", [id]);
      if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
      if (t.status === "approved") return res.status(409).json({ error: "کار تاییدشده قابل ویرایش نیست." });
      const c = cleanTask(t.role, req.body || {});
      if (c.err) return res.status(400).json({ error: c.err });
      db.update("team_tasks", c.v, "id=?", [id]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // کار تایپیست فقط وقتی برای بقیه دیده می‌شود که هم zip صفحات کلین‌شده و هم Word ترجمه را داشته باشد
  const readyToOpen = (role, source, extra) => !!source && (role !== "typist" || !!extra);

  admin.put("/tasks/:id/source", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT role, status, source_file, extra_file FROM team_tasks WHERE id=?", [id]);
      if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
      if (!ROLE_RULES[t.role].source) return res.status(400).json({ error: "این نقش فایل ورودی ندارد." });
      const name = await saveZip(req, "zip", id, t.role, "source");
      db.update("team_tasks", { source_file: name, status: t.status === "draft" && readyToOpen(t.role, name, t.extra_file) ? "open" : t.status }, "id=?", [id]);
      await rmFile(t.source_file);
      res.json({ ok: true });
    } catch (e) { upErr(res, e); }
  });

  // آپلود تکه‌تکه‌ی فایل ورودی (ادمین)
  chunkedRoutes(admin, "/tasks/:id/source", (req, res, next) => next(),
    async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) { res.status(400).json({ error: "شناسه نامعتبر است." }); return null; }
      const t = db.get("SELECT role, status, source_file, extra_file FROM team_tasks WHERE id=?", [id]);
      if (!t) { res.status(404).json({ error: "کار پیدا نشد." }); return null; }
      if (!ROLE_RULES[t.role].source) { res.status(400).json({ error: "این نقش فایل ورودی ندارد." }); return null; }
      req.task = t;
      return { role: t.role, taskId: id, kind: "source", ext: "zip" };
    },
    async (req, res, c, name) => {
      const t = db.get("SELECT role, status, source_file, extra_file FROM team_tasks WHERE id=?", [c.taskId]) || req.task;
      db.update("team_tasks", { source_file: name, status: t.status === "draft" && readyToOpen(t.role, name, t.extra_file) ? "open" : t.status }, "id=?", [c.taskId]);
      await rmFile(t.source_file);
      res.json({ ok: true });
    });

  // آپلود تکه‌تکه‌ی «ترجمه‌ی Word» برای کار تایپیست (ادمین)
  chunkedRoutes(admin, "/tasks/:id/extra", (req, res, next) => next(),
    async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) { res.status(400).json({ error: "شناسه نامعتبر است." }); return null; }
      const t = db.get("SELECT role, status, source_file, extra_file FROM team_tasks WHERE id=?", [id]);
      if (!t) { res.status(404).json({ error: "کار پیدا نشد." }); return null; }
      if (t.role !== "typist") { res.status(400).json({ error: "فقط کار تایپیست فایل ترجمه دارد." }); return null; }
      return { role: t.role, taskId: id, kind: "extra", ext: "docx" };
    },
    async (req, res, c, name) => {
      const t = db.get("SELECT role, status, source_file, extra_file FROM team_tasks WHERE id=?", [c.taskId]);
      if (!t) { await rmFile(name); return res.status(404).json({ error: "کار پیدا نشد." }); }
      db.update("team_tasks", { extra_file: name, status: t.status === "draft" && readyToOpen(t.role, t.source_file, name) ? "open" : t.status }, "id=?", [c.taskId]);
      await rmFile(t.extra_file);
      res.json({ ok: true });
    });

  admin.get("/tasks/:id/download", async (req, res) => {
    const id = req.params.id;
    const kind = ["result", "extra"].includes(req.query.kind) ? req.query.kind : "source";
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT * FROM team_tasks WHERE id=?", [id], "team_tasks");
      // نتیجه‌ی تایپیست: اگر بنر چپتر ساخته شده باشد، بنر اولین تصویرِ zip دانلودی می‌شود (برای نسخه‌ی خام: ?plain=1)
      if (kind === "result" && t && t.role === "typist" && t.chapter_id && /\.zip$/i.test(t.result_file || "") && req.query.plain !== "1") {
        const ch = db.get("SELECT banner_file FROM team_chapters WHERE id=?", [t.chapter_id]);
        if (ch && ch.banner_file) {
          try {
            const p = await localCopy(t.result_file), bn = await readBuf(ch.banner_file);
            return await sendZipWithBanner(res, p, bn, `${safeName(t.label)}-final.zip`);
          } catch (e) { if (res.headersSent) return res.destroy(); console.error("[team] zip+banner:", e.message); }
        }
      }
      await sendFile(res, t, kind);
    } catch (e) { fail(res, e); }
  });

  // ---------- پیش‌نمایش برای ادمین: فهرست تصاویر zip یا متن docx ----------
  admin.get("/tasks/:id/preview", async (req, res) => {
    const id = req.params.id, kind = kindOf(req.query.kind);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const t = db.get("SELECT * FROM team_tasks WHERE id=?", [id], "team_tasks");
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
      const t = db.get("SELECT * FROM team_tasks WHERE id=?", [id], "team_tasks");
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
      const t = db.get("SELECT result_file FROM team_tasks WHERE id=? AND status IN ('claimed','submitted')", [id]);
      if (!t) return res.status(409).json({ error: "این کار در دست کارمند نیست." });
      const rows = db.update("team_tasks", {
        status: "open", assignee: null, claimed_at: null, submitted_at: null, first_claimed_at: null, first_submitted_at: null, quality: null, result_file: null, admin_note: null,
      }, "id=? AND status IN ('claimed','submitted')", [id]);
      if (rows.length) await rmFile(t.result_file);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.delete("/tasks/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const rows = db.remove("team_tasks", "id=? AND status IN ('draft','open')", [id]);
      if (!rows.length) return res.status(409).json({ error: "فقط کار پیش‌نویس یا آزاد قابل حذف است. برای بقیه اول «پس گرفتن» را بزن." });
      await rmFile(rows[0].source_file);
      await rmFile(rows[0].extra_file);
      const cid = rows[0].chapter_id;
      if (cid && !db.get("SELECT id FROM team_tasks WHERE chapter_id=? LIMIT 1", [cid])) {
        const gone = db.remove("team_chapters", "id=?", [cid]);
        if (gone[0] && gone[0].banner_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: gone[0].banner_file })).catch(() => {});
      }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ثبت یک چپتر = یک کار تایپ؛ ترجمه و کلین از قبل انجام شده‌اند. کار تا آپلود zip صفحات و Word ترجمه «پیش‌نویس» می‌ماند.
  admin.post("/chapters", async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim().slice(0, 200), label = String(b.label || "").trim().slice(0, 60);
    const ty = parseInt(b.typist_reward, 10) || BASE_RANGE.typist[0];
    if (!title || !label) return res.status(400).json({ error: "عنوان داخلی و برچسب (مثلاً CH1) لازم است." });
    const g = BASE_RANGE.typist;
    if (ty < g[0] || ty > g[1]) return res.status(400).json({ error: g[0] === g[1] ? `حقوق ${ROLES.typist} ثابت و ${g[0]} توکن است.` : `حقوق ${ROLES.typist} باید بین ${g[0]} تا ${g[1]} توکن باشد.` });
    try {
      // مانهوا: یا از مانهواهای سایت (slug)، یا ردیف دستیِ قدیمی (id)
      let manhwaId = UUID_RE.test(String(b.manhwa_id || "")) ? b.manhwa_id : null;
      if (!manhwaId && b.manhwa_slug) {
        const m = await ensureManhwa(String(b.manhwa_slug));
        if (!m) return res.status(400).json({ error: "این مانهوا در سایت پیدا نشد." });
        manhwaId = m.id;
      }
      const made = db.tx(() => {
        const ch = db.insert("team_chapters", { title, label, typist_reward: ty, manhwa_id: manhwaId });
        const task = db.insert("team_tasks", { role: "typist", chapter_id: ch.id, title: `${title} — تایپ`, label, reward_tokens: ty, status: "draft" });
        return { ch, task };
      });
      res.json({ ok: true, task_id: made.task.id, chapter_id: made.ch.id, manhwa_id: manhwaId });
    } catch (e) { fail(res, e); }
  });

  admin.delete("/chapters/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const ts = db.all("SELECT id, status, source_file, extra_file FROM team_tasks WHERE chapter_id=?", [id]);
      if (ts.some((t) => !["draft", "open"].includes(t.status))) return res.status(409).json({ error: "این چپتر کار در جریان یا تمام‌شده دارد؛ حذف نمی‌شود." });
      const chb = db.get("SELECT banner_file FROM team_chapters WHERE id=?", [id]);
      db.tx(() => { db.remove("team_tasks", "chapter_id=?", [id]); db.remove("team_chapters", "id=?", [id]); });
      if (chb && chb.banner_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chb.banner_file })).catch(() => {});
      for (const t of ts) { await rmFile(t.source_file); await rmFile(t.extra_file); }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.get("/ledger", async (req, res) => {
    const uid = req.query.user_id;
    try {
      res.json(UUID_RE.test(String(uid)) ? db.all("SELECT * FROM team_ledger WHERE user_id=? ORDER BY id DESC LIMIT 200", [uid]) : db.all("SELECT * FROM team_ledger ORDER BY id DESC LIMIT 200"));
    } catch (e) { fail(res, e); }
  });

  admin.post("/adjust", async (req, res) => {
    const { user_id } = req.body || {};
    const tokens = parseInt((req.body || {}).tokens, 10);
    const note = String((req.body || {}).note || "").trim().slice(0, 200);
    if (!UUID_RE.test(String(user_id)) || !tokens || Math.abs(tokens) > 100000 || !note) return res.status(400).json({ error: "عضو، تعداد توکن (مثبت/منفی) و دلیل لازم است." });
    try {
      if (tokens < 0 && (await balanceOf(user_id)) + tokens < 0) return res.status(400).json({ error: "موجودی کافی نیست." });
      db.insert("team_ledger", { user_id, tokens, kind: "adjust", note });
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
    if (typeof b.banner_name === "string") { const bn = cleanBannerName(b.banner_name); if (bn.length < 2) return res.status(400).json({ error: "اسم روی بنر باید حداقل ۲ حرف باشد." }); upd.banner_name = bn; }
    try { db.update("team_members", upd, "user_id=?", [req.params.uid]); res.json({ ok: true }); }
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
      const rows = db.update("team_tasks", { status: "claimed", admin_note: note, claimed_at: new Date().toISOString(), ...(penalty ? { quality: "bad" } : {}) }, "id=? AND status='submitted'", [req.params.id]);
      if (!rows.length) return res.status(409).json({ error: "این کار در انتظار تایید نیست." });
      const tk = rows[0], cut = penalty ? (PAY[tk.role] || FLAT).bad : 0;
      if (penalty && tk.assignee) {
        await ledgerAdd([{ user_id: tk.assignee, tokens: -cut, note: `جریمه‌ی کیفیت بد — ${tk.label}` }]);
        await notify(tk.assignee, tk.id, `کیفیت کار ${tk.label} پایین بود؛ ${cut} توکن کسر شد و برای اصلاح برگشت: ${note}`, "warning");
      }
      res.json({ ok: true, penalty: cut });
    } catch (e) { fail(res, e); }
  });

  // ---------- بنر چپتر ----------
  admin.post("/chapters/:id/banner", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      if (!banner.configured()) return res.status(400).json({ error: "ساخت بنر روی سرور آماده نیست (فایل قالب template-bg.png یا فونت Diba.ttf پیدا نشد)." });
      const ch = db.get("SELECT id FROM team_chapters WHERE id=?", [req.params.id]);
      if (!ch) return res.status(404).json({ error: "چپتر پیدا نشد." });
      if (bannerBusy.has(ch.id)) return res.status(409).json({ error: "بنر همین الان در حال ساخت است." });
      makeBanner(ch.id).catch(() => {});
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  admin.get("/chapters/:id/banner", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const ch = db.get("SELECT label, banner_file FROM team_chapters WHERE id=?", [req.params.id]);
      if (!ch || !ch.banner_file) return res.status(404).json({ error: "بنر هنوز ساخته نشده." });
      await sendS3(res, ch.banner_file, "image/png", req.query.dl ? `${safeName(ch.label)}-banner.png` : null);
    } catch (e) { fail(res, e); }
  });

  // ---------- مانهواها (تصویر زیر بنر) ----------
  admin.post("/manhwas", async (req, res) => {
    const name = String((req.body || {}).name || "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "نام مانهوا را بنویس." });
    try { db.insert("team_manhwas", { name }); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });
  admin.put("/manhwas/:id/image", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const m = db.get("SELECT image_file FROM team_manhwas WHERE id=?", [id]);
      if (!m) return res.status(404).json({ error: "مانهوا پیدا نشد." });
      const key = await saveImage(req, id);
      db.update("team_manhwas", { image_file: key }, "id=?", [id]);
      if (m.image_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: m.image_file })).catch(() => {});
      res.json({ ok: true });
    } catch (e) { upErr(res, e); }
  });
  // لینک سورس مانهوا: به تایپیستِ چپترهای این مانهوا نشان داده می‌شود (همراه «به نسخه‌ی اصلی توجه کنید»)؛ خالی = حذف
  admin.post("/manhwas/source", async (req, res) => {
    const b = req.body || {}, url = String(b.url || "").trim().slice(0, 500);
    if (url && !/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: "لینک باید با http:// یا https:// شروع شود." });
    try {
      let id = UUID_RE.test(String(b.id || "")) ? b.id : null;
      if (!id && b.slug) { const m = await ensureManhwa(String(b.slug)); if (!m) return res.status(404).json({ error: "این مانهوا در سایت پیدا نشد." }); id = m.id; }
      if (!id) return res.status(400).json({ error: "مانهوا مشخص نیست." });
      const rows = db.update("team_manhwas", { source_url: url || null }, "id=?", [id]);
      if (!rows.length) return res.status(404).json({ error: "مانهوا پیدا نشد." });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  // کاور بنر برای یک مانهوای سایت (ردیفش در صورت نبودن خودکار ساخته می‌شود)
  admin.put("/manhwas/by-slug/:slug/image", async (req, res) => {
    try {
      const m = await ensureManhwa(String(req.params.slug));
      if (!m) return res.status(404).json({ error: "این مانهوا در سایت پیدا نشد." });
      const key = await saveImage(req, m.id);
      db.update("team_manhwas", { image_file: key }, "id=?", [m.id]);
      if (m.image_file) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: m.image_file })).catch(() => {});
      res.json({ ok: true, id: m.id });
    } catch (e) { upErr(res, e); }
  });
  admin.get("/manhwas/:id/image", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      const m = db.get("SELECT image_file FROM team_manhwas WHERE id=?", [req.params.id]);
      if (!m || !m.image_file) return res.status(404).json({ error: "تصویری ثبت نشده." });
      await sendS3(res, m.image_file, "image/" + (m.image_file.split(".").pop() === "jpg" ? "jpeg" : m.image_file.split(".").pop()), null);
    } catch (e) { fail(res, e); }
  });
  admin.delete("/manhwas/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try {
      if (db.get("SELECT id FROM team_chapters WHERE manhwa_id=? LIMIT 1", [id])) return res.status(409).json({ error: "چپترهایی به این مانهوا وصل‌اند؛ حذف نمی‌شود." });
      const rows = db.remove("team_manhwas", "id=?", [id]);
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
        const t = db.get("SELECT id, assignee FROM team_tasks WHERE id=?", [b.task_id]);
        if (!t) return res.status(404).json({ error: "کار پیدا نشد." });
        taskId = t.id; uid = t.assignee || uid; // گیرنده = کسی که کار دست اوست
      }
      if (!UUID_RE.test(String(uid))) return res.status(400).json({ error: "گیرنده‌ی تیکت مشخص نیست." });
      db.insert("team_tickets", { user_id: uid, task_id: taskId, message, level });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  admin.get("/tickets", async (req, res) => {
    try {
      const rows = db.all("SELECT * FROM team_tickets ORDER BY created_at DESC LIMIT 100");
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries(db.all(`SELECT id, label FROM team_tasks WHERE id IN (${db.ph(ids)})`, ids).map((t) => [t.id, t.label])) : {};
      const mem = Object.fromEntries(db.all("SELECT user_id, display_name FROM team_members").map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      res.json(rows.map((r) => ({ ...r, name: mem[r.user_id] || r.user_id.slice(0, 8), label: r.task_id ? lab[r.task_id] || null : null })));
    } catch (e) { fail(res, e); }
  });
  admin.delete("/tickets/:id", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try { db.remove("team_tickets", "id=?", [req.params.id]); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  // ---------- برداشت‌ها (ادمین) ----------
  admin.get("/withdrawals", async (req, res) => {
    try {
      const rows = db.all("SELECT * FROM team_withdrawals ORDER BY created_at DESC LIMIT 100");
      const mem = Object.fromEntries(db.all("SELECT user_id, display_name FROM team_members").map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      res.json(rows.map((r) => ({ ...r, name: mem[r.user_id] || r.user_id.slice(0, 8), toman: r.tokens * r.toman_per_token })));
    } catch (e) { fail(res, e); }
  });
  // «پرداخت شد»: بعد از واریز واقعی پول؛ توکن از حساب کم می‌شود (kind=payout مثل تسویه‌ی دستی)
  admin.post("/withdrawals/:id/pay", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const note = String((req.body || {}).note || "").trim().slice(0, 300) || null;
    try {
      const w = db.get("SELECT * FROM team_withdrawals WHERE id=?", [req.params.id]);
      if (!w || w.status !== "pending") return res.status(409).json({ error: "این درخواست در انتظار بررسی نیست." });
      if ((await balanceOf(w.user_id)) < w.tokens) return res.status(400).json({ error: "موجودی عضو از مبلغ درخواست کمتر شده؛ درخواست را رد کن یا موجودی را اصلاح کن." });
      const amount = w.tokens * w.toman_per_token;
      // تغییر وضعیت + کسر توکن در یک تراکنش: یا هر دو انجام می‌شود یا هیچ‌کدام
      const rows = db.tx(() => {
        const r = db.update("team_withdrawals", { status: "paid", admin_note: note, decided_at: new Date().toISOString() }, "id=? AND status='pending'", [w.id]);
        if (r.length) db.insert("team_ledger", { user_id: w.user_id, tokens: -w.tokens, kind: "payout", note: `برداشت ${amount} تومان` });
        return r;
      });
      if (!rows.length) return res.status(409).json({ error: "این درخواست همین الان بررسی شد." });
      await notify(w.user_id, null, `برداشت ${fmt(amount)} تومان انجام شد.${note ? " " + note : ""}`, "info");
      res.json({ ok: true, toman: amount });
    } catch (e) { fail(res, e); }
  });
  admin.post("/withdrawals/:id/reject", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const note = String((req.body || {}).note || "").trim().slice(0, 300);
    if (!note) return res.status(400).json({ error: "دلیل رد را بنویس." });
    try {
      const rows = db.update("team_withdrawals", { status: "rejected", admin_note: note, decided_at: new Date().toISOString() }, "id=? AND status='pending'", [req.params.id]);
      if (!rows.length) return res.status(409).json({ error: "این درخواست در انتظار بررسی نیست." });
      await notify(rows[0].user_id, null, `درخواست برداشت ${fmt(rows[0].tokens * rows[0].toman_per_token)} تومان رد شد: ${note}`, "warning");
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- تیکت‌های کارمندها (ادمین) ----------
  admin.get("/support", async (req, res) => {
    try {
      const rows = db.all("SELECT * FROM team_support ORDER BY created_at DESC LIMIT 100");
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];
      const lab = ids.length ? Object.fromEntries(db.all(`SELECT id, label, title FROM team_tasks WHERE id IN (${db.ph(ids)})`, ids).map((t) => [t.id, `${t.label} — ${t.title}`])) : {};
      const mem = Object.fromEntries(db.all("SELECT user_id, display_name FROM team_members").map((m) => [m.user_id, m.display_name || m.user_id.slice(0, 8)]));
      res.json(rows.map((r) => ({ ...r, name: mem[r.user_id] || r.user_id.slice(0, 8), task: r.task_id ? lab[r.task_id] || null : null })));
    } catch (e) { fail(res, e); }
  });
  admin.post("/support/:id/reply", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    const message = String((req.body || {}).message || "").trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: "متن پاسخ را بنویس." });
    try {
      const rows = db.update("team_support", { reply: message, status: "answered", replied_at: new Date().toISOString(), user_read_at: null }, "id=?", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "تیکت پیدا نشد." });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  admin.delete("/support/:id", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try { db.remove("team_support", "id=?", [req.params.id]); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  // افزودن/ویرایش عضو با ایمیل یا شماره موبایل
  admin.post("/members", async (req, res) => {
    const { identifier, name, banner_name } = req.body || {};
    const rl = ["typist"]; // این پنل فقط تایپ است
    const idf = String(identifier || "").trim();
    if (!idf) return res.status(400).json({ error: "ایمیل یا شماره موبایل لازم است." });
    try {
      const isEmail = idf.includes("@");
      const phone = isEmail ? null : normalizeIranPhone(idf);
      if (!isEmail && !phone) return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
      const user = db.findAuthUser({ phone, email: isEmail ? idf.toLowerCase() : null });
      if (!user) return res.status(404).json({ error: "کاربری با این مشخصات در سایت ثبت‌نام نکرده است." });
      const dn = String(name || idf).slice(0, 80);
      const bn = cleanBannerName(banner_name) || (looksLikeId(dn) ? "" : cleanBannerName(dn)) || null; // هر تایپیست از همان اول یک اسم روی بنر دارد
      if (db.get("SELECT 1 AS x FROM team_members WHERE user_id=?", [user.id])) db.update("team_members", { display_name: dn, roles: rl, active: true, ...(cleanBannerName(banner_name) ? { banner_name: bn } : {}) }, "user_id=?", [user.id]);
      else db.insert("team_members", { user_id: user.id, display_name: dn, roles: rl, active: true, banner_name: bn });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  admin.delete("/members/:uid", async (req, res) => {
    if (!UUID_RE.test(req.params.uid)) return res.status(400).json({ error: "شناسه نامعتبر است." });
    try { db.update("team_members", { active: false }, "user_id=?", [req.params.uid]); res.json({ ok: true }); }
    catch (e) { fail(res, e); }
  });

  // ثبت تسویه (کسر توکن بعد از پرداخت واقعی پول به عضو)
  admin.post("/payout", async (req, res) => {
    const { user_id } = req.body || {};
    const tokens = parseInt((req.body || {}).tokens, 10);
    if (!UUID_RE.test(String(user_id)) || !(tokens > 0)) return res.status(400).json({ error: "ورودی نامعتبر است." });
    try {
      if ((await balanceOf(user_id)) < tokens) return res.status(400).json({ error: "موجودی کافی نیست." });
      db.insert("team_ledger", { user_id, tokens: -tokens, kind: "payout", note: `تسویه ${tokens * TOMAN_PER_TOKEN} تومان` });
      res.json({ ok: true, toman: tokens * TOMAN_PER_TOKEN });
    } catch (e) { fail(res, e); }
  });

  // جارو: آزادسازی کارهای رهاشده + (اختیاری) تایید خودکار تحویل‌های بررسی‌نشده
  async function sweep() {
    try {
      db.ready();
      // بعد از ۳۶ ساعت بدون اولین تحویل: آزادسازی + کسر کل توکن کار از کارمند
      {
        const cut = new Date(Date.now() - (DEADLINE_H + GRACE_H) * 36e5).toISOString();
        const over = db.all("SELECT id, assignee, reward_tokens, label FROM team_tasks WHERE status='claimed' AND first_submitted_at IS NULL AND first_claimed_at < ?", [cut]);
        for (const t of over) {
          const rows = db.update("team_tasks", { status: "open", assignee: null, claimed_at: null, first_claimed_at: null, quality: null, admin_note: null }, "id=? AND status='claimed' AND first_submitted_at IS NULL", [t.id]);
          if (!rows.length || !t.assignee) continue;
          await ledgerAdd([{ user_id: t.assignee, tokens: -t.reward_tokens, note: `جریمه‌ی عدم تحویل در ${DEADLINE_H + GRACE_H} ساعت (کسر کل توکن کار) — ${t.label}` }]);
          await notify(t.assignee, null, `کار ${t.label} را در ${DEADLINE_H + GRACE_H} ساعت تحویل ندادی؛ کار آزاد شد و ${t.reward_tokens} توکن کسر شد.`, "warning");
          console.log(`[team] کار ${t.label} بعد از مهلت آزاد و جریمه شد`);
        }
      }
      if (CLAIM_HOURS > 0) {
        const cut = new Date(Date.now() - CLAIM_HOURS * 36e5).toISOString();
        const freed = db.update("team_tasks", { status: "open", assignee: null, claimed_at: null, first_claimed_at: null, first_submitted_at: null, quality: null, admin_note: null }, "status='claimed' AND claimed_at < ?", [cut]);
        if (freed.length) console.log(`[team] ${freed.length} کار رهاشده خودکار آزاد شد`);
      }
      if (AUTO_APPROVE_HOURS > 0) {
        const cut = new Date(Date.now() - AUTO_APPROVE_HOURS * 36e5).toISOString();
        for (const t of db.all("SELECT id FROM team_tasks WHERE status='submitted' AND submitted_at < ?", [cut])) {
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

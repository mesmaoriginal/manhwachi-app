// blog/blogRouter.js
// API پنل وبلاگ، زیر /panel/api (کاملاً جدا از /admin).
// مرحله‌ی ۱: احراز هویت، مدیریت کارکنان، دسته‌ها، CRUD مقاله و صفحه.

const express = require("express");
const path = require("path");
const { sb, enc } = require("./blogDb");
const A = require("./blogAuth");
const { SchemaError, normalizeBlocks } = require("./blockSchema");
const { seoProblems } = require("./blogSeo");
const { plainText, countWords } = require("./blogRender");

const router = express.Router();

// ---------- هدرهای عمومی پنل ----------
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});
// بدنه‌ی بزرگ‌تر از JSON سراسری سایت (۵۰KB) لازمه؛ این روتر باید قبل از
// express.json سراسری در server.js مانت بشه.
router.use(express.json({ limit: "2mb" }));
router.use(A.csrfGuard);
// صفحه‌ی پنل (فایل استاتیک؛ خودش با API لاگین می‌کنه)
router.use(express.static(path.join(__dirname, "panel"), { index: "index.html", maxAge: 0 }));

// ---------- ابزارها ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;
const ROLES = ["admin", "editor", "author", "support"];
const COVER_STYLES = ["full", "split", "overlay", "compact", "none"];
const STATUSES = ["draft", "review", "published", "archived"];
const MAX_CONTENT_BYTES = 1_500_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SchemaError) return res.status(400).json({ error: e.message });
    if (e && e.status === 409) {
      let code = "";
      try { code = JSON.parse(e.detail).code; } catch { /* detail JSON نبود */ }
      return res.status(409).json({ error: code === "23503" ? "مرجع انتخاب‌شده (دسته/کاربر) وجود ندارد" : "این مقدار (نشانک/نام) قبلاً استفاده شده" });
    }
    console.error("[blog]", req.method, req.path, e.message, e.detail || "");
    res.status(500).json({ error: "خطای داخلی سرور" });
  }
};

// نشانک (slug) یکدست: حروف عربی → فارسی، ارقام فارسی/عربی → انگلیسی (آدرس کوتاه‌تر و بدون
// دو نسخه‌ی مختلف از یک کلمه)، حذف کشیده/اعراب/نیم‌فاصله و هر نمادی.
// auto=true (ساخت از روی عنوان): حداکثر ۷۰ کاراکتر و برش در مرز کلمه؛ آدرس کوتاه برای سئو بهتره.
function normSlug(s, { auto = false } = {}) {
  let out = String(s || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/\u0640/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (auto && out.length > 70) {
    const cut = out.slice(0, 70);
    const i = cut.lastIndexOf("-");
    out = i >= 30 ? cut.slice(0, i) : cut;
  }
  return out.slice(0, 120).replace(/-+$/g, "");
}

function str(v, max, { required = false, field = "فیلد", oneLine = false } = {}) {
  let s = typeof v === "string" ? v : "";
  // کاراکترهای کنترلی حذف می‌شن؛ در حالت oneLine هر فاصله/خط‌جدید به یک فاصله تبدیل می‌شه
  // (عنوان و توضیح متا نباید خط‌جدید داشته باشن).
  s = s.replace(oneLine ? /[\u0000-\u001F\u007F\s]+/g : /[\u0000-\u0008\u000B-\u001F\u007F]/g, oneLine ? " " : "").trim();
  if (required && !s) throw new HttpError(400, `${field} الزامی است`);
  if (s.length > max) throw new HttpError(400, `${field} بیش از ${max} کاراکتر است`);
  return s;
}

function urlField(v, field) {
  const s = str(v, 1000, { field });
  if (!s) return "";
  if (!/^(https:\/\/|\/(?!\/))[^\s<>"'`\\]*$/.test(s)) throw new HttpError(400, `${field} نامعتبر است`);
  return s;
}

// ابعاد تصویرهای کتابخانه‌ی رسانه رو (از جدول blog_media) داخل بلوک تصویر می‌ذاریم؛
// سایت عمومی با width/height روی <img> جلوی پرش چیدمان (CLS) رو می‌گیره که روی سئو اثر داره.
// مقدار هیچ‌وقت از کلاینت قبول نمی‌شه.
const MEDIA_URL_RE = /^\/blog-media\/\d{4}-\d{2}\/[a-f0-9]{24}\.webp$/;

async function attachImageSizes(blocks) {
  const imgs = blocks.filter((b) => b.type === "image" && MEDIA_URL_RE.test(b.data.src));
  if (!imgs.length) return blocks;
  const urls = [...new Set(imgs.map((b) => b.data.src))];
  const dims = new Map();
  try {
    for (let i = 0; i < urls.length; i += 40) {
      const list = urls.slice(i, i + 40).map((u) => `"${u}"`).join(",");
      const rows = await sb(`blog_media?url=in.${enc(`(${list})`)}&select=url,width,height`);
      for (const r of rows || []) if (r.width > 0 && r.height > 0) dims.set(r.url, r);
    }
  } catch (e) {
    console.error("[blog] attachImageSizes:", e.message); // ذخیره‌ی مقاله نباید به‌خاطر این خراب بشه
  }
  for (const b of imgs) {
    const d = dims.get(b.data.src);
    if (d) {
      b.data.w = d.width;
      b.data.h = d.height;
    }
  }
  return blocks;
}

// محتوا با blockSchema.js کاملاً نرمال‌سازی می‌شه (هیچ HTML‌ای ذخیره نمی‌شه).
async function validateBlocks(content) {
  const blocks = await attachImageSizes(normalizeBlocks(content));
  if (Buffer.byteLength(JSON.stringify(blocks)) > MAX_CONTENT_BYTES) {
    throw new HttpError(400, "حجم محتوا بیش از حد مجاز است");
  }
  return blocks;
}

const isLive = (d) => !!d && new Date(d).getTime() <= Date.now();
const MAX_REVISIONS = 20;
const REVISION_GAP_MS = 3 * 60 * 1000;

// ---------- نشانک‌های قبلی (برای ریدایرکت ۳۰۱ در سایت عمومی) ----------
// نشانکی که قبلاً مال مطلب دیگری بوده و ریدایرکت داره نباید دوباره به کسِ دیگه داده بشه.
async function assertSlugFree(table, slug, selfId) {
  let q = `${table}?old_slugs=cs.${enc(`{"${slug}"}`)}&select=id&limit=1`;
  if (selfId) q += `&id=neq.${enc(selfId)}`;
  const rows = await sb(q);
  if (rows && rows[0]) throw new HttpError(409, "این نشانک قبلاً برای مورد دیگری استفاده شده و ریدایرکت دارد؛ نشانک دیگری انتخاب کنید");
}

// اگر مورد قبلاً منتشر شده بوده (published_at دارد) آدرس فعلی‌اش وارد old_slugs می‌شه.
function nextOldSlugs(row, newSlug) {
  const olds = new Set(row.old_slugs || []);
  // فقط اگر مطلب واقعاً عمومی شده بوده (انتشار زمان‌بندی‌شده‌ی هنوز نرسیده، آدرس عمومی ندارد)
  if (isLive(row.published_at)) olds.add(row.slug);
  olds.delete(newSlug);
  return [...olds].slice(-30);
}

function tagsField(v) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 15) throw new HttpError(400, "حداکثر ۱۵ تگ مجاز است");
  return [...new Set(v.map((t) => str(t, 40, { oneLine: true })).filter(Boolean))];
}

// ---------- تاریخچه‌ی نسخه‌ها ----------
// نسخه‌ی «قبل از تغییر» ذخیره می‌شود. ذخیره‌ی خودکار هر ۴۵ ثانیه است؛ برای اینکه تاریخچه پر نشود،
// اگر آخرین نسخه کمتر از ۳ دقیقه پیش ساخته شده باشد نسخه‌ی جدید ساخته نمی‌شود (مگر force).
async function snapshot(kind, row, staffId, { force }) {
  try {
    if (!row || (!row.title && !(row.content || []).length)) return;
    if (!force) {
      const last = await sb(`blog_revisions?kind=eq.${kind}&item_id=eq.${enc(row.id)}&select=created_at&order=created_at.desc&limit=1`);
      if (last && last[0] && Date.now() - new Date(last[0].created_at).getTime() < REVISION_GAP_MS) return;
    }
    await sb("blog_revisions", {
      method: "POST",
      body: { kind, item_id: row.id, title: row.title || "", content: row.content || [], saved_by: staffId },
    });
    // فقط ۲۰ نسخه‌ی آخر نگه داشته می‌شود
    const old = await sb(`blog_revisions?kind=eq.${kind}&item_id=eq.${enc(row.id)}&select=id&order=created_at.desc&offset=${MAX_REVISIONS}&limit=100`);
    if (old && old.length) {
      await sb(`blog_revisions?id=in.${enc("(" + old.map((r) => r.id).join(",") + ")")}`, { method: "DELETE" });
    }
  } catch (e) {
    // تاریخچه یک امکان کمکی است؛ خرابی‌اش نباید ذخیره‌ی مطلب را خراب کند
    console.error("[blog] snapshot:", e.message, e.detail || "");
  }
}

// ---------- ورود / خروج ----------
router.post("/api/login", wrap(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!USERNAME_RE.test(username) || !password || password.length > 200) {
    throw new HttpError(400, "نام کاربری یا رمز نامعتبر است");
  }
  if (A.isLoginBlocked(req.ip, username)) {
    throw new HttpError(429, "تلاش‌های ناموفق زیاد بود؛ ۱۵ دقیقه بعد دوباره امتحان کنید");
  }

  const rows = await sb(
    `blog_staff?username=eq.${enc(username)}&select=id,password_hash,is_active,session_version&limit=1`
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const ok = await A.verifyPassword(password, row ? row.password_hash : await A.DUMMY_HASH_PROMISE);

  if (!row || !ok || !row.is_active) {
    A.recordLoginFailure(req.ip, username);
    throw new HttpError(401, "نام کاربری یا رمز عبور اشتباه است");
  }

  A.clearLoginFailures(req.ip, username);
  A.setSessionCookie(req, res, A.createSessionToken(row.id, row.session_version));
  sb(`blog_staff?id=eq.${enc(row.id)}`, { method: "PATCH", body: { last_login_at: new Date().toISOString() } })
    .catch(() => {});
  res.json({ ok: true });
}));

router.post("/api/logout", (req, res) => {
  A.clearSessionCookie(req, res);
  res.json({ ok: true });
});

// از اینجا به بعد همه‌چیز نیاز به ورود دارد
router.use("/api", A.requireStaff);

router.get("/api/me", wrap(async (req, res) => {
  const { id, username, display_name, role, can_publish } = req.staff;
  let profile = { bio: "", avatar_url: "", public_slug: null };
  try {
    const r = await sb(`blog_staff?id=eq.${enc(id)}&select=bio,avatar_url,public_slug&limit=1`);
    if (r && r[0]) profile = r[0];
  } catch { /* پروفایل اختیاری است */ }
  res.json({ id, username, display_name, role, can_publish, permissions: A.permsOf(req.staff), ...profile });
}));

// پروفایل خود نویسنده: نام نمایشی، معرفی کوتاه، عکس و آدرس عمومی صفحه‌ی نویسنده
const RESERVED_SLUGS = new Set(["search", "category", "tag", "author", "preview", "rss", "rss.xml", "sitemap.xml"]);
router.put("/api/me", wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.display_name !== undefined) patch.display_name = str(b.display_name, 80, { required: true, field: "نام نمایشی", oneLine: true });
  if (b.bio !== undefined) patch.bio = str(b.bio, 500, { oneLine: true });
  if (b.avatar_url !== undefined) patch.avatar_url = urlField(b.avatar_url, "آدرس عکس");
  if (b.public_slug !== undefined) {
    const v = String(b.public_slug || "").trim();
    if (!v) patch.public_slug = null;
    else {
      const sl = normSlug(v);
      if (sl.length < 3 || RESERVED_SLUGS.has(sl)) throw new HttpError(400, "آدرس عمومی نویسنده نامعتبر یا رزروشده است (حداقل ۳ کاراکتر)");
      patch.public_slug = sl.slice(0, 40);
    }
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "چیزی برای تغییر ارسال نشده");
  await sb(`blog_staff?id=eq.${enc(req.staff.id)}`, { method: "PATCH", body: patch });
  A.invalidateStaff(req.staff.id);
  res.json({ ok: true, ...patch });
}));

// ---------- داشبورد ----------
router.get("/api/dashboard", wrap(async (req, res) => {
  const all = A.can(req.staff, "posts.write.all");
  if (!all && !A.can(req.staff, "posts.write.own")) throw new HttpError(403, "دسترسی کافی ندارید");
  let q = "blog_posts?select=id,slug,title,status,views,published_at,updated_at,author_id&limit=5000";
  if (!all) q += `&author_id=eq.${enc(req.staff.id)}`;
  const rows = (await sb(q)) || [];
  const c = { published: 0, scheduled: 0, draft: 0, review: 0, archived: 0, views: 0 };
  for (const r of rows) {
    if (r.status === "published") c[isLive(r.published_at) ? "published" : "scheduled"]++;
    else if (c[r.status] !== undefined) c[r.status]++;
    c.views += r.views || 0;
  }
  const live = rows.filter((r) => r.status === "published" && isLive(r.published_at));
  res.json({
    counts: c,
    top: [...live].sort((a, b) => b.views - a.views).slice(0, 5).map(({ id, title, views }) => ({ id, title, views })),
    review: rows.filter((r) => r.status === "review").slice(0, 8).map(({ id, title }) => ({ id, title })),
    upcoming: rows
      .filter((r) => r.status === "published" && !isLive(r.published_at))
      .sort((a, b) => a.published_at.localeCompare(b.published_at))
      .slice(0, 5)
      .map(({ id, title, published_at }) => ({ id, title, published_at })),
  });
}));

// تگ‌های پرکاربرد (برای پیشنهاد در ویرایشگر)
router.get("/api/tags", wrap(async (req, res) => {
  const rows = (await sb("blog_posts?select=tags&limit=5000")) || [];
  const n = new Map();
  for (const r of rows) for (const t of r.tags || []) n.set(t, (n.get(t) || 0) + 1);
  res.json([...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([name, count]) => ({ name, count })));
}));


// ---------- مدیریت کارکنان (فقط ادمین وبلاگ) ----------
const STAFF_COLS = "id,username,display_name,role,can_publish,is_active,created_at,last_login_at";

router.get("/api/staff", A.requirePerm("staff.manage"), wrap(async (req, res) => {
  res.json(await sb(`blog_staff?select=${STAFF_COLS}&order=created_at.asc`));
}));

router.post("/api/staff", A.requirePerm("staff.manage"), wrap(async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "نام کاربری: ۳ تا ۳۲ حرف انگلیسی/عدد/._-");
  if (typeof b.password !== "string" || b.password.length < 10 || b.password.length > 200) {
    throw new HttpError(400, "رمز باید حداقل ۱۰ کاراکتر باشد");
  }
  const role = ROLES.includes(b.role) ? b.role : "author";
  const rows = await sb("blog_staff", {
    method: "POST",
    prefer: "return=representation",
    body: {
      username,
      display_name: str(b.display_name, 80, { oneLine: true }) || username,
      password_hash: await A.hashPassword(b.password),
      role,
      can_publish: role === "author" ? !!b.can_publish : false,
    },
  });
  const { password_hash, ...safe } = rows[0];
  res.status(201).json(safe);
}));

router.put("/api/staff/:id", A.requirePerm("staff.manage"), wrap(async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new HttpError(400, "شناسه نامعتبر");
  const b = req.body || {};
  const patch = {};
  let bumpSession = false;

  if (b.display_name !== undefined) patch.display_name = str(b.display_name, 80, { required: true, field: "نام نمایشی", oneLine: true });
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) throw new HttpError(400, "نقش نامعتبر");
    patch.role = b.role;
    if (b.role !== "author") patch.can_publish = false;
    bumpSession = true;
  }
  // can_publish فقط برای نقش «نویسنده» معنا داره (can() هم برای بقیه نادیده‌ش می‌گیره)
  if (b.can_publish !== undefined && patch.can_publish === undefined) patch.can_publish = !!b.can_publish;
  if (b.is_active !== undefined) {
    patch.is_active = !!b.is_active;
    if (!patch.is_active) bumpSession = true;
  }
  if (b.password !== undefined) {
    if (typeof b.password !== "string" || b.password.length < 10 || b.password.length > 200) {
      throw new HttpError(400, "رمز باید حداقل ۱۰ کاراکتر باشد");
    }
    patch.password_hash = await A.hashPassword(b.password);
    bumpSession = true;
  }

  // ادمین نمی‌تونه نقش یا فعال بودن خودش رو خراب کنه (جلوگیری از قفل شدن پنل)
  if (id === req.staff.id && ((patch.role && patch.role !== "admin") || patch.is_active === false)) {
    throw new HttpError(400, "نمی‌توانید نقش یا فعال‌بودن حساب خودتان را تغییر دهید");
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "چیزی برای تغییر ارسال نشده");

  if (bumpSession) {
    const cur = await sb(`blog_staff?id=eq.${enc(id)}&select=session_version&limit=1`);
    if (!cur || !cur[0]) throw new HttpError(404, "کاربر پیدا نشد");
    patch.session_version = cur[0].session_version + 1;
  }
  const rows = await sb(`blog_staff?id=eq.${enc(id)}&select=${STAFF_COLS}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: patch,
  });
  if (!rows || !rows[0]) throw new HttpError(404, "کاربر پیدا نشد");
  A.invalidateStaff(id);
  res.json(rows[0]);
}));

// ---------- رسانه ----------
router.post("/api/media", A.requirePerm("media.upload"), (req, res, next) => require("./blogMedia").uploadMiddleware(req, res, next),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, "فایلی ارسال نشد");
    let img;
    try {
      img = await require("./blogMedia").storeImage(req.file.path);
    } catch (e) {
      if (e && e.userError) throw new HttpError(400, e.message);
      throw e;
    }
    const rows = await sb("blog_media", {
      method: "POST",
      prefer: "return=representation",
      body: { url: img.url, width: img.width, height: img.height, bytes: img.bytes, uploader_id: req.staff.id },
    });
    res.status(201).json(rows[0]);
  })
);

router.get("/api/media", A.requirePerm("media.upload"), wrap(async (req, res) => {
  const mine = !A.can(req.staff, "posts.write.all");
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.json(await sb(`blog_media?select=id,url,width,height,created_at&order=created_at.desc&limit=60&offset=${(page - 1) * 60}${mine ? `&uploader_id=eq.${enc(req.staff.id)}` : ""}`));
}));

// ---------- جستجوی مانهوا برای بلوک «کارت مانهوا» (فقط‌خواندنی) ----------
router.get("/api/manhwas", wrap(async (req, res) => {
  if (!A.can(req.staff, "posts.write.own") && !A.can(req.staff, "posts.write.all")) throw new HttpError(403, "دسترسی کافی ندارید");
  const data = require("../admin/dataStore").readData();
  const toItem = ([slug, m]) => ({ slug, title_fa: m.title_fa || "", title_en: m.title_en || "", cover_image: m.cover_image || "" });
  if (req.query.slug) {
    const slug = String(req.query.slug);
    return res.json(Object.hasOwn(data, slug) ? [toItem([slug, data[slug]])] : []);
  }
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 60);
  if (!q) return res.json([]);
  res.json(
    Object.entries(data)
      .filter(([slug, m]) => `${slug} ${m.title_fa || ""} ${m.title_en || ""}`.toLowerCase().includes(q))
      .slice(0, 12)
      .map(toItem)
  );
}));

// ---------- دسته‌بندی ----------
router.get("/api/categories", wrap(async (req, res) => {
  let rows;
  res.json(await sb("blog_categories?select=id,slug,name,description&order=name.asc"));
}));

router.post("/api/categories", A.requirePerm("taxonomy.manage"), wrap(async (req, res) => {
  const name = str(req.body?.name, 60, { required: true, field: "نام دسته", oneLine: true });
  const slug = normSlug(req.body?.slug || name, { auto: !req.body?.slug });
  if (!slug) throw new HttpError(400, "نشانک نامعتبر");
  await assertSlugFree("blog_categories", slug, null);
  const description = str(req.body?.description, 300, { oneLine: true });
  const rows = await sb("blog_categories", { method: "POST", prefer: "return=representation", body: { name, slug, ...(description ? { description } : {}) } });
  res.status(201).json(rows[0]);
}));

router.put("/api/categories/:id", A.requirePerm("taxonomy.manage"), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new HttpError(400, "شناسه نامعتبر");
  const patch = {};
  if (req.body?.name !== undefined) patch.name = str(req.body.name, 60, { required: true, field: "نام دسته", oneLine: true });
  if (req.body?.description !== undefined) patch.description = str(req.body.description, 300, { oneLine: true });
  if (req.body?.slug !== undefined) {
    patch.slug = normSlug(req.body.slug);
    if (!patch.slug) throw new HttpError(400, "نشانک نامعتبر");
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "چیزی برای تغییر ارسال نشده");
  if (patch.slug) {
    const cur = await sb(`blog_categories?id=eq.${enc(req.params.id)}&select=id,slug,old_slugs&limit=1`);
    if (!cur || !cur[0]) throw new HttpError(404, "پیدا نشد");
    if (cur[0].slug !== patch.slug) {
      await assertSlugFree("blog_categories", patch.slug, req.params.id);
      // صفحه‌ی دسته همیشه عمومی است، پس آدرس قبلی همیشه نگه داشته می‌شود
      patch.old_slugs = nextOldSlugs({ ...cur[0], published_at: true }, patch.slug);
    }
  }
  const rows = await sb(`blog_categories?id=eq.${enc(req.params.id)}`, { method: "PATCH", prefer: "return=representation", body: patch });
  if (!rows || !rows[0]) throw new HttpError(404, "پیدا نشد");
  res.json(rows[0]);
}));

router.delete("/api/categories/:id", A.requirePerm("taxonomy.manage"), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new HttpError(400, "شناسه نامعتبر");
  await sb(`blog_categories?id=eq.${enc(req.params.id)}`, { method: "DELETE" });
  res.json({ ok: true });
}));

// ---------- مقاله و صفحه (کارخانه‌ی مشترک) ----------
async function pickFields(kind, b, { partial, staff }) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  const need = (k) => !partial || has(k);

  if (need("title")) out.title = str(b.title, 200, { required: true, field: "عنوان", oneLine: true });
  if (need("slug") || (!partial && !has("slug"))) {
    const slug = normSlug(has("slug") && String(b.slug || "").trim() ? b.slug : b.title, { auto: !(has("slug") && String(b.slug || "").trim()) });
    if (!slug) throw new HttpError(400, "نشانک (slug) نامعتبر است");
    // این نشانک‌ها آدرس‌های خود وبلاگ‌اند (/blog/search و ...) و با مطلب تداخل پیدا می‌کنند
    if (kind === "posts" && RESERVED_SLUGS.has(slug)) throw new HttpError(400, "این نشانک رزرو شده است؛ نشانک دیگری انتخاب کنید");
    out.slug = slug;
  }
  if (has("content")) {
    out.content = await validateBlocks(b.content);
    if (kind === "posts") {
      // متن ساده برای جستجو + شمارش کلمات (زمان مطالعه)
      const text = plainText(out.content);
      out.search_text = text.slice(0, 200000);
      out.word_count = countWords(text);
    }
  }
  if (has("seo_title")) out.seo_title = str(b.seo_title, 120, { oneLine: true });
  if (has("seo_desc")) out.seo_desc = str(b.seo_desc, 320, { oneLine: true });

  if (kind === "posts") {
    if (has("excerpt")) out.excerpt = str(b.excerpt, 400, { oneLine: true });
    if (has("cover_url")) out.cover_url = urlField(b.cover_url, "آدرس کاور");
    if (has("cover_alt")) out.cover_alt = str(b.cover_alt, 200, { oneLine: true });
    if (has("cover_style")) {
      if (!COVER_STYLES.includes(b.cover_style)) throw new HttpError(400, "نوع کاور نامعتبر");
      out.cover_style = b.cover_style;
    }
    if (has("category_id")) {
      if (b.category_id !== null && !UUID_RE.test(String(b.category_id))) throw new HttpError(400, "دسته نامعتبر");
      out.category_id = b.category_id;
    }
    if (has("tags")) out.tags = tagsField(b.tags);
    if (has("focus_keyword")) out.focus_keyword = str(b.focus_keyword, 80, { oneLine: true });
    if (has("canonical_url")) {
      out.canonical_url = urlField(b.canonical_url, "آدرس canonical");
      if (out.canonical_url.startsWith("/")) throw new HttpError(400, "آدرس canonical باید با https:// شروع شود");
    }
    if (has("noindex")) out.noindex = !!b.noindex;
    if (has("featured")) {
      // مطلب ویژه یک تصمیم سردبیری است؛ نویسنده‌ی بدون مجوز انتشار نمی‌تواند عوضش کند
      if (!!b.featured && staff && !A.can(staff, "posts.publish") && !A.can(staff, "posts.write.all")) {
        throw new HttpError(403, "فقط ویراستار/ادمین می‌تواند مطلب ویژه تعیین کند");
      }
      out.featured = !!b.featured;
    }
  }
  return out;
}

function mountContent(kind, table) {
  const own = `${kind}.write.own`;
  const all = `${kind}.write.all`;
  const canWrite = (s) => A.can(s, own) || A.can(s, all);
  const guard = (req, res, next) =>
    canWrite(req.staff) ? next() : res.status(403).json({ error: "دسترسی کافی ندارید" });

  const canEdit = (staff, row) => {
    if (A.can(staff, all)) return true;
    if (!A.can(staff, own) || row.author_id !== staff.id) return false;
    // نویسنده‌ی بدون مجوز انتشار، بعد از انتشار دیگه نمی‌تونه مطلب رو دستکاری کنه
    return row.status === "draft" || row.status === "review" || A.can(staff, "posts.publish");
  };

  async function getRow(id) {
    if (!UUID_RE.test(id)) throw new HttpError(400, "شناسه نامعتبر");
    const rows = await sb(`${table}?id=eq.${enc(id)}&select=*&limit=1`);
    if (!rows || !rows[0]) throw new HttpError(404, "پیدا نشد");
    return rows[0];
  }

  const base = `/api/${kind}`;

  router.get(base, guard, wrap(async (req, res) => {
    const cols = kind === "posts"
      ? "id,slug,title,status,author_id,category_id,cover_url,views,featured,word_count,published_at,created_at,updated_at"
      : "id,slug,title,status,author_id,published_at,created_at,updated_at";
    const sorts = { updated: "updated_at.desc", published: "published_at.desc.nullslast", views: "views.desc", title: "title.asc" };
    const sortKey = kind === "posts" && sorts[req.query.sort] ? req.query.sort : kind !== "posts" && req.query.sort === "title" ? "title" : "updated";
    let q = `${table}?select=${cols}&order=${sorts[sortKey]}`;
    if (!A.can(req.staff, all)) q += `&author_id=eq.${enc(req.staff.id)}`;
    if (req.query.status === "scheduled") q += `&status=eq.published&published_at=gt.${enc(new Date().toISOString())}`;
    else if (STATUSES.includes(req.query.status)) q += `&status=eq.${req.query.status}`;
    const term = String(req.query.q || "").replace(/[*%,()\\]/g, " ").trim().slice(0, 80);
    if (term) q += `&title=ilike.*${enc(term)}*`;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    q += `&limit=30&offset=${(page - 1) * 30}`;
    res.json(await sb(q));
  }));

  router.get(`${base}/:id`, guard, wrap(async (req, res) => {
    const row = await getRow(req.params.id);
    if (!A.can(req.staff, all) && row.author_id !== req.staff.id) throw new HttpError(403, "دسترسی کافی ندارید");
    res.json(row);
  }));

  router.post(base, guard, wrap(async (req, res) => {
    const fields = await pickFields(kind, req.body || {}, { partial: false, staff: req.staff });
    await assertSlugFree(table, fields.slug, null);
    const rows = await sb(table, {
      method: "POST",
      prefer: "return=representation",
      body: { content: [], ...fields, status: "draft", author_id: req.staff.id },
    });
    res.status(201).json(rows[0]);
  }));

  router.put(`${base}/:id`, guard, wrap(async (req, res) => {
    const row = await getRow(req.params.id);
    if (!canEdit(req.staff, row)) throw new HttpError(403, "اجازه‌ی ویرایش این مورد را ندارید");
    const patch = await pickFields(kind, req.body || {}, { partial: true, staff: req.staff });
    if (!Object.keys(patch).length) throw new HttpError(400, "چیزی برای تغییر ارسال نشده");
    if (patch.slug && patch.slug !== row.slug) {
      await assertSlugFree(table, patch.slug, row.id);
      patch.old_slugs = nextOldSlugs(row, patch.slug);
    }
    // مطلبِ منتشرشده نباید با ویرایش، استانداردهای سئو رو از دست بده
    if (row.status === "published") {
      const problems = seoProblems({ ...row, ...patch }, kind);
      if (problems.length) throw new HttpError(400, "مطلب منتشرشده باید استاندارد سئو را حفظ کند: " + problems.join("؛ "));
    }
    if (patch.content !== undefined || patch.title !== undefined) await snapshot(kind, row, req.staff.id, { force: false });
    const rows = await sb(`${table}?id=eq.${enc(row.id)}`, { method: "PATCH", prefer: "return=representation", body: patch });
    res.json(rows[0]);
  }));

  // تغییر وضعیت: draft / review / published / archived
  router.post(`${base}/:id/status`, guard, wrap(async (req, res) => {
    const target = req.body?.status;
    if (!STATUSES.includes(target)) throw new HttpError(400, "وضعیت نامعتبر");
    const row = await getRow(req.params.id);
    if (!canEdit(req.staff, row)) throw new HttpError(403, "اجازه‌ی تغییر این مورد را ندارید");
    if ((target === "published" || target === "archived") && !A.can(req.staff, "posts.publish")) {
      throw new HttpError(403, "مجوز انتشار ندارید؛ مطلب را برای بررسی بفرستید");
    }
    if (target === "published") {
      const problems = seoProblems(row, kind);
      if (problems.length) throw new HttpError(400, "قبل از انتشار این موارد را اصلاح کنید: " + problems.join("؛ "));
    }
    const patch = { status: target };
    if (target === "published") {
      // publish_at در آینده = انتشار زمان‌بندی‌شده (سایت عمومی تا آن زمان مطلب را نشان نمی‌دهد)
      let when = null;
      if (req.body?.publish_at) {
        when = new Date(req.body.publish_at);
        if (Number.isNaN(when.getTime())) throw new HttpError(400, "تاریخ انتشار نامعتبر است");
        if (when.getTime() > Date.now() + 366 * 24 * 3600 * 1000) throw new HttpError(400, "زمان‌بندی حداکثر تا یک سال بعد ممکن است");
        if (when.getTime() < Date.now()) when = null; // گذشته = همین حالا
      }
      if (when) patch.published_at = when.toISOString();
      else if (!isLive(row.published_at)) patch.published_at = new Date().toISOString(); // اولین انتشار یا «همین حالا» برای مطلب زمان‌بندی‌شده
    } else if (row.published_at && !isLive(row.published_at)) {
      patch.published_at = null; // زمان‌بندی لغو شد
    }
    const rows = await sb(`${table}?id=eq.${enc(row.id)}`, { method: "PATCH", prefer: "return=representation", body: patch });
    res.json(rows[0]);
  }));

  // ---- تاریخچه‌ی نسخه‌ها ----
  const editableRow = async (req) => {
    const row = await getRow(req.params.id);
    if (!A.can(req.staff, all) && row.author_id !== req.staff.id) throw new HttpError(403, "دسترسی کافی ندارید");
    return row;
  };

  router.get(`${base}/:id/revisions`, guard, wrap(async (req, res) => {
    const row = await editableRow(req);
    const revs = (await sb(`blog_revisions?kind=eq.${kind}&item_id=eq.${enc(row.id)}&select=id,title,content,saved_by,created_at&order=created_at.desc&limit=${MAX_REVISIONS}`)) || [];
    const ids = [...new Set(revs.map((r) => r.saved_by).filter(Boolean))];
    const names = new Map();
    if (ids.length) {
      const st = (await sb(`blog_staff?id=in.${enc("(" + ids.join(",") + ")")}&select=id,display_name`)) || [];
      for (const x of st) names.set(x.id, x.display_name);
    }
    res.json(revs.map((r) => ({
      id: r.id,
      title: r.title,
      created_at: r.created_at,
      by: names.get(r.saved_by) || "",
      words: countWords(plainText(r.content)),
      blocks: (r.content || []).length,
    })));
  }));

  router.post(`${base}/:id/revisions/:rid/restore`, guard, wrap(async (req, res) => {
    const row = await editableRow(req);
    if (!canEdit(req.staff, row)) throw new HttpError(403, "اجازه‌ی ویرایش این مورد را ندارید");
    if (!UUID_RE.test(req.params.rid)) throw new HttpError(400, "شناسه نامعتبر");
    const revs = await sb(`blog_revisions?id=eq.${enc(req.params.rid)}&kind=eq.${kind}&item_id=eq.${enc(row.id)}&select=title,content&limit=1`);
    if (!revs || !revs[0]) throw new HttpError(404, "نسخه پیدا نشد");
    const patch = { title: revs[0].title || row.title, content: await validateBlocks(revs[0].content) };
    if (kind === "posts") {
      const text = plainText(patch.content);
      patch.search_text = text.slice(0, 200000);
      patch.word_count = countWords(text);
    }
    if (row.status === "published") {
      const problems = seoProblems({ ...row, ...patch }, kind);
      if (problems.length) throw new HttpError(400, "این نسخه استاندارد سئوی مطلب منتشرشده را ندارد: " + problems.join("؛ "));
    }
    await snapshot(kind, row, req.staff.id, { force: true }); // وضعیت فعلی هم قابل بازگشت می‌ماند
    const rows = await sb(`${table}?id=eq.${enc(row.id)}`, { method: "PATCH", prefer: "return=representation", body: patch });
    res.json(rows[0]);
  }));

  // ---- لینک پیش‌نمایش (۷ روزه) برای دیدن پیش‌نویس قبل از انتشار ----
  router.post(`${base}/:id/preview-link`, guard, wrap(async (req, res) => {
    const row = await editableRow(req);
    res.json({ path: A.makePreviewPath(kind, row.id) });
  }));

  // ---- تکثیر مطلب (پیش‌نویس جدید با همان محتوا) ----
  router.post(`${base}/:id/duplicate`, guard, wrap(async (req, res) => {
    const row = await editableRow(req);
    let slug = normSlug(row.slug + "-copy");
    for (let i = 2; i < 30; i++) {
      const used = await sb(`${table}?slug=eq.${enc(slug)}&select=id&limit=1`);
      const old = await sb(`${table}?old_slugs=cs.${enc(`{"${slug}"}`)}&select=id&limit=1`);
      if (!(used && used[0]) && !(old && old[0])) break;
      slug = normSlug(`${row.slug}-copy-${i}`);
    }
    const copy = { slug, title: (row.title + " (کپی)").slice(0, 200), content: row.content || [], seo_title: row.seo_title, seo_desc: row.seo_desc, status: "draft", author_id: req.staff.id };
    if (kind === "posts") {
      Object.assign(copy, {
        excerpt: row.excerpt, cover_url: row.cover_url, cover_style: row.cover_style, cover_alt: row.cover_alt,
        category_id: row.category_id, tags: row.tags, search_text: row.search_text, word_count: row.word_count,
        focus_keyword: row.focus_keyword, noindex: row.noindex,
      });
    }
    const rows = await sb(table, { method: "POST", prefer: "return=representation", body: copy });
    res.status(201).json(rows[0]);
  }));

  router.delete(`${base}/:id`, guard, wrap(async (req, res) => {
    const row = await getRow(req.params.id);
    const ownDraft = row.author_id === req.staff.id && row.status === "draft";
    if (!A.can(req.staff, all) && !ownDraft) throw new HttpError(403, "اجازه‌ی حذف ندارید");
    await snapshot(kind, row, req.staff.id, { force: true }); // آخرین نسخه در تاریخچه می‌ماند (قابل بازیابی از دیتابیس)
    await sb(`${table}?id=eq.${enc(row.id)}`, { method: "DELETE" });
    res.json({ ok: true });
  }));
}

mountContent("posts", "blog_posts");
mountContent("pages", "blog_pages");

// خطاهای body-parser (JSON خراب، بدنه‌ی خیلی بزرگ) به‌جای صفحه‌ی HTML پیش‌فرض اکسپرس، JSON برگردونن
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "حجم درخواست بیش از حد مجاز است" });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "درخواست نامعتبر است" });
  console.error("[blog] unhandled:", err && err.message);
  res.status(500).json({ error: "خطای داخلی سرور" });
});

module.exports = { router };

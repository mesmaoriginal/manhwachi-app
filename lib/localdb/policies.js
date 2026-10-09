// lib/localdb/policies.js — جایگزین RLS سوپابیس. فقط service_role (کلید سرور) همه‌چیز را می‌بیند.
// برای anon/authenticated هر جدول/عملیات که اینجا تعریف نشده باشد «بسته» است.
//   select/update/delete:  false (هیچ ردیفی) | true (همه) | تابعی که {sql, params} برمی‌گرداند (فیلتر ردیف)
//   insert: تابع (ctx,row) => row  (می‌تواند فیلد را اجباری کند یا HttpError 403 بیندازد)
//   updateCols: ستون‌هایی که کاربر اجازه‌ی تغییرشان را دارد
const { HttpError } = require("./errors");
const sqlite = require("./sqlite");
const notify = require("./notify");

const nowIso = () => new Date().toISOString();
const deny = (m) => new HttpError(403, "42501", m || "new row violates row-level security policy");
const bad = (m) => new HttpError(400, "23514", m);
const own = (col) => (c) => (c.uid ? { sql: `"${col}" = ?`, params: [c.uid] } : false);
const member = (c) => !!(c.uid && sqlite.get("SELECT 1 AS x FROM team_members WHERE user_id = ? AND active = 1", [c.uid]));
const str = (v, max, name) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw bad(`${name} نامعتبر است`); return v; };
const optStr = (v, max, name) => (v == null || v === "" ? null : str(v, max, name));

// ---- محدودیت نرخ نوشتن برای کاربران ناشناس/عادی (در حافظه) ----
const hits = new Map();
function limitWrite(ctx, table) {
  const max = table === "reel_likes" ? 120 : 30, key = `${ctx.ip}:${table}`, now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 600e3);
  if (arr.length >= max) { hits.set(key, arr); throw new HttpError(429, "429", "تعداد درخواست‌ها زیاد است، کمی بعد تلاش کنید"); }
  arr.push(now); hits.set(key, arr);
}
setInterval(() => { const n = Date.now(); for (const [k, a] of hits) { const f = a.filter((t) => n - t < 600e3); f.length ? hits.set(k, f) : hits.delete(k); } }, 300e3).unref();

const isAdmin = (c) => !!(c.uid && sqlite.get("SELECT 1 AS x FROM admins WHERE id = ?", [c.uid]));
const adminOnly = (c) => isAdmin(c);

// این سیاست‌ها دقیقاً از pg_policies و تریگرهای خودِ سوپابیس شما (فایل کوئری ۲) برداشته شده‌اند.
const policies = {
  reels: { select: true, update: true, updateCols: ["likes_count", "comments_count"] },
  plans: { select: true },
  ads: { select: true },
  manhwa_stats: { select: true },
  profiles: { select: true }, // مثل قبل: خواندن همه‌ی پروفایل‌ها برای همه (تغییر فقط با RPC update_own_profile)
  admins: { select: own("id"), update: own("id"), updateCols: ["display_name", "role_tag"] },
  reel_likes: {
    select: true, delete: true,
    insert: (c, r) => ({ reel_id: r.reel_id ?? null, device_id: str(r.device_id, 100, "device_id") }),
  },
  comments: {
    select: () => ({ sql: "approved = 1", params: [] }),
    insert: (c, r) => {
      const reel = str(r.reel_id, 64, "reel_id"), dev = str(r.device_id, 100, "device_id");
      const n = sqlite.get("SELECT COUNT(*) AS n FROM comments WHERE reel_id = ? AND device_id = ?", [reel, dev]).n;
      if (n >= 3) throw new HttpError(400, "P0001", "شما فقط مجاز به ثبت ۳ نظر در این پست هستید!");
      return { reel_id: reel, device_id: dev, username: str(r.username, 60, "username"), text: str(r.text, 1000, "text") };
    },
  },
  messages: {
    // کاربر عادی: نظرهای تاییدشده + نظرهای خودش. ادمین (جدول admins): همه‌ی عملیات.
    select: (c) => (isAdmin(c) ? true : c.uid ? { sql: "(approved = 1 OR user_id = ?)", params: [c.uid] } : { sql: "approved = 1", params: [] }),
    insert: (c, r) => {
      if (!c.uid) throw deny();
      if (isAdmin(c)) return r;
      if (r.user_id !== c.uid) throw deny();
      return { text: str(r.text, 2000, "text"), manhwa_slug: optStr(r.manhwa_slug, 200, "manhwa_slug"), name: str(r.name, 80, "name"), parent_message_id: r.parent_message_id ?? null, user_id: c.uid, approved: false, approved_at: null };
    },
    update: adminOnly, delete: adminOnly, updateCols: ["text", "approved", "approved_at", "name", "manhwa_slug", "parent_message_id"],
  },
  replies: {
    select: true, update: adminOnly, delete: adminOnly,
    insert: (c, r) => { if (!isAdmin(c)) throw deny(); return r; },
    updateCols: ["reply_text", "admin_name", "admin_role", "is_admin"],
  },
  bookmarks: {
    select: own("user_id"), delete: own("user_id"),
    insert: (c, r) => { if (!c.uid || r.user_id !== c.uid) throw deny(); return r; },
  },
  profile_contacts: { select: own("user_id") },
  payments: { select: own("user_id") },
  manhwa_ratings: { select: own("user_id") }, // نوشتن فقط از مسیر سرور (/api/ratings) تا قانون اشتراک دور زده نشود
  chapter_reports: { insert: (c, r) => ({ slug: str(r.slug, 200, "slug"), chapter_num: r.chapter_num ?? null, page: optStr(r.page, 100, "page"), message: str(r.message, 2000, "message") }) },
  applications: {
    insert: (c, r) => ({ role: str(r.role, 100, "role"), full_name: str(r.full_name, 120, "full_name"), age: optStr(r.age, 20, "age"), platform: str(r.platform, 100, "platform"), social_id: str(r.social_id, 200, "social_id"), bio: optStr(r.bio, 2000, "bio") }),
  },
  // --- تیم: در سوپابیس شما سیاستی نداشت (فقط از مسیر سرور). اینجا فقط خواندنِ داده‌ی خودِ کاربر مجاز است ---
  team_members: { select: own("user_id") },
  team_tasks: { select: (c) => (member(c) ? { sql: "(assignee = ? OR status = 'open')", params: [c.uid] } : false) },
  team_chapters: { select: (c) => member(c) },
  team_manhwas: { select: (c) => member(c) },
  team_ledger: { select: own("user_id") },
  team_withdrawals: { select: own("user_id") },
  team_tickets: { select: own("user_id") },
  team_support: { select: own("user_id") },
};

// ---- تریگرهای قبلی ----
const hooks = {
  comments: {
    afterInsert: (rows) => { for (const r of rows) sqlite.run("UPDATE reels SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = ?", [r.reel_id]); },
    afterDelete: (rows) => { for (const r of rows) sqlite.run("UPDATE reels SET comments_count = MAX(COALESCE(comments_count, 0) - 1, 0) WHERE id = ?", [r.reel_id]); },
  },
  messages: { afterInsert: (rows) => { for (const r of rows) notify.newMessage(r); } },
};
function beforeUpdate(table, patch) {
  if (table === "messages" && patch.approved === true && patch.approved_at === undefined) patch.approved_at = nowIso();
}
module.exports = { policies, hooks, beforeUpdate, limitWrite, nowIso };

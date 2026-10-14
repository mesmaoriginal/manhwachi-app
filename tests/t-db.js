// تست خود لایه‌ی دیتابیس (SQLite واقعی روی فایل)
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blogdb-"));
process.env.BLOG_DB_FILE = path.join(dir, "data", "blog.sqlite");
const { DatabaseSync } = require("node:sqlite");

// دیتابیس «قدیمی»: جدول مطلب بدون ستون‌های نسخه‌ی ۳ → باید خودکار مهاجرت شود
fs.mkdirSync(path.join(dir, "data"));
const old = new DatabaseSync(process.env.BLOG_DB_FILE);
old.exec(`CREATE TABLE blog_staff (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'author', can_publish INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT);
INSERT INTO blog_staff (id,username,password_hash,created_at) VALUES ('11111111-1111-1111-1111-111111111111','olduser','h','2026-01-01T00:00:00.000Z');`);
old.close();

const { sb, upsertRow, backupNow, TABLES } = require("../blog/blogDb");
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log("  ✓", n); } catch (e) { fail++; console.log("  ✗", n, "\n    ", e.message.split("\n")[0]); } };
const rejects = async (p, status) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, "status " + e.status); return; } throw new Error("باید خطا می‌داد"); };

(async () => {
  const U = "11111111-1111-1111-1111-111111111111";
  await t("مهاجرت خودکار: ستون‌های جدید به جدول قدیمی اضافه شد و داده‌ی قبلی سالم است", async () => {
    const r = (await sb("blog_staff?username=eq.olduser&select=id,bio,avatar_url,public_slug,can_publish"))[0];
    assert.deepStrictEqual(r, { id: U, bio: "", avatar_url: "", public_slug: null, can_publish: false });
  });
  await t("آرایه/JSON/بولین رفت‌وبرگشت درست؛ تگ فارسی و نقل‌قول", async () => {
    const [p] = await sb("blog_posts", { method: "POST", prefer: "return=representation", body: { slug: "a", title: "ا", author_id: U, tags: ['x"y', "فارسی"], content: [{ type: "divider", data: {} }], featured: true } });
    assert.deepStrictEqual(p.tags, ['x"y', "فارسی"]); assert.strictEqual(p.featured, true); assert.strictEqual(p.noindex, false); assert.strictEqual(p.content[0].type, "divider");
    assert.strictEqual((await sb(`blog_posts?tags=cs.${encodeURIComponent('{"x\\"y"}')}&select=id`)).length, 1);
    assert.strictEqual((await sb(`blog_posts?tags=ov.${encodeURIComponent('{"نیست","فارسی"}')}&select=id`)).length, 1);
    assert.strictEqual((await sb("blog_posts?featured=eq.true&select=id")).length, 1);
  });
  await t("محدودیت‌ها: slug تکراری ۴۰۹ (23505)، نویسنده‌ی ناموجود ۴۰۹ (23503)، وضعیت نامعتبر ۴۰۰", async () => {
    await rejects(sb("blog_posts", { method: "POST", body: { slug: "a", title: "ب", author_id: U } }), 409);
    await rejects(sb("blog_posts", { method: "POST", body: { slug: "b", title: "ب", author_id: "nope" } }), 409);
    await rejects(sb("blog_posts", { method: "POST", body: { slug: "c", title: "ب", author_id: U, status: "weird" } }), 400);
  });
  await t("تزریق SQL: نام ستون/جدول/عملگر نامعتبر رد می‌شود، مقدار فقط پارامتر است", async () => {
    await rejects(sb("blog_posts?id;drop table blog_posts=eq.1"), 400);
    await rejects(sb("blog_posts?select=id,(select 1)"), 400);
    await rejects(sb("blog_posts?order=title;drop.asc"), 400);
    await rejects(sb("nope?select=id"), 404);
    await rejects(sb("blog_posts?title=exec.x"), 400);
    const r = await sb(`blog_posts?title=eq.${encodeURIComponent("' OR 1=1 --")}&select=id`); assert.strictEqual(r.length, 0);
    assert((await sb("blog_posts?select=id")).length === 1);
  });
  await t("جستجو: % و _ داخل عبارت معنی خاص ندارند؛ * جای هرچیز", async () => {
    await sb("blog_posts", { method: "POST", body: { slug: "p100", title: "تخفیف 100% ویژه", author_id: U } });
    await sb("blog_posts", { method: "POST", body: { slug: "p101", title: "تخفیف 1000 ویژه", author_id: U } });
    assert.strictEqual((await sb(`blog_posts?title=ilike.${encodeURIComponent("*100%*")}&select=id`)).length, 1);
    assert.strictEqual((await sb(`blog_posts?title=ilike.${encodeURIComponent("*تخفیف*")}&select=id`)).length, 2);
    assert.strictEqual((await sb(`blog_posts?or=${encodeURIComponent("(title.ilike.*ویژه*,slug.eq.a)")}&select=id`)).length, 3);
  });
  await t("order/limit/offset/count، null آخر برای nullslast", async () => {
    await sb("blog_posts?slug=eq.a", { method: "PATCH", body: { published_at: "2026-01-02T00:00:00.000Z" } });
    await sb("blog_posts?slug=eq.p100", { method: "PATCH", body: { published_at: "2026-01-03T00:00:00.000Z" } });
    const r = await sb("blog_posts?select=slug&order=published_at.desc.nullslast&limit=2");
    assert.deepStrictEqual(r.map((x) => x.slug), ["p100", "a"]);
    const c = await sb("blog_posts?select=slug&order=slug.asc&limit=1&offset=1", { withCount: true });
    assert.strictEqual(c.total, 3); assert.strictEqual(c.rows.length, 1);
  });
  await t("updated_at فقط با تغییر واقعی عوض می‌شود (شمارنده‌ی بازدید نه)", async () => {
    const [a] = await sb("blog_posts?slug=eq.a&select=updated_at,views");
    await new Promise((r) => setTimeout(r, 5));
    await sb("blog_posts?slug=eq.a", { method: "PATCH", body: { views: 9 } });
    assert.strictEqual((await sb("blog_posts?slug=eq.a&select=updated_at"))[0].updated_at, a.updated_at);
    await sb("blog_posts?slug=eq.a", { method: "PATCH", body: { title: "عنوان جدید" } });
    assert.notStrictEqual((await sb("blog_posts?slug=eq.a&select=updated_at"))[0].updated_at, a.updated_at);
  });
  await t("حذف دسته: مطلب‌ها بدون دسته می‌شوند (نه حذف)", async () => {
    const [c] = await sb("blog_categories", { method: "POST", prefer: "return=representation", body: { slug: "c1", name: "ک" } });
    await sb("blog_posts?slug=eq.a", { method: "PATCH", body: { category_id: c.id } });
    await sb(`blog_categories?id=eq.${c.id}`, { method: "DELETE" });
    assert.strictEqual((await sb("blog_posts?slug=eq.a&select=category_id"))[0].category_id, null);
  });
  await t("بکاپ خودکار: فایل ساخته می‌شود و قابل باز شدن است", async () => {
    const d = path.join(dir, "data", "blog-backups");
    fs.rmSync(d, { recursive: true, force: true }); // بکاپ اولِ هنگام راه‌اندازی، قبل از داده‌ها گرفته شده بود
    backupNow();
    const f = fs.readdirSync(d)[0]; assert(f);
    const b = new DatabaseSync(path.join(d, f)); assert(b.prepare("select count(*) n from blog_posts").get().n >= 3); b.close();
  });
  await t("upsertRow (درون‌ریزی): دوباره اجرا مشکلی ندارد؛ ستون ناشناخته نادیده", async () => {
    const row = { id: "22222222-2222-2222-2222-222222222222", username: "imported", password_hash: "scrypt$a$b", created_at: "2026-02-02T00:00:00.000Z", unknown_col: 1, role: "editor" };
    upsertRow("blog_staff", row); upsertRow("blog_staff", row);
    assert.strictEqual((await sb("blog_staff?username=eq.imported&select=role"))[0].role, "editor");
  });
  console.log(`\n${pass} موفق، ${fail} ناموفق`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();

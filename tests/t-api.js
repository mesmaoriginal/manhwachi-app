const H = require("./harness");
H.install();
process.env.BLOG_SESSION_SECRET = "y".repeat(40);
const assert = require("assert");
const A = require("../blog/blogAuth");
const { router } = require("../blog/blogRouter");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "\n    ", e.message); } };
const DAY = 86400000;

async function mkUser(username, role, extra = {}) {
  await H.sb("blog_staff", { method: "POST", body: { username, display_name: username, password_hash: await A.hashPassword("password-1234"), role, ...extra } });
  const r = await H.dispatch(router, "POST", "/api/login", { headers: { "x-blog-panel": "1" }, body: { username, password: "password-1234" } });
  assert.strictEqual(r.status, 200, r.body);
  const cookie = r.cookies[0].split(";")[0];
  return (method, url, body) => H.dispatch(router, method, url, { headers: { "x-blog-panel": "1", cookie }, body, ip: "7.7.7." + username.length });
}
const para = (t) => ({ type: "paragraph", data: { runs: [{ t }] } });
const goodPost = (o = {}) => ({ title: "عنوان آزمایشی", excerpt: "خلاصه", content: [para("یک متن نمونه برای آزمایش")], ...o });

(async () => {
  const admin = await mkUser("admin1", "admin");
  const author = await mkUser("writer1", "author");
  console.log("ایجاد و ذخیره");
  let post;
  await t("ساخت مقاله: search_text و word_count خودکار", async () => {
    const r = await admin("POST", "/api/posts", goodPost()); assert.strictEqual(r.status, 201, r.body);
    post = r.json(); assert.strictEqual(post.word_count, 5); assert(post.search_text.includes("نمونه"));
  });
  await t("نشانک رزرو (search) پذیرفته نمی‌شود", async () => {
    const r = await admin("POST", "/api/posts", goodPost({ slug: "search" })); assert.strictEqual(r.status, 400);
  });
  await t("اسکیما/گارد قدیمی هنوز کار می‌کنند: بدون هدر CSRF رد، بدون ورود ۴۰۱", async () => {
    assert.strictEqual((await H.dispatch(router, "POST", "/api/posts", { body: {} })).status, 403);
    assert.strictEqual((await H.dispatch(router, "GET", "/api/posts", { headers: { "x-blog-panel": "1" } })).status, 401);
  });
  console.log("انتشار و زمان‌بندی");
  await t("انتشار بدون alt/خلاصه رد می‌شود (قانون سئو سر جایش)", async () => {
    const p = (await admin("POST", "/api/posts", { title: "بی‌خلاصه", content: [para("متن")] })).json();
    const r = await admin("POST", `/api/posts/${p.id}/status`, { status: "published" }); assert.strictEqual(r.status, 400); assert(r.json().error.includes("خلاصه"));
  });
  await t("انتشار فوری: published_at = اکنون", async () => {
    const r = await admin("POST", `/api/posts/${post.id}/status`, { status: "published" }); assert.strictEqual(r.status, 200, r.body);
    const d = r.json(); assert(Math.abs(Date.now() - new Date(d.published_at)) < 5000);
  });
  await t("زمان‌بندی: publish_at آینده ذخیره می‌شود، گذشته = همین حالا، نامعتبر/بیش از یک سال رد", async () => {
    const p = (await admin("POST", "/api/posts", goodPost({ title: "زمان‌بندی" }))).json();
    const when = new Date(Date.now() + 3 * DAY).toISOString();
    let r = await admin("POST", `/api/posts/${p.id}/status`, { status: "published", publish_at: when }); assert.strictEqual(r.json().published_at, when);
    assert.strictEqual((await admin("POST", `/api/posts/${p.id}/status`, { status: "published", publish_at: "نه" })).status, 400);
    assert.strictEqual((await admin("POST", `/api/posts/${p.id}/status`, { status: "published", publish_at: new Date(Date.now() + 400 * DAY).toISOString() })).status, 400);
    r = await admin("POST", `/api/posts/${p.id}/status`, { status: "published" }); // «همین حالا» روی مطلب زمان‌بندی‌شده
    assert(new Date(r.json().published_at) <= new Date());
    await admin("POST", `/api/posts/${p.id}/status`, { status: "published", publish_at: when });
    r = await admin("POST", `/api/posts/${p.id}/status`, { status: "draft" }); assert.strictEqual(r.json().published_at, null); // لغو زمان‌بندی
  });
  await t("تغییر نشانکِ مطلب زمان‌بندی‌شده، old_slug نمی‌سازد (هنوز عمومی نشده)؛ ولی منتشرشده می‌سازد", async () => {
    const p = (await admin("POST", "/api/posts", goodPost({ title: "اسلاگ", slug: "slug-a" }))).json();
    await admin("POST", `/api/posts/${p.id}/status`, { status: "published", publish_at: new Date(Date.now() + 2 * DAY).toISOString() });
    let r = await admin("PUT", `/api/posts/${p.id}`, { slug: "slug-b" }); assert.deepStrictEqual(r.json().old_slugs, []);
    await admin("POST", `/api/posts/${p.id}/status`, { status: "published" });
    r = await admin("PUT", `/api/posts/${p.id}`, { slug: "slug-c" }); assert.deepStrictEqual(r.json().old_slugs, ["slug-b"]);
  });
  console.log("تاریخچه‌ی نسخه‌ها");
  await t("نسخه‌ی قبلی ذخیره می‌شود (throttle ۳ دقیقه)، بازگردانی با نسخه‌ی اضطراری", async () => {
    const p = (await admin("POST", "/api/posts", goodPost({ title: "تاریخچه", content: [para("نسخه یک")] }))).json();
    await admin("PUT", `/api/posts/${p.id}`, { content: [para("نسخه دو")] });
    await admin("PUT", `/api/posts/${p.id}`, { content: [para("نسخه سه")] }); // کمتر از ۳ دقیقه: نسخه‌ی تازه ساخته نمی‌شود
    let list = (await admin("GET", `/api/posts/${p.id}/revisions`)).json();
    assert.strictEqual(list.length, 1); assert.strictEqual(list[0].words, 2);
    const r = await admin("POST", `/api/posts/${p.id}/revisions/${list[0].id}/restore`); assert.strictEqual(r.status, 200, r.body);
    assert.strictEqual(r.json().content[0].data.runs[0].t, "نسخه یک"); assert.strictEqual(r.json().word_count, 2);
    list = (await admin("GET", `/api/posts/${p.id}/revisions`)).json(); assert.strictEqual(list.length, 2); // نسخه‌ی «سه» هم قابل بازگشت است
  });
  await t("حداکثر ۲۰ نسخه نگه داشته می‌شود", async () => {
    const p = (await admin("POST", "/api/posts", goodPost({ title: "پر" }))).json();
    for (let i = 0; i < 25; i++) await H.sb("blog_revisions", { method: "POST", body: { kind: "posts", item_id: p.id, title: "t", content: [], created_at: new Date(Date.now() - (i + 5) * 600000).toISOString() } });
    await admin("PUT", `/api/posts/${p.id}`, { content: [para("تغییر جدید")] });
    assert.strictEqual((await H.sb(`blog_revisions?item_id=eq.${p.id}&select=id`)).length, 20);
  });
  await t("حذف مطلب، آخرین نسخه را در تاریخچه نگه می‌دارد", async () => {
    const p = (await admin("POST", "/api/posts", goodPost({ title: "برای حذف" }))).json();
    assert.strictEqual((await admin("DELETE", `/api/posts/${p.id}`)).status, 200);
    assert((await H.sb(`blog_revisions?item_id=eq.${p.id}&select=title`)).some((r) => r.title === "برای حذف"));
  });
  console.log("دسترسی‌ها");
  await t("نویسنده: مطلب ویژه ممنوع، مطلب دیگران دیده نمی‌شود، تکثیر مطلب دیگران ممنوع", async () => {
    const mine = (await author("POST", "/api/posts", goodPost({ title: "مال نویسنده" }))).json();
    assert.strictEqual((await author("PUT", `/api/posts/${mine.id}`, { featured: true })).status, 403);
    assert.strictEqual((await author("GET", `/api/posts/${post.id}`)).status, 403);
    assert.strictEqual((await author("POST", `/api/posts/${post.id}/duplicate`)).status, 403);
    assert.strictEqual((await author("POST", `/api/posts/${post.id}/preview-link`)).status, 403);
    assert.strictEqual((await author("GET", `/api/posts/${post.id}/revisions`)).status, 403);
    assert.strictEqual((await admin("PUT", `/api/posts/${mine.id}`, { featured: true })).json().featured, true);
    assert.strictEqual((await author("GET", "/api/staff")).status, 403);
  });
  await t("لینک پیش‌نمایش معتبر ساخته می‌شود", async () => {
    const r = (await admin("POST", `/api/posts/${post.id}/preview-link`)).json();
    const m = /^\/blog\/preview\/posts\/([^/]+)\/(\d+)\/(.+)$/.exec(r.path); assert(m && A.verifyPreview("posts", m[1], m[2], m[3]));
  });
  console.log("تکثیر، داشبورد، تگ، پروفایل");
  await t("تکثیر: پیش‌نویس با نشانک یکتا؛ دوباره تکثیر = -copy-2", async () => {
    const a = (await admin("POST", `/api/posts/${post.id}/duplicate`)).json(); assert.strictEqual(a.status, "draft"); assert.strictEqual(a.published_at, null); assert(a.title.endsWith("(کپی)"));
    const b = (await admin("POST", `/api/posts/${post.id}/duplicate`)).json(); assert.notStrictEqual(a.slug, b.slug); assert(/copy-2$/.test(b.slug));
  });
  await t("داشبورد: شمارش‌ها، زمان‌بندی‌شده جدا از منتشرشده", async () => {
    const sp = (await admin("POST", "/api/posts", goodPost({ title: "آینده‌دار" }))).json();
    await admin("POST", `/api/posts/${sp.id}/status`, { status: "published", publish_at: new Date(Date.now() + 4 * DAY).toISOString() });
    const d = (await admin("GET", "/api/dashboard")).json();
    assert(d.counts.published >= 1 && d.counts.scheduled >= 1 && d.counts.draft >= 1);
  });
  await t("تگ‌ها شمرده می‌شوند", async () => {
    await admin("PUT", `/api/posts/${post.id}`, { tags: ["الف", "ب"] });
    const t2 = (await admin("GET", "/api/tags")).json(); assert(t2.some((x) => x.name === "الف" && x.count === 1));
  });
  await t("پروفایل نویسنده: slug رزروشده رد، تکراری ۴۰۹، و /me برمی‌گرداند", async () => {
    assert.strictEqual((await author("PUT", "/api/me", { public_slug: "search" })).status, 400);
    assert.strictEqual((await author("PUT", "/api/me", { public_slug: "writer", bio: "معرفی", display_name: "نویسنده" })).status, 200);
    assert.strictEqual((await admin("PUT", "/api/me", { public_slug: "writer" })).status, 409);
    const me = (await author("GET", "/api/me")).json(); assert.strictEqual(me.public_slug, "writer"); assert.strictEqual(me.bio, "معرفی");
    assert(!("password_hash" in me));
  });
  await t("لیست: فیلتر scheduled و مرتب‌سازی بازدید", async () => {
    const l = (await admin("GET", "/api/posts?status=scheduled")).json(); assert(l.length >= 1 && l.every((x) => new Date(x.published_at) > new Date()));
    assert.strictEqual((await admin("GET", "/api/posts?sort=views")).status, 200);
  });
  await t("بلوک‌های جدید از API ذخیره می‌شوند (کد/جدول/FAQ)", async () => {
    const p = (await admin("POST", "/api/posts", goodPost({ title: "بلوک‌های جدید", content: [para("x"), { type: "code", data: { code: "a<b", lang: "js" } }, { type: "table", data: { header: true, rows: [["a", "b"], ["1", "2"]] } }, { type: "faq", data: { items: [{ q: "ا", a: "ب" }] } }] }))).json();
    assert.deepStrictEqual(p.content.map((b) => b.type), ["paragraph", "code", "table", "faq"]);
  });

  console.log(`\n${pass} موفق، ${fail} ناموفق`);
  process.exit(fail ? 1 : 0);
})();

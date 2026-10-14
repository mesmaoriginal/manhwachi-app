const H = require("./harness");
H.install();
process.env.BLOG_SESSION_SECRET = "x".repeat(40);
process.env.SITE_URL = "https://example.test";
const assert = require("assert");
const { normalizeBlocks } = require("../blog/blockSchema");
const R = require("../blog/blogRender");
const A = require("../blog/blogAuth");
const pub = require("../blog/blogPublic");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "\n    ", e.message); } };
const DAY = 86400000, iso = (off) => new Date(Date.now() + off).toISOString();

(async () => {
  console.log("رندر و ایمنی");
  await t("XSS در متن/alt/href/کد escape می‌شود", () => {
    const blocks = normalizeBlocks([
      { type: "paragraph", data: { runs: [{ t: "<script>alert(1)</script>", a: { href: "https://ok.com/x" } }, { t: "bad", a: { href: "https://ok.com/a" } }] } },
      { type: "image", data: { src: "https://ok.com/i.webp", alt: '"><img src=x onerror=alert(1)>' } },
      { type: "code", data: { code: "</code><script>x</script>" } },
      { type: "table", data: { rows: [["<b>", "&"]] } },
    ]);
    const { html } = R.renderBlocks(blocks);
    assert(!/<script>alert|<img src=x|<b>|<\/code><script>/.test(html), html);
    assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });
  await t("لینک javascript: در رندر هم حذف می‌شود (دفاع در عمق، حتی اگر دیتابیس دستکاری شده باشد)", () => {
    const { html } = R.renderBlocks([{ type: "paragraph", data: { runs: [{ t: "x", a: { href: "javascript:alert(1)" } }] } }, { type: "button", data: { text: "go", href: "javascript:alert(1)" } }, { type: "image", data: { src: "javascript:alert(1)", alt: "" } }]);
    assert(!/javascript:/.test(html), html);
  });
  await t("شناسه‌ی عنوان‌ها یکتا و TOC درست", () => {
    const blocks = normalizeBlocks([2, 2, 3].map((l, i) => ({ type: "heading", data: { level: l, runs: [{ t: "مقدمه" }] } })));
    const { toc, html } = R.renderBlocks(blocks);
    assert.deepStrictEqual(toc.map((x) => x.id), ["مقدمه", "مقدمه-2", "مقدمه-3"]);
    assert(html.includes('id="مقدمه-2"'));
  });
  await t("FAQ جمع می‌شود، ویدیو آدرس امن دارد، شمارش کلمه", () => {
    const blocks = normalizeBlocks([{ type: "faq", data: { items: [{ q: "؟", a: "پاسخ" }] } }, { type: "video", data: { id: "dQw4w9WgXcQ" } }, { type: "paragraph", data: { runs: [{ t: "یک دو سه چهار" }] } }]);
    const r = R.renderBlocks(blocks);
    assert.strictEqual(r.faq.length, 1);
    assert(r.html.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ"));
    assert.strictEqual(R.countWords(R.plainText(blocks)), 6); // پاراگراف ۴ + سؤال و جواب ۲
    assert.strictEqual(R.readingMinutes(0), 1);
  });

  // ---------- داده‌ی نمونه ----------
  const staff = (await H.sb("blog_staff", { method: "POST", prefer: "return=representation", body: { username: "ali", display_name: "علی", password_hash: "x", role: "admin", public_slug: "ali", bio: "نویسنده‌ی مانهوا" } }))[0];
  const cat = (await H.sb("blog_categories", { method: "POST", prefer: "return=representation", body: { slug: "review", name: "نقد", old_slugs: ["reviews"] } }))[0];
  const body = (txt) => [{ type: "heading", data: { level: 2, runs: [{ t: "بخش یک" }] } }, { type: "heading", data: { level: 2, runs: [{ t: "بخش دو" }] } }, { type: "heading", data: { level: 3, runs: [{ t: "زیربخش" }] } }, { type: "paragraph", data: { runs: [{ t: txt }] } }, { type: "faq", data: { items: [{ q: "سؤال؟", a: "جواب" }] } }];
  const mk = (o) => H.sb("blog_posts", { method: "POST", prefer: "return=representation", body: { author_id: staff.id, category_id: cat.id, excerpt: "خلاصه", ...o } }).then((r) => r[0]);
  const live = await mk({ slug: "live-post", title: "مطلب زنده <b>", status: "published", published_at: iso(-3 * DAY), content: body("سلام <script>alert(1)</script> دنیا"), search_text: "سلام دنیا کلمه‌ی‌یکتا", word_count: 400, tags: ["تگ اول", "x"], old_slugs: ["old-live"], cover_url: "/blog-media/2026-10/aaaaaaaaaaaaaaaaaaaaaaaa.webp", cover_alt: "کاور", featured: true });
  const other = await mk({ slug: "other-post", title: "مطلب دوم", status: "published", published_at: iso(-1 * DAY), content: body("متن"), tags: ["تگ اول"], search_text: "متن دوم" });
  const sched = await mk({ slug: "future-post", title: "آینده", status: "published", published_at: iso(+5 * DAY), content: body("آینده") });
  const draft = await mk({ slug: "draft-post", title: "پیش‌نویس", status: "draft", content: body("پیش‌نویس") });
  const arch = await mk({ slug: "arch-post", title: "بایگانی", status: "archived", published_at: iso(-9 * DAY), content: body("قدیمی") });
  await H.sb("blog_pages", { method: "POST", body: { slug: "about", title: "درباره", status: "published", published_at: iso(-DAY), author_id: staff.id, content: body("درباره‌ی ما") } });

  const get = (u, o) => H.dispatch(pub.router, "GET", u, o);
  console.log("صفحه‌های عمومی");
  await t("/blog فقط مطلب منتشرشده‌ی گذشته را نشان می‌دهد و مطلب ویژه hero است", async () => {
    const r = await get("/blog");
    assert.strictEqual(r.status, 200);
    assert(r.body.includes("مطلب دوم") && r.body.includes('class="hero"'));
    assert(!r.body.includes("آینده") && !r.body.includes("پیش‌نویس") && !r.body.includes("بایگانی"));
    assert(r.body.includes('lang="fa" dir="rtl"') && r.body.includes('rel="canonical" href="https://example.test/blog"'));
  });
  await t("مطلب: سئو، JSON-LD، TOC، escape، یک h1", async () => {
    const r = await get("/blog/live-post");
    assert.strictEqual(r.status, 200);
    const h = r.body;
    assert(h.includes('<link rel="canonical" href="https://example.test/blog/live-post">'));
    assert(h.includes('"@type":"BlogPosting"') && h.includes('"@type":"FAQPage"') && h.includes('"@type":"BreadcrumbList"'));
    assert(h.includes('class="toc"'));
    assert(!h.includes("<script>alert(1)") && h.includes("&lt;script&gt;alert(1)"));
    assert.strictEqual((h.match(/<h1[ >]/g) || []).length, 1);
    assert(h.includes("&lt;b&gt;") && !h.includes("زنده <b>"));
    assert(h.includes('property="og:type" content="article"') && h.includes('og:image" content="https://example.test/blog-media/'));
    assert(h.includes('fetchpriority="high"'));
    assert(h.includes("/blog/author/ali") && h.includes("مطالب مرتبط"));
  });
  await t("JSON-LD نمی‌تواند با </script> بشکند", async () => {
    await H.sb("blog_posts?slug=eq.live-post", { method: "PATCH", body: { title: "x</script><script>alert(1)" } });
    const r = await get("/blog/live-post");
    assert(!r.body.includes("</script><script>alert(1)"));
    await H.sb("blog_posts?slug=eq.live-post", { method: "PATCH", body: { title: "مطلب زنده <b>" } });
  });
  await t("زمان‌بندی‌شده/پیش‌نویس ۴۰۴، بایگانی ۴۱۰، آدرس قدیمی ۳۰۱", async () => {
    assert.strictEqual((await get("/blog/future-post")).status, 404);
    assert.strictEqual((await get("/blog/draft-post")).status, 404);
    assert.strictEqual((await get("/blog/arch-post")).status, 410);
    assert.strictEqual((await get("/blog/nothing")).status, 404);
    const r = await get("/blog/old-live");
    assert.strictEqual(r.status, 301); assert.strictEqual(r.redirect, "/blog/live-post");
  });
  await t("وقتی زمان انتشار برسد مطلب خودبه‌خود دیده می‌شود", async () => {
    await H.sb("blog_posts?slug=eq.future-post", { method: "PATCH", body: { published_at: iso(-1000) } });
    assert.strictEqual((await get("/blog/future-post")).status, 200);
    await H.sb("blog_posts?slug=eq.future-post", { method: "PATCH", body: { published_at: iso(+5 * DAY) } });
  });
  await t("دسته (با ۳۰۱ از نام قدیمی)، تگ، نویسنده", async () => {
    assert.strictEqual((await get("/blog/category/review")).status, 200);
    const r = await get("/blog/category/reviews"); assert.strictEqual(r.status, 301); assert.strictEqual(r.redirect, "/blog/category/review");
    const tg = await get("/blog/tag/" + encodeURIComponent("تگ اول"));
    assert.strictEqual(tg.status, 200); assert(tg.body.includes("مطلب دوم") && tg.body.includes("مطلب زنده"));
    assert.strictEqual((await get("/blog/tag/نیست")).status, 404);
    const au = await get("/blog/author/ali"); assert.strictEqual(au.status, 200); assert(au.body.includes("نویسنده‌ی مانهوا"));
    assert.strictEqual((await get("/blog/author/nobody")).status, 404);
  });
  await t("نام ورود (username) و هش رمز هیچ‌جا در خروجی نیست", async () => {
    for (const u of ["/blog", "/blog/live-post", "/blog/author/ali", "/blog/rss.xml", "/blog/sitemap.xml"]) {
      const r = await get(u); assert(!/password_hash|scrypt\$/.test(r.body), u);
    }
  });
  await t("جستجو: در متن بدنه پیدا می‌کند، noindex، مطلب پیش‌نویس را نشان نمی‌دهد", async () => {
    const r = await get("/blog/search?q=" + encodeURIComponent("یکتا"));
    assert(r.body.includes("مطلب زنده") && r.body.includes('content="noindex,follow"'));
    assert(!(await get("/blog/search?q=" + encodeURIComponent("پیش‌نویس"))).body.includes('href="/blog/draft-post"'));
    assert((await get("/blog/search?q=a")).body.includes("حداقل دو حرف"));
    const inj = await get("/blog/search?q=" + encodeURIComponent('x),title.ilike.(*')); assert.strictEqual(inj.status, 200);
  });
  await t("سایت‌مپ فقط مطلب‌های زنده؛ RSS با آدرس کامل", async () => {
    const s = (await get("/blog/sitemap.xml")).body;
    assert(s.includes("https://example.test/blog/live-post") && s.includes("/p/about") && s.includes("/blog/category/review") && s.includes("/blog/author/ali"));
    assert(!s.includes("future-post") && !s.includes("draft-post") && !s.includes("arch-post"));
    const r = (await get("/blog/rss.xml")).body;
    assert(r.includes("<rss") && r.includes("<content:encoded><![CDATA[") && !/src="\/(?!\/)/.test(r) && !r.includes("future-post"));
  });
  await t("noindex در مطلب → در سایت‌مپ نیست و meta robots دارد", async () => {
    await H.sb("blog_posts?slug=eq.other-post", { method: "PATCH", body: { noindex: true } });
    assert(!(await get("/blog/sitemap.xml")).body.includes("other-post"));
    assert((await get("/blog/other-post")).body.includes('content="noindex,follow"'));
    await H.sb("blog_posts?slug=eq.other-post", { method: "PATCH", body: { noindex: false } });
  });
  await t("پیش‌نمایش پیش‌نویس با لینک امضاشده؛ لینک جعلی/منقضی ۴۰۴", async () => {
    const p = A.makePreviewPath("posts", draft.id);
    const ok = await get(p); assert.strictEqual(ok.status, 200); assert(ok.body.includes("پیش‌نمایش پیش‌نویس") && ok.body.includes("noindex") && ok.headers["cache-control"] === "no-store");
    assert.strictEqual((await get(p.slice(0, -3) + "abc")).status, 404);
    assert.strictEqual((await get(p.replace(draft.id, other.id))).status, 404);
    assert.strictEqual((await get(`/blog/preview/posts/${draft.id}/${Date.now() - 1000}/x`)).status, 404);
  });
  await t("بازدید: ربات و تکراری شمرده نمی‌شود، ثبت دسته‌ای، updated_at دست‌نخورده", async () => {
    await pub.flushViews(); // بازدیدهای تست‌های قبلی
    const before = (await H.sb("blog_posts?slug=eq.live-post&select=views,updated_at"))[0];
    await get("/blog/live-post", { ip: "9.9.9.1", headers: { "user-agent": "Mozilla/5.0" } });
    await get("/blog/live-post", { ip: "9.9.9.1", headers: { "user-agent": "Mozilla/5.0" } }); // تکراری
    await get("/blog/live-post", { ip: "9.9.9.2", headers: { "user-agent": "Googlebot/2.1" } }); // ربات
    await get("/blog/live-post", { ip: "9.9.9.3", headers: { "user-agent": "Mozilla/5.0" } });
    await pub.flushViews();
    const after = (await H.sb("blog_posts?slug=eq.live-post&select=views,updated_at"))[0];
    assert.strictEqual(after.views, before.views + 2); assert.strictEqual(after.updated_at, before.updated_at);
  });
  await t("صفحه‌ی سفارشی و فایل ۴۰۴", async () => {
    assert.strictEqual((await get("/p/about")).status, 200);
    assert.strictEqual((await get("/p/nope")).status, 404);
  });

  console.log(`\n${pass} موفق، ${fail} ناموفق`);
  process.exit(fail ? 1 : 0);
})();

// تست سرتاسری: مرورگر واقعی (Chromium) → پنل واقعی → روتر واقعی → دیتابیس ساختگی
const H = require("./harness");
H.install();
process.env.BLOG_SESSION_SECRET = "z".repeat(40);
process.env.SITE_URL = "http://localhost:4599";
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert");
const A = require("../blog/blogAuth");
const { router: panelRouter } = require("../blog/blogRouter");
const pubMod = require("../blog/blogPublic"); const pubRouter = pubMod.router;
const { chromium } = require("playwright");

const PORT = 4599, SHOTS = process.env.SHOTS || "/tmp/shots";
fs.mkdirSync(SHOTS, { recursive: true });

const server = http.createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const url = req.url;
  const send = (out) => {
    const h = { ...out.headers };
    if (out.redirect) h.location = out.redirect;
    if (out.cookies.length) h["set-cookie"] = out.cookies;
    res.writeHead(out.status, h); res.end(out.body);
  };
  const opts = { headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
  if (url === "/panel" || url === "/panel/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(path.join(__dirname, "../blog/panel/index.html"))); }
  if (url.startsWith("/panel/")) return send(await H.dispatch(panelRouter, req.method, url.slice(6), opts));
  if (url.startsWith("/blog-assets/")) { const f = path.join(__dirname, "../blog/public", url.split("?")[0].replace("/blog-assets/", "")); if (fs.existsSync(f)) { res.writeHead(200, { "content-type": f.endsWith(".css") ? "text/css" : "application/javascript" }); return res.end(fs.readFileSync(f)); } }
  if (url.startsWith("/blog") || url.startsWith("/p/")) return send(await H.dispatch(pubRouter, req.method, url, { ...opts, ip: "5.5.5.5" }));
  res.writeHead(404); res.end("nf");
});

let pass = 0, fail = 0;
const step = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "\n    ", String(e.message).split("\n").slice(0,6).join(" | ")); } };

(async () => {
  await H.sb("blog_staff", { method: "POST", body: { username: "boss", display_name: "مدیر", password_hash: await A.hashPassword("password-1234"), role: "admin" } });
  await H.sb("blog_categories", { method: "POST", body: { slug: "news", name: "اخبار" } });
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "fa-IR" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_NAME_NOT_RESOLVED|401/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  const toastText = () => page.locator("#toast").innerText();
  const B = `http://localhost:${PORT}`;
  const location_id = (u) => (/edit\/posts\/([0-9a-f-]{36})/.exec(u) || [])[1];

  console.log("پنل در مرورگر");
  await step("ورود و داشبورد", async () => {
    await page.goto(B + "/panel/");
    await page.fill("#u", "boss"); await page.fill("#p", "password-1234"); await page.click("#go");
    await page.waitForSelector("#dash .stats", { timeout: 5000 });
    assert((await page.locator(".stat").count()) >= 6);
  });
  let postId;
  await step("ساخت مقاله با همه‌ی بلوک‌های جدید + ذخیره", async () => {
    await page.click('a[href="#/new/posts"]');
    await page.waitForSelector("#ti");
    await page.fill("#ti", "راهنمای کامل مانهوای سولو لولینگ");
    await page.locator("#bl .ed").first().click();
    await page.keyboard.type("این یک مقدمه درباره مانهوای سولو لولینگ است و چرا محبوب شده.");
    const add = async (k) => { await page.click("#addb"); await page.click(`.menu [data-m="${k}"]`); };
    await add("heading"); await page.keyboard.type("معرفی سولو لولینگ");
    await add("paragraph"); await page.keyboard.type("متن دوم بدون کلمه‌ی خاص.");
    await add("code");
    await page.fill('[data-t=code] textarea[data-k=code]', "const a = '<b>';");
    await page.selectOption('[data-t=code] select[data-k=lang]', "js");
    await add("table");
    await page.click('[data-t=table] [data-a="tr+"]'); await page.click('[data-t=table] [data-a="tc+"]');
    const cells = page.locator("[data-t=table] input:not([type=checkbox])");
    assert.strictEqual(await cells.count(), 9); // ۳×۳
    await cells.nth(0).fill("نام"); await cells.nth(1).fill("امتیاز"); await cells.nth(3).fill("سولو"); await cells.nth(4).fill("۹");
    await add("faq");
    await page.fill(".fq-q", "آیا ادامه دارد؟"); await page.fill(".fq-a", "بله.");
    await page.click('[data-t=faq] [data-a="fq+"]');
    assert.strictEqual(await page.locator(".fq").count(), 2);
    await page.fill("#ex", "معرفی کامل مانهوای سولو لولینگ برای شروع خواندن.");
    await page.fill("#fk", "سولو لولینگ");
    await page.fill("#tg", "اکشن، فانتزی");
    await page.click("#b-save");
    await page.waitForFunction(() => document.querySelector("#sv").textContent.includes("ذخیره شد"), null, { timeout: 5000 });
    postId = location_id(await page.url());
    assert(postId);
  });
    await step("شمارنده‌ی کلمه و تحلیل کلمه‌ی کلیدی نمایش داده می‌شود", async () => {
    assert(/کلمه ·/.test(await page.locator("#wc").innerText()));
    const kw = await page.locator(".kw").innerText();
    assert(kw.includes("سولو لولینگ") && kw.includes("در عنوان آمده"), kw);
    await page.screenshot({ path: SHOTS + "/editor.png", fullPage: true });
  });
  await step("پیشنهاد تگ‌ها کلیک‌شدنی است", async () => {
    // تگ‌های دیتابیس بعد از ذخیره‌ی اول موجودند؛ صفحه را دوباره باز می‌کنیم
    await page.reload(); await page.waitForSelector("#ti");
    await page.waitForSelector("#tgs .chip", { timeout: 4000 });
    assert((await page.locator("#tgs .chip").count()) >= 2);
  });
  await step("بلوک‌ها بعد از بازکردن دوباره سالم‌اند (کد، جدول، سؤال)", async () => {
    assert.strictEqual(await page.locator('[data-t=code] textarea').inputValue(), "const a = '<b>';");
    assert.strictEqual(await page.locator("[data-t=table] tr").count(), 2); // سطر کاملاً خالی ذخیره نمی‌شود
    assert.strictEqual(await page.locator(".fq").count(), 1); // سؤال دوم خالی بود و ذخیره نمی‌شود
  });
  await step("زمان‌بندی انتشار", async () => {
    const d = new Date(Date.now() + 3 * 86400000), p2 = (n) => String(n).padStart(2, "0");
    await page.fill("#pa", `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T10:30`);
    await page.click("#b-sch");
    await page.waitForFunction(() => document.querySelector("#stt").textContent.includes("زمان‌بندی‌شده"), null, { timeout: 5000 });
    assert((await page.locator("#b-pub").innerText()).includes("همین حالا"));
    const r = await H.dispatch(pubRouter, "GET", "/blog/" + encodeURIComponent("راهنمای-کامل-مانهوای-سولو-لولینگ"));
    assert.strictEqual(r.status, 404); // هنوز عمومی نیست
  });
  await step("انتشار همین حالا → صفحه‌ی عمومی با سئو و بلوک‌های جدید", async () => {
    await page.click("#b-pub");
    await page.waitForFunction(() => document.querySelector("#stt").textContent.trim() === "منتشرشده", null, { timeout: 5000 });
    const href = await page.locator("#b-view").getAttribute("href");
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => errors.push("public pageerror: " + e.message));
    await pg.goto(B + href);
    const html = await pg.content();
    assert(html.includes("راهنمای کامل مانهوای سولو لولینگ"));
    assert(await pg.locator(".code pre code").count() === 1 && await pg.locator(".tbl table th").count() === 3 && await pg.locator(".faq details").count() === 1);
    assert(await pg.locator('script[type="application/ld+json"]').count() >= 3);
    // دکمه‌ی کپی کد
    await pg.locator("[data-copy]").click();
    await pg.screenshot({ path: SHOTS + "/post.png", fullPage: true });
    const list = await ctx.newPage(); await list.goto(B + "/blog"); await list.screenshot({ path: SHOTS + "/blog-index.png", fullPage: true });
    await pg.close(); await list.close();
  });
  await step("تاریخچه‌ی نسخه‌ها: ویرایش، سپس بازگردانی", async () => {
    await page.locator("#bl .ed").first().click();
    await page.keyboard.type(" متن اضافه‌ی موقت");
    await page.click("#b-save");
    await page.waitForFunction(() => document.querySelector("#sv").textContent.includes("ذخیره شد"));
    await page.click("#b-hist");
    await page.waitForSelector(".hist button[data-rv]", { timeout: 4000 });
    await page.screenshot({ path: SHOTS + "/history.png" });
    await page.click(".hist button[data-rv]");
    await page.waitForFunction(() => !document.querySelector(".modal") && /بازگردانی شد/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 });
    await page.waitForSelector("#ti");
    assert(!(await page.locator("#bl .ed").first().innerText()).includes("موقت"));
  });
  await step("پیش‌نمایش پیش‌نویس (لینک امضاشده)", async () => {
    await page.click("#b-draft");
    await page.waitForFunction(() => document.querySelector("#stt").textContent.includes("پیش‌نویس"));
    const [pv] = await Promise.all([ctx.waitForEvent("page"), page.click("#b-pv")]);
    await pv.waitForLoadState();
    await pv.waitForFunction(() => location.pathname.includes("/blog/preview/"), null, { timeout: 5000 });
    assert((await pv.content()).includes("پیش‌نمایش پیش‌نویس"));
    await pv.close();
  });
  await step("لیست: تکثیر و حذف با تأیید", async () => {
    await page.click('a.btn:has-text("بازگشت")');
    await page.waitForSelector("#tb tr.r");
    const before = await page.locator("#tb tr.r").count();
    await page.click('#tb tr.r [data-act="dup"]');
    await page.waitForSelector("#ti");
    assert((await page.inputValue("#ti")).includes("(کپی)"));
    await page.click('a.btn:has-text("بازگشت")'); await page.waitForSelector("#tb tr.r");
    assert.strictEqual(await page.locator("#tb tr.r").count(), before + 1);
    await page.locator('#tb tr.r:has-text("(کپی)") [data-act="del"]').click();
    await page.waitForFunction((n) => document.querySelectorAll("#tb tr.r").length === n, before);
  });
  await step("دسته‌ها: ساخت و ویرایش", async () => {
    await page.click('.chip[data-k="cats"]'); await page.waitForSelector("#cb input");
    await page.fill("#cn", "راهنما"); await page.fill("#cdsc", "آموزش‌ها"); await page.click("#cadd");
    await page.waitForFunction(() => document.querySelectorAll("#cb tr").length >= 2);
    assert((await page.locator("#cb").innerText() + (await page.locator("#cb input[data-f=description]").evaluateAll((a) => a.map((i) => i.value).join()))).includes("آموزش‌ها"));
  });
  await step("کارکنان: ساخت کاربر جدید", async () => {
    await page.click('.chip[data-k="staff"]'); await page.waitForSelector("#stb tr");
    await page.fill("#su", "newwriter"); await page.fill("#sn", "نویسنده‌ی نو"); await page.fill("#sp", "very-strong-pass-1");
    await page.click("#sadd");
    await page.waitForFunction(() => document.querySelectorAll("#stb tr").length >= 2, null, { timeout: 4000 });
    await page.screenshot({ path: SHOTS + "/staff.png" });
  });
  await step("پروفایل من + صفحه‌ی نویسنده‌ی عمومی", async () => {
    await page.click("#pf");
    await page.fill("#pb", "درباره‌ی من"); await page.fill("#ps", "boss");
    await page.click("#psv");
    pubMod._test.clearCache();
    await page.waitForFunction(() => !document.querySelector(".modal"));
    const r = await H.dispatch(pubRouter, "GET", "/blog/author/boss");
    assert.strictEqual(r.status, 200); assert(r.body.includes("درباره‌ی من"));
  });

  await browser.close(); server.close();
  console.log("\nخطاهای کنسول مرورگر:", errors.length ? errors.join("\n  ") : "هیچ");
  console.log(`${pass} موفق، ${fail} ناموفق`);
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

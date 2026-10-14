// blog/blogPublic.js
// صفحه‌های عمومی وبلاگ (رندر سمت سرور، سئو‌محور):
//   /blog                       فهرست + مطلب ویژه
//   /blog/<slug>                مطلب  (ریدایرکت ۳۰۱ از آدرس‌های قبلی)
//   /blog/category/<slug>       دسته
//   /blog/tag/<تگ>              تگ
//   /blog/author/<slug>         نویسنده
//   /blog/search?q=             جستجو (noindex)
//   /blog/rss.xml  /blog/sitemap.xml
//   /p/<slug>                   صفحه‌ی سفارشی
//   /blog/preview/...           پیش‌نمایش پیش‌نویس با لینک امضاشده (noindex)
//   /blog-assets/*              CSS/JS وبلاگ (هیچ اسکریپت/استایل inline لازم نیست)
//
// فقط مطلبی نشان داده می‌شود که status=published و published_at <= الان باشد
// (انتشار زمان‌بندی‌شده بدون cron: وقتی زمانش برسد خودبه‌خود دیده می‌شود).

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { sb, enc } = require("./blogDb");
const A = require("./blogAuth");
const R = require("./blogRender");

const router = express.Router();
const { esc } = R;

// ---------- تنظیمات ----------
const SITE = () => String(process.env.SITE_URL || "https://manhwachi.ir").replace(/\/+$/, "");
const SITE_NAME = () => process.env.BLOG_SITE_NAME || "مانهواچی";
const BLOG_NAME = () => process.env.BLOG_TITLE || "وبلاگ مانهواچی";
const BLOG_DESC = () => process.env.BLOG_DESC || "مقاله‌ها، معرفی و بررسی مانهوا، مانگا و وب‌تون با ترجمه‌ی فارسی";
// آدرس صفحه‌ی مانهوا در سایت؛ {slug} جایگزین می‌شود. اگر آدرس سایت شما فرق دارد با env عوضش کنید.
const MANHWA_URL = () => process.env.BLOG_MANHWA_URL || "/manga/{slug}";
const PER_PAGE = 12;
const ASSET_DIR = path.join(__dirname, "public");

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
};
const abs = (u) => (!u ? "" : /^https?:\/\//i.test(u) ? u : SITE() + (u.startsWith("/") ? u : "/" + u));
const nowIso = () => new Date().toISOString();
const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
};
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const arrLit = (v) => enc(`{"${String(v).replace(/[\\"]/g, "\\$&")}"}`); // مقدار آرایه‌ای PostgREST: cs.{"x"}

// ---------- کش کوچک (دسته‌ها و نویسنده‌ها؛ ۶۰ ثانیه) ----------
const cache = new Map();
async function cached(key, fn, ttl = 60_000) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await fn();
  cache.set(key, { v, exp: Date.now() + ttl });
  return v;
}
const getCategories = () =>
  cached("cats", async () => {
    return (await sb("blog_categories?select=id,slug,name,description&order=name.asc")) || [];
  });
// هرگز password_hash/username (نام ورود) خوانده یا نمایش داده نمی‌شود
const getAuthors = () =>
  cached("authors", async () => {
    const rows = await sb("blog_staff?select=id,display_name,bio,avatar_url,public_slug");
    return new Map((rows || []).map((r) => [r.id, r]));
  });

// ---------- مانهوا (برای بلوک «کارت مانهوا») ----------
function manhwaLookup(slug) {
  try {
    const data = require("../admin/dataStore").readData();
    if (!slug || !Object.hasOwn(data, slug)) return null;
    const m = data[slug];
    return {
      title: m.title_fa || m.title_en || slug,
      subtitle: m.title_fa && m.title_en ? m.title_en : "",
      cover: m.cover_image || "",
      url: MANHWA_URL().replace("{slug}", encodeURIComponent(slug)),
    };
  } catch {
    return null;
  }
}

// ---------- قالب کلی صفحه ----------
let assetVer = "1";
try {
  assetVer = String(Math.floor(require("fs").statSync(path.join(ASSET_DIR, "blog.css")).mtimeMs / 1000));
} catch { /* در تست */ }

function layout({ title, desc, canonical, image, ogType = "website", noindex = false, ld = [], body, prev, next, bodyClass = "" }) {
  const fullTitle = title === BLOG_NAME() ? title : `${title} | ${BLOG_NAME()}`;
  const img = abs(image);
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(clip(desc || BLOG_DESC(), 200))}">
${noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
${prev ? `<link rel="prev" href="${esc(prev)}">` : ""}${next ? `<link rel="next" href="${esc(next)}">` : ""}
<link rel="alternate" type="application/rss+xml" title="${esc(BLOG_NAME())}" href="${SITE()}/blog/rss.xml">
<meta property="og:locale" content="fa_IR">
<meta property="og:site_name" content="${esc(SITE_NAME())}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(clip(desc || BLOG_DESC(), 200))}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<meta name="theme-color" content="#0b0b0b">
<link rel="stylesheet" href="/blog-assets/blog.css?v=${assetVer}">
${ld.map(jsonLd).join("\n")}
</head>
<body class="${bodyClass}">
<div class="progress" id="rp" aria-hidden="true"></div>
<header class="hd"><div class="in">
  <a class="logo" href="/">${esc(SITE_NAME())}</a>
  <nav aria-label="منوی وبلاگ"><a href="/blog">وبلاگ</a><a href="/blog/rss.xml">RSS</a></nav>
  <form class="sf" action="/blog/search" method="get" role="search"><input type="search" name="q" placeholder="جستجو در وبلاگ…" maxlength="60" aria-label="جستجو"><button type="submit">جستجو</button></form>
</div></header>
<main class="main">${body}</main>
<footer class="ft"><div class="in"><span>© ${esc(SITE_NAME())}</span><span><a href="/blog">وبلاگ</a> · <a href="/blog/rss.xml">RSS</a> · <a href="/blog/sitemap.xml">نقشه‌ی سایت</a></span></div></footer>
<script src="/blog-assets/blog.js?v=${assetVer}" defer></script>
</body>
</html>`;
}

function send(res, html, { status = 200, cacheable = true } = {}) {
  res.status(status);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", cacheable ? "public, max-age=60" : "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  if (!cacheable) res.set("X-Robots-Tag", "noindex, nofollow");
  res.send(html);
}

function notFound(res, status = 404) {
  const body = `<div class="wrap narrow center"><h1>${status === 410 ? "این مطلب حذف شده است" : "صفحه پیدا نشد"}</h1><p class="mu">آدرس را بررسی کنید یا از جستجو استفاده کنید.</p><p><a class="btn btn-s" href="/blog">بازگشت به وبلاگ</a></p></div>`;
  send(res, layout({ title: status === 410 ? "حذف‌شده" : "صفحه پیدا نشد", noindex: true, body }), { status, cacheable: false });
}

// ---------- ساختارهای HTML ----------
function metaLine(p, authors, cats) {
  const a = authors.get(p.author_id);
  const c = cats.find((x) => x.id === p.category_id);
  const mins = R.readingMinutes(p.word_count);
  const parts = [];
  if (c) parts.push(`<a class="cat" href="/blog/category/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>`);
  if (a) parts.push(a.public_slug ? `<a href="/blog/author/${encodeURIComponent(a.public_slug)}">${esc(a.display_name)}</a>` : `<span>${esc(a.display_name)}</span>`);
  if (p.published_at) parts.push(`<time datetime="${esc(p.published_at)}">${esc(fmtDate(p.published_at))}</time>`);
  if (p.word_count) parts.push(`<span>${mins} دقیقه مطالعه</span>`);
  return parts.join('<i aria-hidden="true">·</i>');
}

function card(p, authors, cats, { big = false } = {}) {
  const url = `/blog/${encodeURIComponent(p.slug)}`;
  const img = p.cover_url
    ? `<a class="pc-img" href="${esc(url)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover_url)}" alt="" loading="${big ? "eager" : "lazy"}" decoding="async"></a>`
    : "";
  return `<article class="pc${big ? " pc-big" : ""}">${img}<div class="pc-b"><div class="meta">${metaLine(p, authors, cats)}</div><h2><a href="${esc(url)}">${esc(p.title)}</a></h2>${p.excerpt ? `<p>${esc(clip(p.excerpt, big ? 220 : 140))}</p>` : ""}</div></article>`;
}

function pager(base, page, hasNext) {
  if (page <= 1 && !hasNext) return "";
  const u = (n) => (n <= 1 ? base : base + (base.includes("?") ? "&" : "?") + "page=" + n);
  return `<nav class="pager" aria-label="صفحه‌بندی">${page > 1 ? `<a class="btn" rel="prev" href="${esc(u(page - 1))}">→ صفحه‌ی قبل</a>` : "<span></span>"}<span class="mu">صفحه‌ی ${page}</span>${hasNext ? `<a class="btn" rel="next" href="${esc(u(page + 1))}">صفحه‌ی بعد ←</a>` : "<span></span>"}</nav>`;
}

const LIST_COLS = "id,slug,title,excerpt,cover_url,category_id,tags,author_id,published_at,word_count,featured";
const liveFilter = () => `status=eq.published&published_at=lte.${enc(nowIso())}`;
const pageNum = (req) => Math.min(500, Math.max(1, parseInt(req.query.page, 10) || 1));

async function listPosts(extra, page) {
  const rows =
    (await sb(`blog_posts?select=${LIST_COLS}&${liveFilter()}${extra ? "&" + extra : ""}&order=published_at.desc&limit=${PER_PAGE + 1}&offset=${(page - 1) * PER_PAGE}`)) || [];
  return { rows: rows.slice(0, PER_PAGE), hasNext: rows.length > PER_PAGE };
}

function listPage({ h1, intro, rows, authors, cats, base, page, hasNext, featured, empty }) {
  const grid = rows.length
    ? `<div class="grid">${rows.map((p) => card(p, authors, cats)).join("")}</div>`
    : `<p class="mu center">${esc(empty || "هنوز مطلبی منتشر نشده است.")}</p>`;
  const chips = cats.length
    ? `<nav class="chips" aria-label="دسته‌ها"><a class="chip${base === "/blog" ? " on" : ""}" href="/blog">همه</a>${cats.map((c) => `<a class="chip${base === "/blog/category/" + encodeURIComponent(c.slug) ? " on" : ""}" href="/blog/category/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>`).join("")}</nav>`
    : "";
  return `<div class="wrap"><header class="ph"><h1>${esc(h1)}</h1>${intro ? `<p class="mu">${esc(intro)}</p>` : ""}</header>${chips}${featured || ""}${grid}${pager(base, page, hasNext)}</div>`;
}

// ---------- فهرست اصلی ----------
router.get("/blog", async (req, res, next) => {
  try {
    const page = pageNum(req);
    const [{ rows, hasNext }, cats, authors] = await Promise.all([listPosts("", page), getCategories(), getAuthors()]);
    let featured = "";
    let list = rows;
    if (page === 1 && rows.length) {
      const f = (await sb(`blog_posts?select=${LIST_COLS}&${liveFilter()}&featured=eq.true&order=published_at.desc&limit=1`).catch(() => null)) || [];
      const hero = f[0] || null;
      if (hero) {
        featured = `<section class="hero" aria-label="مطلب ویژه">${card(hero, authors, cats, { big: true })}</section>`;
        list = rows.filter((p) => p.id !== hero.id);
      }
    }
    const canonical = SITE() + "/blog" + (page > 1 ? "?page=" + page : "");
    const body = listPage({ h1: BLOG_NAME(), intro: BLOG_DESC(), rows: list, authors, cats, base: "/blog", page, hasNext, featured });
    const ld = [{ "@context": "https://schema.org", "@type": "Blog", name: BLOG_NAME(), url: SITE() + "/blog", inLanguage: "fa" }];
    send(res, layout({ title: BLOG_NAME(), desc: BLOG_DESC(), canonical, body, ld, prev: page > 1 ? SITE() + "/blog" + (page > 2 ? "?page=" + (page - 1) : "") : "", next: hasNext ? SITE() + "/blog?page=" + (page + 1) : "" }));
  } catch (e) {
    next(e);
  }
});

// ---------- فید و سایت‌مپ ----------
const xmlEsc = (s) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const cdata = (s) => "<![CDATA[" + String(s).replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";

router.get("/blog/rss.xml", async (req, res, next) => {
  try {
    const rows = (await sb(`blog_posts?select=${LIST_COLS},content,updated_at&${liveFilter()}&order=published_at.desc&limit=30`)) || [];
    const [cats, authors] = await Promise.all([getCategories(), getAuthors()]);
    const items = rows
      .map((p) => {
        const url = `${SITE()}/blog/${encodeURIComponent(p.slug)}`;
        let html = R.renderBlocks(p.content, { manhwa: manhwaLookup, hasCover: true }).html;
        html = html.replace(/(src|href)="\/(?!\/)/g, `$1="${SITE()}/`); // آدرس‌های نسبی → کامل
        if (p.cover_url) html = `<p><img src="${esc(abs(p.cover_url))}" alt=""></p>` + html;
        const c = cats.find((x) => x.id === p.category_id);
        const a = authors.get(p.author_id);
        return `<item><title>${xmlEsc(p.title)}</title><link>${xmlEsc(url)}</link><guid isPermaLink="true">${xmlEsc(url)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate>${a ? `<dc:creator>${xmlEsc(a.display_name)}</dc:creator>` : ""}${c ? `<category>${xmlEsc(c.name)}</category>` : ""}${(p.tags || []).map((t) => `<category>${xmlEsc(t)}</category>`).join("")}<description>${xmlEsc(p.excerpt || "")}</description><content:encoded>${cdata(html)}</content:encoded></item>`;
      })
      .join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${xmlEsc(BLOG_NAME())}</title><link>${SITE()}/blog</link><description>${xmlEsc(BLOG_DESC())}</description><language>fa</language><atom:link href="${SITE()}/blog/rss.xml" rel="self" type="application/rss+xml"/>${rows[0] ? `<lastBuildDate>${new Date(rows[0].updated_at || rows[0].published_at).toUTCString()}</lastBuildDate>` : ""}${items}</channel></rss>`;
    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=600");
    res.send(xml);
  } catch (e) {
    next(e);
  }
});

router.get("/blog/sitemap.xml", async (req, res, next) => {
  try {
    const [posts, pages, cats, authors] = await Promise.all([
      sb(`blog_posts?select=slug,updated_at,published_at,category_id,tags,author_id,noindex&${liveFilter()}&order=published_at.desc&limit=5000`),
      sb(`blog_pages?select=slug,updated_at&${liveFilter()}&limit=1000`),
      getCategories(),
      getAuthors(),
    ]);
    const day = (d) => String(d || "").slice(0, 10);
    const urls = [{ loc: SITE() + "/blog", lastmod: day(posts?.[0]?.updated_at) }];
    const catUsed = new Set();
    const tagUsed = new Map();
    const authUsed = new Set();
    for (const p of posts || []) {
      if (p.noindex) continue;
      urls.push({ loc: `${SITE()}/blog/${encodeURIComponent(p.slug)}`, lastmod: day(p.updated_at) });
      if (p.category_id) catUsed.add(p.category_id);
      authUsed.add(p.author_id);
      for (const t of p.tags || []) if (!tagUsed.has(t) || tagUsed.get(t) < p.updated_at) tagUsed.set(t, p.updated_at);
    }
    for (const c of cats) if (catUsed.has(c.id)) urls.push({ loc: `${SITE()}/blog/category/${encodeURIComponent(c.slug)}` });
    for (const [t, u] of tagUsed) urls.push({ loc: `${SITE()}/blog/tag/${encodeURIComponent(t)}`, lastmod: day(u) });
    for (const id of authUsed) {
      const a = authors.get(id);
      if (a && a.public_slug) urls.push({ loc: `${SITE()}/blog/author/${encodeURIComponent(a.public_slug)}` });
    }
    for (const p of pages || []) urls.push({ loc: `${SITE()}/p/${encodeURIComponent(p.slug)}`, lastmod: day(p.updated_at) });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("")}</urlset>`;
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=600");
    res.send(xml);
  } catch (e) {
    next(e);
  }
});

// ---------- جستجو ----------
const searchHits = new Map();
function searchLimited(ip) {
  const now = Date.now();
  const e = searchHits.get(ip);
  if (!e || e.reset <= now) searchHits.set(ip, { n: 1, reset: now + 60_000 });
  else e.n++;
  while (searchHits.size > 5000) searchHits.delete(searchHits.keys().next().value);
  return (searchHits.get(ip).n || 0) > 30;
}

router.get("/blog/search", async (req, res, next) => {
  try {
    if (searchLimited(req.ip)) return res.status(429).type("text/plain").send("درخواست‌های زیاد؛ کمی بعد دوباره امتحان کنید");
    const q = String(req.query.q || "").replace(/[*%,()\\"{}:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    const [cats, authors] = await Promise.all([getCategories(), getAuthors()]);
    let rows = [];
    if (q.length >= 2) {
      const t = `*${q}*`;
      rows = (await sb(`blog_posts?select=${LIST_COLS}&${liveFilter()}&or=${enc(`(title.ilike.${t},excerpt.ilike.${t},search_text.ilike.${t})`)}&order=published_at.desc&limit=20`)) || [];
    }
    const body = `<div class="wrap"><header class="ph"><h1>جستجو${q ? `: ${esc(q)}` : ""}</h1></header>${
      q.length < 2 ? '<p class="mu">حداقل دو حرف وارد کنید.</p>' : rows.length ? `<div class="grid">${rows.map((p) => card(p, authors, cats)).join("")}</div>` : '<p class="mu">نتیجه‌ای پیدا نشد؛ عبارت دیگری را امتحان کنید.</p>'
    }</div>`;
    send(res, layout({ title: q ? `جستجو: ${q}` : "جستجو", noindex: true, body }), { cacheable: false });
  } catch (e) {
    next(e);
  }
});

// ---------- دسته / تگ / نویسنده ----------
router.get("/blog/category/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const cats = await getCategories();
    let cat = cats.find((c) => c.slug === slug);
    if (!cat) {
      const old = (await sb(`blog_categories?old_slugs=cs.${arrLit(slug)}&select=slug&limit=1`)) || [];
      if (old[0]) return res.redirect(301, `/blog/category/${encodeURIComponent(old[0].slug)}`);
      return notFound(res);
    }
    const page = pageNum(req);
    const authors = await getAuthors();
    const { rows, hasNext } = await listPosts(`category_id=eq.${enc(cat.id)}`, page);
    if (page > 1 && !rows.length) return notFound(res);
    const base = `/blog/category/${encodeURIComponent(cat.slug)}`;
    const body = listPage({ h1: cat.name, intro: cat.description, rows, authors, cats, base, page, hasNext, empty: "هنوز مطلبی در این دسته منتشر نشده است." });
    const ld = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "وبلاگ", item: SITE() + "/blog" }, { "@type": "ListItem", position: 2, name: cat.name, item: SITE() + base }] }];
    send(res, layout({ title: cat.name, desc: cat.description || `مطالب دسته‌ی ${cat.name}`, canonical: SITE() + base + (page > 1 ? "?page=" + page : ""), body, ld, noindex: !rows.length }));
  } catch (e) {
    next(e);
  }
});

router.get("/blog/tag/:tag", async (req, res, next) => {
  try {
    const tag = String(req.params.tag || "").slice(0, 60);
    const page = pageNum(req);
    const [cats, authors] = await Promise.all([getCategories(), getAuthors()]);
    const { rows, hasNext } = await listPosts(`tags=cs.${arrLit(tag)}`, page);
    if (!rows.length) return notFound(res); // تگ خالی: ۴۰۴ (جلوگیری از صفحه‌ی بی‌محتوا در گوگل)
    const base = `/blog/tag/${encodeURIComponent(tag)}`;
    const body = listPage({ h1: `برچسب: ${tag}`, rows, authors, cats, base, page, hasNext });
    send(res, layout({ title: `برچسب ${tag}`, desc: `مطالب برچسب ${tag}`, canonical: SITE() + base + (page > 1 ? "?page=" + page : ""), body }));
  } catch (e) {
    next(e);
  }
});

router.get("/blog/author/:slug", async (req, res, next) => {
  try {
    const authors = await getAuthors();
    const a = [...authors.values()].find((x) => x.public_slug && x.public_slug === req.params.slug);
    if (!a) return notFound(res);
    const page = pageNum(req);
    const cats = await getCategories();
    const { rows, hasNext } = await listPosts(`author_id=eq.${enc(a.id)}`, page);
    const base = `/blog/author/${encodeURIComponent(a.public_slug)}`;
    const head = `<header class="ph author-h">${a.avatar_url ? `<img class="av" src="${esc(a.avatar_url)}" alt="${esc(a.display_name)}" width="72" height="72">` : ""}<div><h1>${esc(a.display_name)}</h1>${a.bio ? `<p class="mu">${esc(a.bio)}</p>` : ""}</div></header>`;
    const body = `<div class="wrap">${head}${rows.length ? `<div class="grid">${rows.map((p) => card(p, authors, cats)).join("")}</div>` : '<p class="mu">هنوز مطلبی منتشر نشده است.</p>'}${pager(base, page, hasNext)}</div>`;
    const ld = [{ "@context": "https://schema.org", "@type": "Person", name: a.display_name, url: SITE() + base, ...(a.avatar_url ? { image: abs(a.avatar_url) } : {}) }];
    send(res, layout({ title: a.display_name, desc: a.bio || `مطالب ${a.display_name}`, canonical: SITE() + base + (page > 1 ? "?page=" + page : ""), body, ld, noindex: !rows.length }));
  } catch (e) {
    next(e);
  }
});

// ---------- شمارنده‌ی بازدید ----------
// بازدید ربات‌ها و تکراری (همان IP در ۳۰ دقیقه) شمرده نمی‌شود؛ ثبت در دیتابیس هر ۳۰ ثانیه دسته‌ای است.
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|curl|wget|python-requests|monitor|lighthouse/i;
const seen = new Map();
const pending = new Map();
function countView(req, postId) {
  if (req.method !== "GET" || BOT_RE.test(req.get("user-agent") || "")) return;
  const key = crypto.createHash("sha1").update(`${req.ip}|${postId}`).digest("base64url").slice(0, 16);
  const now = Date.now();
  if ((seen.get(key) || 0) > now) return;
  seen.set(key, now + 30 * 60_000);
  while (seen.size > 20000) seen.delete(seen.keys().next().value);
  pending.set(postId, (pending.get(postId) || 0) + 1);
}
async function flushViews() {
  const batch = [...pending.entries()];
  pending.clear();
  for (const [id, n] of batch) {
    try {
      const r = await sb(`blog_posts?id=eq.${enc(id)}&select=views,updated_at&limit=1`);
      if (!r || !r[0]) continue;
      // updated_at را صریح همان مقدار قبلی می‌فرستیم تا شمارش بازدید «تاریخ ویرایش» را عوض نکند
      await sb(`blog_posts?id=eq.${enc(id)}`, { method: "PATCH", body: { views: (r[0].views || 0) + n, updated_at: r[0].updated_at } });
    } catch (e) {
      pending.set(id, (pending.get(id) || 0) + n); // دفعه‌ی بعد دوباره
    }
  }
}
const viewTimer = setInterval(flushViews, 30_000);
if (viewTimer.unref) viewTimer.unref();

// ---------- مطلب ----------
const SHARE = (url, title) => {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return `<div class="share"><span class="mu">اشتراک‌گذاری:</span><a href="https://t.me/share/url?url=${u}&amp;text=${t}" target="_blank" rel="noopener noreferrer">تلگرام</a><a href="https://wa.me/?text=${t}%20${u}" target="_blank" rel="noopener noreferrer">واتساپ</a><a href="https://twitter.com/intent/tweet?url=${u}&amp;text=${t}" target="_blank" rel="noopener noreferrer">ایکس</a><button type="button" data-copy-url="${esc(url)}">کپی لینک</button></div>`;
};

async function related(post) {
  const pick = new Map();
  const add = (rows, w) => {
    for (const r of rows || []) {
      if (r.id === post.id) continue;
      const e = pick.get(r.id) || { r, score: 0 };
      e.score += w;
      pick.set(r.id, e);
    }
  };
  if (post.category_id) add(await sb(`blog_posts?select=${LIST_COLS}&${liveFilter()}&category_id=eq.${enc(post.category_id)}&id=neq.${enc(post.id)}&order=published_at.desc&limit=12`).catch(() => []), 1);
  for (const t of (post.tags || []).slice(0, 4)) {
    add(await sb(`blog_posts?select=${LIST_COLS}&${liveFilter()}&tags=cs.${arrLit(t)}&id=neq.${enc(post.id)}&order=published_at.desc&limit=8`).catch(() => []), 2);
  }
  return [...pick.values()]
    .sort((a, b) => b.score - a.score || String(b.r.published_at).localeCompare(String(a.r.published_at)))
    .slice(0, 3)
    .map((x) => x.r);
}

async function renderPost(req, res, p, { preview = false } = {}) {
  const [cats, authors] = await Promise.all([getCategories(), getAuthors()]);
  const url = `${SITE()}/blog/${encodeURIComponent(p.slug)}`;
  const { html, toc, faq } = R.renderBlocks(p.content, { manhwa: manhwaLookup, hasCover: !!p.cover_url && p.cover_style !== "none" });
  const cat = cats.find((c) => c.id === p.category_id);
  const author = authors.get(p.author_id);
  const words = p.word_count || R.countWords(R.plainText(p.content));
  const desc = p.seo_desc || p.excerpt || clip(R.plainText(p.content), 155);
  const title = p.seo_title || p.title;
  const showCover = p.cover_url && p.cover_style !== "none";
  const cover = showCover
    ? `<figure class="cover cv-${esc(p.cover_style)}"><img src="${esc(p.cover_url)}" alt="${esc(p.cover_alt)}" fetchpriority="high" decoding="async"></figure>`
    : "";

  const crumbs = [`<a href="/">${esc(SITE_NAME())}</a>`, `<a href="/blog">وبلاگ</a>`];
  if (cat) crumbs.push(`<a href="/blog/category/${encodeURIComponent(cat.slug)}">${esc(cat.name)}</a>`);
  const tocHtml = toc.length >= 3
    ? `<nav class="toc" aria-label="فهرست مطالب"><b>فهرست مطالب</b><ol>${toc.map((t) => `<li class="l${t.level}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join("")}</ol></nav>`
    : "";
  const tags = (p.tags || []).length ? `<div class="tags">${p.tags.map((t) => `<a href="/blog/tag/${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}</div>` : "";
  const authorBox = author
    ? `<aside class="abox">${author.avatar_url ? `<img class="av" src="${esc(author.avatar_url)}" alt="" width="56" height="56" loading="lazy">` : ""}<div><b>${author.public_slug ? `<a href="/blog/author/${encodeURIComponent(author.public_slug)}">${esc(author.display_name)}</a>` : esc(author.display_name)}</b>${author.bio ? `<p class="mu">${esc(author.bio)}</p>` : ""}</div></aside>`
    : "";

  let relHtml = "";
  let navHtml = "";
  if (!preview) {
    const rel = await related(p).catch(() => []);
    if (rel.length) relHtml = `<section class="rel"><h2>مطالب مرتبط</h2><div class="grid">${rel.map((r) => card(r, authors, cats)).join("")}</div></section>`;
    const [pv, nx] = await Promise.all([
      sb(`blog_posts?select=slug,title&${liveFilter()}&published_at=lt.${enc(p.published_at)}&order=published_at.desc&limit=1`).catch(() => []),
      sb(`blog_posts?select=slug,title&${liveFilter()}&published_at=gt.${enc(p.published_at)}&order=published_at.asc&limit=1`).catch(() => []),
    ]);
    if ((pv && pv[0]) || (nx && nx[0])) {
      navHtml = `<nav class="pn">${nx && nx[0] ? `<a rel="next" href="/blog/${encodeURIComponent(nx[0].slug)}"><small>مطلب بعدی</small>${esc(nx[0].title)}</a>` : "<span></span>"}${pv && pv[0] ? `<a rel="prev" href="/blog/${encodeURIComponent(pv[0].slug)}"><small>مطلب قبلی</small>${esc(pv[0].title)}</a>` : "<span></span>"}</nav>`;
    }
  }

  const body = `${preview ? '<div class="pvbar">پیش‌نمایش پیش‌نویس — این صفحه در گوگل ایندکس نمی‌شود</div>' : ""}
<article class="wrap post" data-readroot>
<nav class="crumbs" aria-label="مسیر">${crumbs.join("<i>‹</i>")}</nav>
${p.cover_style === "overlay" || p.cover_style === "full" || p.cover_style === "split" ? cover : ""}
<header class="ph"><h1>${esc(p.title)}</h1><div class="meta">${metaLine(p, authors, cats)}${p.updated_at && p.published_at && new Date(p.updated_at) - new Date(p.published_at) > 86400000 ? `<i aria-hidden="true">·</i><span>به‌روزرسانی: ${esc(fmtDate(p.updated_at))}</span>` : ""}</div>${p.excerpt ? `<p class="lead">${esc(p.excerpt)}</p>` : ""}</header>
${p.cover_style === "compact" ? cover : ""}
${tocHtml}
<div class="content">${html}</div>
${tags}${SHARE(url, p.title)}${authorBox}${navHtml}${relHtml}
</article>`;

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: clip(p.title, 110),
      description: clip(desc, 200),
      inLanguage: "fa",
      mainEntityOfPage: url,
      datePublished: p.published_at,
      dateModified: p.updated_at || p.published_at,
      wordCount: words,
      ...(showCover ? { image: [abs(p.cover_url)] } : {}),
      ...(p.tags && p.tags.length ? { keywords: p.tags.join("، ") } : {}),
      ...(author ? { author: { "@type": "Person", name: author.display_name, ...(author.public_slug ? { url: `${SITE()}/blog/author/${encodeURIComponent(author.public_slug)}` } : {}) } } : {}),
      publisher: { "@type": "Organization", name: SITE_NAME(), url: SITE() },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME(), item: SITE() + "/" },
        { "@type": "ListItem", position: 2, name: "وبلاگ", item: SITE() + "/blog" },
        ...(cat ? [{ "@type": "ListItem", position: 3, name: cat.name, item: `${SITE()}/blog/category/${encodeURIComponent(cat.slug)}` }] : []),
        { "@type": "ListItem", position: cat ? 4 : 3, name: p.title, item: url },
      ],
    },
  ];
  if (faq.length) {
    ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  }

  send(
    res,
    layout({
      title,
      desc,
      canonical: p.canonical_url || url,
      image: showCover ? p.cover_url : "",
      ogType: "article",
      noindex: preview || !!p.noindex,
      ld: preview ? [] : ld,
      body,
      bodyClass: "is-post",
    }),
    { cacheable: !preview }
  );
}

// ---------- پیش‌نمایش (باید قبل از /blog/:slug بیاید) ----------
router.get("/blog/preview/:kind/:id/:exp/:sig", async (req, res, next) => {
  try {
    const { kind, id, exp, sig } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !A.verifyPreview(kind, id, exp, sig)) return notFound(res);
    const table = kind === "pages" ? "blog_pages" : "blog_posts";
    const rows = await sb(`${table}?id=eq.${enc(id)}&select=*&limit=1`);
    if (!rows || !rows[0]) return notFound(res);
    if (kind === "pages") return renderPage(res, rows[0], { preview: true });
    await renderPost(req, res, rows[0], { preview: true });
  } catch (e) {
    next(e);
  }
});

const isLive = (p) => p && p.status === "published" && p.published_at && new Date(p.published_at).getTime() <= Date.now();

router.get("/blog/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const rows = await sb(`blog_posts?slug=eq.${enc(slug)}&select=*&limit=1`);
    const p = rows && rows[0];
    if (p) {
      if (isLive(p)) {
        countView(req, p.id);
        return await renderPost(req, res, p);
      }
      return notFound(res, p.status === "archived" && p.published_at ? 410 : 404);
    }
    const old = await sb(`blog_posts?old_slugs=cs.${arrLit(slug)}&select=slug,status,published_at&limit=1`);
    if (old && old[0] && isLive(old[0])) return res.redirect(301, `/blog/${encodeURIComponent(old[0].slug)}`);
    notFound(res);
  } catch (e) {
    next(e);
  }
});

// ---------- صفحه‌ی سفارشی ----------
function renderPage(res, p, { preview = false } = {}) {
  const { html } = R.renderBlocks(p.content, { manhwa: manhwaLookup, hasCover: true });
  const url = `${SITE()}/p/${encodeURIComponent(p.slug)}`;
  const body = `${preview ? '<div class="pvbar">پیش‌نمایش پیش‌نویس — این صفحه در گوگل ایندکس نمی‌شود</div>' : ""}<article class="wrap post"><header class="ph"><h1>${esc(p.title)}</h1></header><div class="content">${html}</div></article>`;
  send(res, layout({ title: p.seo_title || p.title, desc: p.seo_desc || clip(R.plainText(p.content), 155), canonical: url, noindex: preview, body, bodyClass: "is-post" }), { cacheable: !preview });
}

router.get("/p/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const rows = await sb(`blog_pages?slug=eq.${enc(slug)}&select=*&limit=1`);
    const p = rows && rows[0];
    if (p) return isLive(p) ? renderPage(res, p) : notFound(res);
    const old = await sb(`blog_pages?old_slugs=cs.${arrLit(slug)}&select=slug,status,published_at&limit=1`);
    if (old && old[0] && isLive(old[0])) return res.redirect(301, `/p/${encodeURIComponent(old[0].slug)}`);
    notFound(res);
  } catch (e) {
    next(e);
  }
});

// ---------- فایل‌های CSS/JS ----------
router.use("/blog-assets", express.static(ASSET_DIR, { maxAge: "7d", index: false, fallthrough: false }));

// ---------- خطا ----------
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error("[blog-public]", req.method, req.originalUrl, err && err.message, (err && err.detail) || "");
  res.status(status).type("text/plain; charset=utf-8").send(status === 404 ? "پیدا نشد" : "خطای داخلی سرور");
});

module.exports = { router, flushViews, _test: { layout, manhwaLookup, clearCache: () => cache.clear() } };

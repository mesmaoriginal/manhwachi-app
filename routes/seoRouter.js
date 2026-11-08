"use strict";
/**
 * سئوی سمت‌سرور مانهواچی
 *  - /robots.txt
 *  - /sitemap.xml (ایندکس) + /sitemap-manhwa.xml (مانهواها + تصاویر + lastmod) + /sitemap-pages.xml (صفحات ثابت و ژانرها)
 *  - صفحه اصلی با لیست‌های SSR (جدیدترین‌ها / برترین‌ها / لینک ژانرها)
 *  - /genres و /genre/:slug (صفحات ژانر قابل‌ایندکس)
 *
 * استفاده در server.js:
 *   app.use(require("./routes/seoRouter")({ readHtml: versionedHtml, publicDir: PUBLIC_DIR }));
 * (باید قبل از middleware ی که "/" را از index.html سرو می‌کند و قبل از express.static ثبت شود)
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const { getData } = require("../lib/dataStore");

const SITE = (process.env.SITE_URL || "https://manhwachi.ir").replace(/\/+$/, "");
const BRAND = "مانهواچی";
const TTL = 60 * 1000;
const DEFAULT_OG = `${SITE}/ManhwaChi/favicon-192x192.png`;

const FA = {
  Action: "اکشن", Romance: "عاشقانه", Fantasy: "فانتزی", Adventure: "ماجراجویی", Comedy: "کمدی",
  Drama: "درام", Mystery: "معمایی", Horror: "ترسناک", "Sci-Fi": "علمی-تخیلی", Psychological: "روان‌شناختی",
  Sports: "ورزشی", Historical: "تاریخی", "School Life": "زندگی مدرسه‌ای", "Martial Arts": "هنرهای رزمی",
  "Dark Fantasy": "دارک فانتزی", Thriller: "هیجان‌انگیز", Supernatural: "ماورایی", Isekai: "ایسکای",
  "Slice of Life": "برشی از زندگی", Harem: "هارم", Ecchi: "اکی", Seinen: "سینن",
  Shounen: "شونن", Shoujo: "شوجو", Josei: "جوسی", Tragedy: "تراژدی", Crime: "جنایی", Military: "نظامی",
};
const REV = Object.fromEntries(Object.entries(FA).map(([k, v]) => [v, k]));
const keyOf = (g) => REV[g] || g;
const faOf = (k) => FA[k] || k;
const slugOf = (k) => String(k).trim().toLowerCase().replace(/\s+/g, "-");

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fa = (n) => Number(n).toLocaleString("fa-IR");
const score = (it) => parseFloat(it.score || it.rating || 0) || 0;
const title = (it) => it.title_fa || it.title_en || it.slug;
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const trimTo = (s, n) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 25)).replace(/[،,.؛:\s-]+$/, "") + "…";
};

// ---------- تاریخ: شمسی → میلادی (برای lastmod و dateModified) ----------
function j2g(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [gy, gm, gd];
}
const faDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
// ورودی: "1404/08/10" یا "2026-11-01" → خروجی "YYYY-MM-DD" یا ""
function isoDate(d) {
  if (!d) return "";
  const p = faDigits(d).split(/[\/\-.]/).map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((x) => !Number.isFinite(x))) return "";
  let [y, m, dd] = p;
  if (m < 1 || m > 12 || dd < 1 || dd > 31) return "";
  if (y < 1700) [y, m, dd] = j2g(y, m, dd);
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || dd < 1 || dd > 31) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(dd)}`;
}
const dateKey = (d) => { const iso = isoDate(d); return iso ? Number(iso.replace(/-/g, "")) : 0; };

// ---------- ایندکس کش‌شده از data.json ----------
let cache = null;
function index() {
  const data = getData();
  const now = Date.now();
  if (cache && cache.data === data && now - cache.t < TTL) return cache;

  const list = Object.entries(data).map(([slug, it]) => {
    let last = { num: 0, date: "" };
    (it.episodes || []).forEach((ep) => {
      const a = dateKey(ep.date), b = dateKey(last.date);
      if (a > b || (a === b && (ep.num || 0) > (last.num || 0))) last = ep;
    });
    return { slug, ...it, latestNum: last.num, latestDate: last.date || "", lastmod: isoDate(last.date) };
  });

  const genres = new Map();
  for (const it of list) {
    const seen = new Set();
    for (const g of Array.isArray(it.genres) ? it.genres : []) {
      const key = keyOf(g), s = slugOf(key);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      if (!genres.has(s)) genres.set(s, { slug: s, key, name: faOf(key), items: [] });
      genres.get(s).items.push(it);
    }
  }
  for (const g of genres.values()) g.items.sort((a, b) => score(b) - score(a));

  cache = { data, t: now, list, genres, home: null, homeK: "" };
  return cache;
}

const { IMG_BASE, IMG_SNIPPET } = require("../lib/imgBase");
const coverPath = (it) => `/manhwas/${encodeURIComponent(it.slug)}/${esc(it.cover_image)}`; // برای og:image/سئو (دامنه‌ی اصلی)
const coverUrl = (it) => IMG_BASE + coverPath(it); // برای <img> (CDN اگه IMG_BASE ست باشه)

// ---------- صفحه اصلی ----------
function fillUl(html, id, inner) {
  const re = new RegExp(`(<ul[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</ul>)`);
  return re.test(html) ? html.replace(re, `$1\n${inner}\n$2`) : html;
}
function renderHome(readHtml, homeFile) {
  const c = index();
  const base = readHtml(homeFile); // نسخه‌ی نسخه‌دار‌شده (?v=...) از index.html
  const k = base.length + ":" + c.t;
  if (c.home && c.homeK === k) return c.home;

  let html = base;
  const latest = [...c.list].sort((a, b) => dateKey(b.latestDate) - dateKey(a.latestDate)).slice(0, 8);
  const top = [...c.list].sort((a, b) => score(b) - score(a)).slice(0, 8);

  html = fillUl(html, "todaysList", latest.map((it) => {
    const t = esc(title(it)), g = esc(faOf(keyOf((it.genres || [])[0] || "مانهوا")));
    return `<li><a class="comic-card" href="/comic/${encodeURIComponent(it.slug)}"><div class="comic-pic"><img src="${coverUrl(it)}" alt="مانهوا ${t}" loading="lazy" decoding="async"><div class="badge-chapter-box"><span class="badge-chapter-num">چپتر ${esc(it.latestNum)}</span></div></div><div class="comic-info"><h3 class="comic-title">${t}</h3><div class="comic-meta"><span class="comic-genre">${g}</span></div></div></a></li>`;
  }).join("\n"));

  html = fillUl(html, "topRatedList", top.map((it, i) => {
    const t = esc(title(it)), g = esc((it.genres || []).map((x) => faOf(keyOf(x))).join(" • ") || "نامشخص");
    return `<li><a href="/comic/${encodeURIComponent(it.slug)}"><div class="row"><div class="col num"><span${i === 0 ? ' class="rank1"' : ""}>${i + 1}</span></div><div class="col pic"><img src="${coverUrl(it)}" width="100%" alt="مانهوا ${t}" loading="lazy" decoding="async"></div><div class="col info"><p class="subj"><strong class="ellipsis">${t}</strong></p><p class="genre">${g}</p></div></div></a></li>`;
  }).join("\n"));

  const chips = [...c.genres.values()].sort((a, b) => b.items.length - a.items.length)
    .map((g) => `<a class="text-red-500 hover:underline ml-3" href="/genre/${encodeURIComponent(g.slug)}">مانهوای ${esc(g.name)}</a>`).join(" ");
  html = html.replace("<!--GENRE_LINKS-->", chips);

  const ld = jsonLd({
    "@context": "https://schema.org", "@type": "ItemList", name: "آخرین آپدیت‌های مانهواچی",
    itemListElement: latest.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/comic/${encodeURIComponent(it.slug)}`, name: title(it) })),
  });
  html = html.replace("</head>", `${ld}\n</head>`);

  c.home = html; c.homeK = k;
  return html;
}

// ---------- قالب صفحات ژانر ----------
function layout({ ttl, desc, canonical, robots, body, ld, image, css, ogType }) {
  const img = image || DEFAULT_OG;
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="UTF-8">${IMG_SNIPPET}<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ttl)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${robots || "index, follow, max-image-preview:large"}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${ogType || 'website'}"><meta property="og:site_name" content="${BRAND}"><meta property="og:title" content="${esc(ttl)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="fa_IR"><meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(ttl)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<link rel="icon" href="/ManhwaChi/favicon.ico"><link rel="icon" type="image/png" sizes="192x192" href="/ManhwaChi/favicon-192x192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#000;color:#e2e2e2;font-family:Vazirmatn,system-ui,sans-serif;line-height:1.9}
a{color:inherit;text-decoration:none}header{position:sticky;top:0;z-index:5;background:rgba(18,18,18,.92);border-bottom:1px solid rgba(255,255,255,.1)}
.bar{max-width:1100px;margin:auto;padding:0 16px;height:60px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.bar img{height:30px;width:auto}nav{display:flex;gap:18px;font-size:14px;font-weight:600;color:#9ca3af}nav a:hover{color:#fff}
main{max-width:1100px;margin:auto;padding:24px 16px 64px}h1{font-size:24px;color:#fff;margin-bottom:8px}h1 span,.red{color:#DC2626}
.intro{color:#9ca3af;font-size:14px;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.card img{width:100%;height:auto;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:#1b1b1b;border:1px solid rgba(255,255,255,.06)}
.card h2{font-size:13px;font-weight:600;margin-top:6px;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.6}
.card small{color:#fbbf24;font-size:12px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:28px 0 8px}
.chip{padding:6px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:13px;color:#cbb8b8}.chip:hover,.chip.on{border-color:#DC2626;color:#fff;background:rgba(220,38,38,.15)}
.gg{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.gg a{padding:18px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);text-align:center}
.gg a:hover{border-color:rgba(220,38,38,.5)}.gg b{display:block;color:#fff}.gg small{color:#8c8c8c}
.crumb{font-size:12px;color:#8c8c8c;margin-bottom:12px}.crumb a:hover{color:#fff}
footer{border-top:1px solid rgba(255,255,255,.1);padding:24px 16px;text-align:center;color:#8c8c8c;font-size:12px}
${css || ""}</style>${ld || ""}</head><body>
<header><div class="bar"><a href="/"><img src="/ManhwaChi/LOGO-main-white.webp" alt="${BRAND}" width="120" height="30"></a>
<nav aria-label="منوی اصلی"><a href="/">خانه</a><a href="/library-page.html">آرشیو مانهوا</a><a href="/genres">ژانرها</a><a href="/blog">وبلاگ</a><a href="/search.html">جستجو</a></nav></div></header>
<main>${body}</main><footer>© ${BRAND} | Manhwachi — خواندن آنلاین مانهوا و مانگا با ترجمه فارسی</footer></body></html>`;
}
const card = (it) => `<a class="card" href="/comic/${encodeURIComponent(it.slug)}"><img src="${coverUrl(it)}" alt="مانهوا ${esc(title(it))}" loading="lazy" decoding="async" width="300" height="400"><h2>${esc(title(it))}</h2>${score(it) ? `<small>★ ${esc(it.score || it.rating)}</small>` : ""}</a>`;
const crumbs = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: u })) });


// ---------- صفحه‌ی قابل‌ایندکس هر چپتر: /comic/<slug>/chapter-<n> ----------
// reader.html عمداً noindex است (SPA، بدون عنوان و محتوای اختصاصی). این صفحه‌ی سبک و SSR،
// برای جستجوهایی مثل «مانهوا X چپتر N» ایندکس می‌شود و کاربر را با یک دکمه به خواننده می‌برد.
const CH_CSS = `
.hero{display:flex;gap:18px;align-items:flex-start;margin:14px 0 22px}.hero img{width:130px;height:auto;aspect-ratio:3/4;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#1b1b1b;flex:none}
.hero .meta{flex:1;min-width:0}.badge{display:inline-block;padding:2px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,.15);color:#cbb8b8;margin-left:6px}
.badge.free{color:#22c55e;border-color:rgba(34,197,94,.4)}.badge.vip{color:#fbbf24;border-color:rgba(251,191,36,.4)}
.cta{display:inline-block;margin-top:14px;padding:12px 30px;border-radius:12px;background:#DC2626;color:#fff;font-weight:700;font-size:16px}.cta:hover{background:#b91c1c}
.pn{display:flex;gap:10px;justify-content:space-between;margin:22px 0;flex-wrap:wrap}.pn a{flex:1;min-width:140px;text-align:center;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);font-size:14px;color:#e2e2e2}.pn a:hover{border-color:#DC2626}
.sec{margin-top:30px}.sec h2{font-size:17px;color:#fff;margin-bottom:10px}.sec p{color:#b8b8b8;font-size:14px}
.chl{display:flex;flex-wrap:wrap;gap:8px}.chl a{padding:5px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:13px;color:#cbb8b8}.chl a:hover,.chl a.on{border-color:#DC2626;color:#fff;background:rgba(220,38,38,.15)}
@media(max-width:520px){.hero img{width:96px}h1{font-size:20px}}
`;
const CH_PER_MAP = 40000;
const chapterUrls = (c) => {
  if (c.chUrls) return c.chUrls;
  const out = [];
  for (const it of c.list) for (const { n, ep } of chaptersOf(it)) out.push([`${SITE}${chUrl(it.slug, n)}`, isoDate(ep.date)]);
  return (c.chUrls = out);
};
const chUrl = (slug, n) => `/comic/${encodeURIComponent(slug)}/chapter-${n}`;
const thumbUrl = (slug, n) => `/manhwas/${encodeURIComponent(slug)}/chapterPictures/chapterpicture${n}.png`;

function chaptersOf(it) {
  // چپترهای یکتا بر اساس شماره، صعودی
  const m = new Map();
  for (const ep of it.episodes || []) {
    const n = Number(ep.num);
    if (Number.isFinite(n) && n >= 0 && !m.has(n)) m.set(n, ep);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([n, ep]) => ({ n, ep }));
}

function renderChapter(c, it, n) {
  const list = chaptersOf(it);
  const i = list.findIndex((x) => x.n === n);
  if (i < 0) return null;
  const { ep } = list[i];
  const prev = list[i - 1], next = list[i + 1];
  const nameFa = it.title_fa || it.title_en || it.slug;
  const nameEn = it.title_en && it.title_fa && it.title_en !== it.title_fa ? it.title_en : "";
  const canonical = `${SITE}${chUrl(it.slug, n)}`;
  const seriesUrl = `${SITE}/comic/${encodeURIComponent(it.slug)}`;
  const iso = isoDate(ep.date);
  const free = !!ep.free;
  const genres = (Array.isArray(it.genres) ? it.genres : []).map((g) => ({ name: faOf(keyOf(g)), slug: slugOf(keyOf(g)) }));
  const lastN = list[list.length - 1].n;
  const cover = it.cover_image ? SITE + coverPath(it) : undefined;

  const ttls = [
    `مانهوا ${nameFa} چپتر ${n} | خواندن آنلاین | ${BRAND}`,
    `${nameFa} چپتر ${n} | ${BRAND}`,
  ];
  const ttl = ttls.find((t) => t.length <= 62) || trimTo(ttls[1], 62);
  const raw = String(it.description || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const lead = `خواندن آنلاین چپتر ${n} مانهوا ${nameFa}${nameEn ? ` (${nameEn})` : ""} با ترجمه فارسی`;
  const desc = trimTo(raw ? `${lead}؛ ${raw}` : `${lead} در ${BRAND}.`, 158);

  // چپترهای اطراف (حداکثر ۱۲ مورد) + دو چپتر ابتدایی/آخر برای لینک‌سازی داخلی
  const from = Math.max(0, Math.min(i - 5, list.length - 12)), around = list.slice(from, from + 12);
  const keep = new Map();
  [list[0], ...around, list[list.length - 1]].forEach((x) => keep.set(x.n, x));
  const chips = [...keep.values()].sort((a, b) => b.n - a.n)
    .map((x) => `<a href="${chUrl(it.slug, x.n)}"${x.n === n ? ' class="on" aria-current="page"' : ""}>چپتر ${x.n}</a>`).join("");

  // مانهواهای مرتبط: هم‌ژانر با بیشترین امتیاز
  const g0 = genres[0] && c.genres.get(genres[0].slug);
  const related = g0 ? g0.items.filter((x) => x.slug !== it.slug).slice(0, 6) : [];

  const body = `<nav class="crumb" aria-label="مسیر"><a href="/">خانه</a> › <a href="/comic/${encodeURIComponent(it.slug)}">${esc(nameFa)}</a> › چپتر ${n}</nav>
<h1>مانهوا <span>${esc(nameFa)}</span> چپتر ${n}</h1>
<div class="hero">${it.cover_image ? `<img src="${coverUrl(it)}" alt="مانهوا ${esc(nameFa)}" width="130" height="173" decoding="async" fetchpriority="high">` : ""}
<div class="meta"><p class="intro">${esc(lead)}.${ep.date ? ` تاریخ انتشار: ${esc(ep.date)}.` : ""} ${lastN === n ? "این آخرین چپتر منتشرشده است." : `آخرین چپتر منتشرشده: ${lastN}.`}</p>
<span class="badge ${free ? "free" : "vip"}">${free ? "رایگان" : "اشتراکی"}</span>${genres.slice(0, 3).map((g) => `<a class="badge" href="/genre/${encodeURIComponent(g.slug)}">${esc(g.name)}</a>`).join("")}
<div><a class="cta" href="/reader.html?slug=${encodeURIComponent(it.slug)}&amp;ch=${n}" rel="nofollow">خواندن چپتر ${n}</a></div></div></div>
<div class="pn">${next ? `<a href="${chUrl(it.slug, next.n)}" rel="next">‹ چپتر ${next.n}</a>` : "<span></span>"}<a href="/comic/${encodeURIComponent(it.slug)}">همه‌ی چپترهای ${esc(nameFa)}</a>${prev ? `<a href="${chUrl(it.slug, prev.n)}" rel="prev">چپتر ${prev.n} ›</a>` : "<span></span>"}</div>
${raw ? `<section class="sec"><h2>درباره‌ی مانهوا ${esc(nameFa)}</h2><p>${esc(trimTo(raw, 420))}</p></section>` : ""}
<section class="sec"><h2>چپترهای دیگر ${esc(nameFa)}</h2><div class="chl">${chips}</div></section>
${related.length ? `<section class="sec"><h2>مانهواهای مشابه</h2><div class="grid">${related.map(card).join("")}</div></section>` : ""}`;

  const issue = {
    "@type": "ComicIssue", "@id": canonical + "#issue", name: `${nameFa} چپتر ${n}`, issueNumber: n, url: canonical, inLanguage: "fa-IR",
    isPartOf: { "@type": "ComicSeries", "@id": seriesUrl + "#series", name: nameFa, url: seriesUrl },
    datePublished: iso || undefined, image: cover, genre: genres.map((g) => g.name),
    isAccessibleForFree: free, publisher: { "@id": SITE + "/#org" },
  };
  const ld = jsonLd(crumbs([["خانه", SITE + "/"], [nameFa, seriesUrl], [`چپتر ${n}`, canonical]])) +
    jsonLd({ "@context": "https://schema.org", ...issue });

  return layout({ ttl, desc, canonical, body, ld, image: cover, css: CH_CSS, ogType: "article" });
}

module.exports = function createSeoRouter(opts = {}) {
  const publicDir = opts.publicDir || path.join(__dirname, "..", "public");
  const homeFile = path.join(publicDir, "index.html");
  const readHtml = opts.readHtml || ((f) => fs.readFileSync(f, "utf8"));
  const extraSitemaps = (process.env.EXTRA_SITEMAPS || "").split(",").map((s) => s.trim()).filter(Boolean); // مثلاً https://manhwachi.ir/blog/sitemap.xml
  const r = express.Router();

  // ---------- robots.txt ----------
  r.get("/robots.txt", (req, res) => {
    const lines = [
      "User-agent: *",
      "Allow: /",
      "Allow: /manhwas/",
      "Disallow: /api/",
      "Disallow: /auth/",
      "Disallow: /rest/",
      "Disallow: /admin",
      "Disallow: /panel",
      "Disallow: /dbadmin",
      "Disallow: /purchase",
      "Disallow: /chapter-image/",
      "Disallow: /*?*utm_",
      "Disallow: /*?*fbclid=",
      "",
      `Sitemap: ${SITE}/sitemap.xml`,
      "",
    ];
    res.set("Cache-Control", "public, max-age=3600").type("text/plain; charset=utf-8").send(lines.join("\n"));
  });

  // ---------- صفحه اصلی ----------
  r.get("/", (req, res, next) => {
    try {
      res.set("Cache-Control", "no-cache").type("html").send(renderHome(readHtml, homeFile));
    } catch (e) { next(); } // اگر index.html پیدا نشد، به express.static برمی‌گردد
  });

  // ---------- ژانرها ----------
  r.get("/genres", (req, res) => {
    const gs = [...index().genres.values()].sort((a, b) => b.items.length - a.items.length);
    const body = `<nav class="crumb" aria-label="مسیر"><a href="/">خانه</a> › ژانرها</nav>
<h1>ژانرهای <span>مانهواچی</span></h1><p class="intro">مانهوا، مانگا و مانها را بر اساس ژانر مورد علاقه‌ات پیدا کن؛ همه با ترجمه فارسی.</p>
<div class="gg">${gs.map((g) => `<a href="/genre/${encodeURIComponent(g.slug)}"><b>${esc(g.name)}</b><small>${fa(g.items.length)} عنوان</small></a>`).join("")}</div>`;
    res.set("Cache-Control", "public, max-age=300").type("html").send(layout({
      ttl: `ژانرهای مانهوا و مانگا | ${BRAND}`,
      desc: `لیست ژانرهای مانهواچی: ${gs.slice(0, 6).map((g) => g.name).join("، ")} و بیشتر. خواندن آنلاین با ترجمه فارسی.`,
      canonical: `${SITE}/genres`, body,
      ld: jsonLd(crumbs([["خانه", SITE + "/"], ["ژانرها", SITE + "/genres"]])),
    }));
  });

  r.get("/genre/:slug", (req, res) => {
    const c = index();
    const s = slugOf(req.params.slug);
    const g = c.genres.get(s);
    if (!g) {
      return res.status(404).type("html").send(layout({
        ttl: `ژانر پیدا نشد | ${BRAND}`, desc: "این ژانر وجود ندارد.", canonical: `${SITE}/genres`, robots: "noindex, follow",
        body: `<h1>ژانر پیدا نشد</h1><p class="intro">به <a class="red" href="/genres">فهرست ژانرها</a> برگرد.</p>`,
      }));
    }
    if (req.params.slug !== g.slug) return res.redirect(301, `/genre/${encodeURIComponent(g.slug)}`);

    const url = `${SITE}/genre/${encodeURIComponent(g.slug)}`;
    const others = [...c.genres.values()].filter((x) => x.slug !== g.slug).sort((a, b) => b.items.length - a.items.length);
    const names = g.items.slice(0, 3).map(title).join("، ");
    const body = `<nav class="crumb" aria-label="مسیر"><a href="/">خانه</a> › <a href="/genres">ژانرها</a> › ${esc(g.name)}</nav>
<h1>خواندن مانهوا و مانگای <span>${esc(g.name)}</span> با ترجمه فارسی</h1>
<p class="intro">${fa(g.items.length)} مانهوا و مانگای ${esc(g.name)} در مانهواچی؛ از جمله ${esc(names)}. جدیدترین چپترها را آنلاین و با ترجمه فارسی بخوان.</p>
<div class="grid">${g.items.map(card).join("")}</div>
<h2 style="margin-top:32px;font-size:16px;color:#fff">ژانرهای دیگر</h2>
<div class="chips">${others.map((x) => `<a class="chip" href="/genre/${encodeURIComponent(x.slug)}">${esc(x.name)}</a>`).join("")}</div>`;
    const first = g.items[0];
    res.set("Cache-Control", "public, max-age=300").type("html").send(layout({
      ttl: trimTo(`مانهوا و مانگای ${g.name} | خواندن آنلاین با ترجمه فارسی | ${BRAND}`, 70),
      desc: trimTo(`خواندن آنلاین ${fa(g.items.length)} مانهوا و مانگای ${g.name} با ترجمه فارسی، از جمله ${names}. جدیدترین چپترها در مانهواچی.`, 158),
      canonical: url, body, image: first && first.cover_image ? SITE + coverPath(first) : undefined,
      ld: jsonLd(crumbs([["خانه", SITE + "/"], ["ژانرها", SITE + "/genres"], [g.name, url]])) +
        jsonLd({ "@context": "https://schema.org", "@type": "CollectionPage", name: `مانهوای ${g.name}`, url, inLanguage: "fa-IR",
          isPartOf: { "@type": "WebSite", name: BRAND, url: SITE + "/" },
          mainEntity: { "@type": "ItemList", itemListElement: g.items.slice(0, 50).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/comic/${encodeURIComponent(it.slug)}`, name: title(it) })) } }),
    }));
  });


  // ---------- صفحه‌ی چپتر ----------
  r.get("/comic/:slug/:chap", (req, res, next) => {
    const m = /^chapter-(\d{1,5})$/.exec(req.params.chap);
    if (!m) return next();
    const c = index();
    const raw = String(req.params.slug || "");
    const it = c.list.find((x) => x.slug === raw) || c.list.find((x) => x.slug.toLowerCase() === raw.toLowerCase());
    const notFound = (why) => res.status(404).set("X-Robots-Tag", "noindex").type("html").send(layout({
      ttl: `چپتر پیدا نشد | ${BRAND}`, desc: why, canonical: `${SITE}/`, robots: "noindex, follow",
      body: `<h1>چپتر پیدا نشد</h1><p class="intro">${esc(why)} <a class="red" href="${it ? "/comic/" + encodeURIComponent(it.slug) : "/"}">${it ? "بازگشت به صفحه‌ی مانهوا" : "بازگشت به خانه"}</a></p>`,
    }));
    if (!it) return notFound("این مانهوا وجود ندارد.");
    const n = parseInt(m[1], 10);
    // آدرس استاندارد: slug دقیق + عدد بدون صفر ابتدایی
    if (it.slug !== raw || String(n) !== m[1]) return res.redirect(301, chUrl(it.slug, n));
    const html = renderChapter(c, it, n);
    if (!html) return notFound("این چپتر هنوز منتشر نشده یا وجود ندارد.");
    res.set("Cache-Control", "public, max-age=300").type("html").send(html);
  });

  // ---------- sitemap ها ----------
  const xml = (res, body, ttl = 3600) => res.set("Cache-Control", `public, max-age=${ttl}`).type("application/xml; charset=utf-8").send(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`);

  r.get("/sitemap.xml", (req, res) => {
    const c = index();
    const newest = c.list.map((x) => x.lastmod).filter(Boolean).sort().pop();
    const chunks = Math.max(1, Math.ceil(chapterUrls(c).length / CH_PER_MAP));
    const maps = [`${SITE}/sitemap-manhwa.xml`, `${SITE}/sitemap-pages.xml`, ...Array.from({ length: chunks }, (_, k) => `${SITE}/sitemap-chapters-${k + 1}.xml`), ...extraSitemaps];
    xml(res, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map((u, i) => `  <sitemap><loc>${esc(u)}</loc>${i === 0 && newest ? `<lastmod>${newest}</lastmod>` : ""}</sitemap>`).join("\n")}\n</sitemapindex>`);
  });

  r.get("/sitemap-manhwa.xml", (req, res) => {
    const c = index();
    const items = c.list.map((it) => {
      const loc = `${SITE}/comic/${encodeURIComponent(it.slug)}`;
      const img = it.cover_image ? `<image:image><image:loc>${esc(SITE + `/manhwas/${encodeURIComponent(it.slug)}/${it.cover_image}`)}</image:loc><image:title>${esc(title(it))}</image:title></image:image>` : "";
      return `  <url><loc>${esc(loc)}</loc>${it.lastmod ? `<lastmod>${it.lastmod}</lastmod>` : ""}${img}</url>`;
    });
    xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${items.join("\n")}\n</urlset>`);
  });


  // sitemap چپترها (هر فایل حداکثر ۴۰٬۰۰۰ آدرس؛ سقف گوگل ۵۰٬۰۰۰ است)
  r.get("/sitemap-chapters-:k.xml", (req, res) => {
    const all = chapterUrls(index());
    const k = parseInt(req.params.k, 10);
    const part = all.slice((k - 1) * CH_PER_MAP, k * CH_PER_MAP);
    if (!(k >= 1) || (!part.length && k > 1)) return res.status(404).type("text/plain").send("not found");
    xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${part.map(([u, m]) => `  <url><loc>${esc(u)}</loc>${m ? `<lastmod>${m}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>`);
  });

  r.get("/sitemap-pages.xml", (req, res) => {
    const c = index();
    const newest = c.list.map((x) => x.lastmod).filter(Boolean).sort().pop();
    const urls = [
      [`${SITE}/`, newest], [`${SITE}/library-page.html`, newest], [`${SITE}/genres`, newest],
      ...[...c.genres.values()].map((g) => [`${SITE}/genre/${encodeURIComponent(g.slug)}`, g.items.map((x) => x.lastmod).filter(Boolean).sort().pop()]),
      [`${SITE}/vip.html`], [`${SITE}/app.html`],
    ];
    xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, m]) => `  <url><loc>${esc(u)}</loc>${m ? `<lastmod>${m}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>`);
  });

  return r;
};

// برای استفاده در server.js / قالب مانهوا
module.exports.genreInfo = (g) => ({ name: faOf(keyOf(g)), slug: slugOf(keyOf(g)) });
module.exports.isoDate = isoDate;
module.exports.trimTo = trimTo;

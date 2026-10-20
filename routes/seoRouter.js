"use strict";
/**
 * سئو: صفحه اصلی با لیست‌های سمت‌سرور، صفحات ژانر (/genres و /genre/:slug) و sitemap مانهواها.
 * همه‌چیز از کش lib/dataStore خوانده می‌شود؛ پس بعد از آپدیت data.json هیچ مرحله‌ی دستی لازم نیست.
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const { getData } = require("../lib/dataStore");

const SITE = "https://manhwachi.ir";
const HOME_FILE = path.join(__dirname, "..", "public", "index.html");
const TTL = 60 * 1000;

const FA = {
  Action: "اکشن", Romance: "عاشقانه", Fantasy: "فانتزی", Adventure: "ماجراجویی", Comedy: "کمدی",
  Drama: "درام", Mystery: "معمایی", Horror: "ترسناک", "Sci-Fi": "علمی-تخیلی", Psychological: "روان‌شناختی",
  Sports: "ورزشی", Historical: "تاریخی", "School Life": "زندگی مدرسه‌ای", "Martial Arts": "هنرهای رزمی",
  "Dark Fantasy": "دارک فانتزی", Thriller: "هیجان‌انگیز",
};
const REV = Object.fromEntries(Object.entries(FA).map(([k, v]) => [v, k]));
const keyOf = (g) => REV[g] || g;
const faOf = (k) => FA[k] || k;
const slugOf = (k) => String(k).trim().toLowerCase().replace(/\s+/g, "-");

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fa = (n) => Number(n).toLocaleString("fa-IR");
const score = (it) => parseFloat(it.score || it.rating || 0) || 0;
const title = (it) => it.title_fa || it.title_en || it.slug;
const dateKey = (d) => { if (!d) return 0; const p = String(d).split("/").map(Number); return p.length !== 3 || p.some(isNaN) ? 0 : p[0] * 10000 + p[1] * 100 + p[2]; };
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;

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
    return { slug, ...it, latestNum: last.num, latestDate: last.date || "" };
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

  cache = { data, t: now, list, genres, home: null, homeM: 0 };
  return cache;
}

// ---------- صفحه اصلی ----------
function fillUl(html, id, inner) {
  const re = new RegExp(`(<ul[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</ul>)`);
  return re.test(html) ? html.replace(re, `$1\n${inner}\n$2`) : html;
}
function renderHome() {
  const c = index();
  const m = fs.statSync(HOME_FILE).mtimeMs;
  if (c.home && c.homeM === m) return c.home;

  let html = fs.readFileSync(HOME_FILE, "utf8");
  const latest = [...c.list].sort((a, b) => dateKey(b.latestDate) - dateKey(a.latestDate)).slice(0, 5);
  const top = [...c.list].sort((a, b) => score(b) - score(a)).slice(0, 5);

  html = fillUl(html, "todaysList", latest.map((it) => {
    const t = esc(title(it)), g = esc(faOf(keyOf((it.genres || [])[0] || "مانهوا")));
    return `<li><a class="comic-card" href="${SITE}/comic/${encodeURIComponent(it.slug)}"><div class="comic-pic"><img src="/manhwas/${encodeURIComponent(it.slug)}/${esc(it.cover_image)}" alt="${t}" loading="lazy"><div class="badge-chapter-box"><span class="badge-chapter-num">چپتر ${esc(it.latestNum)}</span></div></div><div class="comic-info"><h3 class="comic-title">${t}</h3><div class="comic-meta"><span class="comic-genre">${g}</span></div></div></a></li>`;
  }).join("\n"));

  html = fillUl(html, "topRatedList", top.map((it, i) => {
    const t = esc(title(it)), g = esc((it.genres || []).map((x) => faOf(keyOf(x))).join(" • ") || "نامشخص");
    return `<li><a href="${SITE}/comic/${encodeURIComponent(it.slug)}"><div class="row"><div class="col num"><span${i === 0 ? ' class="rank1"' : ""}>${i + 1}</span></div><div class="col pic"><img src="manhwas/${encodeURIComponent(it.slug)}/${esc(it.cover_image)}" width="100%" alt="${t}"></div><div class="col info"><p class="subj"><strong class="ellipsis">${t}</strong></p><p class="genre">${g}</p></div></div></a></li>`;
  }).join("\n"));

  const chips = [...c.genres.values()].sort((a, b) => b.items.length - a.items.length)
    .map((g) => `<a class="text-red-500 hover:underline ml-3" href="/genre/${encodeURIComponent(g.slug)}">مانهوای ${esc(g.name)}</a>`).join(" ");
  html = html.replace("<!--GENRE_LINKS-->", chips);

  c.home = html; c.homeM = m;
  return html;
}

// ---------- قالب صفحات ژانر ----------
function layout({ ttl, desc, canonical, robots, body, ld }) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ttl)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${robots || "index, follow"}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="مانهواچی"><meta property="og:title" content="${esc(ttl)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="fa_IR">
<link rel="icon" href="/ManhwaChi/favicon.ico"><link rel="icon" type="image/png" sizes="192x192" href="/ManhwaChi/favicon-192x192.png">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#000;color:#e2e2e2;font-family:Vazirmatn,system-ui,sans-serif;line-height:1.9}
a{color:inherit;text-decoration:none}header{position:sticky;top:0;z-index:5;background:rgba(18,18,18,.92);border-bottom:1px solid rgba(255,255,255,.1)}
.bar{max-width:1100px;margin:auto;padding:0 16px;height:60px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.bar img{height:30px}nav{display:flex;gap:18px;font-size:14px;font-weight:600;color:#9ca3af}nav a:hover{color:#fff}
main{max-width:1100px;margin:auto;padding:24px 16px 64px}h1{font-size:24px;color:#fff;margin-bottom:8px}h1 span,.red{color:#DC2626}
.intro{color:#9ca3af;font-size:14px;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.card img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:#1b1b1b;border:1px solid rgba(255,255,255,.06)}
.card h2{font-size:13px;font-weight:600;margin-top:6px;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.6}
.card small{color:#fbbf24;font-size:12px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:28px 0 8px}
.chip{padding:6px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:13px;color:#cbb8b8}.chip:hover,.chip.on{border-color:#DC2626;color:#fff;background:rgba(220,38,38,.15)}
.gg{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.gg a{padding:18px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);text-align:center}
.gg a:hover{border-color:rgba(220,38,38,.5)}.gg b{display:block;color:#fff}.gg small{color:#8c8c8c}
footer{border-top:1px solid rgba(255,255,255,.1);padding:24px 16px;text-align:center;color:#8c8c8c;font-size:12px}
</style>${ld || ""}</head><body>
<header><div class="bar"><a href="/"><img src="/ManhwaChi/LOGO-main-white.webp" alt="مانهواچی"></a>
<nav><a href="/">خانه</a><a href="/library-page.html">آرشیو مانهوا</a><a href="/genres">ژانرها</a><a href="/search.html">جستجو</a></nav></div></header>
<main>${body}</main><footer>© مانهواچی | Manhwachi — خواندن آنلاین مانهوا و مانگا با ترجمه فارسی</footer></body></html>`;
}
const card = (it) => `<a class="card" href="/comic/${encodeURIComponent(it.slug)}"><img src="/manhwas/${encodeURIComponent(it.slug)}/${esc(it.cover_image)}" alt="${esc(title(it))}" loading="lazy" width="300" height="400"><h2>${esc(title(it))}</h2>${score(it) ? `<small>★ ${esc(it.score || it.rating)}</small>` : ""}</a>`;
const crumbs = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: u })) });

module.exports = function createSeoRouter() {
  const r = express.Router();

  // صفحه اصلی: قبل از express.static ثبت می‌شود تا لیست‌ها داخل HTML باشند
  r.get("/", (req, res, next) => {
    try {
      res.set("Cache-Control", "public, max-age=60, must-revalidate").type("html").send(renderHome());
    } catch (e) { next(); } // اگر index.html پیدا نشد، به express.static برمی‌گردد
  });

  r.get("/genres", (req, res) => {
    const gs = [...index().genres.values()].sort((a, b) => b.items.length - a.items.length);
    const body = `<h1>ژانرهای <span>مانهواچی</span></h1><p class="intro">مانهوا، مانگا و مانها را بر اساس ژانر مورد علاقه‌ات پیدا کن؛ همه با ترجمه فارسی.</p>
<div class="gg">${gs.map((g) => `<a href="/genre/${encodeURIComponent(g.slug)}"><b>${esc(g.name)}</b><small>${fa(g.items.length)} عنوان</small></a>`).join("")}</div>`;
    res.set("Cache-Control", "public, max-age=300").type("html").send(layout({
      ttl: "ژانرهای مانهوا و مانگا | مانهواچی",
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
        ttl: "ژانر پیدا نشد | مانهواچی", desc: "این ژانر وجود ندارد.", canonical: `${SITE}/genres`, robots: "noindex, follow",
        body: `<h1>ژانر پیدا نشد</h1><p class="intro">به <a class="red" href="/genres">فهرست ژانرها</a> برگرد.</p>`,
      }));
    }
    if (req.params.slug !== g.slug) return res.redirect(301, `/genre/${encodeURIComponent(g.slug)}`);

    const url = `${SITE}/genre/${encodeURIComponent(g.slug)}`;
    const others = [...c.genres.values()].filter((x) => x.slug !== g.slug).sort((a, b) => b.items.length - a.items.length);
    const names = g.items.slice(0, 3).map(title).join("، ");
    const body = `<h1>خواندن مانهوا و مانگای <span>${esc(g.name)}</span> با ترجمه فارسی</h1>
<p class="intro">${fa(g.items.length)} مانهوا و مانگای ${esc(g.name)} در مانهواچی؛ از جمله ${esc(names)}. جدیدترین چپترها را آنلاین و با ترجمه فارسی بخوان.</p>
<div class="grid">${g.items.map(card).join("")}</div>
<h2 style="margin-top:32px;font-size:16px;color:#fff">ژانرهای دیگر</h2>
<div class="chips">${others.map((x) => `<a class="chip" href="/genre/${encodeURIComponent(x.slug)}">${esc(x.name)}</a>`).join("")}</div>`;
    res.set("Cache-Control", "public, max-age=300").type("html").send(layout({
      ttl: `مانهوا و مانگای ${g.name} | خواندن آنلاین با ترجمه فارسی | مانهواچی`,
      desc: `خواندن آنلاین ${fa(g.items.length)} مانهوا و مانگای ${g.name} با ترجمه فارسی، از جمله ${names}. جدیدترین چپترها در مانهواچی.`,
      canonical: url, body,
      ld: jsonLd(crumbs([["خانه", SITE + "/"], ["ژانرها", SITE + "/genres"], [g.name, url]])) +
        jsonLd({ "@context": "https://schema.org", "@type": "CollectionPage", name: `مانهوای ${g.name}`, url, inLanguage: "fa-IR",
          mainEntity: { "@type": "ItemList", itemListElement: g.items.slice(0, 50).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/comic/${encodeURIComponent(it.slug)}`, name: title(it) })) } }),
    }));
  });

  // sitemap مانهواها و ژانرها (جدا از sitemap وبلاگ تا تداخلی پیش نیاید)
  r.get("/sitemap-manhwa.xml", (req, res) => {
    const c = index();
    const urls = [`${SITE}/`, `${SITE}/library-page.html`, `${SITE}/genres`,
      ...[...c.genres.keys()].map((s) => `${SITE}/genre/${encodeURIComponent(s)}`),
      ...c.list.map((it) => `${SITE}/comic/${encodeURIComponent(it.slug)}`)];
    res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`);
  });

  return r;
};

// برای استفاده در server.js / قالب مانهوا: نام فارسی و slug یک ژانر
module.exports.genreInfo = (g) => ({ name: faOf(keyOf(g)), slug: slugOf(keyOf(g)) });

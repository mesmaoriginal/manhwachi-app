"use strict";
/**
 * سیاست ایندکس صفحات استاتیک و هدرهای سئو.
 *  - صفحات خصوصی/ابزاری: noindex (هم هدر X-Robots-Tag، هم متا)
 *  - صفحات عمومی بدون canonical: canonical خودکار (بدون query string) تزریق می‌شود
 *  - ریدایرکت 301 از www به دامنه‌ی اصلی (جلوگیری از محتوای تکراری)
 *
 * نکته: برای صفحاتی که noindex هستند عمداً در robots.txt Disallow نکرده‌ایم تا گوگل بتواند
 * دستور noindex را ببیند.
 */
const SITE = (process.env.SITE_URL || "https://manhwachi.ir").replace(/\/+$/, "");
const HOST = new URL(SITE).host;

// نام فایل (بدون .html) صفحاتی که نباید ایندکس شوند
const NOINDEX_PAGES = new Set([
  "profile", "vip-verify", "team", "team-admin", "vip-admin", "admin-comments", "support",
  "bookmarks", "manhwa-request", "maintenance", "offline", "reader", "search", "reels",
  "ganre", "genre-page", // جایگزین: /genre/:slug (سمت سرور)
]);
// صفحات عمومی که باید canonical داشته باشند (بدون query)
const CANONICAL_PAGES = {
  "library-page": "/library-page.html",
  vip: "/vip.html",
  app: "/app.html",
};
// مسیرهایی که هرگز نباید در نتایج گوگل بیایند
const NOINDEX_PREFIX = /^\/(api|auth|rest|admin|panel|dbadmin|purchase|chapter-image|data)(\/|$)/;

function pageName(p) {
  const m = /^\/([A-Za-z0-9_-]+)\.html$/.exec(p);
  return m ? m[1] : null;
}

/** middleware: ریدایرکت www و هدر X-Robots-Tag */
function middleware(req, res, next) {
  const host = String(req.headers.host || "").toLowerCase();
  if (host === "www." + HOST && (req.method === "GET" || req.method === "HEAD")) {
    return res.redirect(301, SITE + req.originalUrl);
  }
  const name = pageName(req.path);
  if (NOINDEX_PREFIX.test(req.path)) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  else if (name && NOINDEX_PAGES.has(name)) res.setHeader("X-Robots-Tag", "noindex, follow");
  next();
}

/** تزریق متا به HTML صفحات استاتیک (فقط اگر خودِ صفحه نداشته باشد) */
function enhance(reqPath, html) {
  const name = pageName(reqPath === "/" ? "/index.html" : reqPath);
  if (!name) return html;
  let add = "";
  const has = (re) => re.test(html);

  if (NOINDEX_PAGES.has(name)) {
    if (!has(/<meta[^>]+name=["']robots["']/i)) add += `<meta name="robots" content="noindex, follow">\n`;
  } else if (CANONICAL_PAGES[name]) {
    if (!has(/<meta[^>]+name=["']robots["']/i)) add += `<meta name="robots" content="index, follow, max-image-preview:large">\n`;
    if (!has(/<link[^>]+rel=["']canonical["']/i)) add += `<link rel="canonical" href="${SITE}${CANONICAL_PAGES[name]}">\n`;
    if (!has(/<meta[^>]+property=["']og:url["']/i)) add += `<meta property="og:url" content="${SITE}${CANONICAL_PAGES[name]}">\n`;
    if (!has(/<meta[^>]+property=["']og:locale["']/i)) add += `<meta property="og:locale" content="fa_IR">\n`;
  }
  if (!add) return html;
  return html.replace(/<head[^>]*>/i, (m) => `${m}\n${add}`);
}

module.exports = { middleware, enhance, SITE };

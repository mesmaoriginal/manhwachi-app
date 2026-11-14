"use strict";

const SITE = (process.env.SITE_URL || "https://manhwachi.ir").replace(/\/+$/, "");

const HOST = new URL(SITE).host;

const NOINDEX_PAGES = new Set([ "profile", "vip-verify", "team", "team-admin", "vip-admin", "admin-comments", "support", "bookmarks", "manhwa-request", "maintenance", "offline", "reader", "search", "reels", "ganre", "genre-page" ]);

const CANONICAL_PAGES = {
  "library-page": "/library-page.html",
  vip: "/vip.html",
  app: "/app.html"
};

const NOINDEX_PREFIX = /^\/(api|auth|rest|admin|panel|dbadmin|purchase|chapter-image|data)(\/|$)/;

function pageName(p) {
  const m = /^\/([A-Za-z0-9_-]+)\.html$/.exec(p);
  return m ? m[1] : null;
}

function middleware(req, res, next) {
  const host = String(req.headers.host || "").toLowerCase();
  if (host === "www." + HOST && (req.method === "GET" || req.method === "HEAD")) {
    return res.redirect(301, SITE + req.originalUrl);
  }
  const name = pageName(req.path);
  if (NOINDEX_PREFIX.test(req.path)) res.setHeader("X-Robots-Tag", "noindex, nofollow"); else if (name && NOINDEX_PAGES.has(name)) res.setHeader("X-Robots-Tag", "noindex, follow");
  next();
}

function enhance(reqPath, html) {
  const name = pageName(reqPath === "/" ? "/index.html" : reqPath);
  if (!name) return html;
  let add = "";
  const has = re => re.test(html);
  if (NOINDEX_PAGES.has(name)) {
    if (!has(/<meta[^>]+name=["']robots["']/i)) add += `<meta name="robots" content="noindex, follow">\n`;
  } else if (CANONICAL_PAGES[name]) {
    if (!has(/<meta[^>]+name=["']robots["']/i)) add += `<meta name="robots" content="index, follow, max-image-preview:large">\n`;
    if (!has(/<link[^>]+rel=["']canonical["']/i)) add += `<link rel="canonical" href="${SITE}${CANONICAL_PAGES[name]}">\n`;
    if (!has(/<meta[^>]+property=["']og:url["']/i)) add += `<meta property="og:url" content="${SITE}${CANONICAL_PAGES[name]}">\n`;
    if (!has(/<meta[^>]+property=["']og:locale["']/i)) add += `<meta property="og:locale" content="fa_IR">\n`;
  }
  if (!add) return html;
  return html.replace(/<head[^>]*>/i, m => `${m}\n${add}`);
}

module.exports = {
  middleware: middleware,
  enhance: enhance,
  SITE: SITE
};
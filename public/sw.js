/* public/sw.js — سرویس‌ورکر مانهواچی (فقط «پوسته‌ی» خواندنگر برای حالت آفلاین)
 * ⚠️ هرگز صفحه‌های چپتر (/chapter-image)، /api، /auth و /rest را کش نمی‌کند.
 *    صفحه‌های چپتر فقط به‌صورت رمزشده در IndexedDB (offline.js) نگه داشته می‌شوند.
 */
'use strict';
var VER = 'v3';
var SHELL = 'mc-shell-' + VER;
var RUNTIME = 'mc-rt-' + VER;
var COVERS = 'mc-cov-' + VER;
var KEEP = [SHELL, RUNTIME, COVERS];

var PRECACHE = ['/offline.html', '/reader.html', '/offline.js', '/offline-ui.js', '/js/supabase.js', '/js/vendor/supabase.min.js', '/data/data.json'];
var NEVER = /^\/(api|auth|rest|chapter-image|dbadmin|admin|panel|purchase|health)(\/|$)/;
var CDN_OK = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'code.jquery.com'];

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    var cache = await caches.open(SHELL);
    // فایل‌های ثابت
    await Promise.all(PRECACHE.map(function (u) { return cache.add(u).catch(function () {}); }));
    // دارایی‌های داخل خود reader.html و offline.html (css/js/فونت با ?v=...) هم کش شوند
    for (var page of ['/reader.html', '/offline.html']) {
      try {
        var res = await cache.match(page);
        if (!res) continue;
        var html = await res.clone().text();
        var urls = new Set();
        var re = /<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["']/gi, m;
        while ((m = re.exec(html))) urls.add(m[1]);
        await Promise.all([...urls].map(function (u) {
          try {
            var abs = new URL(u, self.location.origin);
            if (abs.origin === self.location.origin) return cache.add(abs.href).catch(function () {});
            if (CDN_OK.indexOf(abs.hostname) !== -1) return cache.add(new Request(abs.href, { mode: 'no-cors' })).catch(function () {});
          } catch (_) { /* ignore */ }
        }));
      } catch (_) { /* ignore */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return KEEP.indexOf(k) === -1; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

function withTimeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function (err) { clearTimeout(t); reject(err); });
  });
}

async function trim(cacheName, max) {
  var c = await caches.open(cacheName);
  var keys = await c.keys();
  for (var i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function navigation(req) {
  var url = new URL(req.url);
  var isShell = url.pathname === '/reader.html' || url.pathname === '/offline.html';
  try {
    var res = await (isShell ? withTimeout(fetch(req), 8000) : fetch(req));
    if (res && res.ok && isShell) {
      var c = await caches.open(SHELL);
      c.put(url.pathname, res.clone()); // یک نسخه (بدون query) برای حالت آفلاین
    }
    return res;
  } catch (_) {
    var cache = await caches.open(SHELL);
    var hit = (isShell && (await cache.match(url.pathname))) || (await cache.match(req, { ignoreSearch: true }));
    return hit || (await cache.match('/offline.html')) || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  var cache = await caches.open(cacheName);
  try {
    var res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    var hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    throw _;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  var cache = await caches.open(cacheName);
  var hit = await cache.match(req);
  var net = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(function () { return null; });
  if (hit) return hit;
  var res = await net;
  return res || Response.error();
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  var same = url.origin === self.location.origin;

  if (same && NEVER.test(url.pathname)) return; // هیچ دخالتی در API و تصویر چپتر

  if (req.mode === 'navigate') {
    if (!same) return;
    e.respondWith(navigation(req));
    return;
  }

  if (same) {
    if (url.pathname === '/data/data.json') { e.respondWith(networkFirst(req, RUNTIME)); return; }
    if (url.pathname.indexOf('/manhwas/') === 0) {
      e.respondWith((async function () {
        var cache = await caches.open(COVERS);
        var hit = await cache.match(req);
        if (hit) return hit;
        var res = await fetch(req);
        if (res && res.ok) { cache.put(req, res.clone()); trim(COVERS, 300); }
        return res;
      })());
      return;
    }
    var d = req.destination;
    if (d === 'script' || d === 'style' || d === 'font' || d === 'image' || d === 'manifest') {
      e.respondWith(staleWhileRevalidate(req, RUNTIME));
    }
    return;
  }

  // CDNهای شناخته‌شده (tailwind، فونت و ...)
  if (CDN_OK.indexOf(url.hostname) !== -1) {
    var dd = req.destination;
    if (dd === 'script' || dd === 'style' || dd === 'font') e.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
});

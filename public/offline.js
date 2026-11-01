/* public/offline.js — خواندن آفلاین امن (مانهواچی)
 *
 * - صفحه‌ها فقط به‌صورت «رمزشده» (AES-256-GCM) در IndexedDB ذخیره می‌شوند؛ هیچ فایل تصویری/blob-URL ساخته نمی‌شود.
 * - کلید رمز یک CryptoKey غیرقابل‌استخراج است (JavaScript نمی‌تواند بایت‌های خامش را بخواند).
 * - رمزگشایی فقط در حافظه انجام می‌شود و نتیجه مستقیم روی <canvas> کشیده می‌شود.
 * - هر چپتر مجوز با تاریخ انقضا دارد؛ بدون تمدید (آنلاین + اشتراک معتبر) بی‌مصرف می‌شود.
 * - با خروج از حساب (SIGNED_OUT) همه‌چیز پاک می‌شود.
 */
(function () {
  'use strict';
  if (window.MCOffline) return;

  var DB_NAME = 'mc-offline-v1';
  var API = '/api/offline';
  var RENEW_WHEN_LEFT_MS = 3 * 86400e3; // وقتی کمتر از ۳ روز به انقضا مانده، در اولین فرصتِ آنلاین تمدید شود
  var MAX_CANVAS_PIXELS = 16 * 1024 * 1024; // سقف امن برای مرورگرهای موبایل

  function OfflineError(code, message, status) {
    var e = new Error(message || code);
    e.code = code;
    e.status = status || 0;
    return e;
  }

  function supported() {
    return !!(window.indexedDB && window.crypto && crypto.subtle && window.createImageBitmap && window.fetch);
  }

  // ───────────── IndexedDB ─────────────
  var dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' });
      };
      rq.onsuccess = function () {
        var db = rq.result;
        db.onversionchange = function () { db.close(); dbPromise = null; }; // تا deleteDatabase تب‌های دیگر بلاک نشود
        resolve(db);
      };
      rq.onerror = function () { dbPromise = null; reject(rq.error); };
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var out;
        try { out = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && 'result' in out ? out.result : out); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('idb')); };
      });
    });
  }
  function idbGet(store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); }
  function idbPut(store, val) { return tx(store, 'readwrite', function (s) { s.put(val); }); }
  function idbDel(store, key) { return tx(store, 'readwrite', function (s) { s.delete(key); }); }
  function idbAll(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); }
  function delPagesOf(chapterId) {
    return tx('pages', 'readwrite', function (s) { s.delete(IDBKeyRange.bound(chapterId + '|', chapterId + '|\uffff')); });
  }

  function chId(uid, slug, ch) { return uid + '|' + slug + '|' + ch; }
  function pgId(id, i) { return id + '|' + String(i).padStart(4, '0'); }

  // ───────────── شناسه‌ی دستگاه ─────────────
  function deviceId() {
    var k = 'mc_off_did';
    try {
      var v = localStorage.getItem(k);
      if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
      var a = new Uint8Array(24); crypto.getRandomValues(a);
      v = Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem(k, v);
      return v;
    } catch (e) { return 'tmp' + Math.random().toString(16).slice(2).padEnd(24, '0'); }
  }

  // ───────────── درخواست به سرور ─────────────
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function apiFetch(path, body, accessToken, signal) {
    return fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify(body),
    });
  }
  async function apiJson(path, body, accessToken, signal) {
    var res = await apiFetch(path, body, accessToken, signal);
    var j = null;
    try { j = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw OfflineError((j && j.code) || 'HTTP_' + res.status, (j && j.error) || 'خطا در ارتباط با سرور', res.status);
    return j;
  }

  // ───────────── دانلود ─────────────
  /**
   * opts: { slug, ch, title, uid, accessToken, onProgress(done,total), signal }
   */
  async function download(opts) {
    if (!supported()) throw OfflineError('UNSUPPORTED', 'مرورگر شما از ذخیره‌ی آفلاین امن پشتیبانی نمی‌کند.');
    var uid = opts.uid, slug = opts.slug, ch = Number(opts.ch);
    var id = chId(uid, slug, ch);
    var existing = await idbGet('chapters', id);
    if (existing && existing.exp > Date.now()) return { already: true };

    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

    var lic = await apiJson('/license', { slug: slug, chapterNum: ch, did: deviceId() }, opts.accessToken, opts.signal);
    var keyBytes = Uint8Array.from(atob(lic.key), function (c) { return c.charCodeAt(0); });
    // کلید غیرقابل‌استخراج: از اینجا به بعد خود JS هم نمی‌تواند بایت‌های کلید را بخواند
    var cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    keyBytes.fill(0);

    await delPagesOf(id);
    var n = lic.n, done = 0, bytes = 0, dims = new Array(n), next = 0, failed = null;
    if (opts.onProgress) opts.onProgress(0, n);

    async function fetchPage(i) {
      for (var attempt = 0; attempt < 4; attempt++) {
        if (opts.signal && opts.signal.aborted) throw OfflineError('ABORTED', 'لغو شد');
        try {
          var res = await apiFetch('/page', { token: lic.token, i: i }, opts.accessToken, opts.signal);
          if (res.ok) {
            var dim = (res.headers.get('X-Mc-Dim') || '').split('x');
            return { buf: await res.arrayBuffer(), w: +dim[0] || 0, h: +dim[1] || 0 };
          }
          var j = null; try { j = await res.json(); } catch (e) { /* ignore */ }
          var code = (j && j.code) || 'HTTP_' + res.status;
          if ((res.status === 429 && code === 'BUSY') || res.status >= 500) {
            await sleep(Math.min(8000, 700 * Math.pow(2, attempt)) + Math.random() * 300);
            continue;
          }
          throw OfflineError(code, (j && j.error) || 'خطا', res.status);
        } catch (e) {
          if (e && e.code) throw e;
          if (opts.signal && opts.signal.aborted) throw OfflineError('ABORTED', 'لغو شد');
          await sleep(900 * (attempt + 1)); // خطای شبکه
        }
      }
      throw OfflineError('NETWORK', 'دانلود صفحه‌ها کامل نشد؛ اینترنت را بررسی کنید.');
    }

    async function worker() {
      while (!failed) {
        var i = next++;
        if (i >= n) return;
        try {
          var r = await fetchPage(i);
          await idbPut('pages', { id: pgId(id, i), data: r.buf });
          dims[i] = [r.w, r.h];
          bytes += r.buf.byteLength;
          done++;
          if (opts.onProgress) opts.onProgress(done, n);
        } catch (e) { failed = e; }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (failed) { await delPagesOf(id).catch(function () {}); throw failed; }

    // رکورد چپتر آخر نوشته می‌شود؛ تا قبل از آن چپتر «ناقص» است و خوانده نمی‌شود
    await idbPut('chapters', {
      id: id, uid: uid, slug: slug, ch: ch, title: opts.title || slug,
      n: n, dims: dims, bytes: bytes, lid: lic.lid, token: lic.token, exp: lic.exp,
      key: cryptoKey, savedAt: Date.now(), lastSeen: Date.now(),
    });
    try { localStorage.setItem('mc_off_uid', uid); } catch (e) { /* ignore */ }
    return { already: false, bytes: bytes, n: n };
  }

  // ───────────── فهرست / حذف ─────────────
  async function list(uid) {
    var all = await idbAll('chapters');
    return all.filter(function (r) { return r.uid === uid; }).map(function (r) {
      return { slug: r.slug, ch: r.ch, title: r.title, n: r.n, bytes: r.bytes, exp: r.exp, savedAt: r.savedAt, expired: r.exp <= Date.now() };
    }).sort(function (a, b) { return a.title === b.title ? a.ch - b.ch : (a.title < b.title ? -1 : 1); });
  }
  async function has(uid, slug, ch) {
    var r = await idbGet('chapters', chId(uid, slug, Number(ch)));
    return !!r && r.exp > Date.now();
  }
  async function remove(uid, slug, ch) {
    var id = chId(uid, slug, Number(ch));
    await idbDel('chapters', id);
    await delPagesOf(id);
  }
  async function wipeAll() {
    try { var db = await openDB(); db.close(); } catch (e) { /* ignore */ }
    dbPromise = null;
    await new Promise(function (resolve) {
      try {
        var rq = indexedDB.deleteDatabase(DB_NAME);
        rq.onsuccess = rq.onerror = rq.onblocked = function () { resolve(); };
      } catch (e) { resolve(); }
    });
    try { localStorage.removeItem('mc_off_uid'); } catch (e) { /* ignore */ }
  }

  // ───────────── تمدید ─────────────
  async function renewAll(uid, accessToken, force) {
    if (!navigator.onLine || !accessToken) return;
    var all = (await idbAll('chapters')).filter(function (r) { return r.uid === uid; });
    for (var k = 0; k < all.length; k++) {
      var r = all[k];
      if (!force && r.exp - Date.now() > RENEW_WHEN_LEFT_MS) continue;
      try {
        var j = await apiJson('/renew', { token: r.token }, accessToken);
        r.token = j.token; r.exp = j.exp;
        await idbPut('chapters', r);
      } catch (e) {
        if (e.status === 403) await remove(uid, r.slug, r.ch); // اشتراک تمام شده/مجوز باطل → پاک
        // خطای شبکه: بی‌صدا رد می‌شویم
      }
    }
  }

  // ───────────── باز کردن چپتر برای خواندن ─────────────
  async function open(uid, slug, ch, accessToken) {
    var id = chId(uid, slug, Number(ch));
    var r = await idbGet('chapters', id);
    if (!r) return null;
    var now = Date.now();
    // محافظ ساده در برابر عقب بردن ساعت دستگاه
    var clockBack = now < r.lastSeen - 5 * 60e3;
    if (r.exp <= now || clockBack) {
      if (accessToken && navigator.onLine && !clockBack) {
        await renewAll(uid, accessToken, true);
        r = await idbGet('chapters', id);
        if (r && r.exp > Date.now()) return makeHandle(r);
      }
      throw OfflineError('EXPIRED', clockBack ? 'ساعت دستگاه نامعتبر است.' : 'مجوز آفلاین این چپتر منقضی شده است؛ یک‌بار آنلاین شوید.');
    }
    r.lastSeen = Math.max(r.lastSeen, now);
    idbPut('chapters', r).catch(function () {});
    return makeHandle(r);
  }

  function makeHandle(r) {
    return { id: r.id, slug: r.slug, ch: r.ch, title: r.title, n: r.n, dims: r.dims, exp: r.exp, _rec: r };
  }

  async function decryptPage(rec, i) {
    var row = await idbGet('pages', pgId(rec.id, i));
    if (!row) throw OfflineError('MISSING', 'صفحه‌ی ذخیره‌شده پیدا نشد؛ چپتر را دوباره دانلود کنید.');
    var u8 = new Uint8Array(row.data);
    var iv = u8.slice(0, 12);
    var ct = u8.subarray(12);
    var aad = new TextEncoder().encode(rec.lid + '|' + i + '|' + rec.n);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: aad }, rec.key, ct);
  }

  async function paintPage(rec, i, canvas) {
    var plain = await decryptPage(rec, i);
    var bmp;
    try { bmp = await createImageBitmap(new Blob([plain])); } finally { new Uint8Array(plain).fill(0); }
    var w = bmp.width, h = bmp.height, s = 1;
    if (w * h > MAX_CANVAS_PIXELS) s = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
    canvas.width = Math.max(1, Math.floor(w * s));
    canvas.height = Math.max(1, Math.floor(h * s));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
  }

  /**
   * ساخت پنل‌های canvas داخل container (با همان کلاس‌های خوانندگر).
   * رمزگشایی تنبل است (فقط نزدیک صفحه‌ی دیده‌شده) و پنل‌های دور از صفحه از حافظه آزاد می‌شوند.
   * خروجی: وقتی چند صفحه‌ی اول کشیده شدند resolve می‌شود.
   */
  function render(container, handle, opts) {
    opts = opts || {};
    var rec = handle._rec;
    var resolved = false, pendingInitial = 0, sawFirstBatch = false;
    return new Promise(function (resolve) {
      function maybeResolve() { if (!resolved && sawFirstBatch && pendingInitial <= 0) { resolved = true; resolve(); } }
      setTimeout(function () { if (!resolved) { resolved = true; resolve(); } }, opts.maxWaitMs || 10000); // سقف انتظار
      container.innerHTML = '';
      var io = ('IntersectionObserver' in window) ? new IntersectionObserver(onIntersect, { rootMargin: '1800px 0px' }) : null;

      function onIntersect(entries) {
        var first = !sawFirstBatch;
        entries.forEach(function (en) {
          var p = en.target;
          if (en.isIntersecting) {
            if (first) { p._initial = true; pendingInitial++; }
            load(p);
          } else unload(p);
        });
        if (first) { sawFirstBatch = true; maybeResolve(); }
      }
      function settle(p) { if (p._initial) { p._initial = false; pendingInitial--; maybeResolve(); } }
      // حداکثر ۲ رمزگشایی هم‌زمان (مصرف حافظه‌ی موبایل)
      var running = 0, queue = [];
      function pump() {
        while (running < 2 && queue.length) {
          (function (p) {
            running++;
            var i = +p.dataset.idx, c = p.querySelector('canvas');
            paintPage(rec, i, c).then(function () {
              p._state = 'ready'; p.classList.remove('panel-loading');
            }).catch(function (e) {
              p._state = 'error'; p.classList.remove('panel-loading');
              if (opts.onError) opts.onError(e, i);
            }).then(function () { running--; settle(p); pump(); });
          })(queue.shift());
        }
      }
      function load(p) {
        if (p._state === 'loading' || p._state === 'ready') return;
        p._state = 'loading';
        queue.push(p);
        pump();
      }
      function unload(p) {
        if (p._state !== 'ready') return;
        var c = p.querySelector('canvas');
        c.width = 1; c.height = 1; // آزادسازی حافظه‌ی canvas
        p._state = '';
      }

      for (var i = 0; i < handle.n; i++) {
        var d = handle.dims && handle.dims[i];
        var p = document.createElement('div');
        p.className = 'manhwa-panel mc-off panel-loading w-full max-w-3xl flex justify-center items-center';
        p.dataset.idx = i;
        if (d && d[0] && d[1]) p.style.setProperty('--ar', d[0] + ' / ' + d[1]);
        var c = document.createElement('canvas');
        c.width = (d && d[0]) || 800; c.height = (d && d[1]) || 1200;
        c.setAttribute('aria-label', 'صفحه ' + (i + 1));
        c.draggable = false;
        p.appendChild(c);
        container.appendChild(p);
        if (io) io.observe(p); else { p._initial = true; pendingInitial++; load(p); }
      }
      // جلوگیری از منوی راست‌کلیک / نگه‌داشتن طولانی روی موبایل
      container.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('.mc-off')) e.preventDefault(); });
      container.addEventListener('dragstart', function (e) { if (e.target.closest && e.target.closest('.mc-off')) e.preventDefault(); });
      if (!io) { sawFirstBatch = true; maybeResolve(); }
      if (!handle.n) { resolved = true; resolve(); }
    });
  }

  // ───────────── مصرف فضا ─────────────
  async function usage(uid) {
    var items = await list(uid);
    var bytes = items.reduce(function (a, b) { return a + (b.bytes || 0); }, 0);
    var quota = null;
    try { if (navigator.storage && navigator.storage.estimate) quota = await navigator.storage.estimate(); } catch (e) { /* ignore */ }
    return { bytes: bytes, count: items.length, quota: quota };
  }

  // ───────────── سرویس‌ورکر + پاک‌سازی هنگام خروج ─────────────
  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  function hookAuth() {
    try {
      var c = window.supabaseClient;
      if (c && c.auth && c.auth.onAuthStateChange) {
        c.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') wipeAll(); });
      }
    } catch (e) { /* ignore */ }
  }
  function rememberUid(uid) { try { if (uid) localStorage.setItem('mc_off_uid', uid); } catch (e) { /* ignore */ } }
  function lastUid() { try { return localStorage.getItem('mc_off_uid') || null; } catch (e) { return null; } }

  window.MCOffline = {
    supported: supported, deviceId: deviceId,
    download: download, list: list, has: has, remove: remove, wipeAll: wipeAll,
    renewAll: renewAll, open: open, render: render, usage: usage,
    rememberUid: rememberUid, lastUid: lastUid,
  };
  if (supported()) {
    registerSW();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookAuth); else hookAuth();
  }
})();

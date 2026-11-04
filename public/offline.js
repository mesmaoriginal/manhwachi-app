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

  // ───────────── دانلود (قابل‌ازسرگیری) ─────────────
  // تا وقتی چپتر کامل نشده، رکوردش با incomplete:true در همان جدول می‌ماند (همراه مجوز و کلید).
  // اگر دانلود قطع شد (بستن تب، رفتن به چپتر بعد، قطع اینترنت) دفعه‌ی بعد فقط صفحه‌های مانده گرفته می‌شود
  // و مجوز تازه (که از سهمیه‌ی روزانه کم می‌کند) صادر نمی‌شود.
  var RESTART_CODES = { PAGE_LIMIT: 1, LICENSE_INVALID: 1, CHAPTER_CHANGED: 1 };
  function pagesRange(id) { return IDBKeyRange.bound(id + '|', id + '|\uffff'); }

  /**
   * opts: { slug, ch, title, uid, accessToken, onProgress(done,total), signal }
   */
  async function download(opts) {
    if (!supported()) throw OfflineError('UNSUPPORTED', 'مرورگر شما از ذخیره‌ی آفلاین امن پشتیبانی نمی‌کند.');
    var uid = opts.uid, slug = opts.slug, ch = Number(opts.ch);
    var id = chId(uid, slug, ch);
    var existing = await idbGet('chapters', id);
    if (existing && !existing.incomplete && existing.exp > Date.now()) return { already: true };

    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

    var rec = null;
    if (existing && existing.incomplete && existing.exp > Date.now() && existing.key && existing.did === deviceId()) rec = existing;

    if (!rec) {
      var lic = await apiJson('/license', { slug: slug, chapterNum: ch, did: deviceId() }, opts.accessToken, opts.signal);
      var keyBytes = Uint8Array.from(atob(lic.key), function (c) { return c.charCodeAt(0); });
      // کلید غیرقابل‌استخراج: از اینجا به بعد خود JS هم نمی‌تواند بایت‌های کلید را بخواند
      var cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
      keyBytes.fill(0);
      await delPagesOf(id);
      rec = {
        id: id, uid: uid, slug: slug, ch: ch, title: opts.title || slug,
        n: lic.n, dims: new Array(lic.n), bytes: 0, lid: lic.lid, token: lic.token, exp: lic.exp,
        key: cryptoKey, did: deviceId(), incomplete: true, savedAt: Date.now(), lastSeen: Date.now(),
      };
      await idbPut('chapters', rec);
    }

    var n = rec.n;
    var dims = rec.dims && rec.dims.length === n ? rec.dims : new Array(n);
    rec.dims = dims;
    // صفحه‌هایی که از دفعه‌ی قبل کامل ذخیره شده‌اند (هم خودِ صفحه هست هم ابعادش)
    var haveKeys = (await tx('pages', 'readonly', function (st) { return st.getAllKeys(pagesRange(id)); })) || [];
    var haveSet = {};
    haveKeys.forEach(function (k) { haveSet[k] = 1; });
    var todo = [];
    var done = 0;
    for (var p = 0; p < n; p++) {
      if (haveSet[pgId(id, p)] && dims[p] && dims[p][0]) done++;
      else todo.push(p);
    }
    if (opts.onProgress) opts.onProgress(done, n);

    var next = 0, failed = null;
    async function fetchPage(i) {
      for (var attempt = 0; attempt < 4; attempt++) {
        if (opts.signal && opts.signal.aborted) throw OfflineError('ABORTED', 'لغو شد');
        try {
          var res = await apiFetch('/page', { token: rec.token, i: i }, opts.accessToken, opts.signal);
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
        var k = next++;
        if (k >= todo.length) return;
        var i = todo[k];
        try {
          var r = await fetchPage(i);
          await idbPut('pages', { id: pgId(id, i), data: r.buf });
          dims[i] = [r.w, r.h];
          rec.bytes = (rec.bytes || 0) + r.buf.byteLength;
          await idbPut('chapters', rec); // پیشرفت ذخیره می‌شود تا قطع شدن چیزی را از بین نبرد
          done++;
          if (opts.onProgress) opts.onProgress(done, n);
        } catch (e) { failed = e; }
      }
    }
    await Promise.all([worker(), worker(), worker()]);

    if (failed) {
      // مجوز/چپتر دیگر معتبر نیست: ناقص‌ها را دور بریز و یک‌بار از اول (با مجوز تازه) تلاش کن
      if (RESTART_CODES[failed.code] && !opts._restarted) {
        await remove(uid, slug, ch).catch(function () {});
        var o2 = {}; for (var kk in opts) o2[kk] = opts[kk];
        o2._restarted = true;
        return download(o2);
      }
      throw failed; // نیمه‌کاره می‌ماند و دفعه‌ی بعد ادامه پیدا می‌کند
    }

    // چپتر فقط وقتی «کامل» حساب می‌شود که همه‌ی صفحه‌ها و ابعادشان ذخیره شده باشد
    rec.incomplete = false;
    rec.savedAt = Date.now();
    rec.lastSeen = Date.now();
    await idbPut('chapters', rec);
    try { localStorage.setItem('mc_off_uid', uid); } catch (e) { /* ignore */ }
    return { already: false, bytes: rec.bytes, n: n };
  }

  // ───────────── فهرست / حذف ─────────────
  async function list(uid) {
    var all = await idbAll('chapters');
    cleanupPartials(all);
    return all.filter(function (r) { return r.uid === uid && !r.incomplete; }).map(function (r) {
      return { slug: r.slug, ch: r.ch, title: r.title, n: r.n, bytes: r.bytes, exp: r.exp, savedAt: r.savedAt, lastSeen: r.lastSeen, opened: !!r.opened, expired: r.exp <= Date.now() };
    }).sort(function (a, b) { return a.title === b.title ? a.ch - b.ch : (a.title < b.title ? -1 : 1); });
  }
  async function has(uid, slug, ch) {
    var r = await idbGet('chapters', chId(uid, slug, Number(ch)));
    return !!r && !r.incomplete && r.exp > Date.now();
  }
  // نیمه‌کاره‌های منقضی/خیلی قدیمی (دیگر قابل ادامه نیستند) پاک می‌شوند
  function cleanupPartials(all) {
    var now = Date.now();
    all.forEach(function (r) {
      if (r.incomplete && (r.exp <= now || now - (r.savedAt || 0) > 2 * 86400e3)) remove(r.uid, r.slug, r.ch).catch(function () {});
    });
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
    var all = (await idbAll('chapters')).filter(function (r) { return r.uid === uid && !r.incomplete; });
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
    if (!r || r.incomplete) return null;
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
    r.opened = true;
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

  // ───────────── صف دانلود ─────────────
  // چند چپتر پشت‌سرهم، یکی‌یکی (سرور همزمانی را محدود کرده). صف در localStorage ذخیره می‌شود؛
  // اگر کاربر وسطش به چپتر بعد رفت یا تب را بست، صفحه‌ی بعد (ریدر/کتابخانه) خودکار ادامه می‌دهد.
  var QKEY = 'mc_off_queue';
  var FATAL = { AUTH_REQUIRED: 1, PREMIUM_REQUIRED: 1, OFFLINE_DISABLED: 1, OFFLINE_UNAVAILABLE: 1, OFFLINE_DEVICE_LIMIT: 1, OFFLINE_DAILY_LIMIT: 1, UNSUPPORTED: 1, AUTH_UNAVAILABLE: 1 };
  var queue = (function () {
    var listeners = [];
    var getSession = null;
    var items = [];            // { slug, ch, title, status: wait|run|done|fail|skip, err }
    var cur = null;            // { slug, ch, title, done, n }
    var running = false, paused = false, error = null, ctl = null, finishedAt = 0, uid = null;

    function snap() {
      var wait = items.filter(function (i) { return i.status === 'wait'; });
      return {
        running: running, paused: paused, error: error, finishedAt: finishedAt,
        current: cur ? { slug: cur.slug, ch: cur.ch, title: cur.title, done: cur.done, n: cur.n, pct: cur.n ? Math.round(cur.done / cur.n * 100) : 0 } : null,
        waiting: wait.map(function (i) { return { slug: i.slug, ch: i.ch, title: i.title }; }),
        completed: items.filter(function (i) { return i.status === 'done' || i.status === 'skip'; }).length,
        saved: items.filter(function (i) { return i.status === 'done'; }).length,
        failed: items.filter(function (i) { return i.status === 'fail'; }).map(function (i) { return { slug: i.slug, ch: i.ch, title: i.title, err: i.err }; }),
        total: items.length,
      };
    }
    function emit() { var st = snap(); listeners.slice().forEach(function (fn) { try { fn(st); } catch (e) { /* ignore */ } }); }
    function persist() {
      try {
        var left = items.filter(function (i) { return i.status === 'wait' || i.status === 'run'; }).map(function (i) { return { slug: i.slug, ch: i.ch, title: i.title }; });
        if (left.length && uid) localStorage.setItem(QKEY, JSON.stringify({ uid: uid, items: left }));
        else localStorage.removeItem(QKEY);
      } catch (e) { /* ignore */ }
    }
    function sess() { return getSession ? Promise.resolve(getSession()).catch(function () { return null; }) : Promise.resolve(null); }
    function waitOnline() {
      return new Promise(function (resolve) {
        if (navigator.onLine) return resolve();
        paused = true; emit();
        function on() { removeEventListener('online', on); paused = false; resolve(); }
        addEventListener('online', on);
      });
    }

    async function loop() {
      while (true) {
        var it = items.find(function (i) { return i.status === 'wait'; });
        if (!it) break;
        await waitOnline();
        var s = await sess();
        if (!s || !s.uid || !s.token) { error = { code: 'AUTH_REQUIRED', message: 'برای دانلود باید وارد حساب شوید.' }; break; }
        uid = s.uid;
        if (await has(s.uid, it.slug, it.ch)) { it.status = 'skip'; persist(); emit(); continue; }
        it.status = 'run';
        cur = { slug: it.slug, ch: it.ch, title: it.title, done: 0, n: 0 };
        ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        emit();
        try {
          await download({
            slug: it.slug, ch: it.ch, title: it.title, uid: s.uid, accessToken: s.token, signal: ctl && ctl.signal,
            onProgress: function (d, n) { cur.done = d; cur.n = n; emit(); },
          });
          it.status = 'done';
        } catch (e) {
          var code = e && e.code;
          if (code === 'ABORTED') { it.status = 'wait'; break; }
          if (FATAL[code]) { it.status = 'wait'; error = { code: code, message: e.message || 'دانلود متوقف شد.' }; break; }
          if (!navigator.onLine) { it.status = 'wait'; continue; } // قطع شدن اینترنت: صبر می‌کنیم و همین را دوباره می‌گیریم
          it.status = 'fail'; it.err = (e && e.message) || 'ناموفق';
        }
        cur = null; persist(); emit();
      }
    }

    async function run() {
      if (running) return;
      running = true; error = null; emit();
      var body = async function () { await loop(); };
      try {
        if (navigator.locks && navigator.locks.request) {
          // هم‌زمان فقط یک تب صف را اجرا کند؛ اگر تبِ قبلی هنوز در حال بسته‌شدن است چند بار صبر می‌کنیم
          var got = false;
          for (var t = 0; t < 6 && !got; t++) {
            await navigator.locks.request('mc-off-queue', { ifAvailable: true }, async function (lock) {
              if (!lock) return;
              got = true; await body();
            });
            if (!got) await sleep(1200);
          }
          if (!got) error = { code: 'BUSY_TAB', message: 'دانلود در تب دیگری در حال انجام است.' };
        } else { await body(); }
      } finally {
        running = false; cur = null; ctl = null;
        var anyLeft = items.some(function (i) { return i.status === 'wait'; });
        if (error && FATAL[error.code]) { items = items.filter(function (i) { return i.status !== 'wait'; }); }
        if (!anyLeft || error) { persist(); }
        if (items.length && !items.some(function (i) { return i.status === 'wait'; })) finishedAt = Date.now();
        emit();
      }
    }

    return {
      configure: function (fn) { getSession = fn; },
      onChange: function (fn) { listeners.push(fn); try { fn(snap()); } catch (e) { /* ignore */ } return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
      state: snap,
      /** add([{slug,ch,title}]) — موارد تکراری/ذخیره‌شده نادیده گرفته می‌شوند */
      add: async function (list) {
        var s = await sess();
        if (!s || !s.uid) { error = { code: 'AUTH_REQUIRED', message: 'برای دانلود باید وارد حساب شوید.' }; emit(); return false; }
        uid = s.uid;
        if (!running) { items = items.filter(function (i) { return i.status === 'wait'; }); finishedAt = 0; error = null; }
        (list || []).forEach(function (x) {
          var ch = Number(x.ch);
          if (!x.slug || !isFinite(ch)) return;
          if (items.some(function (i) { return i.slug === x.slug && i.ch === ch && (i.status === 'wait' || i.status === 'run'); })) return;
          items.push({ slug: x.slug, ch: ch, title: x.title || x.slug, status: 'wait' });
        });
        persist(); emit();
        run();
        return true;
      },
      cancel: function () {
        items = []; error = null; finishedAt = 0;
        try { if (ctl) ctl.abort(); } catch (e) { /* ignore */ }
        try { localStorage.removeItem(QKEY); } catch (e) { /* ignore */ }
        emit();
      },
      retryFailed: function () {
        items.forEach(function (i) { if (i.status === 'fail') { i.status = 'wait'; i.err = null; } });
        persist(); emit(); run();
      },
      dismiss: function () { if (!running) { items = []; error = null; finishedAt = 0; emit(); } },
      /** صف نیمه‌کاره‌ی دفعه‌ی قبل (فقط برای همین کاربر) را ادامه می‌دهد. چیزی برای ادامه نبود false. */
      resume: async function () {
        if (running) return false;
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(QKEY) || 'null'); } catch (e) { /* ignore */ }
        if (!raw || !raw.items || !raw.items.length) return false;
        var s = await sess();
        if (!s || !s.uid || s.uid !== raw.uid) return false;
        return this.add(raw.items);
      },
      pendingCount: function () {
        try { var raw = JSON.parse(localStorage.getItem(QKEY) || 'null'); return raw && raw.items ? raw.items.length : 0; } catch (e) { return 0; }
      },
    };
  })();

  // ───────────── ترجیح «دانلود خودکار چپتر بعدی» ─────────────
  function autoNext(v) {
    try {
      if (v === undefined) return localStorage.getItem('mc_off_auto') === '1';
      if (v) localStorage.setItem('mc_off_auto', '1'); else localStorage.removeItem('mc_off_auto');
      return !!v;
    } catch (e) { return false; }
  }

  // ───────────── سرویس‌ورکر + پاک‌سازی هنگام خروج ─────────────
  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  function hookAuth() {
    try {
      var c = window.supabaseClient;
      if (c && c.auth && c.auth.onAuthStateChange) {
        c.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') { queue.cancel(); wipeAll(); } });
      }
    } catch (e) { /* ignore */ }
  }
  function rememberUid(uid) { try { if (uid) localStorage.setItem('mc_off_uid', uid); } catch (e) { /* ignore */ } }
  function lastUid() { try { return localStorage.getItem('mc_off_uid') || null; } catch (e) { return null; } }

  window.MCOffline = {
    supported: supported, deviceId: deviceId,
    download: download, list: list, has: has, remove: remove, wipeAll: wipeAll,
    renewAll: renewAll, open: open, render: render, usage: usage,
    queue: queue, autoNext: autoNext,
    rememberUid: rememberUid, lastUid: lastUid,
  };
  if (supported()) {
    registerSW();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookAuth); else hookAuth();
  }
})();

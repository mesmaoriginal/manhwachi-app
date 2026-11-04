/* public/offline-ui.js — نوار کوچک پیشرفت دانلود آفلاین (مشترک بین صفحه‌ها)
 * استفاده: MCOfflineUI.mount()   ← بعد از offline.js
 * فقط وقتی صف دانلود کاری دارد دیده می‌شود، مزاحم خواندن نیست و با ✕ لغو می‌شود.
 */
(function () {
  'use strict';
  if (window.MCOfflineUI) return;

  var CSS = '' +
    '.mco-pill{position:fixed;left:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:70;max-width:min(92vw,360px);' +
    'display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:16px;direction:rtl;font:600 12px/1.6 Vazirmatn,system-ui,sans-serif;color:#f4f4f5;' +
    'background:rgba(24,24,27,.94);border:1px solid rgba(255,255,255,.1);box-shadow:0 12px 32px -12px rgba(0,0,0,.8);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);' +
    'opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s,transform .25s}' +
    '.mco-pill.on{opacity:1;transform:none;pointer-events:auto}' +
    '.mco-pill.err{border-color:rgba(248,113,113,.45);background:rgba(40,16,16,.95)}' +
    '.mco-pill.ok{border-color:rgba(52,211,153,.4)}' +
    'html.vf-t-premium .mco-pill:not(.err){border-color:rgba(232,182,74,.4)}' +
    '.mco-ring{--p:0;flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:800;' +
    'background:conic-gradient(#f3c75f calc(var(--p)*1%),rgba(255,255,255,.12) 0)}' +
    '.mco-ring i{width:20px;height:20px;border-radius:50%;background:#18181b;display:grid;place-items:center;font-style:normal}' +
    '.mco-ring.spin{animation:mcoSpin 1.1s linear infinite}' +
    '@keyframes mcoSpin{to{transform:rotate(360deg)}}' +
    '.mco-t{min-width:0;flex:1}.mco-t small{display:block;color:#a1a1aa;font-weight:500;font-size:11px}' +
    '.mco-b{flex:none;border:0;background:rgba(255,255,255,.08);color:#e4e4e7;border-radius:10px;padding:5px 10px;font:inherit;font-size:11px;cursor:pointer;text-decoration:none}' +
    '.mco-b:hover{background:rgba(255,255,255,.16)}' +

    '.mco-pop{position:fixed;z-index:80;width:268px;max-width:calc(100vw - 16px);padding:12px;border-radius:18px;direction:rtl;color:#f4f4f5;font:600 13px/1.7 Vazirmatn,system-ui,sans-serif;' +
    'background:rgba(20,20,23,.97);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 44px -14px rgba(0,0,0,.85);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
    'opacity:0;transform:translateY(-6px) scale(.98);pointer-events:none;transition:opacity .16s,transform .16s}' +
    '.mco-pop.on{opacity:1;transform:none;pointer-events:auto}' +
    'html.vf-t-premium .mco-pop{border-color:rgba(232,182,74,.35)}' +
    '.mco-pop h4{margin:0 2px 8px;font-size:13px;font-weight:800}' +
    '.mco-opt{display:block;width:100%;text-align:right;border:0;border-radius:12px;padding:9px 12px;margin-top:6px;font:inherit;color:#f4f4f5;background:rgba(255,255,255,.06);cursor:pointer;text-decoration:none}' +
    '.mco-opt:hover{background:rgba(255,255,255,.12)}' +
    '.mco-opt small{display:block;font-size:11px;font-weight:500;color:#a1a1aa}' +
    '.mco-opt.pri{background:#dc2626}.mco-opt.pri:hover{background:#ef4444}.mco-opt.pri small{color:#fecaca}' +
    'html.vf-t-premium .mco-opt.pri{background:linear-gradient(110deg,#e8b64a,#f7d778);color:#2a1a00}html.vf-t-premium .mco-opt.pri small{color:#5b3b00}' +
    '.mco-opt.danger{color:#fca5a5}.mco-opt.danger.arm{background:#7f1d1d;color:#fff}' +
    '.mco-bar{height:6px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin:8px 2px}' +
    '.mco-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#b9822a,#f7d778);transition:width .2s}' +
    '.mco-chk{display:flex;align-items:center;gap:8px;margin:10px 4px 2px;font-size:12px;font-weight:500;color:#d4d4d8;cursor:pointer}' +
    '.mco-chk input{width:16px;height:16px;accent-color:#e8b64a}' +
    '.mco-note{margin:6px 4px 0;font-size:11px;font-weight:500;color:#a1a1aa}' +
    '@media (prefers-reduced-motion:reduce){.mco-pill{transition:none}.mco-pop{transition:none}.mco-ring.spin{animation:none}}';

  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var el = null, hideT = null, mounted = false;

  function ensure() {
    if (el) return el;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div');
    el.className = 'mco-pill'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), q = window.MCOffline.queue;
      if (a === 'cancel') q.cancel();
      else if (a === 'dismiss') q.dismiss();
      else if (a === 'retry') q.retryFailed();
    });
    return el;
  }

  function render(s) {
    var p = ensure();
    clearTimeout(hideT);
    var failedN = s.failed.length;

    if (s.error) {
      p.className = 'mco-pill on err';
      p.innerHTML = '<div class="mco-t">' + esc(s.error.message) + '</div><button class="mco-b" data-a="dismiss" aria-label="بستن">بستن</button>';
      return;
    }
    if (s.running && s.current) {
      var more = s.waiting.length;
      var c = s.current;
      p.className = 'mco-pill on';
      p.innerHTML =
        '<span class="mco-ring" style="--p:' + c.pct + '"><i>' + (s.paused ? '⏸' : fa(c.pct)) + '</i></span>' +
        '<div class="mco-t">' + (s.paused ? 'منتظر اینترنت…' : 'در حال ذخیره‌ی چپتر ' + fa(c.ch)) +
        '<small>' + esc(c.title) + (more ? ' • ' + fa(more) + ' چپتر در صف' : '') + '</small></div>' +
        '<button class="mco-b" data-a="cancel" aria-label="لغو دانلود">لغو</button>';
      return;
    }
    if (s.running) { // بین دو چپتر
      p.className = 'mco-pill on';
      p.innerHTML = '<span class="mco-ring spin" style="--p:30"><i></i></span><div class="mco-t">در حال آماده‌سازی…</div><button class="mco-b" data-a="cancel">لغو</button>';
      return;
    }
    if (s.saved > 0 || failedN) {
      p.className = 'mco-pill on ' + (failedN && !s.saved ? 'err' : 'ok');
      p.innerHTML =
        '<div class="mco-t">' + (s.saved ? '✓ ' + fa(s.saved) + ' چپتر برای آفلاین ذخیره شد' : '') +
        (failedN ? '<small>' + fa(failedN) + ' چپتر ناموفق بود</small>' : '') + '</div>' +
        (failedN ? '<button class="mco-b" data-a="retry">دوباره</button>' : '<a class="mco-b" href="/offline.html">کتابخانه</a>') +
        '<button class="mco-b" data-a="dismiss" aria-label="بستن">✕</button>';
      if (!failedN) hideT = setTimeout(function () { p.classList.remove('on'); window.MCOffline.queue.dismiss(); }, 6000);
      return;
    }
    p.classList.remove('on');
  }


  // ───────────── منوی دکمه‌ی آفلاین (ریدر) ─────────────
  /**
   * attachMenu({ btn, icon, label, ctx })
   * ctx(): { slug, ch, title, episodes:[{num}], getSession(), checkAccess(token), onNeedLogin(), onNeedPremium() }
   * خروجی: { refresh(), autoNext() }
   */
  function attachMenu(o) {
    var pop = document.createElement('div');
    pop.className = 'mco-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'خواندن بدون اینترنت');
    document.body.appendChild(pop);
    var armed = false, armT = null, saved = null, savedExp = 0, premiumOk = null;
    var Q = MCOffline.queue;

    function C() { return o.ctx(); }
    function nextEps(n) {
      var c = C(), cur = Number(c.ch);
      return (c.episodes || []).map(function (e) { return Number(e.num); }).filter(function (x) { return isFinite(x) && x > cur; }).sort(function (a, b) { return a - b; }).slice(0, n);
    }
    function mk(c, nums) { return nums.map(function (n) { return { slug: c.slug, ch: n, title: c.title }; }); }

    async function refresh() {
      var c = C(), sess = null;
      try { sess = await c.getSession(); } catch (e) { /* ignore */ }
      saved = false;
      if (sess && sess.uid && MCOffline.supported()) {
        try {
          saved = await MCOffline.has(sess.uid, c.slug, c.ch);
          if (saved) { var l = (await MCOffline.list(sess.uid)).filter(function (i) { return i.slug === c.slug && Number(i.ch) === Number(c.ch); })[0]; savedExp = l ? l.exp : 0; }
        } catch (e) { /* ignore */ }
      }
      paintBtn(Q.state());
      if (pop.classList.contains('on')) paintPop(Q.state());
    }
    function paintBtn(st) {
      var c = C(), cur = st.current;
      var mine = cur && cur.slug === c.slug && Number(cur.ch) === Number(c.ch);
      o.icon.textContent = saved ? 'download_done' : (st.running ? 'downloading' : 'download');
      o.btn.classList.toggle('text-green-400', !!saved);
      o.label.textContent = mine ? fa(cur.pct) + '٪' : (st.running && st.waiting.length ? fa(st.waiting.length + 1) : '');
      o.btn.title = saved ? 'ذخیره‌شده برای آفلاین' : 'خواندن بدون اینترنت';
    }
    function opt(a, t, sub, cls) { return '<button class="mco-opt ' + (cls || '') + '" data-a="' + a + '">' + t + (sub ? '<small>' + sub + '</small>' : '') + '</button>'; }

    function paintPop(st) {
      var c = C(), cur = st.current, mine = cur && cur.slug === c.slug && Number(cur.ch) === Number(c.ch);
      var n3 = nextEps(3).length, n10 = nextEps(10).length;
      var h = '<h4>' + (saved ? '✓ این چپتر ذخیره شده' : 'خواندن بدون اینترنت') + '</h4>';
      if (st.running && cur) {
        h += '<div class="mco-note">' + (st.paused ? 'منتظر اینترنت…' : 'در حال ذخیره‌ی چپتر ' + fa(cur.ch) + ' (' + fa(cur.pct) + '٪)') + (st.waiting.length ? ' • ' + fa(st.waiting.length) + ' در صف' : '') + '</div>' +
             '<div class="mco-bar"><i style="width:' + cur.pct + '%"></i></div>' + opt('cancel', 'لغو دانلودها', '', '');
      }
      if (saved) {
        var days = Math.max(0, Math.ceil((savedExp - Date.now()) / 86400e3));
        h += '<div class="mco-note">با هر بار اتصال به اینترنت خودکار تمدید می‌شود' + (days ? ' (اعتبار فعلی: ' + fa(days) + ' روز)' : '') + '</div>';
        if (n3) h += opt('next3', 'ذخیره‌ی ' + fa(n3) + ' چپتر بعدی', 'برای ادامه‌ی داستان بدون اینترنت', 'pri');
        h += opt('del', 'حذف از دستگاه', '', 'danger');
      } else if (!mine) {
        h += opt('this', 'ذخیره‌ی همین چپتر', 'چپتر ' + fa(c.ch), 'pri');
        if (n3) h += opt('this3', 'این چپتر + ' + fa(n3) + ' بعدی', 'مناسب سفر یا اینترنت ضعیف', '');
        if (n10 > n3) h += opt('this10', 'این چپتر + ' + fa(n10) + ' بعدی', '', '');
      }
      h += '<label class="mco-chk"><input type="checkbox" id="mcoAuto"' + (MCOffline.autoNext() ? ' checked' : '') + '> دانلود خودکار ۲ چپتر بعدی هنگام خواندن</label>';
      h += '<a class="mco-opt" style="margin-top:10px;text-align:center" href="/offline.html">کتابخانه‌ی آفلاین ←</a>';
      pop.innerHTML = h;
    }

    function place() {
      var r = o.btn.getBoundingClientRect(), w = 268;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      pop.style.left = left + 'px';
      pop.style.top = Math.max(8, r.bottom + 8) + 'px';
    }
    function open() { paintPop(Q.state()); place(); pop.classList.add('on'); }
    function close() { pop.classList.remove('on'); armed = false; }

    async function ensureAllowed() {
      var c = C(), sess = await c.getSession().catch(function () { return null; });
      if (!sess || !sess.token) { c.onNeedLogin(); return false; }
      if (premiumOk !== true) {
        var acc = await c.checkAccess(sess.token);
        if (acc && !acc.canOffline) { c.onNeedPremium(); return false; }
        if (acc && acc.canOffline) premiumOk = true;
      }
      if (!MCOffline.supported()) { c.toast('مرورگر شما از دانلود آفلاین پشتیبانی نمی‌کند'); return false; }
      return true;
    }

    o.btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop.classList.contains('on')) close(); else open();
    });
    document.addEventListener('click', function (e) { if (!pop.contains(e.target) && !o.btn.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', function () { if (pop.classList.contains('on')) place(); });

    pop.addEventListener('change', function (e) { if (e.target.id === 'mcoAuto') { MCOffline.autoNext(e.target.checked); if (e.target.checked) autoRun(); } });
    pop.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), c = C();
      if (a === 'cancel') { Q.cancel(); close(); return; }
      if (a === 'del') {
        if (!armed) { armed = true; b.classList.add('arm'); b.firstChild.nodeValue = 'برای حذف دوباره بزنید'; clearTimeout(armT); armT = setTimeout(function () { armed = false; if (pop.classList.contains('on')) paintPop(Q.state()); }, 3000); return; }
        var s = await c.getSession().catch(function () { return null; });
        if (s && s.uid) await MCOffline.remove(s.uid, c.slug, c.ch);
        close(); await refresh(); c.toast('از دستگاه حذف شد'); return;
      }
      var nums = [];
      if (a === 'this') nums = [Number(c.ch)];
      else if (a === 'this3') nums = [Number(c.ch)].concat(nextEps(3));
      else if (a === 'this10') nums = [Number(c.ch)].concat(nextEps(10));
      else if (a === 'next3') nums = nextEps(3);
      if (!nums.length) return;
      if (!(await ensureAllowed())) { close(); return; }
      close();
      Q.add(mk(c, nums));
    });

    // پس از هر تغییر صف، دکمه (و منوی باز) به‌روز می‌شود؛ بعد از اتمام هم وضعیت «ذخیره شد» دوباره خوانده می‌شود
    var wasRunning = false;
    Q.onChange(function (st) {
      paintBtn(st);
      if (pop.classList.contains('on')) paintPop(st);
      if (wasRunning && !st.running) refresh();
      wasRunning = st.running;
    });

    // دانلود خودکار: وقتی کاربر چپتر را می‌خواند، ۲ چپتر بعدی (و همین چپتر) در پس‌زمینه ذخیره شود
    async function autoRun() {
      try {
        if (!MCOffline.autoNext() || !navigator.onLine || !MCOffline.supported()) return;
        var cn = navigator.connection;
        if (cn && (cn.saveData || cn.type === 'cellular')) return; // روی دیتای موبایل/حالت صرفه‌جویی بی‌صدا دانلود نکن
        var c = C(), sess = await c.getSession().catch(function () { return null; });
        if (!sess || !sess.token) return;
        if (premiumOk !== true) {
          var acc = await c.checkAccess(sess.token);
          if (!acc || !acc.canOffline) return;
          premiumOk = true;
        }
        Q.add(mk(c, [Number(c.ch)].concat(nextEps(2))));
      } catch (e) { /* ignore */ }
    }

    refresh();
    return { refresh: refresh, autoRun: autoRun };
  }

  window.MCOfflineUI = {
    attachMenu: attachMenu,
    mount: function () {
      if (mounted || !window.MCOffline || !MCOffline.queue) return;
      mounted = true;
      MCOffline.queue.onChange(render);
    },
  };
})();

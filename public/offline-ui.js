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


  // ───────────── آیکون دانلودِ انیمیشنی (مشترک: ریدر + صفحه‌ی مانگا) ─────────────
  // حالت‌ها: idle (فلش دانلود) → wait (در صف) → load (حلقه‌ی پیشرفت) → done (تیک سبز) | err
  var ICON_CSS = '' +
    '.mco-dl{position:relative;display:inline-grid;place-items:center;width:1.25em;height:1.25em;color:inherit;vertical-align:middle}' +
    '.mco-dl svg{width:100%;height:100%;overflow:visible;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.mco-dl .a,.mco-dl .t,.mco-dl .rg,.mco-dl .ck,.mco-dl .r{transition:transform .5s cubic-bezier(.3,1.5,.5,1),opacity .3s ease,stroke-dashoffset .35s ease,stroke .3s ease}' +
    '.mco-dl .a{transform-origin:12px 12px}.mco-dl .t{transform-origin:12px 19px}' +
    '.mco-dl .rg{opacity:0;transform:scale(.35);transform-origin:12px 12px}' +
    '.mco-dl .rb{opacity:.22}.mco-dl .r{stroke-dasharray:100;stroke-dashoffset:100}' +
    '.mco-dl .ck{opacity:0;stroke-dasharray:22;stroke-dashoffset:22;stroke-width:2.4}' +
    '.mco-dl[data-s=wait] .a,.mco-dl[data-s=load] .a{opacity:0;transform:translateY(7px) scale(.2)}' +
    '.mco-dl[data-s=wait] .t,.mco-dl[data-s=load] .t{opacity:0;transform:scaleX(0)}' +
    '.mco-dl[data-s=wait] .rg,.mco-dl[data-s=load] .rg{opacity:1;transform:none}' +
    '.mco-dl[data-s=wait] .rg{opacity:.55}' +
    '.mco-dl[data-s=wait] .r{stroke-dasharray:28 72;stroke-dashoffset:0}' +
    '.mco-dl[data-s=wait] .rg,.mco-dl[data-i="1"] .rg{animation:mcoSpin 1s linear infinite}' +
    '.mco-dl[data-i="1"] .r{stroke-dasharray:28 72;stroke-dashoffset:0}' +
    '.mco-dl[data-s=done]{color:#34d399}' +
    '.mco-dl[data-s=done] .a,.mco-dl[data-s=done] .t{opacity:0;transform:scale(.2)}' +
    '.mco-dl[data-s=done] .rg{opacity:1;transform:none}' +
    '.mco-dl[data-s=done] .r{stroke-dashoffset:0}' +
    '.mco-dl[data-s=done] .ck{opacity:1;stroke-dashoffset:0;transition-delay:.15s}' +
    '.mco-dl[data-s=done] svg{animation:mcoPop .55s cubic-bezier(.3,1.6,.5,1)}' +
    '.mco-dl[data-s=err]{color:#f87171}' +
    '@keyframes mcoBob{0%,100%{transform:translateY(0)}50%{transform:translateY(2.2px)}}' +
    '@keyframes mcoPop{0%{transform:scale(.7)}60%{transform:scale(1.18)}100%{transform:scale(1)}}' +
    '*:hover>.mco-dl[data-s=idle] .a,*:focus-visible>.mco-dl[data-s=idle] .a{animation:mcoBob .8s ease-in-out infinite}' +
    '.mco-dl[data-s=err] .a{animation:mcoShake .5s}@keyframes mcoShake{20%,60%{transform:translateX(-2px)}40%,80%{transform:translateX(2px)}}' +
    'html.vf-t-premium .mco-dl[data-s=idle],html.vf-t-premium .mco-dl[data-s=load],html.vf-t-premium .mco-dl[data-s=wait]{color:#f3c75f;filter:drop-shadow(0 0 5px rgba(232,182,74,.45))}' +
    '@media (prefers-reduced-motion:reduce){.mco-dl *,.mco-dl svg{animation:none!important;transition:none!important}}' +

    // دکمه‌ی گردِ هر چپتر در لیست قسمت‌ها + دکمه‌ی دانلود گروهی
    '.mx-dl{display:none;flex:none;width:40px;height:40px;padding:0;border-radius:50%;place-items:center;font-size:18px;cursor:pointer;color:#d4d4d8;' +
    'border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);transition:background .2s,border-color .2s,transform .2s;-webkit-tap-highlight-color:transparent}' +
    'html.vf-t-premium .mx-dl{display:grid;border-color:rgba(232,182,74,.32);background:rgba(232,182,74,.07)}' +
    'html.vf-t-premium .mx-dl:hover{background:rgba(232,182,74,.16);border-color:rgba(232,182,74,.6);transform:translateY(-1px)}' +
    '.mx-dl:active{transform:scale(.92)}' +
    '.mx-dl[data-s=done]{border-color:rgba(52,211,153,.45)!important;background:rgba(52,211,153,.09)!important}' +
    '.mx-dl[data-s=err]{border-color:rgba(248,113,113,.5)!important}' +
    '.mx-dl .mco-pct{position:absolute;inset:auto 0 -15px 0;text-align:center;font:700 9px/1 Vazirmatn,system-ui,sans-serif;color:#f3c75f;pointer-events:none}' +
    '.mx-dl{position:relative}' +
    '.mx-bulk{display:none;align-items:center;gap:6px;padding:6px 12px 6px 14px;border-radius:99px;font:600 12.5px/1.6 Vazirmatn,system-ui,sans-serif;cursor:pointer;color:#f3c75f;' +
    'border:1px solid rgba(232,182,74,.4);background:rgba(232,182,74,.08);transition:background .2s}' +
    'html.vf-t-premium .mx-bulk{display:inline-flex}.mx-bulk:hover{background:rgba(232,182,74,.18)}' +
    '.mco-toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:90;transform:translate(-50%,16px);opacity:0;pointer-events:none;max-width:min(92vw,380px);' +
    'padding:10px 16px;border-radius:14px;direction:rtl;font:600 13px/1.7 Vazirmatn,system-ui,sans-serif;color:#f4f4f5;background:rgba(24,24,27,.96);border:1px solid rgba(255,255,255,.12);' +
    'box-shadow:0 14px 36px -12px rgba(0,0,0,.8);transition:opacity .25s,transform .25s}.mco-toast.on{opacity:1;transform:translate(-50%,0)}';

  var ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<g class="rg"><circle class="rb" cx="12" cy="12" r="10"/><circle class="r" cx="12" cy="12" r="10" pathLength="100" transform="rotate(-90 12 12)"/></g>' +
    '<g class="a"><path d="M12 4.5v10"/><path d="M7.8 10.8 12 15l4.2-4.2"/></g>' +
    '<path class="t" d="M5.5 19.5h13"/>' +
    '<path class="ck" d="M7.6 12.4l3.1 3.1 5.9-6.4"/></svg>';

  function iconHTML() { return '<span class="mco-dl" data-s="idle">' + ICON_SVG + '</span>'; }
  /** state: idle | wait | load | done | err ؛ pct فقط برای load (۰ = نامعلوم، حلقه می‌چرخد) */
  function setIcon(host, state, pct) {
    var w = host && (host.classList && host.classList.contains('mco-dl') ? host : host.querySelector && host.querySelector('.mco-dl'));
    if (!w) { if (!host) return; host.innerHTML = iconHTML(); w = host.firstChild; }
    pct = Math.max(0, Math.min(100, pct || 0));
    var ind = state === 'load' && pct < 3;
    if (w.getAttribute('data-s') !== state) w.setAttribute('data-s', state);
    if (ind) w.setAttribute('data-i', '1'); else w.removeAttribute('data-i');
    var r = w.querySelector('.r');
    if (r && state === 'load' && !ind) r.style.strokeDashoffset = String(100 - pct); else if (r) r.style.strokeDashoffset = '';
    return w;
  }
  function injectCss() {
    if (document.getElementById('mco-icon-css')) return;
    var st = document.createElement('style'); st.id = 'mco-icon-css'; st.textContent = ICON_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  injectCss();

  var toastEl = null, toastT = null;
  function toast(msg, ms) {
    if (!document.body) return;
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mco-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 2600);
  }

  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var el = null, hideT = null, mounted = false, quiet = false;

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
    if (quiet && s.running) { // دکمه‌ی خودش پیشرفت را نشان می‌دهد؛ فقط وقتی اینترنت قطع است خبر بده
      if (s.paused) { p.className = 'mco-pill on'; p.innerHTML = '<div class="mco-t">منتظر اینترنت…<small>با وصل شدن ادامه پیدا می‌کند</small></div><button class="mco-b" data-a="cancel">لغو</button>'; }
      else p.classList.remove('on');
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
    o.icon.className = (o.icon.className || '').replace('material-symbols-outlined', '').trim();
    o.icon.innerHTML = iconHTML();
    var pressT = null, longFired = false;

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
      var state = saved ? 'done' : (mine ? 'load' : (st.running ? 'wait' : 'idle'));
      setIcon(o.icon, state, mine ? cur.pct : 0);
      o.btn.classList.toggle('text-green-400', !!saved);
      o.label.textContent = mine ? fa(cur.pct) + '٪' : (st.running && st.waiting.length ? fa(st.waiting.length + 1) : '');
      o.btn.title = saved ? 'ذخیره‌شده برای آفلاین' : (mine ? 'در حال دانلود…' : 'ذخیره‌ی این چپتر برای خواندن بدون اینترنت');
    }
    function opt(a, t, sub, cls) { return '<button class="mco-opt ' + (cls || '') + '" data-a="' + a + '">' + t + (sub ? '<small>' + sub + '</small>' : '') + '</button>'; }

    function paintPop(st) {
      var c = C(), cur = st.current, mine = cur && cur.slug === c.slug && Number(cur.ch) === Number(c.ch);
      var n3 = nextEps(3).length, n10 = nextEps(10).length;
      var h = '<h4>' + (saved ? '✓ این چپتر ذخیره شده' : 'خواندن بدون اینترنت') + '</h4>';
      if (st.running && cur) {
        h += '<div class="mco-note">' + (st.paused ? 'منتظر اینترنت…' : 'در حال ذخیره‌ی چپتر ' + fa(cur.ch) + ' (' + fa(cur.pct) + '٪)') + (st.waiting.length ? ' • ' + fa(st.waiting.length) + ' در صف' : '') + '</div>' +
             '<div class="mco-bar"><i style="width:' + cur.pct + '%"></i></div>' + (mine && n3 ? opt('next3', 'ذخیره‌ی ' + fa(n3) + ' چپتر بعدی هم', 'برای ادامه‌ی داستان بدون اینترنت', 'pri') : '') + opt('cancel', 'لغو دانلودها', '', '');
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

    // یک‌لمس: اگر چپتر ذخیره نیست همان لحظه دانلود می‌شود (بدون منوی اضافه)؛
    // اگر در حال دانلود/ذخیره‌شده است یا کاربر نگه دارد/راست‌کلیک کند، منوی گزینه‌ها باز می‌شود.
    async function quickSave() {
      var c = C();
      if (!(await ensureAllowed())) return;
      Q.add(mk(c, [Number(c.ch)]));
      if (c.toast) c.toast('دانلود چپتر ' + fa(c.ch) + ' شروع شد • برای گزینه‌های بیشتر دوباره روی آیکون بزنید');
    }
    o.btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (longFired) { longFired = false; return; }
      var st = Q.state(), cur = st.current, c = C();
      var mine = cur && cur.slug === c.slug && Number(cur.ch) === Number(c.ch);
      if (pop.classList.contains('on')) { close(); return; }
      if (saved || st.running || mine) { open(); return; }
      quickSave();
    });
    o.btn.addEventListener('contextmenu', function (e) { e.preventDefault(); longFired = false; open(); });
    o.btn.addEventListener('touchstart', function () { longFired = false; clearTimeout(pressT); pressT = setTimeout(function () { longFired = true; open(); }, 480); }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(function (ev) { o.btn.addEventListener(ev, function () { clearTimeout(pressT); }, { passive: true }); });
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


  // ───────────── دکمه‌ی دانلود در لیست قسمت‌های صفحه‌ی مانگا ─────────────
  /**
   * bindList({ root, slug, title(), episodes(), isRead(num), getSession, checkAccess, onNeedLogin, onNeedPremium, bulkBtn })
   * root: عنصری که کارت‌ها داخلش‌اند؛ هر کارت یک <button class="mx-dl" data-dl="شماره"> دارد (محتوایش را خودمان پر می‌کنیم).
   * بعد از هر بار بازرسم لیست، paint() را صدا بزنید.
   */
  function bindList(o) {
    var Q = MCOffline.queue, savedSet = {}, premiumOk = null, armedNum = null, armT = null;
    var root = typeof o.root === 'string' ? document.querySelector(o.root) : o.root;
    if (!root) return { paint: function () {}, refresh: function () {} };

    async function allowed() {
      var sess = await o.getSession().catch(function () { return null; });
      if (!sess || !sess.token) { o.onNeedLogin(); return false; }
      if (premiumOk !== true) {
        var acc = await o.checkAccess(sess.token);
        if (acc && !acc.canOffline) { o.onNeedPremium(); return false; }
        if (acc && acc.canOffline) premiumOk = true;
      }
      if (!MCOffline.supported()) { toast('مرورگر شما از دانلود آفلاین پشتیبانی نمی‌کند'); return false; }
      return true;
    }
    function title() { return (o.title && o.title()) || o.slug; }

    function paint(st) {
      st = st || Q.state();
      var cur = st.current && st.current.slug === o.slug ? st.current : null;
      var waitN = {}; st.waiting.forEach(function (w) { if (w.slug === o.slug) waitN[Number(w.ch)] = 1; });
      var failN = {}; st.failed.forEach(function (f) { if (f.slug === o.slug) failN[Number(f.ch)] = 1; });
      root.querySelectorAll('.mx-dl[data-dl]').forEach(function (b) {
        var n = Number(b.getAttribute('data-dl')), state, pct = 0;
        if (savedSet[n]) state = 'done';
        else if (cur && Number(cur.ch) === n) { state = 'load'; pct = cur.pct; }
        else if (waitN[n]) state = 'wait';
        else if (failN[n]) state = 'err';
        else state = 'idle';
        if (!b.firstChild || !b.querySelector('.mco-dl')) b.innerHTML = iconHTML();
        setIcon(b, state, pct);
        b.setAttribute('data-s', state);
        var pc = b.querySelector('.mco-pct');
        if (state === 'load') { if (!pc) { pc = document.createElement('span'); pc.className = 'mco-pct'; b.appendChild(pc); } pc.textContent = fa(pct) + '٪'; }
        else if (pc) pc.remove();
        b.setAttribute('aria-label', (state === 'done' ? 'ذخیره‌شده برای آفلاین — چپتر ' : state === 'load' || state === 'wait' ? 'در حال دانلود چپتر ' : 'دانلود چپتر ') + n);
        b.title = state === 'done' ? 'ذخیره‌شده؛ برای حذف دوباره بزنید' : state === 'load' ? 'در حال دانلود…' : state === 'wait' ? 'در صف دانلود' : state === 'err' ? 'ناموفق؛ برای تلاش دوباره بزنید' : 'ذخیره برای خواندن بدون اینترنت';
      });
    }
    async function refresh() {
      try {
        var sess = await o.getSession().catch(function () { return null; });
        savedSet = {};
        if (sess && sess.uid && MCOffline.supported()) {
          (await MCOffline.list(sess.uid)).forEach(function (i) { if (i.slug === o.slug && !i.expired) savedSet[Number(i.ch)] = 1; });
        }
      } catch (e) { /* ignore */ }
      paint();
    }

    root.addEventListener('click', async function (e) {
      var b = e.target.closest && e.target.closest('.mx-dl');
      if (!b) return;
      e.preventDefault(); e.stopPropagation(); // کارت (لینک) باز نشود
      var n = Number(b.getAttribute('data-dl')), state = b.getAttribute('data-s');
      if (state === 'load' || state === 'wait') { Q.cancel(); toast('دانلودها لغو شد'); return; }
      if (state === 'done') {
        if (armedNum !== n) { armedNum = n; clearTimeout(armT); armT = setTimeout(function () { armedNum = null; }, 3000); toast('برای حذف چپتر ' + fa(n) + ' از دستگاه، دوباره بزنید'); return; }
        armedNum = null;
        var s = await o.getSession().catch(function () { return null; });
        if (s && s.uid) await MCOffline.remove(s.uid, o.slug, n);
        await refresh(); toast('چپتر ' + fa(n) + ' از دستگاه حذف شد'); return;
      }
      if (!(await allowed())) return;
      Q.add([{ slug: o.slug, ch: n, title: title() }]);
    });

    var wasRunning = false;
    Q.onChange(function (st) {
      paint(st);
      if (wasRunning && !st.running) refresh();
      wasRunning = st.running;
    });

    // ── دانلود گروهی (دکمه‌ی کنار عنوان «قسمت‌ها») ──
    if (o.bulkBtn) {
      var bb = typeof o.bulkBtn === 'string' ? document.querySelector(o.bulkBtn) : o.bulkBtn;
      var pop = document.createElement('div');
      pop.className = 'mco-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'دانلود گروهی');
      document.body.appendChild(pop);
      var pick = function (n) {
        var eps = (o.episodes() || []).map(function (e) { return Number(e.num); }).filter(isFinite).sort(function (a, b) { return a - b; });
        var unsaved = eps.filter(function (x) { return !savedSet[x]; });
        var unread = o.isRead ? unsaved.filter(function (x) { return !o.isRead(x); }) : unsaved;
        var base = unread.length ? unread : unsaved;
        return n ? base.slice(0, n) : base.slice(0, 40);
      };
      var paintBulk = function () {
        var n5 = pick(5).length, n10 = pick(10).length, all = pick(0).length, total = (o.episodes() || []).length;
        var h = '<h4>دانلود برای خواندن بدون اینترنت</h4>';
        if (!all) h += '<div class="mco-note">همه‌ی چپترها روی این دستگاه ذخیره شده‌اند ✓</div>';
        else {
          h += '<div class="mco-note">از اولین چپتر نخوانده‌ی شما شروع می‌شود</div>';
          h += '<button class="mco-opt pri" data-n="5">' + fa(n5) + ' چپتر بعدی<small>سریع و کم‌حجم</small></button>';
          if (n10 > n5) h += '<button class="mco-opt" data-n="10">' + fa(n10) + ' چپتر بعدی</button>';
          if (all > n10) h += '<button class="mco-opt" data-n="0">همه‌ی چپترها' + (all < total ? ' (' + fa(all) + ' مورد)' : '') + '<small>سقف دانلود روزانه ۴۰ چپتر است</small></button>';
        }
        h += '<a class="mco-opt" style="margin-top:10px;text-align:center" href="/offline.html">کتابخانه‌ی آفلاین ←</a>';
        pop.innerHTML = h;
      };
      var place = function () {
        var r = bb.getBoundingClientRect(), w = 268;
        pop.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8) + 'px';
        pop.style.top = Math.max(8, r.bottom + 8) + 'px';
      };
      var closeB = function () { pop.classList.remove('on'); };
      bb.addEventListener('click', function (e) {
        e.stopPropagation();
        if (pop.classList.contains('on')) { closeB(); return; }
        paintBulk(); place(); pop.classList.add('on');
      });
      document.addEventListener('click', function (e) { if (!pop.contains(e.target) && !bb.contains(e.target)) closeB(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeB(); });
      window.addEventListener('resize', function () { if (pop.classList.contains('on')) place(); });
      window.addEventListener('scroll', function () { if (pop.classList.contains('on')) place(); }, { passive: true });
      pop.addEventListener('click', async function (e) {
        var b = e.target.closest('[data-n]'); if (!b) return;
        var nums = pick(Number(b.getAttribute('data-n')));
        closeB();
        if (!nums.length) return;
        if (!(await allowed())) return;
        Q.add(nums.map(function (x) { return { slug: o.slug, ch: x, title: title() }; }));
        toast('دانلود ' + fa(nums.length) + ' چپتر شروع شد');
      });
    }
    return { paint: paint, refresh: refresh };
  }

  window.MCOfflineUI = {
    attachMenu: attachMenu,
    icon: { html: iconHTML, set: setIcon },
    toast: toast,
    bindList: bindList,
    mount: function (o) {
      if (o && o.quiet) quiet = true;
      if (mounted || !window.MCOffline || !MCOffline.queue) return;
      mounted = true;
      MCOffline.queue.onChange(render);
    },
  };
})();

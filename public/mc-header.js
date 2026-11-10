/* =====================================================================
   ManhwaChi — mc-header.js
   هدر + منوی کشویی یکسان برای همه‌ی صفحه‌ها (همون هدر صفحه‌ی مانگا).
   استفاده در هر صفحه:
     <link rel="stylesheet" href="/mc-header.css?v=1">
     <script src="/mc-header.js?v=1" defer></script>
   اگه توی صفحه <div id="mc-header-root"></div> باشه همون‌جا ساخته می‌شه،
   وگرنه اول <body> اضافه می‌شه. برای صفحه‌هایی که هدر نمی‌خوان: <body data-mc-header="off">
   ===================================================================== */
(function () {
  'use strict';
  if (window.__mcHeaderLoaded) return;
  window.__mcHeaderLoaded = true;

  var NAV = [
    { href: '/', icon: 'home', label: 'خانه', match: /^\/$|^\/index\.html$/ },
    { href: '/library-page.html', icon: 'grid_view', label: 'آرشیو مانهوا', match: /^\/library-page\.html$/ },
    { href: '/bookmarks.html', icon: 'bookmark', label: 'نشان‌شده‌ها', match: /^\/bookmarks\.html$/ }
  ];
  var DRAWER = [
    { href: '/', icon: 'home', label: 'صفحه اصلی' },
    { href: '/library-page.html', icon: 'grid_view', label: 'لیست مانهواها' },
    { href: '/bookmarks.html', icon: 'bookmark', label: 'نشان‌شده‌ها' },
    { href: '/Careers.html', icon: 'group_add', label: 'همکاری با تیم' }
  ];
  var TG = 'https://telegram.me/Manhwachiofficial';

  function ic(n) { return '<span class="material-symbols-outlined" aria-hidden="true" translate="no">' + n + '</span>'; }

  function ensureIconFont() {
    var has = document.querySelector('link[href*="material-symbols"], link[href*="Material+Symbols"]');
    if (has) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/vendor/material-symbols.css';
    l.onerror = function () { l.onerror = null; l.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block'; };
    document.head.appendChild(l);
  }
  function ensureFonts() {
    if (!document.querySelector('link[href*="vazirmatn"], link[href*="Vazirmatn"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/vendor/vazirmatn.css'; document.head.appendChild(l);
    }
    if (!document.querySelector('link[href*="montserrat"], link[href*="Montserrat"]')) {
      var m = document.createElement('link'); m.rel = 'stylesheet'; m.href = '/css/vendor/montserrat.css'; document.head.appendChild(m);
    }
  }

  function build() {
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var nav = NAV.map(function (n) {
      return '<a href="' + n.href + '"' + (n.match.test(path) ? ' class="is-active"' : '') + '>' + ic(n.icon) + ' ' + n.label + '</a>';
    }).join('') + '<a href="' + TG + '" target="_blank" rel="noopener" class="mch-tg">' + ic('send') + ' تلگرام</a>';

    var items = DRAWER.map(function (n) {
      return '<a href="' + n.href + '" class="mch-item"><div class="mch-item__ic">' + ic(n.icon) + '</div><span>' + n.label + '</span></a>';
    }).join('');

    var header =
      '<header class="mch" id="mcHeader"><div class="mch__in">' +
        '<div class="mch__side">' +
          '<button type="button" id="mchOpen" class="mch-btn" aria-label="منو">' + ic('menu') + '</button>' +
          '<a href="/" class="mch-brand" aria-label="مانهواچی"><img src="/ManhwaChi/LOGO-main-white.webp" alt="ManhwaChi Logo" onerror="this.remove()"><span class="mch-brand__name">Manhwa<b>Chi</b></span></a>' +
        '</div>' +
        '<nav class="mch-nav" aria-label="منوی اصلی">' + nav + '</nav>' +
        '<div class="mch__actions">' +
          '<button type="button" id="mchAccount" class="mch-btn mch-account" aria-label="حساب کاربری" title="ورود به حساب">' + ic('person') + '<span class="mch-account__name" id="mchAccountName"></span></button>' +
          '<a href="/search.html" class="mch-btn" aria-label="جستجو">' + ic('search') + '</a>' +
          '<a href="/Careers.html" class="mch-careers">' + ic('group_add') + ' همکاری با ما</a>' +
        '</div>' +
      '</div></header>' +
      '<div class="mch-overlay" id="mchOverlay"></div>' +
      '<aside class="mch-drawer" id="mchDrawer" aria-label="منو"><div class="mch-drawer__glow"></div>' +
        '<div class="mch-drawer__top">' +
          '<div class="mch-drawer__head"><div class="mch-drawer__brand"><img src="/ManhwaChi/LOGO-main-white.webp" alt="" onerror="this.remove()"><span>Manhwa<b>Chi</b></span></div>' +
          '<button type="button" id="mchClose" class="mch-drawer__close" aria-label="بستن">' + ic('close') + '</button></div>' +
          '<nav class="mch-drawer__nav">' + items + '<div data-mhp="drawer"></div></nav>' +
        '</div>' +
        '<div class="mch-drawer__foot">' +
          '<a href="' + TG + '" target="_blank" rel="noopener" class="mch-tgbtn"><span>' + ic('send') + '<span>کانال تلگرام مانهواچی</span></span>' + ic('chevron_left') + '</a>' +
          '<p class="mch-copy">© ۲۰۲۶ مانهواچی - تمامی حقوق محفوظ است</p>' +
        '</div>' +
      '</aside>';

    var root = document.getElementById('mc-header-root');
    if (root) { root.outerHTML = header; }
    else { document.body.insertAdjacentHTML('afterbegin', header); }
  }

  function wireDrawer() {
    var b = document.body;
    function open() { b.classList.add('mch-open'); }
    function close() { b.classList.remove('mch-open'); }
    document.getElementById('mchOpen').addEventListener('click', open);
    document.getElementById('mchClose').addEventListener('click', close);
    document.getElementById('mchOverlay').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ---------- دکمه‌ی حساب کاربری ---------- */
  var user = null;
  function getDb() { return window.supabaseClient || (window.supabase && window.supabase.auth ? window.supabase : null); }

  function nameOf(u, prof) {
    if (!u) return '';
    return ((prof && prof.full_name) || '').trim() || (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.display_name)) || (u.email ? u.email.split('@')[0] : 'کاربر');
  }
  function paint(prof) {
    var btn = document.getElementById('mchAccount'), nm = document.getElementById('mchAccountName');
    if (!btn) return;
    var icon = btn.querySelector('.material-symbols-outlined');
    if (user) {
      var n = nameOf(user, prof);
      icon.textContent = 'account_circle'; nm.textContent = n; btn.classList.add('is-in'); btn.title = n + ' — مشاهده پروفایل';
    } else {
      icon.textContent = 'person'; nm.textContent = ''; btn.classList.remove('is-in'); btn.title = 'ورود به حساب';
    }
  }
  function setUser(u, db) {
    user = u || null;
    paint(null);
    if (user && db) {
      try {
        db.from('profiles').select('full_name').eq('id', user.id).maybeSingle().then(function (r) { if (r && r.data && user) paint(r.data); });
      } catch (e) {}
    }
  }
  function wireAccount() {
    var btn = document.getElementById('mchAccount');
    btn.addEventListener('click', function () {
      if (user) { location.href = '/?page=profile'; return; }
      if (typeof window.openAuthModal === 'function') { window.openAuthModal('login'); return; }
      // صفحه‌هایی که مدال ورود ندارن: به صفحه‌ی اصلی می‌ره و مدال همون‌جا باز می‌شه و بعد برمی‌گرده
      location.href = '/?action=login&next=' + encodeURIComponent(location.pathname + location.search);
    });
    var tries = 0;
    (function attach() {
      var db = getDb();
      if (!db || !db.auth) { if (tries++ < 40) setTimeout(attach, 150); return; }
      db.auth.getSession().then(function (r) { setUser(r && r.data && r.data.session && r.data.session.user, db); });
      db.auth.onAuthStateChange(function (_e, s) { setUser(s && s.user, db); });
    })();
  }

  function init() {
    if (document.body.getAttribute('data-mc-header') === 'off') return;
    ensureIconFont(); ensureFonts();
    build(); wireDrawer(); wireAccount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

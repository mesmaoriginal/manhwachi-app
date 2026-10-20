/* ManhwaChi — کادرهای نصب اپ
 * یک فایل برای همه‌ی صفحه‌ها. متن/لینک/آیکون رو فقط از همین‌جا عوض کن.
 *
 * جاهایی که توی HTML فقط یک placeholder می‌ذاریم:
 *   <span data-mhp="pill"></span>     دکمه‌ی هدر
 *   <div  data-mhp="drawer"></div>    کارت داخل منوی کشویی
 *   <div  data-mhp="banner"></div>    بنر بزرگ
 *   <div  data-mhp="strip"></div>     نوار باریک
 *   <div  data-mhp="footer"></div>    لینک فوتر
 * نوار شناور موبایل و QR دسکتاپ رو خود اسکریپت می‌سازه.
 *
 * تست: آدرس صفحه رو با ?showapp=1 باز کن (دوره‌ی «۳ روز مخفی» پاک می‌شه و روی آیفون هم نشون می‌ده).
 */
(function () {
  'use strict';

  var APP  = '/app';
  var ICON = '/ManhwaChi/apple-touch-icon.png';
  var QR   = '/images/app-qr.svg';
  var KEY  = 'mc_app_promo';          // همون کلید قبلی
  var HIDE = 3 * 864e5;               // بستن نوار شناور/QR = ۳ روز مخفی
  var LKEY = 'mc_app_launch';         // کادر «اپ منتشر شد»: با بستن، ۳ روز نمیاد
  var LAUNCH_END = '2026-11-21';      // بعد از این تاریخ کادر دیگه نشون داده نمی‌شه (عوض کن یا null بذار = همیشه)

  var ua = navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  var force = /[?&]showapp=1/.test(location.search);
  var root = document.documentElement;

  if (force) { try { localStorage.removeItem(KEY); localStorage.removeItem('mc_app_launch'); } catch (e) {} }
  // فایل نصب فقط اندرویده؛ به کاربر آیفون چیزی نشون نمی‌دیم
  if (isIOS && !force) { root.classList.add('mhp-ios'); return; }

  var I = {
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>',
    go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>'
  };
  var icon = function (cls) {
    return '<img class="' + cls + '" src="' + ICON + '" alt="" width="46" height="46" onerror="this.style.visibility=\'hidden\'">';
  };

  var TPL = {
    pill:
      '<a class="mhp mhp-pill mhp-shine" href="' + APP + '" data-mhp-place="header" aria-label="دانلود اپ مانهواچی">' +
        I.dl + '<span class="mhp-pill__t">دانلود اپ</span><i class="mhp-dot"></i></a>',

    drawer:
      '<a class="mhp mhp-drawer mhp-shine" href="' + APP + '" data-mhp-place="drawer">' +
        icon('mhp-ic') +
        '<div class="mhp-tx"><small class="mhp-chip">نسخه‌ی اندروید</small><b>اپ مانهواچی</b><span>سریع‌تر و راحت‌تر بخون</span></div>' +
        '<span class="mhp-go">' + I.dl + '</span></a>',

    banner:
      '<div class="mhp-wrap"><a class="mhp mhp-banner" href="' + APP + '" data-mhp-place="banner">' +
        '<div class="mhp-banner__body">' +
          '<span class="mhp-chip">اپلیکیشن اندروید</span>' +
          '<h3>مانهواچی همیشه <em>توی جیبت</em></h3>' +
          '<p>مانهوا و مانگا با ترجمه‌ی فارسی؛ سریع‌تر، راحت‌تر و همیشه دم‌دست.</p>' +
          '<span class="mhp-btn mhp-shine">' + I.dl + 'دانلود اپ</span>' +
        '</div>' +
        '<div class="mhp-phone" aria-hidden="true"><div class="mhp-phone__s"><i class="mhp-ph-h"></i><i class="mhp-ph-sl"></i>' +
          '<span class="mhp-ph-row"><b></b><b></b><b></b></span><span class="mhp-ph-row"><b></b><b></b><b></b></span></div></div>' +
        '<div class="mhp-banner__qr"><img src="' + QR + '" alt="QR کد دانلود اپ مانهواچی" width="96" height="96"><small>با گوشی اسکن کن</small></div>' +
      '</a></div>',

    strip:
      '<div class="mhp-wrap" style="margin:20px auto"><a class="mhp mhp-strip" href="' + APP + '" data-mhp-place="strip">' +
        icon('mhp-ic') +
        '<div class="mhp-tx"><b>توی اپ بخون، راحت‌تر</b><span>مانهواچی برای اندروید</span></div>' +
        '<span class="mhp-btn mhp-shine">نصب</span></a></div>',

    footer:
      '<div class="mhp-footwrap"><a class="mhp mhp-foot" href="' + APP + '" data-mhp-place="footer">' +
        I.dl + '<span>دانلود اپلیکیشن اندروید مانهواچی</span>' + I.go + '</a></div>'
  };

  /* ───── پر کردن placeholderها (برای SPA هم کار می‌کنه) ───── */
  function render() {
    var list = document.querySelectorAll('[data-mhp]:not([data-mhp-ready])');
    for (var i = 0; i < list.length; i++) {
      var t = TPL[list[i].getAttribute('data-mhp')];
      if (t) { list[i].innerHTML = t; list[i].setAttribute('data-mhp-ready', '1'); }
    }
  }
  var queued = false;
  function queue() {
    if (queued) return; queued = true;
    (window.requestAnimationFrame || setTimeout)(function () { queued = false; render(); });
  }
  render();
  try { new MutationObserver(queue).observe(root, { childList: true, subtree: true }); } catch (e) {}

  /* ───── نوار شناور موبایل + QR دسکتاپ ───── */
  var suppressed = false;
  try { var t0 = +localStorage.getItem(KEY); if (t0 && Date.now() - t0 < HIDE) suppressed = true; } catch (e) {}

  var bar = null, qr = null;

  function close() {
    suppressed = true;
    try { localStorage.setItem(KEY, Date.now()); } catch (e) {}
    [bar, qr].forEach(function (el) { if (el) el.classList.remove('is-on'); });
    if (qr) { qr.parentNode && qr.parentNode.removeChild(qr); qr = null; }
  }

  function makeBar() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'mhp mhp-bar';
    bar.setAttribute('role', 'complementary');
    bar.setAttribute('aria-label', 'دانلود اپلیکیشن مانهواچی');
    bar.innerHTML =
      icon('mhp-ic') +
      '<div class="mhp-tx"><b>دانلود اپ مانهواچی</b><span>سریع‌تر و راحت‌تر بخون</span></div>' +
      '<a class="mhp-bar__btn mhp-shine" href="' + APP + '" data-mhp-place="bar">نصب</a>' +
      '<button type="button" class="mhp-x" aria-label="بستن">&times;</button>';
    bar.querySelector('.mhp-x').addEventListener('click', close);
    document.body.appendChild(bar);

    // وقتی نوار پایین سایت مخفی می‌شه، این نوار هم پایین‌تر میاد
    var nav = document.querySelector('.bottom-nav');
    if (!nav) { bar.classList.add('no-nav'); }
    else {
      var sync = function () {
        bar.classList.toggle('nav-gone', nav.classList.contains('nav-hidden') || getComputedStyle(nav).display === 'none');
      };
      try { new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
      sync();
    }
  }

  function makeQr() {
    if (qr) return;
    qr = document.createElement('div');
    qr.className = 'mhp mhp-qr';
    qr.setAttribute('role', 'complementary');
    qr.setAttribute('aria-label', 'اسکن برای نصب اپلیکیشن');
    qr.innerHTML =
      '<button type="button" class="mhp-x" aria-label="بستن">&times;</button>' +
      '<a href="' + APP + '" data-mhp-place="qr" aria-label="صفحه‌ی دانلود اپ"><img src="' + QR + '" alt="QR کد دانلود اپ مانهواچی" width="118" height="118"></a>' +
      '<b>اپ مانهواچی</b><span>اسکن کن و نصب کن</span>';
    qr.querySelector('.mhp-x').addEventListener('click', close);
    document.body.appendChild(qr);
  }

  function evaluate() {
    if (suppressed) return;
    var narrow = window.matchMedia('(max-width: 767.98px)').matches;
    if (narrow) {                         // موبایل (و هر مرورگر باریک غیر آیفون)
      makeBar();
      requestAnimationFrame(function () { bar && bar.classList.add('is-on'); });
    } else if (!isMobileUA) {             // دسکتاپ
      makeQr();
    }
  }


  /* ───── کادر «اولین نسخه‌ی اپ منتشر شد» ───── */
  function launchEligible() {
    if (force) return true;
    if (LAUNCH_END && Date.now() > new Date(LAUNCH_END + 'T23:59:59').getTime()) return false;
    try { var t = +localStorage.getItem(LKEY); if (t && Date.now() - t < HIDE) return false; } catch (e) {}
    return true;
  }
  function showLaunch(done) {
    var ov = document.createElement('div');
    ov.className = 'mhp mhp-launch';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'اولین نسخه‌ی اپ مانهواچی منتشر شد');
    ov.innerHTML =
      '<div class="mhp-lc">' +
        '<button type="button" class="mhp-x" aria-label="بستن">&times;</button>' +
        '<span class="mhp-lc__badge">🎉 اولین نسخه منتشر شد</span>' +
        '<div class="mhp-lc__art" aria-hidden="true">' +
          '<i class="sp"></i><i class="sp"></i><i class="sp"></i><i class="sp"></i><i class="sp"></i>' +
          icon('mhp-ic') +
          '<div class="mhp-phone"><div class="mhp-phone__s"><i class="mhp-ph-h"></i><i class="mhp-ph-sl"></i>' +
            '<span class="mhp-ph-row"><b></b><b></b><b></b></span><span class="mhp-ph-row"><b></b><b></b><b></b></span></div></div>' +
        '</div>' +
        '<h2>اپ <em>مانهواچی</em> رسید!</h2>' +
        '<p>بالاخره اولین نسخه‌ی اپلیکیشن اندروید منتشر شد. مانهوا و مانگا با ترجمه‌ی فارسی، سریع‌تر و راحت‌تر؛ همیشه توی جیبت.</p>' +
        '<div class="mhp-lc__qr"><img src="' + QR + '" alt="QR کد دانلود اپ مانهواچی" width="92" height="92"><small>یا با گوشی اسکن کن</small></div>' +
        '<a class="mhp-btn mhp-shine" href="' + APP + '" data-mhp-place="launch">' + I.dl + 'دانلود اپ</a>' +
        '<button type="button" class="mhp-lc__later">بعداً</button>' +
      '</div>';
    document.body.appendChild(ov);
    var closed = false;
    function shut() {
      if (closed) return; closed = true;
      try { localStorage.setItem(LKEY, Date.now()); } catch (e) {}
      document.removeEventListener('keydown', onKey);
      ov.classList.add('is-out');
      setTimeout(function () { ov.parentNode && ov.parentNode.removeChild(ov); done && done(); }, 260);
    }
    function onKey(e) { if (e.key === 'Escape') shut(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) shut(); });
    ov.querySelector('.mhp-x').addEventListener('click', shut);
    ov.querySelector('.mhp-lc__later').addEventListener('click', shut);
    ov.querySelector('.mhp-btn').addEventListener('click', function () { try { localStorage.setItem(LKEY, Date.now()); } catch (e) {} });
  }

  function start() {
    if (launchEligible()) setTimeout(function () { showLaunch(function () { setTimeout(evaluate, 600); }); }, 1000);
    else setTimeout(evaluate, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(evaluate, 300); });

  /* ───── آمار کلیک هر جا (اگه gtag داری) ───── */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-mhp-place]');
    if (!a) return;
    try { window.gtag && window.gtag('event', 'app_promo_click', { place: a.getAttribute('data-mhp-place') }); } catch (_) {}
  });

  window.mhpReset = function () { try { localStorage.removeItem(KEY); localStorage.removeItem(LKEY); } catch (e) {} location.reload(); };
})();

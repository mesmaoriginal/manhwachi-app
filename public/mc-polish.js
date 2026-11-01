/* ManhwaChi — mc-polish.js
   انیمیشن‌های سبک: ورود تدریجی عناصر، خط پیشرفت اسکرول، حالت سبک برای گوشی ضعیف.
   بدون وابستگی. اگر خطایی رخ بدهد، سایت مثل قبل کار می‌کند. */
(function () {
  'use strict';
  var root = document.documentElement;

  /* ---------- حالت‌ها ---------- */
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conn = navigator.connection || {};
  var weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
             (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
             conn.saveData === true;
  if (weak) root.classList.add('mp-lite');
  if (reduce) return;                       // کاربر حرکت نمی‌خواهد؛ هیچ کاری نکن

  /* انیمیشن افتادن هدر فقط اولین بار هر نشست */
  try {
    if (!sessionStorage.getItem('mp-intro')) {
      sessionStorage.setItem('mp-intro', '1');
      root.classList.add('mp-ready');
      setTimeout(function () { root.classList.remove('mp-ready'); }, 1200);
    }
  } catch (e) {}

  /* ---------- خط پیشرفت اسکرول ---------- */
  if (!weak) {
    var bar = document.createElement('div');
    bar.id = 'mp-progress';
    bar.setAttribute('aria-hidden', 'true');
    var queued = false, last = null;

    function paint() {
      queued = false;
      if (!last) return;
      var max = last.scrollHeight - last.clientHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, last.scrollTop / max)) : 0;
      bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    // scroll روی هر اسکرول‌کننده‌ای (window یا #app در صفحه‌ی اصلی) در فاز capture گرفته می‌شود
    document.addEventListener('scroll', function (e) {
      var t = e.target;
      if (t === document) t = document.scrollingElement || document.documentElement;
      if (!t || t.scrollHeight - t.clientHeight < 400) return;   // لیست‌های افقی و باکس‌های کوچک نادیده
      last = t;
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    }, { passive: true, capture: true });

    var attach = function () { document.body && document.body.appendChild(bar); };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
  }

  /* ---------- ورود تدریجی ---------- */
  if (!('IntersectionObserver' in window)) return;
  root.classList.add('mp-js');

  var SELECTOR = [
    '.title',
    '#todaysList > li',
    '#topRatedList > li',
    '.manhwa-card',
    '.cards .card',
    '.telegram-banner',
    '.instagram-banner',
    '.mw-banner-wrapper',
    '.vip-plan', '.plan-card'
  ].join(',');

  var io = new IntersectionObserver(function (entries) {
    var batch = 0;
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      io.unobserve(el);
      el.style.setProperty('--mp-i', Math.min(batch++, 8));
      el.classList.add('mp-in');
      // بعد از پایان ورود، نشانه برداشته می‌شود تا هاور و استایل‌های خود عنصر دست‌نخورده بمانند
      setTimeout(function () {
        el.removeAttribute('data-mp');
        el.style.removeProperty('--mp-i');
      }, 1300);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });

  function tag(node) {
    if (node.nodeType !== 1) return;
    var list = node.matches && node.matches(SELECTOR) ? [node] : [];
    if (node.querySelectorAll) list = list.concat([].slice.call(node.querySelectorAll(SELECTOR)));
    list.forEach(function (el) {
      if (el.hasAttribute('data-mp') || el.classList.contains('mp-in')) return;
      el.setAttribute('data-mp', '');
      io.observe(el);
    });
  }

  function start() {
    tag(document.body);
    // آیتم‌هایی که بعداً با جاوااسکریپت ساخته می‌شوند (لیست‌ها، کارت‌های جستجو، ...)
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { m.addedNodes.forEach(tag); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  /* شبکه‌ی ایمنی: اگر به هر دلیل چیزی ظاهر نشد، بعد از ۴ ثانیه همه‌چیز دیده شود */
  setTimeout(function () {
    var pending = document.querySelectorAll('[data-mp]:not(.mp-in)');
    for (var i = 0; i < pending.length; i++) {
      var r = pending[i].getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) pending[i].classList.add('mp-in');
    }
  }, 4000);
})();

/* ManhwaChi — Halloween PERF + QUIET. قبل از halloween.js لود کن (کوچیکه، defer لازم نیست). */
(function () {
  var r = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  /* ---- LITE: دستگاه ضعیف => انیمیشن‌های محیطی خاموش ---- */
  var weak = (navigator.hardwareConcurrency || 8) <= 4 ||
             (navigator.deviceMemory || 8) <= 4 ||
             !!(navigator.connection && navigator.connection.saveData);
  var v = get('hw-lite');
  var lite = v === '1' ? true : v === '0' ? false : weak;
  if (/[?&]lite=1/.test(location.search)) lite = true;
  if (/[?&]lite=0/.test(location.search)) lite = false;
  r.classList.toggle('hw-lite', lite);
  window.hwLite = function (on) { set('hw-lite', on === null ? null : on ? '1' : '0'); r.classList.toggle('hw-lite', on === null ? weak : !!on); };

  /* ---- LOUD: حالت «پرشور» قبلی (خفاش/رعدوبرق/چشم/جرقه‌ی موس/چراغ دنبال‌کننده/وراجی کدوچی). پیش‌فرض خاموش ---- */
  var loud = get('hw-loud') === '1' || /[?&]loud=1/.test(location.search);
  window.HW_LOUD = loud;
  r.classList.toggle('hw-loud', loud);
  window.hwLoud = function (on) { set('hw-loud', on ? '1' : null); location.reload(); };

  /* ---- موقع اسکرول انیمیشن‌های محیطی pause می‌شن ---- */
  var t, s = false;
  addEventListener('scroll', function () {
    if (!s) { s = true; r.classList.add('hw-scrolling'); }
    clearTimeout(t);
    t = setTimeout(function () { s = false; r.classList.remove('hw-scrolling'); }, 160);
  }, { passive: true });
})();

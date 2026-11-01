/* ManhwaChi — mc-ui.js
   mcToast(message, type?, ms?)   ← جای alert():   type = 'success' | 'error' | 'info'
   mcConfirm(message, options?)   ← جای confirm(): Promise<boolean>
     options: { title, confirmText, cancelText }
   همه‌ی متن‌ها با textContent گذاشته می‌شن (بدون خطر XSS). */
(function () {
  if (window.mcToast && window.mcConfirm) return;

  function host() {
    var h = document.getElementById('mcToastHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'mcToastHost';
      h.className = 'mc-toast-host';
      h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }

  window.mcToast = function (message, type, ms) {
    type = type === 'success' || type === 'error' ? type : 'info';
    var el = document.createElement('div');
    el.className = 'mc-toast mc-toast--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var ic = document.createElement('span');
    ic.className = 'mc-toast__ic';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
    var tx = document.createElement('span');
    tx.textContent = String(message == null ? '' : message);
    el.appendChild(ic); el.appendChild(tx);

    var h = host();
    while (h.children.length >= 3) h.removeChild(h.firstChild); // هیچ‌وقت بیشتر از ۳ تا روی هم نمونه
    h.appendChild(el);

    var closed = false;
    function close() {
      if (closed) return; closed = true;
      el.classList.add('is-out');
      setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 230);
    }
    el.addEventListener('click', close);
    setTimeout(close, ms || (type === 'error' ? 5000 : 3200));
    return close;
  };

  window.mcConfirm = function (message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var ov = document.createElement('div');
      ov.className = 'mc-dlg';
      ov.setAttribute('role', 'alertdialog');
      ov.setAttribute('aria-modal', 'true');

      var box = document.createElement('div');
      box.className = 'mc-dlg__box';
      if (opts.title) {
        var t = document.createElement('h3');
        t.className = 'mc-dlg__title'; t.textContent = opts.title;
        box.appendChild(t);
      }
      var m = document.createElement('p');
      m.className = 'mc-dlg__msg'; m.textContent = String(message == null ? '' : message);
      box.appendChild(m);

      var row = document.createElement('div');
      row.className = 'mc-dlg__row';
      var no = document.createElement('button');
      no.type = 'button'; no.className = 'mc-dlg__btn'; no.textContent = opts.cancelText || 'انصراف';
      var ok = document.createElement('button');
      ok.type = 'button'; ok.className = 'mc-dlg__btn mc-dlg__btn--ok'; ok.textContent = opts.confirmText || 'تأیید';
      row.appendChild(ok); row.appendChild(no);
      box.appendChild(row); ov.appendChild(box);

      var done = false;
      function finish(v) {
        if (done) return; done = true;
        document.removeEventListener('keydown', onKey, true);
        ov.parentNode && ov.parentNode.removeChild(ov);
        try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) {}
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') { // فوکوس داخل پنجره بمونه
          e.preventDefault();
          (document.activeElement === ok ? no : ok).focus();
        }
      }
      ok.addEventListener('click', function () { finish(true); });
      no.addEventListener('click', function () { finish(false); });
      ov.addEventListener('click', function (e) { if (e.target === ov) finish(false); });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(ov);
      no.focus(); // پیش‌فرض روی «انصراف»؛ Enter اتفاقی چیزی رو حذف/خرید نمی‌کنه
    });
  };
})();

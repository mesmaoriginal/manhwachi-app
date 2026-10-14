/* وبلاگ مانهواچی — اسکریپت عمومی (کوچک، بدون وابستگی، بدون inline handler) */
(function () {
  function copy(text, btn) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = "کپی شد ✓";
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () {});
    } else {
      var t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      document.body.removeChild(t);
    }
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-copy]");
    if (c) { var pre = c.parentNode.querySelector("pre"); if (pre) copy(pre.innerText, c); return; }
    var u = e.target.closest("[data-copy-url]");
    if (u) copy(u.getAttribute("data-copy-url"), u);
  });

  // نوار پیشرفت مطالعه (فقط صفحه‌ی مطلب)
  var root = document.querySelector("[data-readroot]"), bar = document.getElementById("rp");
  if (root && bar) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = root.getBoundingClientRect(), total = r.height - window.innerHeight;
      var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      bar.style.width = (p * 100).toFixed(1) + "%";
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
})();

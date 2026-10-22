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

  var root = document.querySelector("[data-readroot]");
  var bar = document.getElementById("rp");
  var hd = document.querySelector(".hd");
  var bnav = document.getElementById("bnav");

  // نوار پیشرفت مطالعه (فقط صفحه‌ی مطلب)
  var updateBar = function () {
    if (!root || !bar) return;
    var r = root.getBoundingClientRect(), total = r.height - window.innerHeight;
    var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    bar.style.width = (p * 100).toFixed(1) + "%";
  };

  // سایه‌ی هدر + مخفی/نمایان شدن منوی پایین هنگام اسکرول (مثل سایت اصلی)
  var lastY = window.pageYOffset || 0;
  var onScroll = function () {
    var y = window.pageYOffset || 0;
    if (hd) hd.classList.toggle("sc", y > 8);
    if (bnav) {
      var nearEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
      if (y > lastY + 6 && y > 120 && !nearEnd) bnav.classList.add("hide");
      else if (y < lastY - 6 || nearEnd) bnav.classList.remove("hide");
    }
    lastY = y;
    updateBar();
  };
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; onScroll(); });
  }, { passive: true });
  onScroll();

  // فهرست مطالب: در موبایل/تبلت به‌صورت پیش‌فرض بسته؛ در دسکتاپ کنار متن و باز
  var toc = document.querySelector(".toc");
  if (toc) {
    var mq = window.matchMedia("(min-width:1180px)");
    var sync = function () { if (mq.matches) toc.setAttribute("open", ""); else toc.removeAttribute("open"); };
    sync();
    if (mq.addEventListener) mq.addEventListener("change", sync);

    // هایلایت بخشی که الان در حال خواندنش هستید
    var links = {};
    toc.querySelectorAll("a[href^='#']").forEach(function (a) { links[decodeURIComponent(a.getAttribute("href").slice(1))] = a; });
    var heads = [];
    Object.keys(links).forEach(function (id) { var h = document.getElementById(id); if (h) heads.push(h); });
    if (heads.length && "IntersectionObserver" in window) {
      var cur = null;
      var setActive = function (id) {
        if (cur === id) return;
        cur = id;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle("on", k === id); });
        var a = links[id];
        if (a && mq.matches && toc.scrollHeight > toc.clientHeight) {
          var top = a.offsetTop - toc.clientHeight / 2;
          toc.scrollTo({ top: top, behavior: "smooth" });
        }
      };
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
      }, { rootMargin: "-84px 0px -70% 0px", threshold: 0 });
      heads.forEach(function (h) { io.observe(h); });
    }
  }
})();

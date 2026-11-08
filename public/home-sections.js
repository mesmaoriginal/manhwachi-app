/* home-sections.js — بخش‌های صفحه‌ی اصلی که قبلاً فقط در اپ بودند:
   آمار سریع، ادامه‌ی مطالعه، چیپ‌های ژانر، و تب‌های داغ‌ترین‌ها / جدول زمانی / جدیدترین‌ها.
   داده از همان data/data.json (تابع getManhwaData در home.js) می‌آید. */
(function () {
  'use strict';

  var WEEK = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  var PAGE = 20;
  var HISTORY_KEY = 'manhwachi_reading_history';

  var $ = function (id) { return document.getElementById(id); };
  var root = document.querySelector('.home-page');
  if (!root) return;

  /* ---------- ابزارها ---------- */
  function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function gname(g) { return (typeof genreNames !== 'undefined' && genreNames[g]) || g; }
  function normDay(s) {
    return String(s || '').replace(/[\u200c\s]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  }
  function sortable(d) {
    if (!d) return 0;
    var p = String(d).split('/').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return 0;
    return p[0] * 10000 + p[1] * 100 + p[2];
  }
  function todaySortable() {
    try {
      var parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(new Date());
      var o = {};
      parts.forEach(function (p) { o[p.type] = parseInt(p.value, 10); });
      return o.year * 10000 + o.month * 100 + o.day;
    } catch (e) { return 0; }
  }
  function todayName() { return WEEK[(new Date().getDay() + 1) % 7]; }
  function latestEp(m) {
    var best = null;
    (m.episodes || []).forEach(function (ep) {
      if (!best || sortable(ep.date) > sortable(best.date) ||
          (sortable(ep.date) === sortable(best.date) && (ep.num || 0) > (best.num || 0))) best = ep;
    });
    return best;
  }
  function score(m) { return parseFloat(m.score || m.rating || 0) || 0; }
  function title(m) { return m.title_fa || m.title_en || m.slug; }

  function countUp(el, to) {
    if (!el) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fa(to); return; }
    var t0 = performance.now(), dur = 700;
    (function tick(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fa(Math.round(to * e));
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ---------- ردیف مانهوا (برای تب‌ها) ---------- */
  function rowHtml(m, badge, showDate) {
    var ep = latestEp(m);
    var genres = (m.genres || []).slice(0, 2).map(gname).join(' • ');
    var s = score(m);
    return '<li><a class="mc-row" href="/comic/' + encodeURIComponent(m.slug) + '">' +
      '<span class="mc-row__pic"><img loading="lazy" decoding="async" src="' + (window.IMG_BASE || '') + '/manhwas/' + esc(m.slug) + '/' + esc(m.cover_image) + '" alt="' + esc(title(m)) + '"' +
      ' onerror="this.onerror=null;this.style.visibility=\'hidden\'"></span>' +
      '<span class="mc-row__body">' +
        '<span class="mc-row__title">' + esc(title(m)) + '</span>' +
        '<span class="mc-row__sub">' + esc(genres || 'مانهوا') + '</span>' +
        (showDate && ep && ep.date ? '<span class="mc-row__meta">آخرین آپدیت: ' + esc(fa(ep.date)) + '</span>' : '') +
      '</span>' +
      '<span class="mc-row__end">' +
        (badge ? '<span class="mc-row__badge">' + esc(badge) + '</span>' : '') +
        (s > 0 ? '<span class="mc-row__score">★ ' + esc(fa(s.toFixed(1))) + '</span>' : '') +
      '</span></a></li>';
  }

  function fillList(ul, btn, items, mk) {
    var shown = 0;
    function more() {
      var next = items.slice(shown, shown + PAGE);
      ul.insertAdjacentHTML('beforeend', next.map(function (m, i) { return mk(m, shown + i); }).join(''));
      shown += next.length;
      btn.hidden = shown >= items.length;
    }
    ul.innerHTML = '';
    if (!items.length) { btn.hidden = true; return; }
    btn.onclick = more;
    more();
  }

  /* ---------- رندر بخش‌ها ---------- */
  function renderStats(all) {
    var today = todaySortable();
    var todayCount = all.filter(function (m) {
      return (m.episodes || []).some(function (e) { return sortable(e.date) === today; });
    }).length;
    var freq = {};
    all.forEach(function (m) { (m.genres || []).forEach(function (g) { freq[g] = (freq[g] || 0) + 1; }); });
    var top = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; })[0];
    countUp($('mcStatTotal'), all.length);
    countUp($('mcStatToday'), todayCount);
    if ($('mcStatGenre')) $('mcStatGenre').textContent = top ? gname(top) : '—';
  }

  function renderContinue() {
    var box = $('mcContinue'), list = $('mcContinueList');
    if (!box || !list) return;
    var h = [];
    try { var r = JSON.parse(localStorage.getItem(HISTORY_KEY)); if (Array.isArray(r)) h = r; } catch (e) {}
    h = h.filter(function (x) { return x && x.slug; }).slice(0, 12);
    if (!h.length) { box.hidden = true; return; }
    box.hidden = false;
    list.innerHTML = h.map(function (x) {
      return '<li><a class="mc-cont" href="' + esc(x.url || '/comic/' + x.slug) + '">' +
        '<span class="mc-cont__pic"><img loading="lazy" decoding="async" src="' + esc(x.cover || '') + '" alt="' + esc(x.title) + '" onerror="this.style.visibility=\'hidden\'"></span>' +
        '<span class="mc-cont__title">' + esc(x.title) + '</span>' +
        '<span class="mc-cont__ch">ادامه از چپتر ' + esc(fa(x.chapter_number || 1)) + '</span></a></li>';
    }).join('');
  }

  function renderChips(all) {
    var wrap = $('mcChips');
    if (!wrap) return;
    var genres = [];
    all.forEach(function (m) { (m.genres || []).forEach(function (g) { if (genres.indexOf(g) < 0) genres.push(g); }); });
    function draw() {
      var sel = window.__mcGenre || null;
      wrap.innerHTML = ['', ...genres].map(function (g) {
        var on = (g || null) === sel;
        return '<button type="button" class="mc-chip' + (on ? ' is-on' : '') + '" data-g="' + esc(g) + '" aria-pressed="' + on + '">' + (g ? esc(gname(g)) : 'همه') + '</button>';
      }).join('');
    }
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('.mc-chip');
      if (!b) return;
      window.__mcGenre = b.dataset.g || null;
      draw();
      if (typeof renderLatestFromJSON === 'function') renderLatestFromJSON();
      if (typeof loadTopRated === 'function') loadTopRated();
    });
    draw();
  }

  function renderTrending(all) {
    var items = all.slice().sort(function (a, b) { return score(b) - score(a); });
    fillList($('mcTrendingList'), $('mcTrendingMore'), items, function (m, i) { return rowHtml(m, '#' + fa(i + 1), false); });
  }
  function renderLatest(all) {
    var items = all.filter(function (m) { return (m.episodes || []).length; })
      .sort(function (a, b) { return sortable(latestEp(b).date) - sortable(latestEp(a).date); });
    fillList($('mcLatestList'), $('mcLatestMore'), items, function (m) {
      var ep = latestEp(m); return rowHtml(m, ep ? 'چپتر ' + fa(ep.num) : '', true);
    });
  }

  function renderSchedule(all) {
    var days = $('mcDays'), sel = todayName();
    function draw() {
      days.innerHTML = WEEK.map(function (d) {
        var n = all.filter(function (m) { return normDay(m.release_day) === normDay(d); }).length;
        return '<button type="button" class="mc-day' + (d === sel ? ' is-on' : '') + (d === todayName() ? ' is-today' : '') + '" data-d="' + esc(d) + '">' +
          '<b>' + esc(d) + '</b><i>' + (n ? fa(n) + ' اثر' : '—') + '</i>' +
          (d === todayName() ? '<u>امروز</u>' : '') + '</button>';
      }).join('');
      var items = all.filter(function (m) { return normDay(m.release_day) === normDay(sel); });
      $('mcDayTitle').textContent = sel === todayName() ? sel + ' · امروز' : sel;
      $('mcDayCount').textContent = fa(items.length) + ' اثر';
      fillList($('mcScheduleList'), $('mcScheduleMore'), items, function (m) {
        var ep = latestEp(m); return rowHtml(m, ep ? 'چپتر ' + fa(ep.num) : '', true);
      });
      $('mcScheduleEmpty').hidden = items.length > 0;
    }
    days.addEventListener('click', function (e) {
      var b = e.target.closest('.mc-day');
      if (!b) return;
      sel = b.dataset.d; draw();
    });
    draw();
  }

  /* ---------- تب‌ها ---------- */
  function setTab(name) {
    root.setAttribute('data-tab', name);
    document.querySelectorAll('.mc-tab').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on);
    });
    try { history.replaceState(null, '', name === 'home' ? location.pathname + location.search : '#tab-' + name); } catch (e) {}
  }
  var tabs = document.querySelector('.mc-tabs');
  if (tabs) {
    tabs.addEventListener('click', function (e) {
      var t = e.target.closest('.mc-tab');
      if (t) setTab(t.dataset.tab);
    });
    var m = /^#tab-(trending|schedule|latest)$/.exec(location.hash);
    setTab(m ? m[1] : 'home');
  }

  /* ---------- شروع ---------- */
  renderContinue();
  var clear = $('mcContinueClear');
  if (clear) clear.addEventListener('click', function () {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    renderContinue();
  });
  window.addEventListener('pageshow', renderContinue);

  if (typeof getManhwaData !== 'function') return;
  getManhwaData().then(function (data) {
    var all = Object.keys(data).map(function (slug) { return Object.assign({ slug: slug }, data[slug]); });
    renderStats(all);
    renderChips(all);
    renderTrending(all);
    renderLatest(all);
    renderSchedule(all);
  }).catch(function (err) { console.error('home-sections:', err); });
})();

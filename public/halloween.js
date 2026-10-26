/* ManhwaChi — Halloween v3 (combined): icons/mascot/bats/ghosts + witch/spiders/lantern/eyes/lightning + genres-page icons. Load once from index.html. */
/* ManhwaChi — Halloween v2: custom Halloween SVG icons, night sky, mascot "کدوچی" with witch hat, bats, catchable ghosts. Load once from index.html. */
(function () {
  if (window.__hw) return; window.__hw = 1;
  const root = document.documentElement, KEY = 'hw-off', CK = 'hw-ghosts';
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  let off = false; try { off = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (!off) root.classList.add('hw');
  const on = () => root.classList.contains('hw');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const el = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };

  /* ---------- Halloween icons ----------
     Custom duotone SVGs: each one keeps the meaning of the original icon but wears a Halloween costume
     (bookmark = bat, history = bat clock, chat = ghost, delete = coffin, lock = skull padlock ...).
     Anything not drawn here falls back to an emoji; arrows / menu / close are left alone on purpose. */
  const C = { o: '#ff8a2b', g: '#ffd27a', p: '#a78bfa', m: '#86efac', k: '#ffb3c7' };
  const svg = (b) => `<svg class="hw-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
  const dot = (x, y, r, f) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" stroke="none"/>`;
  const WITCH = `<path d="M8 10.5 12 2l4 8.5" fill="${C.p}" fill-opacity=".35"/><path d="M5 10.8h14"/><path d="M8.9 8.3h6.2" stroke="${C.o}"/><circle cx="12" cy="15.6" r="4.4" fill="currentColor" fill-opacity=".1"/>${dot(10.3, 15.3, .8, 'currentColor')}${dot(13.7, 15.3, .8, 'currentColor')}<path d="M10.6 17.4q1.4 1 2.8 0"/>`;
  const BOOKMARK = `<path d="M6 4h12v17l-6-4.5L6 21z" fill="currentColor" fill-opacity=".14"/><path d="M6 4l1.2-2.6L10 4M14 4l2.8-2.6L18 4"/>${dot(10, 8.5, 1, C.o)}${dot(14, 8.5, 1, C.o)}<path d="M10.6 11.2l.5 1.6.5-1.6M12.4 11.2l.5 1.6.5-1.6" stroke-width="1"/>`;
  const CLOCK = `<circle cx="12" cy="13.5" r="8" fill="${C.o}" fill-opacity=".14"/><path d="M12 8.8v4.8l3.2 1.9"/><path d="M5.8 7.6 4.6 3.4l4.2 1.8M18.2 7.6l1.2-4.2-4.2 1.8" fill="currentColor" fill-opacity=".25"/>`;
  const GHOSTI = `<path d="M12 3C7.6 3 4.5 6.2 4.5 10.6V20l2.6-2 2.3 2 2.6-2 2.6 2 2.3-2 2.6 2v-9.4C19.5 6.2 16.4 3 12 3z" fill="currentColor" fill-opacity=".14"/>${dot(9.5, 10.2, 1.2, 'currentColor')}${dot(14.5, 10.2, 1.2, 'currentColor')}<path d="M10.5 13.6q1.5 1.3 3 0"/>${dot(7.6, 12.8, 1, C.k)}${dot(16.4, 12.8, 1, C.k)}`;
  const CROWN = `<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z" fill="${C.g}" fill-opacity=".3"/><path d="M4 21h16"/>${dot(12, 14.6, 1.6, C.o)}`;
  const CAMERA = `<path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4z" fill="currentColor" fill-opacity=".12"/><circle cx="12" cy="13.5" r="4"/><ellipse cx="12" cy="13.5" rx="1" ry="2.7" fill="${C.o}" stroke="none"/>`;
  const COFFIN = `<path d="M9.5 2.5h5L18 8l-2.2 13.5H8.2L6 8z" fill="currentColor" fill-opacity=".12"/><path d="M12 7v7M9.5 9.5h5" stroke="${C.g}"/>`;
  const BROOM = `<path d="M21 3 11 13"/><path d="M9.6 11.6l3.8 3.8-3.6 6.6H3.6z" fill="${C.g}" fill-opacity=".3"/><path d="M7 20l2.4-4M10 21l2.2-3.6" stroke-width="1.2"/><path d="M9.4 12.8l3 3" stroke="${C.o}"/>`;
  const MAIL = `<path d="M3.5 6h17v12h-17z" fill="currentColor" fill-opacity=".1"/><path d="m3.5 6.6 8.5 6.4 8.5-6.4"/>${dot(12, 12.9, 2.2, C.o)}`;
  const PHONE = `<rect x="6" y="2.5" width="12" height="19" rx="2.2" fill="currentColor" fill-opacity=".1"/><path d="M12 7c-1.9 0-3 1.3-3 3v5l1.2-1 1.1 1 .7-1 .7 1 1.1-1L15 15v-5c0-1.7-1.1-3-3-3z" fill="#fff" fill-opacity=".85" stroke="none"/>${dot(11, 10.5, .7, '#2b1b45')}${dot(13, 10.5, .7, '#2b1b45')}`;
  const CAL = `<rect x="4" y="5.5" width="16" height="15" rx="2.5" fill="currentColor" fill-opacity=".1"/><path d="M4 10h16M8 3.5v4M16 3.5v4"/><path d="M13.6 12.2a3.2 3.2 0 1 0 2.6 4.6 3.6 3.6 0 0 1-2.6-4.6z" fill="${C.g}" stroke="none"/>`;
  const COPY = `<path d="M5 16V3.5h11"/><path d="M8 8h11v13H8z" fill="currentColor" fill-opacity=".1"/><path d="M19 8v5M19 8h-5M19 8l-4.5 4.5M19 11.2q-3.4 0-4.4-3.2" stroke="${C.p}" stroke-width="1.1"/>`;
  const DOOR = `<path d="M3.5 21V10a5 5 0 0 1 10 0v11zM3.5 21h10" fill="currentColor" fill-opacity=".1"/>${dot(10.6, 15.5, .9, C.o)}<path d="M16 12h5.5M19 9.5l2.5 2.5-2.5 2.5" stroke="${C.g}"/>`;
  const LOCK = `<path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><rect x="5.5" y="10" width="13" height="11" rx="2" fill="currentColor" fill-opacity=".12"/>${dot(9.6, 14.2, 1.3, C.o)}${dot(14.4, 14.2, 1.3, C.o)}<path d="M12 16l-.7 1.6h1.4z" fill="currentColor"/><path d="M10 19.3h4" stroke-width="1.2"/>`;
  const SEARCH = `<circle cx="10.5" cy="10.5" r="6.5" fill="currentColor" fill-opacity=".1"/><path d="M15.5 15.5 21 21"/><path d="M12.2 7.6a3.4 3.4 0 1 0 2.6 4.6 3.8 3.8 0 0 1-2.6-4.6z" fill="${C.g}" stroke="none"/>`;
  const CANDLE = `<path d="M12 1.8c1.6 2 2.2 3.3 2.2 4.4a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.4 2.2-4.4z" fill="${C.o}" stroke="none"/><rect x="8.5" y="10.5" width="7" height="10.5" rx="1" fill="currentColor" fill-opacity=".12"/><path d="M12 8.8v1.7M10.2 10.5v3"/>`;
  const HOUSE = `<path d="M3.5 11 12 3.5 20.5 11"/><path d="M5.5 9.8v10.7h13V9.8" fill="currentColor" fill-opacity=".1"/><path d="M10 20.5v-4a2 2 0 0 1 4 0v4"/><path d="M16 7.2V4.5h2V8.8"/><rect x="7.3" y="12.3" width="2.2" height="2.2" fill="${C.o}" stroke="none"/>`;
  const STAR = `<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z" fill="${C.g}" fill-opacity=".35"/>`;
  const HEART = `<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.5 2.2C20.5 15 12 20.5 12 20.5z" fill="${C.o}" fill-opacity=".3"/><path d="M9 10.2l2 2M11 10.2l-2 2M13.5 13.2l1.6 1.6M15.1 13.2l-1.6 1.6" stroke="${C.g}" stroke-width="1.1"/>`;
  const EYE = `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="currentColor" fill-opacity=".1"/><ellipse cx="12" cy="12" rx="1.6" ry="3.8" fill="${C.o}" stroke="none"/>`;
  const FIRE = `<path d="M12 2.5c.5 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2 1-3.2 2-4 0 1.5.8 2.3 1.6 2.3C11 8.5 11 5.2 12 2.5z" fill="${C.o}" fill-opacity=".35"/><path d="M12 20a2.3 2.3 0 0 1-2.3-2.3c0-1.5 1.3-2 2.3-3.6 1 1.6 2.3 2.1 2.3 3.6A2.3 2.3 0 0 1 12 20z" fill="${C.g}" stroke="none"/>`;
  const BOLT = `<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" fill="${C.p}" fill-opacity=".4"/>`;
  const POTION = `<path d="M10.5 3h3M10.8 3v5L5.7 17A3 3 0 0 0 8.3 21.5h7.4A3 3 0 0 0 18.3 17L13.2 8V3"/><path d="M7.4 14.5h9.2l1.7 2.9a2 2 0 0 1-1.8 3.1H7.5a2 2 0 0 1-1.8-3.1z" fill="${C.m}" fill-opacity=".5" stroke="none"/>${dot(10.5, 17.2, .9, C.m)}${dot(14, 18.6, .7, C.m)}`;
  const CANDY = `<circle cx="12" cy="12" r="5.5" fill="${C.k}" fill-opacity=".4"/><path d="M9 10.2c2-1.4 4.5-1 6 1.2"/><path d="M6.5 12 2.5 9v6zM17.5 12l4-3v6z" fill="${C.p}" fill-opacity=".4"/>`;
  const BELL = `<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" fill="currentColor" fill-opacity=".1"/><path d="M10 21a2 2 0 0 0 4 0"/>${dot(18, 5, 2.2, C.o)}`;
  const WAND = `<path d="M4 20 15 9" stroke-width="2.4"/><path d="M18.5 3v4M16.5 5h4M20.5 11v2M19.5 12h2" stroke="${C.g}"/>`;
  const SKULL = `<path d="M12 3a7.5 7.5 0 0 0-4.5 13.5V20h9v-3.5A7.5 7.5 0 0 0 12 3z" fill="currentColor" fill-opacity=".1"/>${dot(9.2, 11, 1.7, C.o)}${dot(14.8, 11, 1.7, C.o)}<path d="M12 13.6l-.9 1.9h1.8z" fill="currentColor"/><path d="M10.5 20v-2.3M13.5 20v-2.3" stroke-width="1.2"/>`;
  const SPELL = `<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z" fill="currentColor" fill-opacity=".1"/><path d="M12 6.5v13"/><path d="m8 9.4.6 1.3 1.4.2-1 1 .2 1.4-1.2-.7-1.2.7.2-1.4-1-1 1.4-.2z" fill="${C.g}" stroke="none"/>`;
  const BALL = `<circle cx="12" cy="10.5" r="7" fill="${C.p}" fill-opacity=".28"/><path d="M7 20.5h10l-1.6-3.3H8.6z" fill="currentColor" fill-opacity=".15"/><path d="M8.6 8.4a4 4 0 0 1 2.8-2.2" stroke="#fff" stroke-opacity=".8"/>`;
  const MOON = `<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="${C.g}" fill-opacity=".45"/><path d="M17.5 3.5v3M16 5h3" stroke="${C.g}"/>`;

  const D = {
    person: WITCH, account_circle: WITCH, manage_accounts: WITCH + `<path d="M19.5 3.5v3M18 5h3" stroke="${C.g}"/>`,
    bookmark: BOOKMARK, bookmarks: BOOKMARK, bookmark_added: BOOKMARK, bookmark_border: BOOKMARK,
    history: CLOCK, schedule: CLOCK, chat: GHOSTI, comment: GHOSTI, forum: GHOSTI,
    workspace_premium: CROWN, photo_camera: CAMERA, delete: COFFIN, delete_sweep: BROOM,
    mail: MAIL, email: MAIL, smartphone: PHONE, phone: PHONE, calendar_month: CAL, event: CAL, content_copy: COPY,
    logout: DOOR, login: DOOR, lock: LOCK, key: LOCK, search: SEARCH, info: CANDLE, light_mode: CANDLE, new_releases: CANDLE,
    home: HOUSE, star: STAR, star_rate: STAR, favorite: HEART, thumb_up: HEART, visibility: EYE,
    local_fire_department: FIRE, trending_up: FIRE, bolt: BOLT, settings: POTION, category: CANDY, notifications: BELL,
    edit: WAND, warning: SKULL, error: SKULL, menu_book: SPELL, book: SPELL, auto_stories: SPELL, library_books: SPELL,
    help: BALL, dark_mode: MOON
  };
  const ICONS = { // emoji fallback
    explore: '🧭', download: '🍬', share: '🕸️', thumb_down: '💀', check_circle: '🍬', verified: '🧿', filter_list: '🧪',
    shopping_cart: '🎃', redeem: '🎁', support_agent: '🧛', group: '👥', diversity_3: '👥'
  };
  const clear = (e) => { delete e.dataset.hwK; delete e.dataset.hwE; delete e.dataset.hwO; e.classList.remove('hw-ico', 'hw-s'); };
  const swap = (e) => {
    const k = e.dataset.hwK;
    if (k === 's' && e.firstElementChild && e.firstElementChild.classList.contains('hw-svg')) return;
    if (k === 'e' && e.textContent.trim() === e.dataset.hwE) return;
    if (e.children.length) return;
    const t = e.textContent.trim();
    if (D[t]) { e.dataset.hwK = 's'; e.dataset.hwO = t; e.innerHTML = svg(D[t]); e.classList.add('hw-ico', 'hw-s'); }
    else if (ICONS[t]) { e.dataset.hwK = 'e'; e.dataset.hwO = t; e.dataset.hwE = ICONS[t]; e.textContent = ICONS[t]; e.classList.add('hw-ico'); e.classList.remove('hw-s'); }
    else if (k) clear(e);
  };
  const scan = () => document.querySelectorAll('.material-symbols-outlined,.material-symbols-rounded,.material-symbols-sharp,.material-icons').forEach(swap);
  const unscan = () => document.querySelectorAll('[data-hw-k]').forEach((e) => {
    if (e.dataset.hwK === 's' ? e.querySelector('.hw-svg') : e.textContent === e.dataset.hwE) e.textContent = e.dataset.hwO;
    clear(e);
  });

  /* ---------- content ---------- */
  const LINES = ['بوووو! نترس، من کدوچی‌ام 🎃', 'امشب یه مانهوای ترسناک بخون!', 'چپتر بعدی رو نخونی، کدو می‌شی!', 'من فقط آب‌نبات می‌خورم، مغز نه 🍬', 'ظاهرم ترسناکه ولی قول می‌دم مهربونم 😇', 'یه ژانر پیدا کن، من پیشتم!', 'قلقلکم نده، خنده‌م می‌گیره 🤭', 'به نظرت کدوم مانهوا ترسناک‌تره؟ 👻', 'روح‌های کوچولو رو بگیر، امتیاز داره! 👻', 'خفاش‌ها دارن میان... سرتو بدزد 🦇', 'شب هالووین بدون مانهوا؟ نچ نچ 🕯️', 'کلاه جادوگریم بهم میاد؟ 🧙‍♀️'];
  const PROFILE = ['بیا ببینم چی خوندی! 👀', 'تاریخچه‌ت پر از چپترای باحاله 📜', 'VIP بشی، جادوگرا بهت حسودی می‌کنن 🧙‍♀️', 'عکس پروفایلت رو جادویی کن 🔮'];
  const GHOST = '<svg viewBox="0 0 40 48"><path d="M20 2C9 2 4 11 4 22v22l6-5 5 5 5-5 5 5 5-5 6 5V22C36 11 31 2 20 2z" fill="#fff"/><circle cx="14" cy="22" r="2.4" fill="#2b1b45"/><circle cx="26" cy="22" r="2.4" fill="#2b1b45"/><ellipse cx="20" cy="29" rx="2.2" ry="2.8" fill="#2b1b45"/><circle cx="9.5" cy="27" r="2.6" fill="#ffb3c7"/><circle cx="30.5" cy="27" r="2.6" fill="#ffb3c7"/></svg>';
  const BAT = '<svg viewBox="0 0 60 30"><g fill="#2d1b4e" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1"><path class="wl" d="M30 15C24 5 14 3 3 8c4 2 5 5 4 9 3-2 6-2 8 1 2-3 5-3 8-1 3-1 5-1 7-2z"/><path class="wr" d="M30 15C36 5 46 3 57 8c-4 2-5 5-4 9-3-2-6-2-8 1-2-3-5-3-8-1-3-1-5-1-7-2z"/><ellipse cx="30" cy="17" rx="5" ry="7"/><path d="M26 12l1-7 3 4 3-4 1 7z"/></g><circle cx="28" cy="15" r="1.2" fill="#ff8a2b"/><circle cx="32" cy="15" r="1.2" fill="#ff8a2b"/></svg>';
  const PUMPKIN = `<svg viewBox="0 -26 100 116">
    <ellipse cx="50" cy="86" rx="30" ry="4" fill="rgba(0,0,0,.3)"/>
    <ellipse cx="29" cy="52" rx="24" ry="30" fill="#ff7a18"/><ellipse cx="71" cy="52" rx="24" ry="30" fill="#ff7a18"/>
    <ellipse cx="50" cy="52" rx="24" ry="32" fill="#ffa03a"/>
    <path d="M50 22v60M36 25c-6 14-6 38 0 54M64 25c6 14 6 38 0 54" stroke="#e8590c" stroke-width="2" fill="none" opacity=".5"/>
    <g class="hw-hat"><ellipse cx="50" cy="22" rx="31" ry="6.5" fill="#5a3aa3"/><path d="M34 21Q41 4 47 -12Q51 -25 62 -19Q54 -11 58 0Q62 11 67 21Z" fill="#7a56d6"/><path d="M34 21Q50 27 67 21L65 14Q50 19 36 14Z" fill="#ff8a2b"/><rect x="46" y="14.500" width="8" height="8" rx="1.500" fill="#ffd27a" transform="rotate(-6 50 18)"/><rect x="48.500" y="17" width="3" height="3" fill="#7a56d6" transform="rotate(-6 50 18)"/><circle cx="48" cy="-2" r="1.600" fill="#ffd27a"/><circle cx="55" cy="7" r="1.200" fill="#ffd27a"/></g>
    <g class="hw-eyes"><ellipse cx="38" cy="50" rx="7" ry="8.5" fill="#2b1b45"/><ellipse cx="62" cy="50" rx="7" ry="8.5" fill="#2b1b45"/>
      <circle cx="40" cy="47" r="2.6" fill="#fff"/><circle cx="64" cy="47" r="2.6" fill="#fff"/>
      <ellipse class="hw-lid" cx="38" cy="50" rx="7.5" ry="9" fill="#ffa03a"/><ellipse class="hw-lid" cx="62" cy="50" rx="7.5" ry="9" fill="#ffa03a"/></g>
    <circle cx="27" cy="62" r="5" fill="#ff7a8a" opacity=".6"/><circle cx="73" cy="62" r="5" fill="#ff7a8a" opacity=".6"/>
    <path d="M42 63q8 9 16 0" stroke="#2b1b45" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M47 67.5h6l-3 5z" fill="#fff"/></svg>`;

  /* ---------- particles ---------- */
  const burst = (x, y, list, n) => {
    if (calm) return;
    for (let i = 0; i < n; i++) {
      const s = el('span', 'hw-pop', pick(list)); s.style.left = x + 'px'; s.style.top = y + 'px';
      const a = rnd(0, 6.283), d = rnd(40, 110);
      s.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d - 30}px)) scale(1.1) rotate(${rnd(-120, 120)}deg)`, opacity: 0 }], { duration: rnd(700, 1100), easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
    }
  };

  function build() {
    /* night sky */
    const sky = el('div', 'hw-sky', '<i class="hw-moon"></i><i class="hw-stars a"></i><i class="hw-stars b"></i><div class="hw-fog"></div>');
    const stars = (n) => Array.from({ length: n }, () => `${rnd(0, 100).toFixed(1)}vw ${rnd(0, 100).toFixed(1)}vh 0 ${rnd(0, 1.1).toFixed(1)}px rgba(255,235,200,${rnd(.4, .9).toFixed(2)})`).join(',');
    sky.querySelector('.a').style.boxShadow = stars(innerWidth < 768 ? 30 : 60);
    sky.querySelector('.b').style.boxShadow = stars(innerWidth < 768 ? 24 : 50);

    /* icons */
    if (on()) scan();
    let q = 0;
    const HW_NOISE = '.hw-pop,.hw-say,.hw-count,.hw-mascot,.hw-sky,.hw-scene,.hw-bat,.hwg,.hw-witch,.hw-peek,.hw-flash,.hw-lantern,.k-chip,.k-float,.k-orb,.k6-p,.k6-c,.k6-hud,.k6-panel,.k-dark,.k-lost,.k-parade,.k-spider';
    const hwNoisy = window.__hwNoisy = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest && e.closest(HW_NOISE)); };
    new MutationObserver((recs) => {
      if (q || !on()) return;
      /* PERF: ignore the theme's own DOM churn (sparkles, bubbles, bats...) so scan() doesn't re-run for each one */
      if (recs.every((r) => hwNoisy(r.target) && Array.prototype.every.call(r.addedNodes, hwNoisy))) return;
      q = requestAnimationFrame(() => { q = 0; scan(); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    /* mascot */
    const m = el('div', 'hw-mascot', PUMPKIN + '<div class="hw-say"></div>');
    const say = m.querySelector('.hw-say'); let tmr;
    const speak = (t) => {
      const pool = LINES.concat(document.querySelector('.profile') ? PROFILE : []);
      say.textContent = t || pick(pool); say.classList.add('show'); clearTimeout(tmr); tmr = setTimeout(() => say.classList.remove('show'), 4200);
    };
    let pokes = 0, pokeT;
    m.addEventListener('click', (e) => {
      m.classList.remove('jump', 'dizzy'); void m.offsetWidth;
      pokes++; clearTimeout(pokeT); pokeT = setTimeout(() => { pokes = 0; }, 2000);
      if (pokes >= 6) { pokes = 0; m.classList.add('dizzy'); speak(pick(['سرم گیج رفت 😵‍💫 بیا، آب‌نبات بگیر ببخشمت!', 'دنیا داره دور سرم می‌چرخه 🌀 ... خوشم اومد، دوباره!', 'وایسا! من کدوام، قرقره نیستم 😵'])); burst(e.clientX, e.clientY, ['🍬', '🍭', '🍫', '🎃'], 14); }
      else { m.classList.add('jump'); speak(); burst(e.clientX, e.clientY, ['✨', '🍬', '🦇'], 5); }
    });

    const toggle = el('button', 'hw-toggle', '✕'); toggle.type = 'button'; toggle.title = 'خاموش / روشن کردن هالووین'; toggle.setAttribute('aria-label', toggle.title);
    if (off) toggle.textContent = '🎃';

    /* ghost counter */
    let caught = 0; try { caught = +localStorage.getItem(CK) || 0; } catch (e) {}
    const badge = el('div', 'hw-count', '');
    const showCount = () => { badge.textContent = '👻 ' + fa(caught); badge.classList.toggle('on', caught > 0); badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); };
    if (caught) showCount();
    const MILE = { 1: 'اولین روحت! 👻 بقیه دارن از ترس می‌لرزن', 5: 'پنج‌تا روح؟! دارم از تو می‌ترسم 😳', 15: 'تو دیگه شکارچی روحی! 🏹 ارواح اسمت رو تو لیست سیاه نوشتن', 30: 'روح‌ها دارن اسباب‌کشی می‌کنن، از دستت فرار می‌کنن 😱', 60: 'استاد بزرگ هالووین 👑🎃 کلاهم رو برمی‌دارم... یعنی اگه می‌تونستم' };

    /* ghosts */
    if (!calm) for (let i = 0; i < (innerWidth < 768 ? 1 : (window.HW_LOUD ? 4 : 2)); i++) {
      const g = el('div', 'hwg', GHOST);
      g.style.left = (8 + i * 26 + rnd(-4, 4)) + '%'; g.style.setProperty('--d', rnd(28, 42) + 's'); g.style.setProperty('--w', (i * 7) + 's'); g.style.width = rnd(26, 40) + 'px';
      g.addEventListener('animationiteration', (e) => { if (e.animationName === 'hwRise') g.classList.remove('gone'); });
      g.addEventListener('click', (e) => {
        e.stopPropagation(); const r = g.getBoundingClientRect(); g.classList.add('gone');
        burst(r.left + r.width / 2, r.top + r.height / 2, ['👻', '💜', '✨', '🍬'], 8);
        caught++; try { localStorage.setItem(CK, caught); } catch (er) {} showCount();
        speak(MILE[caught] || pick(['بووو! گرفتیش 👻', 'یه روح کمتر! 👻 بدبخت فکر می‌کرد قایم شده', 'اوه! از چنگت فرار نمی‌کنن 😎👻', 'گرفتیش! 👻 حالا باید بهش آب‌نبات بدی که قهر نکنه']));
      });
    }

    toggle.addEventListener('click', () => {
      const h = root.classList.toggle('hw'); toggle.textContent = h ? '✕' : '🎃';
      if (h) scan(); else unscan();
      try { localStorage.setItem(KEY, h ? '0' : '1'); } catch (e) {}
    });

    /* bats */
    const flyBat = () => {
      if (!on() || document.hidden || calm) return;
      const n = window.HW_LOUD ? 1 + ((Math.random() * 3) | 0) : 1, ltr = Math.random() < .5;
      for (let i = 0; i < n; i++) setTimeout(() => {
        const b = el('div', 'hw-bat', BAT); b.style.top = rnd(14, 58) + 'vh'; b.style.width = rnd(34, 56) + 'px';
        if (!ltr) b.firstChild.style.transform = 'scaleX(-1)';
        const W = innerWidth + 120, from = ltr ? -80 : W - 60, to = ltr ? W - 60 : -80;
        b.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: rnd(8000, 13000), easing: 'linear' }).onfinish = () => b.remove();
      }, i * 700);
    };
    if (window.HW_LOUD) setTimeout(flyBat, 5000); (function loop() { setTimeout(() => { flyBat(); loop(); }, window.HW_LOUD ? rnd(14000, 26000) : rnd(90000, 160000)); })();

    /* sparkle trail (mouse only) */
    if (fine && !calm && window.HW_LOUD) {
      let last = 0;
      addEventListener('pointermove', (e) => {
        if (!on() || e.pointerType !== 'mouse') return; const t = performance.now(); if (t - last < 120) return; last = t;
        const s = el('span', 'hw-pop', Math.random() < .2 ? '🍬' : '✨'); s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; s.style.fontSize = rnd(10, 15) + 'px';
        s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: .9 }, { transform: `translate(calc(-50% + ${rnd(-14, 14)}px),calc(-50% + 26px)) scale(.3)`, opacity: 0 }], { duration: 750, easing: 'ease-out' }).onfinish = () => s.remove();
      }, { passive: true });
    }

    /* eyes follow the pointer */
    addEventListener('pointermove', (e) => {
      const _t = performance.now(); if (_t - (window.__hwPm1 || 0) < 50) return; window.__hwPm1 = _t;
      const r = m.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 200);
      m.style.setProperty('--ex', (dx / d * 4 * k).toFixed(1) + 'px'); m.style.setProperty('--ey', (dy / d * 4 * k).toFixed(1) + 'px');
    }, { passive: true });

    /* greet once per session, then chat now and then */
    let seen = false; try { seen = localStorage.getItem('hw-hi') === '1'; localStorage.setItem('hw-hi', '1'); } catch (e) {}
    if (!seen && on()) setTimeout(() => speak(pick(['سلام! هالووینت مبارک 🎃 من کدوچی‌ام، کدوی شب‌های مانهوا', 'بوووو! 👻 شوخی کردم، خوش اومدی 🧡', 'اووه، مهمون! بفرما، چراغ‌ها رو روشن نگه داشتم 🕯️'])), 1600);
    if (window.HW_LOUD) setInterval(() => { if (on() && !document.hidden && Math.random() < .6) speak(); }, 50000);
  }
  if (document.body) build(); else addEventListener('DOMContentLoaded', build);
})();

/* ===== v3 plus ===== */
/* ManhwaChi — Halloween v3 (additive). Load AFTER halloween.js. Safe to remove: v2 keeps working on its own.
   Adds: haunted-village skyline + embers, witch flying across the moon (tap her for candy rain),
   hanging spiders in the header (tap to make them climb), lantern cursor glow, eyes watching from the dark,
   rare lightning, bat swarm on first visit, Halloween countdown spoken by the mascot. */
(function () {
  if (window.__hwPlus) return; window.__hwPlus = 1;
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const on = () => root.classList.contains('hw');
  const live = () => on() && !document.hidden && !calm;
  const mk = (tag, cls, html, parent) => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; (parent || document.body).appendChild(e); return e; };
  const every = (fn, a, b) => { (function loop() { setTimeout(() => { fn(); loop(); }, rnd(a, b)); })(); };

  /* ---------- artwork ---------- */
  const win = (x, y, w, h, d) => `<rect class="hw-win" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" style="animation-delay:${d}s"/>`;
  const LAND = `<svg class="hw-land" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <path d="M0 190Q150 140 320 175T640 160T960 172T1200 150V240H0Z" fill="#170d30"/>
    <g fill="#0d0720" stroke="#a78bfa" stroke-opacity=".25">
      <rect x="850" y="112" width="110" height="62"/><path d="M840 114 905 62l65 52z"/><rect x="968" y="82" width="28" height="92"/><path d="M962 84 982 46l20 38z"/><rect x="870" y="70" width="10" height="26"/>
    </g>
    ${win(868, 128, 12, 16, 0)}${win(892, 128, 12, 16, -1.3)}${win(916, 128, 12, 16, -2.6)}${win(940, 128, 12, 16, -.7)}${win(977, 100, 9, 14, -2)}
    <circle class="hw-win" cx="905" cy="92" r="6" style="animation-delay:-3s"/>
    <rect x="897" y="150" width="14" height="24" fill="#1b0e33"/>
    <path d="M150 215V140M150 176 120 150 108 122M150 160 182 138 196 108M120 150 100 148M182 138 206 142M108 122 96 112" stroke="#0d0720" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M0 215Q200 185 420 205T820 200T1200 210V240H0Z" fill="#0a0514"/>
    <g fill="#0f0724" stroke="#a78bfa" stroke-opacity=".3">
      <path d="M300 212V190a10 10 0 0 1 20 0v22z"/><path d="M430 213V194a9 9 0 0 1 18 0v19z"/><path d="M472 210V198a7 7 0 0 1 14 0v12z"/>
    </g>
    <path d="M380 212V176M370 186H390" stroke="#0f0724" stroke-width="5" stroke-linecap="round"/>
    <g class="hw-win"><ellipse cx="640" cy="214" rx="15" ry="11"/></g>
    <g class="hw-win" style="animation-delay:-2s"><ellipse cx="702" cy="212" rx="11" ry="8.500"/></g>
    <path d="M633 211l4-5 3 5zM645 211l4-5 3 5zM634 218q6 4 12 0" fill="#0a0514" stroke="#0a0514" stroke-width="1.5"/>
  </svg>`;
  const SPIDER = `<svg viewBox="0 0 30 34" aria-hidden="true"><g stroke="#a78bfa" stroke-width="1.4" fill="none" stroke-linecap="round"><path d="M10 19Q3 15 4 8M10 22Q2 22 3 30M11 25Q6 30 8 33M11 17Q6 11 9 5M20 19Q27 15 26 8M20 22Q28 22 27 30M19 25Q24 30 22 33M19 17Q24 11 21 5"/></g><circle cx="15" cy="23" r="6.500" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.200"/><circle cx="15" cy="14.500" r="4.200" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.200"/><circle cx="13.300" cy="14" r="1.100" fill="#ff8a2b"/><circle cx="16.700" cy="14" r="1.100" fill="#ff8a2b"/><path d="M15 19v8" stroke="#ff8a2b" stroke-width="1.600" stroke-linecap="round"/></svg>`;
  const WITCH = `<svg viewBox="-8 -12 106 70" aria-hidden="true">
    <path d="M14 38 0 30M14 38-3 38M14 38 0 46" stroke="#d9a441" stroke-width="2.600" stroke-linecap="round"/>
    <path d="M12 38 76 30" stroke="#8b5a2b" stroke-width="3.200" stroke-linecap="round"/>
    <path d="M36 35Q39 19 50 19Q57 23 59 33z" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.100"/>
    <path d="M50 28 66 31" stroke="#1b0e33" stroke-width="3.500" stroke-linecap="round"/>
    <circle cx="52" cy="14" r="5" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.100"/>
    <path d="M47 15Q40 19 36 28M47 17Q42 23 41 31" stroke="#ff8a2b" stroke-width="2.200" fill="none" stroke-linecap="round"/>
    <path d="M44 10 53-10 61 10z" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.100" stroke-linejoin="round"/>
    <ellipse cx="52.500" cy="10.500" rx="12" ry="2.800" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.100"/>
    <path d="M45 8.500Q53 6 60 8.500" stroke="#ff8a2b" stroke-width="1.800" fill="none"/>
    <path d="M30 27 27 19 33 23zM36 25 36 17 41 22z" fill="#1b0e33" stroke="#a78bfa" stroke-width=".9" stroke-linejoin="round"/>
  </svg>`;
  const PEEK = '<svg viewBox="0 0 40 16"><g fill="#d7ff5e"><ellipse cx="10" cy="8" rx="5.500" ry="3.400"/><ellipse cx="30" cy="8" rx="5.500" ry="3.400"/></g><g fill="#1a1030"><ellipse cx="10" cy="8" rx="1.200" ry="3"/><ellipse cx="30" cy="8" rx="1.200" ry="3"/></g></svg>';
  const BAT = '<svg viewBox="0 0 60 30"><g fill="#2d1b4e" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1"><path class="wl" d="M30 15C24 5 14 3 3 8c4 2 5 5 4 9 3-2 6-2 8 1 2-3 5-3 8-1 3-1 5-1 7-2z"/><path class="wr" d="M30 15C36 5 46 3 57 8c-4 2-5 5-4 9-3-2-6-2-8 1-2-3-5-3-8-1-3-1-5-1-7-2z"/><ellipse cx="30" cy="17" rx="5" ry="7"/><path d="M26 12l1-7 3 4 3-4 1 7z"/></g><circle cx="28" cy="15" r="1.200" fill="#ff8a2b"/><circle cx="32" cy="15" r="1.200" fill="#ff8a2b"/></svg>';

  /* ---------- helpers ---------- */
  const spark = (x, y) => {
    const s = mk('span', 'hw-pop', pick(['✦', '✧', '✨', '·']));
    s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.fontSize = rnd(10, 18) + 'px'; s.style.color = pick(['#ffc069', '#a78bfa', '#ffb3c7', '#86efac']);
    s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: .95 }, { transform: `translate(calc(-50% + ${rnd(-10, 10)}px),calc(-50% + ${rnd(20, 40)}px)) scale(.2)`, opacity: 0 }], { duration: rnd(700, 1100), easing: 'ease-out' }).onfinish = () => s.remove();
  };
  const rain = (n) => {
    if (calm) return;
    for (let i = 0; i < n; i++) {
      const s = mk('span', 'hw-pop', pick(['🍬', '🍭', '🍫', '🎃', '🧁', '🦇']));
      s.style.left = rnd(2, 98) + 'vw'; s.style.top = '-40px'; s.style.fontSize = rnd(16, 30) + 'px';
      s.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: `translateY(${innerHeight + 80}px) rotate(${rnd(-300, 300)}deg)`, opacity: .95 }],
        { duration: rnd(2400, 4400), delay: i * 90, easing: 'cubic-bezier(.4,.1,.7,.6)', fill: 'both' }).onfinish = () => s.remove();
    }
  };
  const moonPos = () => {
    const m = document.querySelector('.hw-moon'), W = innerWidth;
    if (m) { const r = m.getBoundingClientRect(); if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    return { x: W * .88, y: 120 };
  };

  /* ---------- witch over the moon ---------- */
  const flyWitch = () => {
    if (!live()) return;
    const W = innerWidth, mp = moonPos(), w = mk('div', 'hw-witch', WITCH), half = w.offsetWidth / 2 || 44;
    const k = (x, y, r, o) => ({ transform: `translate(${x}px,${y}px) rotate(${r}deg)`, offset: o });
    const a = w.animate([k(-140, mp.y + 120, -6, 0), k(mp.x * .45, mp.y + 40, -11, .4), k(mp.x - half, mp.y - 34, -3, .78), k(W + 140, mp.y - 130, -12, 1)], { duration: 12000, easing: 'linear' });
    const t = setInterval(() => { const r = w.getBoundingClientRect(); spark(r.left + 8, r.top + r.height * .68); }, 120);
    const done = () => { clearInterval(t); w.remove(); };
    a.onfinish = done; a.oncancel = done;
    w.addEventListener('click', (e) => { e.stopPropagation(); rain(18); });
  };

  /* ---------- bats leaving the moon ---------- */
  const swarm = () => {
    if (!live()) return;
    const mp = moonPos(), W = innerWidth, H = innerHeight;
    for (let i = 0; i < 9; i++) setTimeout(() => {
      const b = mk('div', 'hw-bat', BAT), x = rnd(-60, W - 40), y = rnd(-10, H * .55);
      b.style.top = '0'; b.style.width = rnd(30, 50) + 'px';
      b.animate([
        { transform: `translate(${mp.x}px,${mp.y}px) scale(.25)`, opacity: 0 },
        { opacity: 1, offset: .15 },
        { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1, offset: .78 },
        { transform: `translate(${x + rnd(-90, 90)}px,${y - 140}px) scale(1)`, opacity: 0 }
      ], { duration: rnd(3200, 4800), easing: 'ease-out' }).onfinish = () => b.remove();
    }, i * 120);
  };

  /* ---------- eyes in the dark ---------- */
  const peek = () => {
    if (!live()) return;
    const e = mk('div', 'hw-peek', PEEK), left = Math.random() < .5;
    e.style[left ? 'left' : 'right'] = rnd(.5, 3) + 'vw'; e.style.top = rnd(42, 88) + 'vh';
    e.animate([{ opacity: 0 }, { opacity: .9, offset: .15 }, { opacity: .9, transform: 'scaleY(1)', offset: .45 }, { transform: 'scaleY(.08)', offset: .5 }, { transform: 'scaleY(1)', offset: .55 }, { opacity: .9, offset: .85 }, { opacity: 0 }], { duration: 4200 }).onfinish = () => e.remove();
  };

  /* ---------- lightning ---------- */
  const flash = () => {
    if (!live()) return;
    const f = mk('div', 'hw-flash');
    f.animate([{ opacity: 0 }, { opacity: .5, offset: .08 }, { opacity: .05, offset: .22 }, { opacity: .35, offset: .34 }, { opacity: 0 }], { duration: 750 }).onfinish = () => f.remove();
  };

  /* ---------- countdown (spoken by the mascot) ---------- */
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(now.getFullYear(), 9, 31) - today) / 864e5);
  const LINE = days === 0 ? 'امشب شب هالووینه! 🎃👻🦇' : days === 1 ? 'فقط یه شب تا هالووین مونده! 🎃' : days > 1 && days < 40 ? fa(days) + ' شب تا هالووین مونده! 🎃' : '';
  const hookMascot = (n) => {
    const m = document.querySelector('.hw-mascot');
    if (!m) { if (n < 25) setTimeout(() => hookMascot(n + 1), 200); return; }
    const say = m.querySelector('.hw-say'); if (!LINE || !say) return;
    m.addEventListener('click', () => { if (Math.random() < .3) setTimeout(() => { say.textContent = LINE; say.classList.add('show'); }, 0); });
  };

  /* ---------- build ---------- */
  function init() {
    /* skyline + embers + vignette */
    const sc = mk('div', 'hw-scene', LAND + '<div class="hw-embers"><i></i><i></i><i></i></div>');
    const sh = (n, rgb) => Array.from({ length: n }, () => `${rnd(0, 100).toFixed(1)}vw ${rnd(30, 105).toFixed(1)}vh 0 ${rnd(0, 1).toFixed(1)}px rgba(${rgb},${rnd(.35, .9).toFixed(2)})`).join(',');
    const small = innerWidth < 768, e = sc.querySelectorAll('.hw-embers i');
    e[0].style.boxShadow = sh(small ? 8 : 16, '255,138,43'); e[1].style.boxShadow = sh(small ? 6 : 11, '255,200,120'); e[2].style.boxShadow = sh(small ? 4 : 8, '167,139,250');

    /* spiders dangling from the header */
    const header = document.querySelector('header.sticky, #header, header');
    if (header) {
      if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
      [['14%', 58, ''], ['31%', 92, 's2']].forEach(([x, L, c], i) => {
        const s = mk('div', 'hw-spider ' + c, SPIDER, header);
        s.style.setProperty('--x', x); s.style.setProperty('--L', L + 'px'); s.style.animationDelay = (-i * 1.7) + 's';
        s.addEventListener('click', (ev) => { ev.stopPropagation(); s.classList.add('up'); setTimeout(() => s.classList.remove('up'), 1500); });
      });
    }

    /* lantern glow */
    if (fine && !calm && window.HW_LOUD) {
      const l = mk('div', 'hw-lantern'); let px = 0, py = 0, q = 0;
      addEventListener('pointermove', (ev) => {
        if (ev.pointerType !== 'mouse') return; px = ev.clientX; py = ev.clientY; l.classList.add('on');
        if (!q) q = requestAnimationFrame(() => { q = 0; l.style.transform = `translate3d(${px}px,${py}px,0)`; });
      }, { passive: true });
      document.addEventListener('mouseleave', () => l.classList.remove('on'));
    }

    hookMascot(0);

    /* scheduled magic */
    let first = true; try { first = sessionStorage.getItem('hw-swarm') !== '1'; sessionStorage.setItem('hw-swarm', '1'); } catch (er) {}
    const L = !!window.HW_LOUD;
    if (first && L) setTimeout(swarm, 2600);
    if (days === 0 && L) setTimeout(() => rain(40), 2000);
    setTimeout(flyWitch, L ? (days === 0 ? 3500 : 9000) : 45000); every(flyWitch, L ? 35000 : 240000, L ? 60000 : 420000);
    if (L) setTimeout(peek, 7000); every(peek, L ? 12000 : 200000, L ? 25000 : 360000);
    if (L) every(flash, 45000, 90000);
  }
  if (document.body) init(); else addEventListener('DOMContentLoaded', init);
})();

/* ===== genres page ===== */
/* ManhwaChi — Halloween genres page add-on. Load once from index.html, after halloween.js.
   Draws a custom Halloween icon for every genre (Fantasy = witch hat, Action = crossed swords, Horror = glowing skull ...),
   adds a cursor spotlight to genre cards, swaps the score star for a tiny pumpkin,
   puts a drawn icon in the "best in ..." row titles and replaces the empty-state glyphs.
   It watches the page, so it works with the SPA loading ganre.html / re-rendering the grid. */
(function () {
  if (window.__hwGenres) return; window.__hwGenres = 1;

  const C = { o: '#ff8a2b', g: '#ffd27a', p: '#a78bfa', m: '#86efac', k: '#ffb3c7' };
  const dot = (x, y, r, f, c) => `<circle${c ? ` class="${c}"` : ''} cx="${x}" cy="${y}" r="${r}" fill="${f}" stroke="none"/>`;
  const wrap = (b) => `<svg class="gi-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;

  /* ---------- icons (keyed by the Material name ganre.js already uses) ---------- */
  const ICONS = {
    /* Fantasy — witch hat + sparkles */
    auto_awesome: `<path d="M7 15.5 12 3l5 12.5" fill="${C.p}" fill-opacity=".4"/><ellipse cx="12" cy="16.3" rx="9" ry="2.6" fill="currentColor" fill-opacity=".14"/><path d="M8.8 12.6q3.2 1.3 6.4 0" stroke="${C.o}"/><g class="gi-glow" stroke="${C.g}" stroke-width="1.4"><path d="M19.5 3.5v3.4M17.8 5.2h3.4M4.5 7v2.6M3.2 8.3h2.6"/></g>${dot(19.5, 19.8, 1, C.g, 'gi-glow')}`,
    /* Action — crossed swords */
    swords: `<path d="M20.5 3.5 9.5 14.5M7 12l5 5M9.5 14.5 4.5 19.5"/><path d="M3.5 3.5 14.5 14.5M12 17l5-5M14.5 14.5l5 5"/>${dot(4, 20, 1.1, C.o)}${dot(20, 20, 1.1, C.o)}${dot(12, 12, 1.8, C.o, 'gi-glow')}`,
    /* Adventure — compass */
    explore: `<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".1"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2" stroke-width="1.2"/><g class="gi-needle"><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5z" fill="${C.o}" fill-opacity=".6"/></g>${dot(12, 12, 1.2, 'currentColor')}`,
    /* Comedy — grinning jack-o'-lantern */
    theater_comedy: `<path d="M12 6c-5 0-9 2.8-9 7.2S7 20.5 12 20.5s9-2.9 9-7.3S17 6 12 6z" fill="${C.o}" fill-opacity=".38"/><path d="M12 6c-1.8 1.5-2.6 4.5-2.6 7.2s.8 5.5 2.6 7.3M12 6c1.8 1.5 2.6 4.5 2.6 7.2s-.8 5.5-2.6 7.3" stroke-width="1" opacity=".5"/><path d="M12 6V3.5" stroke="${C.m}"/><path d="M12 3.8q2.2-1.6 4-.4" stroke="${C.m}" stroke-width="1.3"/><path d="M6.8 12.2l1.9-2.8 1.9 2.8zM13.4 12.2l1.9-2.8 1.9 2.8z" fill="currentColor" stroke-width="1"/><g class="gi-glow"><path d="M6.6 15.3q5.4 4.8 10.8 0" stroke-width="1.6"/></g><path d="M9.5 17.2v-1.4M12 18v-1.7M14.5 17.2v-1.4" stroke-width="1.1"/>`,
    /* Drama — cracked heart + tear */
    heart_broken: `<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.5 2.2C20.5 15 12 20.5 12 20.5z" fill="${C.k}" fill-opacity=".28"/><path d="M12 7l-1.8 3.2 2.8 1.7-2.2 3.2 1.6 2.5" stroke="${C.g}" stroke-width="1.5"/><path d="M8.2 9.6 6.8 8.5M16 12.2l1.4-.8" stroke-width="1"/><path class="gi-float" d="M18.5 15c.9 1.3 1.3 2 1.3 2.6a1.3 1.3 0 0 1-2.6 0c0-.6.4-1.3 1.3-2.6z" fill="${C.p}" stroke="none"/>`,
    /* Mystery — all-seeing crystal ball */
    help: `<circle cx="12" cy="10.5" r="7.5" fill="${C.p}" fill-opacity=".3"/><path d="M5.5 20.5h13l-2-4.2h-9z" fill="currentColor" fill-opacity=".16"/><path d="M7.6 10.6S9.4 8 12 8s4.4 2.6 4.4 2.6-1.8 2.6-4.4 2.6-4.4-2.6-4.4-2.6z" stroke-width="1.3"/>${dot(12, 10.6, 1.5, C.o, 'gi-glow')}<path d="M7.8 6.3a5 5 0 0 1 2.5-1.6" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>`,
    /* Horror — glowing-eyed skull */
    skull: `<path d="M12 3a7.5 7.5 0 0 0-4.5 13.5v4h9v-4A7.5 7.5 0 0 0 12 3z" fill="currentColor" fill-opacity=".12"/><g class="gi-glow">${dot(9, 11, 2, C.m)}${dot(15, 11, 2, C.m)}</g><path d="M12 13.5l-1 2h2z" fill="currentColor"/><path d="M10 20.5v-2.8M12 20.5v-2.3M14 20.5v-2.8" stroke-width="1.2"/><path d="M13.5 3.5l-1 3 1.5 1.5" stroke-width="1" opacity=".6"/>`,
    /* Sci-Fi — UFO + tractor beam */
    rocket_launch: `<path d="M7 10.5a5 5 0 0 1 10 0z" fill="${C.m}" fill-opacity=".35"/><ellipse cx="12" cy="11.5" rx="9.5" ry="3" fill="currentColor" fill-opacity=".16"/><path d="M9.5 14.2 7 21M14.5 14.2 17 21" stroke="${C.m}" stroke-opacity=".7" stroke-width="1.3" stroke-dasharray="1.6 2"/><g class="gi-glow">${dot(6.8, 11.6, .9, C.o)}${dot(12, 12.6, .9, C.g)}${dot(17.2, 11.6, .9, C.o)}</g>${dot(12, 8, 1.1, 'currentColor')}${dot(4, 4.5, .8, C.g)}${dot(20, 5.5, .8, C.g)}`,
    /* Psychological — two-tone brain with a spark */
    psychology: `<path d="M12 5.5a3 3 0 0 0-5.6.8A3.2 3.2 0 0 0 5 12.4a3.2 3.2 0 0 0 2 5.4A3 3 0 0 0 12 19z" fill="${C.k}" fill-opacity=".28"/><path d="M12 5.5a3 3 0 0 1 5.6.8 3.2 3.2 0 0 1 1.4 6.1 3.2 3.2 0 0 1-2 5.4A3 3 0 0 1 12 19z" fill="${C.p}" fill-opacity=".3"/><path d="M12 5.5V19M8.5 10.2c1 .2 1.8 1 1.8 2.1M15.5 10.2c-1 .2-1.8 1-1.8 2.1M8.8 15.5h1.8M13.4 15.5h1.8" stroke-width="1.2"/><g class="gi-glow"><path d="M12 1.8v1.6M9 2.8l.7 1.2M15 2.8l-.7 1.2" stroke="${C.g}" stroke-width="1.2"/></g>`,
    /* Sports — basketball pumpkin */
    sports_kabaddi: `<circle cx="12" cy="13" r="8" fill="${C.o}" fill-opacity=".34"/><path d="M12 5v16M4 13h16M6.2 7.5c3 2.6 3 7.4 0 10M17.8 7.5c-3 2.6-3 7.4 0 10" stroke-width="1.2"/><path d="M12 5V2.8" stroke="${C.m}"/><path d="M12 3.2q2-1.2 3.6-.2" stroke="${C.m}" stroke-width="1.3"/>`,
    /* Historical — haunted castle */
    history: `<path d="M3.5 20.5V8.5h5v12M15.5 20.5V8.5h5v12M8.5 20.5V12h7v8.5" fill="currentColor" fill-opacity=".12"/><path d="M3.5 8.5V6.2h1.6v1.4h1.8V6.2h1.6v2.3M15.5 8.5V6.2h1.6v1.4h1.8V6.2h1.6v2.3"/><path d="M10.5 20.5v-3a1.5 1.5 0 0 1 3 0v3"/><path d="M12 12V5.2"/><path d="M12 5.2l3 1.2-3 1.2z" fill="${C.o}" stroke="none"/><g class="gi-glow">${dot(6, 13.5, 1, C.o)}${dot(18, 13.5, 1, C.o)}</g>`,
    /* School Life — graduation cap with an orange tassel */
    school: `<path d="M2.5 9.5 12 5l9.5 4.5L12 14z" fill="${C.p}" fill-opacity=".4"/><path d="M6.5 11.8V16c1.6 1.4 3.4 2 5.5 2s3.9-.6 5.5-2v-4.2" fill="currentColor" fill-opacity=".1"/><path d="M21.5 9.5V15"/>${dot(21.5, 16.3, 1.3, C.o, 'gi-float')}${dot(12, 2.8, .9, C.g, 'gi-glow')}`,
    /* Romance — vampire heart with fangs */
    favorite: `<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.5 2.2C20.5 15 12 20.5 12 20.5z" fill="${C.k}" fill-opacity=".36"/>${dot(9, 10.8, 1, 'currentColor')}${dot(15, 10.8, 1, 'currentColor')}<path d="M8.5 13q3.5 3.2 7 0"/><path d="M9.7 14.2l.7 2.2.8-1.7zM12.8 14.7l.8 1.7.7-2.2z" fill="#fff" fill-opacity=".9" stroke="none"/><path d="M5 5.5 7 3.8l1 2M19 5.5l-2-1.7-1 2" stroke-width="1.2"/>`,
    /* Martial Arts — shuriken */
    sports_martial_arts: `<g class="gi-spin"><path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z" fill="currentColor" fill-opacity=".16"/>${dot(12, 12, 2.6, '#1b0e33')}${dot(12, 12, 1.3, C.o)}</g>`,
    /* Dark Fantasy — moon + bat */
    dark_mode: `<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="${C.g}" fill-opacity=".4"/><g class="gi-float"><path d="M15.2 9.8 16.8 8l1 1.2L19.2 8l1.5 1.8-1 .6-.7 1.5-.8-1.2-.8 1.2-.7-1.5z" fill="currentColor" stroke="none"/></g><path d="M5.5 3.5v2.8M4.1 4.9h2.8" stroke="${C.g}" stroke-width="1.3"/>`,
    /* Thriller — storm cloud + bolt */
    bolt: `<path d="M6.5 14.5a3.5 3.5 0 0 1 .5-6.9A5 5 0 0 1 16.6 7.5a3.5 3.5 0 0 1 .9 7z" fill="${C.p}" fill-opacity=".32"/><g class="gi-glow"><path d="M12.8 11 9.5 17.2h3l-1 4.8 4-7h-3l1.5-4z" fill="${C.g}" stroke="${C.o}" stroke-width="1.1"/></g>`,
    /* anything else — candy */
    category: `<circle cx="12" cy="12" r="5.5" fill="${C.k}" fill-opacity=".4"/><path d="M9 10.2c2-1.4 4.5-1 6 1.2"/><path d="M6.5 12 2.5 9v6zM17.5 12l4-3v6z" fill="${C.p}" fill-opacity=".4"/>`
  };
  const EMPTY = {
    wifi_off: `<path d="M12 3C7.6 3 4.5 6.2 4.5 10.6V20l2.6-2 2.3 2 2.6-2 2.6 2 2.3-2 2.6 2v-9.4C19.5 6.2 16.4 3 12 3z" fill="currentColor" fill-opacity=".14"/><path d="M8.8 9.3l2 2M10.8 9.3l-2 2M13.2 9.3l2 2M15.2 9.3l-2 2" stroke-width="1.3"/><path d="M10 14.8q2-1 4 0"/>`,
    search_off: `<path d="M6.5 21V9.5a5.5 5.5 0 0 1 11 0V21z" fill="currentColor" fill-opacity=".12"/><path d="M3.5 21h17"/><path d="M12 8v6M9.5 10.5h5" stroke="${C.p}"/><path d="M5 19.5q1.5-2 3-.5M16 19q1.5-1.5 3 .5" stroke="${C.m}" stroke-width="1.2"/>`
  };
  const PUMP = '<svg class="gs-s" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="8" cy="14" rx="6.5" ry="7.5" fill="#ff7a18"/><ellipse cx="16" cy="14" rx="6.5" ry="7.5" fill="#ff7a18"/><ellipse cx="12" cy="14" rx="5.5" ry="8" fill="#ffa03a"/><path d="M12 6.5V3.5q2 0 3 1" stroke="#4ade80" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M8.5 12.5l1.2-2 1.2 2zM13.1 12.5l1.2-2 1.2 2z" fill="#2b1b45"/><path d="M9 16q3 2.4 6 0" stroke="#2b1b45" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

  /* Persian genre names -> icon key (normalised: no ZWNJ / spaces / hyphens) */
  const norm = (s) => String(s || '').replace(/[\u200c\s-]/g, '').toLowerCase();
  const NAMES = {
    'فانتزی': 'auto_awesome', 'اکشن': 'swords', 'ماجراجویی': 'explore', 'کمدی': 'theater_comedy', 'درام': 'heart_broken',
    'معمایی': 'help', 'ترسناک': 'skull', 'علمیتخیلی': 'rocket_launch', 'رواناختی': 'psychology', 'روانشناختی': 'psychology',
    'ورزشی': 'sports_kabaddi', 'تاریخی': 'history', 'زندگیمدرسهای': 'school', 'عاشقانه': 'favorite', 'رمانتیک': 'favorite',
    'هنرهایرزمی': 'sports_martial_arts', 'دارکفانتزی': 'dark_mode', 'هیجانانگیز': 'bolt', 'هیجانی': 'bolt'
  };
  const P = Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [norm(k), v]));

  /* ---------- enhancers (each element is processed once, marked with data-hwg) ---------- */
  const cards = () => {
    document.querySelectorAll('#genres-grid .genre-card:not([data-hwg])').forEach((c) => {
      const badge = c.querySelector('.genre-icon-badge'), orig = badge && badge.querySelector('.material-symbols-outlined');
      const fromIcon = orig && (orig.dataset.hwO || orig.textContent.trim());
      const nameEl = c.querySelector('.genre-name');
      const key = (nameEl && P[norm(nameEl.textContent)]) || (ICONS[fromIcon] ? fromIcon : 'category');
      c.dataset.hwg = key;
      c.style.setProperty('--i', Math.min([...c.parentNode.children].indexOf(c), 24));
      if (badge) badge.insertAdjacentHTML('beforeend', `<span class="hw-gi">${wrap(ICONS[key])}</span>`);
      c.insertAdjacentHTML('beforeend', `<i class="gw-spot"></i>`);
    });
  };
  const titles = () => {
    document.querySelectorAll('.genre-rank .text-primary:not([data-hwg])').forEach((s) => {
      s.dataset.hwg = '1';
      const key = P[norm(s.textContent)];
      if (key) s.insertAdjacentHTML('beforebegin', `<span class="hw-gi hw-gi--t">${wrap(ICONS[key])}</span>`);
    });
  };
  const scores = () => {
    document.querySelectorAll('.poster-score:not([data-hwg])').forEach((s) => {
      s.dataset.hwg = '1';
      const v = s.textContent.replace('⭐', '').trim();
      s.innerHTML = `<i class="gs-e" style="font-style:normal">⭐</i>${PUMP}<span>${v}</span>`;
    });
  };
  const empties = () => {
    document.querySelectorAll('.empty-row-state .material-symbols-outlined:not([data-hwg])').forEach((s) => {
      const t = (s.dataset.hwO || s.textContent).trim();
      if (!EMPTY[t]) return;
      s.dataset.hwg = '1';
      s.insertAdjacentHTML('afterend', `<span class="hw-gi hw-gi--e">${wrap(EMPTY[t])}</span>`);
    });
  };
  const run = () => { cards(); titles(); scores(); empties(); };

  /* cursor spotlight on genre cards (mouse only) */
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !e.target.closest) return;
    const c = e.target.closest('.genre-card'); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* the page is injected / re-rendered asynchronously, so keep watching */
  let q = 0;
  const start = () => {
    run();
    new MutationObserver((recs) => { if (q) return; const nz = window.__hwNoisy; if (nz && recs.every((r) => nz(r.target) && Array.prototype.every.call(r.addedNodes, nz))) return; q = requestAnimationFrame(() => { q = 0; run(); }); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();


/* ===== v5: Kodoochi 2.0 ===== */
/* ManhwaChi — Halloween v5 (additive). Appended after v3 + genres. Upgrades the mascot "کدوچی":
   new artwork (glowing body, arms, feet, 5 costumes unlocked with candy), 11 moods, drag & drop,
   long-press / ✨ orbit menu (costume, trick-or-treat, fortune, spells, flashlight ghost hunt, sound, chat, link),
   idle life (sleep, yawn, wave, hum, look around) and reactions to the witch / lightning / ghosts / the lucky wheel.
   Safe to remove: the v2 mascot underneath is never edited. */
(function () {
  if (window.__hwK) return; window.__hwK = 1;
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const on = () => root.classList.contains('hw');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const mk = (tag, cls, html, parent) => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; (parent || document.body).appendChild(e); return e; };
  /* shuffle-bag: every line is used once before any line repeats, and the same line never comes twice in a row */
  const bags = {}, lastOf = {};
  const fresh = (key, arr) => {
    let b = bags[key];
    if (!b || !b.length) { b = bags[key] = arr.slice().sort(() => Math.random() - .5); if (b.length > 1 && b[b.length - 1] === lastOf[key]) b.unshift(b.pop()); }
    return (lastOf[key] = b.pop());
  };

  /* ---------- artwork ---------- */
  const star4 = (x, y, s, c, d) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="k-tw" style="animation-delay:${d || 0}s" d="M0-6 1.6-1.6 6 0 1.6 1.6 0 6-1.6 1.6-6 0-1.6-1.6Z" fill="${c}"/></g>`;
  const HEART = 'M0 5C-9-1-5-8 0-4 5-8 9-1 0 5Z';
  const heartAt = (x, y, s, d) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="k-heart" style="animation-delay:${d}s" d="${HEART}" fill="#ff5d8f"/></g>`;
  const eye = (cx, side, f) => `<g class="k-eye k-e${side}" data-for="${f}"><g class="k-eg"><ellipse class="k-sclera" cx="${cx}" cy="63" rx="10" ry="11.6" fill="#fffaf0" stroke="#2b1b45" stroke-width="2.2"/><g class="k-trk"><ellipse class="k-iris" cx="${cx}" cy="64" rx="8.2" ry="9.6" fill="url(#kIris)"/><circle cx="${cx + 2.8}" cy="60" r="3.6" fill="#fff"/><circle cx="${cx - 3}" cy="67.4" r="1.7" fill="#fff" opacity=".9"/></g></g></g>`;
  const loveEye = (cx) => `<g data-for="love" transform="translate(${cx} 62) scale(1.55)"><path class="k-beat" d="${HEART}" fill="#ff4d7e" stroke="#2b1b45" stroke-width="1.3"/><circle cx="-2.2" cy="-1.4" r=".9" fill="#fff"/></g>`;
  const spiral = (cx) => `<g data-for="dizzy"><path class="k-spiral" d="M${cx} 62m-1.2 0a1.2 1.2 0 1 1 2.4 0a3.4 3.4 0 1 1-6.8 0a5.6 5.6 0 1 1 11.2 0a7.8 7.8 0 1 1-15.6 0" stroke="#2b1b45" stroke-width="1.9" fill="none" stroke-linecap="round"/></g>`;
  const FANG = '<path class="k-fang" d="M52.4 79.4l2.4 5.4 1.9-4.6zM63.3 80.2l1.9 4.6 2.4-5.4z" fill="#fff" stroke="#2b1b45" stroke-width=".8" stroke-linejoin="round"/>';
  const SVG = `<svg class="k-svg" viewBox="-10 -40 140 156" aria-hidden="true" data-mood="happy" data-c="witch">
<defs>
<radialGradient id="kBody" cx=".38" cy=".26" r=".9"><stop offset="0" stop-color="#ffd48f"/><stop offset=".45" stop-color="#ffa03a"/><stop offset="1" stop-color="#e2540d"/></radialGradient>
<radialGradient id="kSide" cx=".35" cy=".3" r=".95"><stop offset="0" stop-color="#ffb457"/><stop offset=".6" stop-color="#f26f14"/><stop offset="1" stop-color="#b8400a"/></radialGradient>
<radialGradient id="kAura" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset=".6" stop-color="#ff8a2b" stop-opacity=".16"/><stop offset="1" stop-color="#ff8a2b" stop-opacity="0"/></radialGradient>
<radialGradient id="kInner" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#fff1b8" stop-opacity=".8"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
<radialGradient id="kIris" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#7d4fd0"/><stop offset=".5" stop-color="#34205c"/><stop offset="1" stop-color="#150a28"/></radialGradient>
<radialGradient id="kBlush" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff4f78" stop-opacity=".9"/><stop offset=".65" stop-color="#ff6b8a" stop-opacity=".4"/><stop offset="1" stop-color="#ff6b8a" stop-opacity="0"/></radialGradient>
<linearGradient id="kTongue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8fa3"/><stop offset="1" stop-color="#e0405f"/></linearGradient>
<linearGradient id="kHatG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9f80f7"/><stop offset="1" stop-color="#4a2c96"/></linearGradient>
<linearGradient id="kGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffeaa8"/><stop offset=".55" stop-color="#ffc233"/><stop offset="1" stop-color="#c77d0a"/></linearGradient>
<linearGradient id="kStemG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a8f35"/><stop offset="1" stop-color="#2f5d1f"/></linearGradient>
<linearGradient id="kHorn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b86"/><stop offset="1" stop-color="#b91c3c"/></linearGradient>
</defs>
<circle class="k-aura" cx="60" cy="68" r="72" fill="url(#kAura)"/>
<ellipse class="k-shadow" cx="60" cy="113" rx="38" ry="5.5" fill="rgba(0,0,0,.35)"/>

<g class="kc kc-vampire"><path d="M10 56C-8 82-4 104 6 114H114C124 104 128 82 110 56 96 72 24 72 10 56Z" fill="#9b1c31" stroke="#4a0d16" stroke-width="1.6"/><path d="M6 108Q60 120 114 108" stroke="#4a0d16" stroke-width="1.6" fill="none" opacity=".6"/>
<path d="M12 56 18 12 47 38Z" fill="#1b0e33" stroke="#a78bfa" stroke-opacity=".5"/><path d="M17 50 21 24 39 40Z" fill="#c42a46"/>
<path d="M108 56 102 12 73 38Z" fill="#1b0e33" stroke="#a78bfa" stroke-opacity=".5"/><path d="M103 50 99 24 81 40Z" fill="#c42a46"/></g>
<g class="kc kc-devil"><path d="M112 98C125 101 130 90 123 82 119 77 124 73 129 75" stroke="#d6204a" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M123 80l11-4-5 10z" fill="#d6204a"/></g>

<g class="k-foots"><ellipse class="k-foot k-fl" cx="42" cy="106" rx="13" ry="7" fill="#3b2470" stroke="#a78bfa" stroke-opacity=".55"/><ellipse class="k-foot k-fr" cx="78" cy="106" rx="13" ry="7" fill="#3b2470" stroke="#a78bfa" stroke-opacity=".55"/><path d="M33 104q9-4 18 0M69 104q9-4 18 0" stroke="#fff" stroke-opacity=".2" stroke-width="1.6" fill="none"/></g>

<ellipse cx="34" cy="70" rx="28" ry="33" fill="url(#kSide)" stroke="#a73a08" stroke-opacity=".5" stroke-width="1.6"/>
<ellipse cx="86" cy="70" rx="28" ry="33" fill="url(#kSide)" stroke="#a73a08" stroke-opacity=".5" stroke-width="1.6"/>
<ellipse cx="60" cy="68" rx="27" ry="37" fill="url(#kBody)" stroke="#b8400a" stroke-opacity=".55" stroke-width="1.6"/>
<path d="M42 36C33 56 33 84 44 103M78 36C87 56 87 84 76 103M20 46C12 61 14 82 24 97M100 46C108 61 106 82 96 97M60 31C58 55 58 85 60 105" stroke="#a73a08" stroke-opacity=".3" stroke-width="2" fill="none" stroke-linecap="round"/>
<ellipse cx="60" cy="33" rx="9.5" ry="3.4" fill="#a73a08" opacity=".55"/>
<path d="M40 50C42 42 48 38 55 36" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="37" cy="58" r="2.2" fill="#fff" opacity=".4"/>
<ellipse class="k-inner" cx="60" cy="78" rx="36" ry="30" fill="url(#kInner)"/>

<g class="k-arm k-al"><path d="M13 78Q0 82-2 94" stroke="#d9480f" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M13 78Q0 82-2 94" stroke="#ff9a3c" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="-2" cy="95" r="5.4" fill="#ffa03a" stroke="#c2410c" stroke-width="1.4"/></g>
<g class="k-arm k-ar"><path d="M107 78Q120 82 122 94" stroke="#d9480f" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M107 78Q120 82 122 94" stroke="#ff9a3c" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="122" cy="95" r="5.4" fill="#ffa03a" stroke="#c2410c" stroke-width="1.4"/></g>

<g class="k-stem"><path d="M54 37C53 27 55 19 59 14 62 11 66 14 67 20 68 27 67 32 66 37Z" fill="url(#kStemG)" stroke="#2a4f1a" stroke-width="1"/><path d="M66 23C76 16 83 22 79 29 76 33 71 31 72 27" stroke="#6be06b" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M55 29C47 22 40 24 38 30 44 33 51 32 55 29Z" fill="#4ca83d" stroke="#2a6a22" stroke-width=".8"/></g>

<ellipse class="k-cheek" cx="26" cy="77" rx="9" ry="5.8" fill="url(#kBlush)"/><ellipse class="k-cheek" cx="94" cy="77" rx="9" ry="5.8" fill="url(#kBlush)"/>
${eye(44, 'l', 'happy wow scared evil cheer wink')}${eye(76, 'r', 'happy wow scared evil cheer')}
<path data-for="laugh" d="M35 64Q44 53 53 64" stroke="#2b1b45" stroke-width="3.8" fill="none" stroke-linecap="round"/>
<path data-for="laugh wink" d="M67 64Q76 53 85 64" stroke="#2b1b45" stroke-width="3.8" fill="none" stroke-linecap="round"/>
<path data-for="sleepy yawn" d="M35 62Q44 70 53 62M67 62Q76 70 85 62" stroke="#2b1b45" stroke-width="3.6" fill="none" stroke-linecap="round"/>
${loveEye(44)}${loveEye(76)}${spiral(44)}${spiral(76)}
<path data-for="evil" d="M32 50L55 58M88 50L65 58" stroke="#2b1b45" stroke-width="3.6" stroke-linecap="round"/>
<path data-for="scared" d="M33 55L53 46M87 55L67 46" stroke="#2b1b45" stroke-width="3.2" stroke-linecap="round"/>
<path data-for="wow" d="M34 47Q44 40 54 47M66 47Q76 40 86 47" stroke="#2b1b45" stroke-width="3" fill="none" stroke-linecap="round"/>

<g data-for="happy love wink"><path d="M53 78Q60 85.5 67 78" stroke="#2b1b45" stroke-width="3.4" fill="none" stroke-linecap="round"/></g>
<path data-for="wink" d="M58 83Q61 94 67 84Z" fill="#ff6b81" stroke="#2b1b45" stroke-width="1.6" stroke-linejoin="round"/>
<g data-for="laugh cheer"><path d="M46 73Q60 98 74 73Z" fill="#2b1b45" stroke="#2b1b45" stroke-width="2.6" stroke-linejoin="round"/><path d="M49 74.6h22q-3 5-11 5t-11-5z" fill="#fff"/><ellipse cx="60" cy="86" rx="6.5" ry="3.6" fill="#ff6b81"/>${FANG.replace('M52.4 79.4', 'M52.4 79').replace('M63.3 80.2', 'M63.3 79.6')}</g>
<ellipse data-for="wow" cx="60" cy="81" rx="5.2" ry="7" fill="#2b1b45"/>
<g data-for="yawn"><ellipse cx="60" cy="81" rx="7.6" ry="10" fill="#2b1b45"/><ellipse cx="60" cy="87" rx="5" ry="3.4" fill="#ff6b81"/></g>
<path data-for="scared" d="M47 83q3.2-5 6.4 0t6.4 0t6.4 0t6.4 0" stroke="#2b1b45" stroke-width="3.2" fill="none" stroke-linecap="round"/>
<g data-for="sleepy"><path d="M55 80Q60 83 65 80" stroke="#2b1b45" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle class="k-bub" cx="69" cy="81" r="4.6" fill="#fff" fill-opacity=".3" stroke="#fff" stroke-opacity=".75"/></g>
<g data-for="evil"><path d="M41 73Q60 100 79 73Q60 80 41 73Z" fill="#2b1b45" stroke="#2b1b45" stroke-width="2.4" stroke-linejoin="round"/><path d="M46 75.4l3.4 6 3.2-5.4zM56 77l3.6 6.4 3.6-6.4zM67.4 75.8l3.2 5.4 3.4-6z" fill="#fff"/></g>
<path data-for="dizzy" d="M49 82q3.6-5.4 7.2 0t7.2 0t7.2 0" stroke="#2b1b45" stroke-width="3.2" fill="none" stroke-linecap="round"/>

<g class="kc kc-witch"><g transform="rotate(7 62 33)"><g class="k-hat">
<ellipse cx="62" cy="33.5" rx="38" ry="8.2" fill="#3a2279" stroke="#1b0e33" stroke-width="1.4"/><ellipse cx="62" cy="31.8" rx="36.4" ry="6.6" fill="none" stroke="#b9a2ff" stroke-opacity=".5" stroke-width="1.2"/>
<path d="M42 33C48 15 54-1 57-16C59-26 66-33 77-32C69-26 68-16 70-6C73 8 78 21 83 33Z" fill="url(#kHatG)" stroke="#2a1560" stroke-width="1.4" stroke-linejoin="round"/>
<path d="M42 33C48 15 54-1 57-16C60-6 62 10 62 33Z" fill="#fff" opacity=".12"/>
<path d="M43.4 26Q62 34 81.6 26L83.4 33Q62 41.5 41.8 33Z" fill="#ff8a2b" stroke="#b8400a" stroke-width="1"/>
<rect x="57.5" y="27.6" width="10" height="10" rx="2" fill="url(#kGold)" stroke="#a45a06" stroke-width="1" transform="rotate(-6 62.5 32.6)"/><rect x="60.4" y="30.4" width="4.2" height="4.2" fill="#7a56d6" transform="rotate(-6 62.5 32.6)"/>
${star4(58, 6, .8, '#ffd27a', 0)}${star4(67, -14, .6, '#fff3c4', .8)}${star4(54, 18, .5, '#ffd27a', 1.4)}
</g></g></g>
<g class="kc kc-cat"><path d="M26 42 29 6 54 30Z" fill="#2a1a4d" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1.4" stroke-linejoin="round"/><path d="M33 34 34.6 16 47 29Z" fill="#ffb3c7"/><path d="M94 42 91 6 66 30Z" fill="#2a1a4d" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1.4" stroke-linejoin="round"/><path d="M87 34 85.4 16 73 29Z" fill="#ffb3c7"/><path d="M57 69.4h6l-3 3.4z" fill="#ffb3c7"/><path d="M8 68 24 71M8 77 24 76M112 68 96 71M112 77 96 76" stroke="#2b1b45" stroke-width="1.7" stroke-linecap="round"/></g>
<g class="kc kc-devil"><path d="M36 40C26 29 24 13 32 3 35 15 43 22 53 31Z" fill="url(#kHorn)" stroke="#7f1d1d" stroke-width="1.3" stroke-linejoin="round"/><path d="M84 40C94 29 96 13 88 3 85 15 77 22 67 31Z" fill="url(#kHorn)" stroke="#7f1d1d" stroke-width="1.3" stroke-linejoin="round"/><path d="M33 12C34 8 36 6 37 5" stroke="#fff" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round"/></g>
<g class="kc kc-vampire"><path d="M33 42C34 20 58 12 61 17 65 12 87 20 88 42 77 31 67 31 61 38 54 31 43 31 33 42Z" fill="#1b0e33" stroke="#a78bfa" stroke-opacity=".5" stroke-width="1.2"/><path d="M45 25C52 20 58 20 61 24" stroke="#fff" stroke-opacity=".25" stroke-width="2" fill="none" stroke-linecap="round"/></g>
<g class="kc kc-crown"><g transform="rotate(-6 60 30)"><path d="M36 37 39 8 50 22 60 4 70 22 81 8 84 37Z" fill="url(#kGold)" stroke="#a45a06" stroke-width="1.6" stroke-linejoin="round"/><rect x="35" y="31" width="50" height="8.5" rx="2.4" fill="url(#kGold)" stroke="#a45a06" stroke-width="1.4"/><circle cx="60" cy="18" r="3.2" fill="#ff4d7e" stroke="#7a0f2c" stroke-width=".8"/><circle cx="46" cy="35" r="2.3" fill="#5eead4"/><circle cx="74" cy="35" r="2.3" fill="#5eead4"/><circle cx="60" cy="35" r="2.3" fill="#a78bfa"/><circle cx="39" cy="8" r="2.3" fill="#fff6c8"/><circle cx="81" cy="8" r="2.3" fill="#fff6c8"/><circle cx="60" cy="4" r="2.5" fill="#fff6c8"/></g>${star4(32, 6, .8, '#fff3c4', 0)}${star4(90, 2, .7, '#ffd27a', 1)}</g>

<path class="k-sweat" data-for="scared" d="M96 40q6 8 0 13-6-5 0-13z" fill="#7dd3fc" stroke="#38a3dc" stroke-width="1"/>
<g class="k-zzz" data-for="sleepy"><text x="88" y="32" font-size="15" font-weight="900" fill="#d9c9f5" font-family="Vazirmatn,sans-serif">Z</text><text class="z2" x="88" y="32" font-size="15" font-weight="900" fill="#d9c9f5" font-family="Vazirmatn,sans-serif">Z</text><text class="z3" x="88" y="32" font-size="15" font-weight="900" fill="#d9c9f5" font-family="Vazirmatn,sans-serif">Z</text></g>
<g class="k-stars" data-for="dizzy"><g transform="translate(60 6)"><path d="M0-5 1.3-1.4 5-1 2.2 1.3 3 5 0 3-3 5-2.2 1.3-5-1-1.3-1.4Z" fill="#ffd27a"/></g><g transform="translate(88 26)"><path d="M0-5 1.3-1.4 5-1 2.2 1.3 3 5 0 3-3 5-2.2 1.3-5-1-1.3-1.4Z" fill="#a78bfa"/></g><g transform="translate(32 26)"><path d="M0-5 1.3-1.4 5-1 2.2 1.3 3 5 0 3-3 5-2.2 1.3-5-1-1.3-1.4Z" fill="#86efac"/></g></g>
<g data-for="love">${heartAt(92, 40, .9, 0)}${heartAt(28, 38, .7, .7)}${heartAt(62, 24, .6, 1.3)}</g>
<g data-for="cheer">${star4(100, 44, 1, '#ffe29a', 0)}${star4(20, 40, .9, '#ffb3c7', .5)}${star4(104, 70, .6, '#a78bfa', 1)}${star4(16, 70, .7, '#86efac', .3)}</g>
</svg>`;

  const BAT = '<svg viewBox="0 0 60 30"><g fill="#2d1b4e" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1"><path class="wl" d="M30 15C24 5 14 3 3 8c4 2 5 5 4 9 3-2 6-2 8 1 2-3 5-3 8-1 3-1 5-1 7-2z"/><path class="wr" d="M30 15C36 5 46 3 57 8c-4 2-5 5-4 9-3-2-6-2-8 1-2-3-5-3-8-1-3-1-5-1-7-2z"/><ellipse cx="30" cy="17" rx="5" ry="7"/><path d="M26 12l1-7 3 4 3-4 1 7z"/></g><circle cx="28" cy="15" r="1.2" fill="#ff8a2b"/><circle cx="32" cy="15" r="1.2" fill="#ff8a2b"/></svg>';
  const GHOST = '<svg viewBox="0 0 40 48"><path d="M20 2C9 2 4 11 4 22v22l6-5 5 5 5-5 5 5 5-5 6 5V22C36 11 31 2 20 2z" fill="#fff"/><circle cx="14" cy="22" r="2.4" fill="#2b1b45"/><circle cx="26" cy="22" r="2.4" fill="#2b1b45"/><ellipse cx="20" cy="29" rx="2.2" ry="2.8" fill="#2b1b45"/><circle cx="9.5" cy="27" r="2.6" fill="#ffb3c7"/><circle cx="30.5" cy="27" r="2.6" fill="#ffb3c7"/></svg>';
  const SPIDER = '<svg viewBox="0 0 30 34"><g stroke="#a78bfa" stroke-width="1.4" fill="none" stroke-linecap="round"><path d="M10 19Q3 15 4 8M10 22Q2 22 3 30M11 25Q6 30 8 33M11 17Q6 11 9 5M20 19Q27 15 26 8M20 22Q28 22 27 30M19 25Q24 30 22 33M19 17Q24 11 21 5"/></g><circle cx="15" cy="23" r="6.5" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.2"/><circle cx="15" cy="14.5" r="4.2" fill="#1b0e33" stroke="#a78bfa" stroke-width="1.2"/><circle cx="13.3" cy="14" r="1.1" fill="#ff8a2b"/><circle cx="16.7" cy="14" r="1.1" fill="#ff8a2b"/><path d="M15 19v8" stroke="#ff8a2b" stroke-width="1.6" stroke-linecap="round"/></svg>';

  /* ---------- content ---------- */
  const COS = [
    { id: 'witch', n: 'جادوگر', e: '🧙‍♀️', need: 0 },
    { id: 'cat', n: 'گربه‌ی سیاه', e: '🐈‍⬛', need: 5 },
    { id: 'devil', n: 'شیطونک', e: '😈', need: 12 },
    { id: 'vampire', n: 'خون‌آشام', e: '🧛', need: 25 },
    { id: 'crown', n: 'شاه کدوها', e: '👑', need: 40 }
  ];
  const GEN = [
    'بوووو! 👻 ترسیدی؟ نه؟ باشه... فردا بیشتر تمرین می‌کنم',
    'یه چپتر دیگه... فقط یکی... (سه ساعت بعد) 📖',
    'بدترین حس دنیا: چپتر جدید رو می‌خونی و می‌بینی «ادامه دارد» 😭',
    'بهترین حس دنیا: چپتر جدید میاد و تو هنوز اسپویل نشدی 🥹',
    'قهرمان‌های مانهوا ده چپتر ضعیفن، بعد یهویی OP می‌شن. من هنوز ده ساله کدوئم 🥲',
    'می‌گن شب نباید مانهوا خوند. ولی خب، مگه کسی گوش می‌ده؟ 😏',
    'نکته: دکمه‌ی «بعدی» رو بزن، من قضاوتت نمی‌کنم 😌',
    'تنها چیزی که ازش می‌ترسم عنکبوته... و نویسنده‌هایی که وسط داستان می‌رن استراحت 🕷️',
    'کلاه جادوگری رو به یه آب‌نبات از یه جادوگر خریدم. معامله‌ی قرن بود 🧙‍♀️',
    'بدنم کدوئه ولی دلم گرمه. تازه شمع هم دارم، تو چی داری؟ 😎',
    'به‌خاطر ظاهرم قضاوتم نکن؛ من از تو مهربون‌ترم... احتمالاً 😇',
    'نصف عمرم رو صرف انتخاب اکسسوری کردم. از دکمه‌ی ⚡ ببین، عینک آفتابی بهم میاد 😎',
    'هیس! روح‌ها هم مانهوا می‌خونن؛ فقط نمی‌تونن صفحه رو ورق بزنن 👻',
    'بوکمارک‌هات رو دیدی؟ بعضیاشون دارن دلتنگی می‌کنن 🔖',
    'سه بار بزن روم تا قلقلکم بیاد؛ بیشتر از هفت بار بزنی، گیج می‌شم 😵‍💫',
    'منو بگیر و جابه‌جا کن! قول می‌دم نه می‌گزم، نه آبمیوه می‌شم 😁',
    'ازم فال بخواه! کریستالم امشب خوش‌حاله ولی زیاد دقیق نیست 🔮 (بدون ضمانت)',
    'چراغ‌قوه رو روشن کن و ارواح گمشده رو پیدا کن؛ اونا از منم ترسوترن 🔦',
    'ترت یا ترت! از منوی ✨ امتحانش کن؛ بدشانسی هم داره ولی شانس بیشتره 🍬',
    'کدوها رو معمولاً می‌تراشن. منو فقط قلقلک می‌دن؛ ترجیح می‌دم همین باشه 🎃',
    'اگه روزی نویسنده‌ی مانهوات گفت «هفته‌ی بعد»، بدون یعنی ماه بعد 😅',
    'رقص بلدم! از دکمه‌ی ⚡ بزن، ولی نخند، پیست رقص مال منه 💃',
    'اون یکی مانهوایی که تو لیستته و هنوز شروعش نکردی، داره بهت نگاه می‌کنه 👀',
    'تمرین قیافه‌ی ترسناک: 😈 ... شد؟ ... نشد؟ ... باشه نشد 🥲',
    'می‌دونستی؟ هر بار که تو چپتر آخر عاشق می‌شی، یه کدو یه جایی لبخند می‌زنه 🧡',
    'چقدر خوبه که اینجایی. بدون تو مجبورم با عنکبوت حرف بزنم 🕷️'
  ];
  const TOD = (h) => h < 5 ? 'ساعت اینقدره و هنوز بیداری؟ جغدها هم دارن به تو حسودی می‌کنن 🦉' : h < 11 ? 'صبح بخیر! یه چای و یه چپتر؟ شروع بی‌نقصه ☕' : h < 17 ? 'ناهار خوردی؟ حالا یه چپتر بخون که هضم بشه 📖' : h < 21 ? 'عصر بخیر! وقتشه یه ژانر جدید امتحان کنی؛ همیشه که اکشن نیست 🌆' : 'شب شده؛ ساعت طلایی مانهواهای ترسناک... و ساعت طلایی «فردا دیر پا می‌شم» 🌙';
  const PROFILE = ['بذار تاریخچه‌ت رو ببینم... وای، چه سلیقه‌ای! 👀', 'این‌همه بوکمارک؟ کتابخونه‌ست یا انبار؟ 📚', 'VIP بشی، جادوگرا بهت حسودی می‌کنن 🧙‍♀️', 'عکس پروفایلت رو جادویی کن 🔮 (با اجازه‌ی من!)', 'اینجا قلب کتابخونه‌ته؛ آروم قدم بزن، شاید یه روح تو یکی از چپترا قایم شده 👻'];
  const WHEEL = ['فقط یه بار شانس داری؛ با دل و جرئت بزن! 🎡', 'کدوی وسط چرخ رو بزن، من برات دعا می‌کنم 🤞', 'برنده شدی یادت باشه یه آب‌نبات به کدوچی بدهکاری 🍬', 'جایزه‌ها واقعین، شوخی نیست! 💎', 'من نمی‌تونم نگاه کنم... نه، شوخی کردم، نگاه می‌کنم 🙈'];
  const TREAT = ['آب‌نبات گرفتی! 🍬 تازه از جیب مخفی‌م درآوردم', 'اووو ترت شد! بفرما، نوش جان 🍭', 'این یکی رو از ته کلاهم درآوردم... نه، نپرس چطوری 🎩🍫', 'آب‌نبات ویژه! (البته همه‌شون ویژه‌ان، ولی این ویژه‌تره 😌)', 'وای شانس آوردی، همین الان داشتم می‌خوردمش! 🍬', 'یه شکلات از ته جیبم... اگه آب شده بود، تقصیر آتیش دلمه 🍫🔥'];
  const FORTUNE = [
    'کریستال می‌گه: امشب می‌گی «فقط یه چپتر»... و ساعت ۴ صبح هنوز بیداری 🔮',
    'فالت: قهرمان مانهوایی که می‌خونی بالاخره لِوِل‌آپ می‌شه؛ تو هم همین‌طور ⚔️',
    'می‌بینم... یه پلات‌تویست که فکرشم نمی‌کنی. نه، اون یکی نه. نه، اون یکی هم نه. آهان، این یکی! 😱',
    'ستاره‌ها می‌گن: اون مانهوایی که تو بوکمارکته و خاک می‌خوره، امشب نوبتشه 🔖',
    'فال امشب: یه شخصیت فرعی که یادت رفته بود، آخرش آدم اصلی ماجرا درمیاد 👁️',
    'پیشگویی: نویسنده‌ی مانهوات فردا چپتر جدید می‌ذاره (احتمالش ۳٪، ولی امیدوار باش) 🙏',
    'کریستالم می‌گه به‌زودی عاشق یه ویلن می‌شی. بیخیال، همه‌مون شدیم 😈💜',
    'فالت: امشب یه کلیف‌هنگر می‌بینی که تا فردا نمی‌تونی ازش بگذری 😵',
    'ستاره‌ها می‌گن: امشب نه اسپویلر، نه عجله. فقط تو و یه چپتر خوب 🌙',
    'فالت می‌گه یه ژانر جدید امتحان کن؛ این بار «ترسناک»! (نه، رشوه نگرفتم 🎃)',
    'کریستال می‌گه: قهرمان ضعیفِ مانهوای بعدیت آخرش از همه قوی‌تر می‌شه. تو هم همین‌طور 💪',
    'پیشگویی: امشب یه پنل هست که ده بار برمی‌گردی و دوباره نگاهش می‌کنی 👀',
    'می‌بینم... آب‌نبات! کلی آب‌نبات! ...آهان، اون خود منم که دارم گرسنه می‌شم 🍬',
    'فال امروز: هرکی بهت گفت «مانهوا که چیزی نیست»، تا آخر ماه عاشقش می‌شه 😎',
    'ستاره‌ها می‌گن: بوکمارک‌هات هر روز پرتر می‌شه... وقتت هر روز کمتر. فاجعه‌ست! 📚',
    'کریستال می‌گه: امشب یه صحنه‌ی مبارزه می‌بینی که قشنگ همه‌چی توش می‌ترکه 💥',
    'مه‌آلوده... چیزی نمی‌بینم... آهان! می‌بینم که چپتر بعدی «تموم» نمی‌شه، فقط «ادامه داره» 🌫️',
    'فال شب: یه رمانتیکِ ترسناک تو راهه 💘💀',
    'یه مانهوای ناشناخته پیدا می‌کنی و ساعت‌ها غرقش می‌شی 💜',
    'هر کی اسپویل کنه، تا هفت شب خوابش نمی‌بره! 🧛',
    'کریستالم می‌گه: یه چپتر خیلی خوب تو راهه، زودتر از اونی که فکر می‌کنی. فقط صبور باش 🔮'
  ];
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(now.getFullYear(), 9, 31) - today) / 864e5);
  const COUNT = days === 0 ? 'امشب شب هالووینه! 🎃👻🦇' : days === 1 ? 'فقط یه شب تا هالووین مونده! 🎃' : days > 1 && days < 40 ? fa(days) + ' شب تا هالووین مونده! 🎃' : '';

  function init() {
    const m = document.querySelector('.hw-mascot');
    if (!m) return false;
    if (m.dataset.k) return true; m.dataset.k = '1';
    const say = m.querySelector('.hw-say');
    const old = m.querySelector('svg'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.className = 'k-wrap'; wrap.innerHTML = SVG; m.insertBefore(wrap, m.firstChild);
    const svg = wrap.firstElementChild;
    const hit = mk('div', 'k-hit', '', m); hit.setAttribute('role', 'button'); hit.tabIndex = 0; hit.setAttribute('aria-label', 'کدوچی');
    const mbtn = mk('button', 'k-mbtn', '✨', m); mbtn.type = 'button'; mbtn.setAttribute('aria-label', 'منوی کدوچی'); mbtn.setAttribute('aria-expanded', 'false');
    const orbit = mk('div', 'k-orbit', '', m);
    const toggle = document.querySelector('.hw-toggle'), badge = document.querySelector('.hw-count');
    const chip = mk('div', 'k-chip', '');
    const isWheel = !!(document.getElementById('spin') && document.getElementById('win'));

    /* ----- state ----- */
    let mood = 'happy', baseMood = 'happy', moodT, sayT, sleeping = false, lastAct = Date.now(), menuOpen = false, dragging = false, torch = false, treatAt = 0;
    let candy = +store.get('hw-candy', 0) || 0;
    let cos = store.get('hw-kcos', 'witch'); if (!COS.some((c) => c.id === cos && candy >= c.need)) cos = 'witch';
    let sfxOn = store.get('hw-ksfx', '0') === '1';
    svg.dataset.c = cos;

    /* ----- moods ----- */
    const nodes = Array.from(svg.querySelectorAll('[data-for]')).map((n) => [n, n.getAttribute('data-for').split(' ')]);
    const paint = () => { nodes.forEach(([n, a]) => { n.style.display = a.includes(mood) ? '' : 'none'; }); svg.dataset.mood = mood; };
    const setMood = (x, ms) => { mood = x; paint(); clearTimeout(moodT); if (ms) moodT = setTimeout(() => { mood = baseMood; paint(); }, ms); };
    paint();
    const cls = (c, ms) => { wrap.classList.remove(c); void wrap.offsetWidth; wrap.classList.add(c); clearTimeout(cls[c]); cls[c] = setTimeout(() => wrap.classList.remove(c), ms); };
    const mcls = (c, ms) => { m.classList.add(c); clearTimeout(mcls[c]); mcls[c] = setTimeout(() => m.classList.remove(c), ms); };
    const centre = () => { const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * .52, r }; };

    /* ----- speech ----- */
    const flipCheck = () => { const r = m.getBoundingClientRect(); m.classList.toggle('k-flip', r.left + r.width / 2 > innerWidth / 2); m.classList.toggle('k-under', r.top < 170); };
    const speak = (t, ms) => { say.textContent = t; flipCheck(); say.classList.add('show'); clearTimeout(sayT); sayT = setTimeout(() => say.classList.remove('show'), ms || Math.max(3600, Math.min(9500, 1900 + t.length * 62))); };
    const talkPool = () => GEN.concat([TOD(new Date().getHours())], COUNT ? [COUNT, COUNT] : [], document.querySelector('.profile') ? PROFILE : [], isWheel ? WHEEL : []);

    /* ----- particles ----- */
    const burst = (x, y, list, n) => {
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const s = mk('span', 'hw-pop', pick(list)); s.style.left = x + 'px'; s.style.top = y + 'px';
        const a = rnd(0, 6.283), d = rnd(40, 120);
        s.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d - 30}px)) scale(1.15) rotate(${rnd(-140, 140)}deg)`, opacity: 0 }], { duration: rnd(700, 1200), easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
      }
    };
    const burstM = (list, n) => { const c = centre(); burst(c.x, c.y - 10, list, n); };
    const rain = (list, n) => {
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const s = mk('span', 'hw-pop', pick(list)); s.style.left = rnd(2, 98) + 'vw'; s.style.top = '-40px'; s.style.fontSize = rnd(16, 32) + 'px'; s.style.zIndex = 90;
        s.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: `translateY(${innerHeight + 80}px) rotate(${rnd(-300, 300)}deg)`, opacity: .95 }], { duration: rnd(2400, 4400), delay: i * 80, easing: 'cubic-bezier(.4,.1,.7,.6)', fill: 'both' }).onfinish = () => s.remove();
      }
    };
    const floatText = (t) => {
      const c = centre(), s = mk('span', 'hw-pop k-float', t); s.style.left = c.x + 'px'; s.style.top = c.r.top + 'px';
      s.animate([{ transform: 'translate(-50%,0) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-26px) scale(1.15)', opacity: 1, offset: .25 }, { transform: 'translate(-50%,-70px) scale(1)', opacity: 0 }], { duration: 1400, easing: 'ease-out' }).onfinish = () => s.remove();
    };

    /* ----- sound (tiny synth, off by default) ----- */
    let ac = null;
    const A = () => { if (!sfxOn) return null; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; } };
    const tone = (f, d, type, v, to, delay) => {
      const c = A(); if (!c) return; const t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v || .06, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + .05);
    };
    const noise = (d, v, fc) => {
      const c = A(); if (!c) return; const n = Math.floor(c.sampleRate * d), b = c.createBuffer(1, n, c.sampleRate), D = b.getChannelData(0);
      for (let i = 0; i < n; i++) D[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b; f.type = 'lowpass'; f.frequency.value = fc; g.gain.value = v;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    };
    const sfx = {
      pop: () => tone(420, .14, 'sine', .08, 820),
      giggle: () => [0, .1, .2, .3, .4].forEach((d, i) => tone(520 + i * 40 + rnd(0, 60), .09, 'triangle', .05, 900, d)),
      boo: () => { tone(220, .7, 'sawtooth', .04, 90); tone(110, .7, 'square', .02, 60); },
      chime: () => { tone(784, .18, 'sine', .06); tone(1176, .3, 'sine', .05, null, .09); },
      thunder: () => { noise(1.4, .22, 500); tone(60, 1, 'sine', .08, 30); },
      creak: () => tone(140, .6, 'sawtooth', .03, 260),
      fanfare: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .22, 'triangle', .06, null, i * .1)),
      whoosh: () => noise(.5, .12, 1800)
    };

    /* ----- candy, costumes ----- */
    const chipUpdate = (bump) => {
      chip.textContent = '🍬 ' + fa(candy); chip.classList.toggle('on', candy > 0);
      const nx = COS.find((c) => c.need > candy); chip.title = nx ? 'تا لباس «' + nx.n + '»: ' + fa(nx.need - candy) + ' آب‌نبات' : 'همه‌ی لباس‌ها باز شدن!';
      if (bump) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    };
    const wear = (id) => { cos = id; svg.dataset.c = id; store.set('hw-kcos', id); };
    const gain = (n) => {
      const before = candy; candy += n; store.set('hw-candy', candy); chipUpdate(true); floatText('+' + fa(n) + ' 🍬'); sfx.chime();
      COS.forEach((c) => { if (before < c.need && candy >= c.need) setTimeout(() => { wear(c.id); setMood('cheer', 3200); cls('k-spin', 1000); speak('✨ لباس جدید باز شد: ' + c.n + ' ' + c.e, 5600); burstM(['✨', '🍬', c.e, '💜'], 18); sfx.fanfare(); }, 900); });
    };
    chipUpdate(false);

    /* ----- basic animations ----- */
    const jump = () => cls('k-jump', 800);
    const flip = () => { cls('k-spin', 1000); setMood('cheer', 1400); sfx.pop(); burstM(['✨', '💫'], 8); };
    const dizzy = () => { cls('k-dizzy', 1800); setMood('dizzy', 2600); speak(pick(['سرم گیج رفت 😵‍💫 بیا، آب‌نبات بگیر ببخشمت!', 'دنیا داره دور سرم می‌چرخه 🌀 ... خوشم اومد، دوباره!', 'وایسا! من کدوام، قرقره نیستم 😵'])); burstM(['🍬', '🍭', '🍫', '🎃'], 16); sfx.creak(); if (Math.random() < .5) setTimeout(() => gain(1), 600); };
    const tickle = () => { cls('k-jump', 800); setMood('laugh', 1800); speak(pick(['هاهاها قلقلکم نده 🤣', 'ایییی! قلقلکی‌ام 😂', 'بسه بسه، می‌ترکم از خنده... کدو بودن سخته 🎃', 'نه نه نه! اونجا نه! 🤭', 'من تسلیمم! هر چی خواستی بگیر، آب‌نباتامو نه 😂'])); burstM(['😂', '💛', '✨'], 8); sfx.giggle(); };
    const normalTap = () => {
      jump(); setMood(pick(['happy', 'cheer', 'wink', 'wow', 'laugh', 'love']), 1900); speak(fresh('talk', talkPool())); burstM(['✨', '🍬', '🦇'], 5); sfx.pop();
      if (Math.random() < .08) setTimeout(() => gain(1), 500);
    };

    /* ----- wake / sleep ----- */
    const wake = () => {
      lastAct = Date.now();
      if (sleeping) { sleeping = false; baseMood = 'happy'; setMood('wow', 1000); speak(pick(['ها؟! بیدارم بیدارم 😳 (خواب نبودم، فقط چشام رو استراحت می‌دادم)', 'خوابم برده بود... بوو! 👻', 'اوه، برگشتی! 🧡 داشتم خواب چپتر جدید می‌دیدم', 'من؟ خواب؟ نه بابا! فقط داشتم به آینده فکر می‌کردم 😴'])); }
    };
    setInterval(() => { if (on() && !sleeping && !menuOpen && !dragging && !torch && !document.hidden && Date.now() - lastAct > 75000) { sleeping = true; baseMood = 'sleepy'; setMood('sleepy'); speak('خوابم میاد... 😴', 3200); } }, 5000);
    ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach((ev) => addEventListener(ev, () => { lastAct = Date.now(); if (sleeping) wake(); }, { passive: true, capture: true }));

    /* ----- eyes follow the pointer ----- */
    addEventListener('pointermove', (e) => {
      lastAct = Date.now(); if (sleeping) wake();
      const _t = performance.now(); if (_t - (window.__hwPm2 || 0) < 50) return; window.__hwPm2 = _t;
      const r = m.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * .5), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 170);
      m.style.setProperty('--kx', (dx / d * 3.4 * k).toFixed(2) + 'px'); m.style.setProperty('--ky', (dy / d * 3.2 * k).toFixed(2) + 'px');
    }, { passive: true });

    /* ----- keep helper buttons next to the mascot ----- */
    const place = () => {
      if (!on()) { [toggle, badge].forEach((e) => { if (e) { e.style.left = ''; e.style.bottom = ''; } }); chip.style.left = ''; chip.style.bottom = ''; return; }
      const r = m.getBoundingClientRect(); if (!r.width) return;
      const fl = r.left + r.width / 2 > innerWidth / 2, x = fl ? r.left - 28 : r.right - 6, b = innerHeight - r.bottom + 4;
      if (toggle) { toggle.style.left = x + 'px'; toggle.style.bottom = b + 'px'; }
      if (badge) { badge.style.left = x + 'px'; badge.style.bottom = (b + 36) + 'px'; }
      chip.style.bottom = (b + 70) + 'px'; chip.style.left = (fl ? Math.max(4, x + 30 - chip.offsetWidth) : x) + 'px';
    };
    new MutationObserver(() => { place(); flipCheck(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(place).observe(chip, { childList: true, characterData: true, subtree: true });
    new MutationObserver(place).observe(badge || document.body, { childList: true, characterData: true, subtree: true });
    const clamp = () => {
      const r = m.getBoundingClientRect(); if (!r.width) return;
      m.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, r.left)) + 'px';
      m.style.bottom = Math.max(4, Math.min(innerHeight - r.height - 4, innerHeight - r.bottom)) + 'px'; place(); flipCheck();
    };
    try { const p = JSON.parse(store.get('hw-kpos', 'null')); if (p && isFinite(p.l) && isFinite(p.b)) { m.style.left = p.l + 'px'; m.style.bottom = p.b + 'px'; } } catch (e) {}
    addEventListener('resize', () => { clamp(); if (torch) torchStop(); }, { passive: true });
    setTimeout(() => { clamp(); }, 100);

    /* ----- drag & tap & long-press ----- */
    let pd = null, lpT, taps = [], lastTap = 0, holdSaid = 0;
    hit.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; wake(); const r = m.getBoundingClientRect();
      pd = { id: e.pointerId, x: e.clientX, y: e.clientY, L: r.left, B: innerHeight - r.bottom, W: r.width, H: r.height, moved: false, long: false };
      try { hit.setPointerCapture(e.pointerId); } catch (er) {}
      clearTimeout(lpT); lpT = setTimeout(() => { if (pd && !pd.moved) { pd.long = true; if (navigator.vibrate) try { navigator.vibrate(18); } catch (er) {} menuOpen ? closeMenu() : openMenu(); } }, 620);
    });
    hit.addEventListener('pointermove', (e) => {
      if (!pd || e.pointerId !== pd.id) return;
      const dx = e.clientX - pd.x, dy = e.clientY - pd.y;
      if (!pd.moved && Math.hypot(dx, dy) > 7) { pd.moved = true; dragging = true; clearTimeout(lpT); closeMenu(); m.classList.add('k-hold'); setMood('scared'); if (Date.now() - holdSaid > 9000) { holdSaid = Date.now(); speak(pick(['وااای منو بلند کردی! 😳', 'پاهام به زمین نمی‌رسه! 🦶', 'آروم‌تر! سرم گیج می‌ره 😵', 'مواظب باش، من شکننده‌ام... یه کدوی خیلی شکننده 🥺', 'من رو کجا می‌بری؟! جریمه‌ی ناپدید شدن داره 😨'])); sfx.whoosh(); } }
      if (pd.moved) {
        m.style.left = Math.max(4, Math.min(innerWidth - pd.W - 4, pd.L + dx)) + 'px';
        m.style.bottom = Math.max(4, Math.min(innerHeight - pd.H - 4, pd.B - dy)) + 'px'; place(); flipCheck();
      }
    });
    const up = (e) => {
      clearTimeout(lpT); if (!pd || (e.pointerId !== undefined && e.pointerId !== pd.id)) return; const was = pd; pd = null;
      if (was.moved) {
        dragging = false; m.classList.remove('k-hold'); cls('k-drop', 700); setMood('cheer', 1600); speak(pick(['هورا! جای جدید قشنگه 🏡', 'فرود نرم! 🪂 ده از ده', 'اینجا بهتره، ممنون! 🧡 منظره‌ش باحاله', 'اینجا چقدر جا داره! می‌تونم رقصم رو تمرین کنم 💃'])); sfx.pop();
        store.set('hw-kpos', JSON.stringify({ l: parseFloat(m.style.left), b: parseFloat(m.style.bottom) })); place(); flipCheck();
      } else if (!was.long) tap();
    };
    hit.addEventListener('pointerup', up); hit.addEventListener('pointercancel', up);
    hit.addEventListener('click', (e) => e.stopPropagation());
    hit.addEventListener('contextmenu', (e) => e.preventDefault());
    hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.shiftKey ? (menuOpen ? closeMenu() : openMenu()) : tap(); } });
    function tap() {
      const t = performance.now(); taps = taps.filter((x) => t - x < 2600); taps.push(t); wake();
      if (taps.length >= 7) { taps = []; return dizzy(); }
      if (t - lastTap < 300) { lastTap = 0; return flip(); } lastTap = t;
      if (taps.length >= 4) return tickle();
      normalTap();
    }

    /* ----- orbit menu ----- */
    const ITEMS = () => [
      { e: '🎭', t: 'لباس', run: cycleCostume },
      { e: '🍬', t: 'ترت یا ترت', run: treat },
      { e: '🔮', t: 'فال', run: fortune },
      { e: '🪄', t: 'جادو', run: spell },
      { e: '🔦', t: 'چراغ‌قوه', run: torchToggle },
      { e: sfxOn ? '🔊' : '🔇', t: 'صدا', run: toggleSfx },
      { e: '💬', t: 'حرف بزن', run: () => { setMood(pick(['happy', 'wink', 'cheer']), 2000); jump(); speak(fresh('talk', talkPool()), 5600); } },
      isWheel ? { e: '👑', t: 'اشتراک VIP', run: () => go('/vip.html', 'VIP یعنی جایزه‌های ویژه‌ی چرخ! 👑') } : { e: '🎡', t: 'چرخونه', run: () => { const a = document.querySelector('.hw-wheel-btn'); go((a && a.getAttribute('href')) || '/halloween-wheel.html', 'برو چرخونه‌ی هالووین رو امتحان کن! 🎡'); } }
    ];
    function layout(n) {
      const c = centre(), W = innerWidth, H = innerHeight, pad = 30, step = Math.PI / 60;
      const ok = (a, R) => { const x = c.x + Math.cos(a) * R, y = c.y + Math.sin(a) * R; return x > pad && x < W - pad && y > pad && y < H - pad; };
      let last = null;
      for (const R of [112, 136, 160, 186]) {
        const need = 2 * Math.asin(27 / R) * (n - 1); let best = null, cur = null;
        for (let a = -Math.PI; a <= Math.PI * 3; a += step) { if (ok(a, R)) { if (!cur) cur = { s: a, e: a }; else cur.e = a; } else { if (cur && (!best || cur.e - cur.s > best.e - best.s)) best = cur; cur = null; } }
        if (cur && (!best || cur.e - cur.s > best.e - best.s)) best = cur;
        if (!best) continue; last = { R, best };
        if (best.e - best.s >= need) { const span = Math.min(best.e - best.s, Math.max(need, Math.PI * .95), Math.PI * 1.25), mid = (best.s + best.e) / 2; return { R, angles: Array.from({ length: n }, (_, i) => mid - span / 2 + i * span / (n - 1)) }; }
      }
      if (last) { const span = Math.min(last.best.e - last.best.s, Math.PI * 1.25), mid = (last.best.s + last.best.e) / 2; return { R: last.R, angles: Array.from({ length: n }, (_, i) => mid - span / 2 + i * span / (n - 1)) }; }
      return { R: 112, angles: Array.from({ length: n }, (_, i) => -Math.PI + i * Math.PI / (n - 1)) };
    }
    function openMenu() {
      if (menuOpen) return; menuOpen = true; wake(); const items = ITEMS(), L = layout(items.length); orbit.innerHTML = '';
      items.forEach((it, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'k-op'; b.dataset.t = it.t; b.setAttribute('aria-label', it.t); b.textContent = it.e;
        b.style.setProperty('--x', (Math.cos(L.angles[i]) * L.R).toFixed(1) + 'px'); b.style.setProperty('--y', (Math.sin(L.angles[i]) * L.R).toFixed(1) + 'px'); b.style.setProperty('--i', i);
        b.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); setTimeout(it.run, 140); });
        orbit.appendChild(b);
      });
      void orbit.offsetWidth; orbit.classList.add('open'); m.classList.add('k-menu'); mbtn.setAttribute('aria-expanded', 'true'); mbtn.textContent = '✕';
      store.set('hw-kseen', '1'); mbtn.classList.remove('k-ping'); setMood('wink', 1600); speak(pick(['چی کار کنیم؟ 😎', 'یه چیزی انتخاب کن! ✨', 'من آماده‌ام! 🎃']), 3200); sfx.pop();
    }
    function closeMenu() { if (!menuOpen) return; menuOpen = false; orbit.classList.remove('open'); m.classList.remove('k-menu'); mbtn.setAttribute('aria-expanded', 'false'); mbtn.textContent = '✨'; setTimeout(() => { if (!menuOpen) orbit.innerHTML = ''; }, 420); }
    if (store.get('hw-kseen', '0') !== '1') mbtn.classList.add('k-ping');
    mbtn.addEventListener('click', (e) => { e.stopPropagation(); wake(); menuOpen ? closeMenu() : openMenu(); });
    document.addEventListener('pointerdown', (e) => { if (menuOpen && !m.contains(e.target)) closeMenu(); }, true);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); if (torch) torchStop('چراغ‌قوه خاموش شد 🔦'); } });

    /* ----- actions ----- */
    function cycleCostume() {
      const open = COS.filter((c) => candy >= c.need), i = open.findIndex((c) => c.id === cos), nx = open[(i + 1) % open.length], lock = COS.find((c) => c.need > candy);
      if (open.length === 1) { speak('لباس‌های جدید با آب‌نبات باز می‌شن! ' + fa(lock.need) + ' تا بیار 🍬 (از منو «ترت یا ترت»)', 5600); setMood('wink', 1800); return; }
      wear(nx.id); cls('k-spin', 1000); setMood('cheer', 1600); sfx.pop(); burstM(['✨', nx.e], 10);
      speak(nx.e + ' ' + nx.n + '!' + (lock ? '  (لباس بعدی: ' + fa(lock.need - candy) + ' آب‌نبات دیگه 🔒)' : '  همه‌ی لباس‌ها باز شدن 🏆'), 5200);
    }
    function treat() {
      if (Date.now() - treatAt < 2200) { speak(pick(['یه کم صبر کن، دارم آب‌نبات می‌پیچم 🍬', 'ای بابا، انقدر عجله نکن! آب‌نباتا خودشون نمی‌پیچن 😤', 'تو که همه‌ی ذخیره‌ی منو می‌خوای! صبر کن 🍬']), 3000); return; } treatAt = Date.now();
      const r = Math.random(), c = centre();
      if (r < .62) { setMood('love', 1800); jump(); speak(fresh('treat', TREAT)); burstM(['🍬', '🍭', '🍫'], 12); gain(1 + (r < .2 ? 1 : 0)); }
      else if (r < .9) {
        const tricks = [
          () => { /* spider */
            const s = mk('div', 'k-spider', SPIDER), x = rnd(innerWidth * .25, innerWidth * .75); s.style.left = x + 'px';
            s.animate([{ transform: 'translateY(-130%)' }, { transform: `translateY(${innerHeight * .34}px)`, offset: .35 }, { transform: `translateY(${innerHeight * .3}px)`, offset: .6 }, { transform: 'translateY(-130%)' }], { duration: 3000, easing: 'ease-in-out' }).onfinish = () => s.remove();
            setMood('scared', 2800); mcls('k-shake', 1600); sfx.boo(); speak(pick(['عنکبوت! 🕷️ هاها ترسیدی؟ حقه بود!', 'عنکبوووت! 🕷️ ... اوه، فقط دوست من بود. خودمم ترسیدم 😅'])); setTimeout(() => gain(1), 1700);
          },
          () => { /* thunder */ lightning(); speak('بوووم! ⚡ این حقه‌ی من بود... خب شاید یه کم زیادی جدی شد. بیا یه آب‌نبات برای جبران'); setTimeout(() => gain(1), 1500); },
          () => { setMood('evil', 2600); cls('k-jump', 800); sfx.boo(); speak('هه‌هه‌هه! این بار حقه بود 😈 ... ولی دلم نیومد خالی‌دست بری، بیا یه آب‌نبات'); burstM(['😈', '🦇', '💀'], 10); setTimeout(() => gain(1), 1500); }
        ];
        pick(tricks)();
      } else { setMood('cheer', 3600); flip(); speak('جکپات! 🎰 پنج‌تا آب‌نبات! امشب شانس با توئه... برای همین از اول ازت می‌ترسیدم 😳', 5600); rain(['🍬', '🍭', '🍫', '🧁'], 26); sfx.fanfare(); setTimeout(() => gain(5), 700); }
    }
    function fortune() {
      setMood('wow', 700); sfx.creak();
      const o = mk('div', 'k-orb', '🔮'); const c = centre(); o.style.left = c.x + 'px'; o.style.top = c.y + 'px';
      o.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-150%) scale(1.5) rotate(180deg)', opacity: 1, offset: .5 }, { transform: 'translate(-50%,-190%) scale(.2) rotate(360deg)', opacity: 0 }], { duration: 1500, easing: 'ease-out' }).onfinish = () => o.remove();
      setTimeout(() => { setMood('love', 2600); speak(fresh('fortune', FORTUNE), 8200); burstM(['✨', '💜', '🔮'], 8); sfx.chime(); }, 900);
    }
    function lightning() {
      const f = mk('div', 'hw-flash'); f.animate([{ opacity: 0 }, { opacity: .8, offset: .08 }, { opacity: .05, offset: .22 }, { opacity: .55, offset: .34 }, { opacity: 0 }], { duration: 800 }).onfinish = () => f.remove(); sfx.thunder(); setMood('scared', 1500);
    }
    function spell() {
      const c = centre(), W = innerWidth;
      const spells = [
        ['🦇 خفاش‌ها بیدار شدن!', () => { for (let i = 0; i < 10; i++) setTimeout(() => { const b = mk('div', 'hw-bat', BAT); b.style.top = '0'; b.style.width = rnd(28, 46) + 'px'; const a = rnd(-2.7, -.45), d = rnd(240, 560), dx = Math.cos(a) * d, dy = Math.sin(a) * d; b.animate([{ transform: `translate(${c.x}px,${c.y}px) scale(.3)`, opacity: 0 }, { opacity: 1, offset: .15 }, { transform: `translate(${c.x + dx}px,${c.y + dy}px) scale(1)`, opacity: 1, offset: .75 }, { transform: `translate(${c.x + dx * 1.25}px,${c.y + dy * 1.3}px) scale(1)`, opacity: 0 }], { duration: rnd(2600, 3800), easing: 'ease-out' }).onfinish = () => b.remove(); }, i * 110); sfx.whoosh(); }],
        ['⚡ طوفان شب!', () => { lightning(); setTimeout(lightning, 900); }],
        ['🍬 بارون آب‌نبات!', () => { rain(['🍬', '🍭', '🍫', '🧁', '🎃'], 34); sfx.chime(); }],
        ['👻 رژه‌ی ارواح!', () => { for (let i = 0; i < 5; i++) { const g = mk('div', 'k-parade', GHOST), w = rnd(32, 54), ltr = Math.random() < .5, y = rnd(10, 70); g.style.top = y + 'vh'; g.style.width = w + 'px'; const a = ltr ? -80 : W + 40, b = ltr ? W + 40 : -80; g.animate([{ transform: `translate(${a}px,0)` }, { transform: `translate(${a + (b - a) * .33}px,-26px)` }, { transform: `translate(${a + (b - a) * .66}px,26px)` }, { transform: `translate(${b}px,0)` }], { duration: rnd(6500, 9500), delay: i * 600, fill: 'both', easing: 'ease-in-out' }).onfinish = () => g.remove(); } sfx.boo(); }],
        ['🎆 آتش‌بازی کدویی!', () => { for (let i = 0; i < 6; i++) setTimeout(() => { burst(rnd(W * .1, W * .9), rnd(innerHeight * .12, innerHeight * .5), ['✨', '🧡', '💜', '💛', '🎃'], 16); sfx.pop(); }, i * 320); }],
        ['🎃 بارون کدو!', () => { rain(['🎃', '🎃', '🎃', '🦇'], 26); }]
      ];
      const s = pick(spells); setMood('evil', 2000); mcls('k-cast', 1400); cls('k-jump', 800); speak(s[0], 3800); setTimeout(s[1], 450);
    }
    function toggleSfx() { sfxOn = !sfxOn; store.set('hw-ksfx', sfxOn ? '1' : '0'); if (sfxOn) { sfx.chime(); speak('صدا روشن شد 🔊 (قول می‌دم فقط وقتی لازمه جیغ بزنم)'); } else speak('صدا خاموش شد 🔇'); }
    function go(url, msg) { setMood('cheer', 1600); speak(msg, 2400); setTimeout(() => { location.href = url; }, 900); }

    /* ----- flashlight ghost hunt ----- */
    let dark = null, lost = [], torchT = null;
    const light = (x, y) => { if (!dark) return; dark.style.setProperty('--lx', x + 'px'); dark.style.setProperty('--ly', y + 'px'); lost.forEach((g) => { if (g.found) return; const d = Math.hypot(g.cx - x, g.cy - y); g.el.style.opacity = Math.max(0, Math.min(1, 1 - (d - 60) / 100)).toFixed(2); }); };
    const tMove = (e) => { const t = e.touches ? e.touches[0] : e; if (t) light(t.clientX, t.clientY); };
    const tDown = (e) => {
      const t = e.touches ? e.touches[0] : e; if (!t) return; light(t.clientX, t.clientY);
      lost.forEach((g) => { if (!g.found && Math.hypot(g.cx - t.clientX, g.cy - t.clientY) < 36) {
        g.found = true; g.el.style.opacity = 1; g.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6) translateY(-30px)', opacity: 0 }], { duration: 600, fill: 'forwards' }).onfinish = () => g.el.remove();
        burst(g.cx, g.cy, ['👻', '💜', '✨', '🍬'], 8); sfx.pop(); gain(2);
        if (lost.every((x) => x.found)) setTimeout(() => torchStop('همه‌ی ارواح رو پیدا کردی! 🏆 شکارچی واقعی‌ای، حتی کدوها هم ازت می‌ترسن'), 700);
        else speak('یکی پیدا شد! ' + fa(lost.filter((x) => !x.found).length) + ' تا مونده 👻', 2400);
      } });
    };
    function torchToggle() { torch ? torchStop('چراغ‌قوه خاموش شد 🔦') : torchStart(); }
    function torchStart() {
      if (torch) return; torch = true; const c = centre(), W = innerWidth, H = innerHeight;
      dark = mk('div', 'k-dark'); dark.style.setProperty('--lx', c.x + 'px'); dark.style.setProperty('--ly', (c.y - 90) + 'px'); void dark.offsetWidth; dark.classList.add('on');
      lost = [];
      for (let i = 0, tries = 0; i < 3 && tries < 60; tries++) {
        const x = rnd(40, W - 40), y = rnd(110, H - 90); if (Math.hypot(x - c.x, y - c.y) < 150) continue; i++;
        lost.push({ cx: x, cy: y, found: false, el: (() => { const e = mk('div', 'k-lost', GHOST); e.style.left = (x - 19) + 'px'; e.style.top = (y - 22) + 'px'; return e; })() });
      }
      addEventListener('pointermove', tMove, { passive: true }); addEventListener('pointerdown', tDown, { passive: true }); addEventListener('touchmove', tMove, { passive: true });
      setMood('wow', 2000); speak('چراغ‌قوه روشنه! 🔦 سه‌تا روح گمشده تو تاریکی قایم شدن؛ پیداشون کن (Esc = خروج)', 6200); sfx.creak();
      torchT = setTimeout(() => torchStop('وقت تموم شد! ارواح فرار کردن 👻💨 دفعه‌ی بعد سریع‌تر!'), 45000);
      light(c.x, c.y - 90);
    }
    function torchStop(msg) {
      if (!torch) return; torch = false; clearTimeout(torchT);
      removeEventListener('pointermove', tMove); removeEventListener('pointerdown', tDown); removeEventListener('touchmove', tMove);
      const d = dark; dark = null; if (d) { d.classList.remove('on'); setTimeout(() => d.remove(), 450); } lost.forEach((g) => g.el.remove()); lost = [];
      setMood('cheer', 1600); if (msg) speak(msg, 4400); if (msg && msg.indexOf('🏆') > -1) { rain(['🍬', '🎃', '✨', '👻'], 24); sfx.fanfare(); }
    }

    /* ----- idle life ----- */
    (function idleLoop() {
      setTimeout(() => {
        if (on() && !document.hidden && !calm && !menuOpen && !dragging && !sleeping && !torch) {
          const a = pick(['look', 'look', 'wave', 'hop', 'hum', 'yawn', 'wink', 'tap', 'wave']);
          if (a === 'look') { m.style.setProperty('--kx', rnd(-3.4, 3.4).toFixed(1) + 'px'); m.style.setProperty('--ky', rnd(-3, 2).toFixed(1) + 'px'); }
          else if (a === 'wave') { mcls('k-wave', 1900); setMood('cheer', 1700); }
          else if (a === 'hop') cls('k-hop', 600);
          else if (a === 'hum') { cls('k-sway', 2500); setMood('happy'); const c = centre(); for (let i = 0; i < 3; i++) setTimeout(() => { const s = mk('span', 'hw-pop', pick(['♪', '♫', '♬'])); s.style.left = (c.x + rnd(-10, 30)) + 'px'; s.style.top = (c.y - 40) + 'px'; s.style.color = '#ffd27a'; s.style.fontSize = '18px'; s.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { opacity: 1, offset: .2 }, { transform: `translate(${rnd(10, 36)}px,-54px) scale(1.1)`, opacity: 0 }], { duration: 1800 }).onfinish = () => s.remove(); }, i * 450); }
          else if (a === 'yawn') setMood('yawn', 1700);
          else if (a === 'wink') setMood('wink', 1200);
          else if (a === 'tap') mcls('k-tap', 1700);
        }
        idleLoop();
      }, window.HW_LOUD ? rnd(7000, 15000) : rnd(30000, 60000));
    })();

    /* ----- reactions to the rest of the page ----- */
    new MutationObserver((list) => list.forEach((r) => r.addedNodes.forEach((n) => {
      if (!n.classList) return;
      if (n.classList.contains('hw-witch')) { mcls('k-wave', 1900); setMood('cheer', 2200); if (Math.random() < .6) speak(pick(['سلام خاله جادوگره! 🧹', 'خاله جادوگر! کلاهم رو دیدی؟ 🎩', 'مواظب باش جارو رو تو ترافیک نیاری! 🧹']), 3200); }
      else if (n.classList.contains('hw-flash') && !torch) { setMood('scared', 1400); mcls('k-shake', 900); if (Math.random() < .4) speak(pick(['وای رعد و برق! ⚡', 'اووو! ⚡ این یکی بلند بود', 'من نترسیدم! ... فقط یه کم پریدم 🙈']), 2800); }
      else if (n.classList.contains('hw-peek')) { setMood('wow', 1800); look2(n); if (Math.random() < .5) speak(pick(['اونجا چیزی بود؟! 👀', 'دو تا چشم تو تاریکی... نه، ندیدم، هیچی ندیدم 🙈', 'یکی داره نگاهمون می‌کنه! 👀 (ترجیح می‌دم فکر کنم دوستانه‌ست)']), 3200); }
    }))).observe(document.body, { childList: true });
    function look2(n) { const r = n.getBoundingClientRect(), c = centre(), dx = r.left - c.x, dy = r.top - c.y, d = Math.hypot(dx, dy) || 1; m.style.setProperty('--kx', (dx / d * 3.4).toFixed(1) + 'px'); m.style.setProperty('--ky', (dy / d * 3).toFixed(1) + 'px'); }
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.hwg')) { setMood(pick(['wink', 'love', 'cheer']), 1400); sfx.pop(); if (Math.random() < .3) setTimeout(() => gain(1), 400); } }, true);

    /* ----- lucky wheel page ----- */
    if (isWheel) {
      const sb = document.getElementById('spin'), win = document.getElementById('win');
      sb.addEventListener('click', () => { if (sb.disabled) return; setMood('scared', 6200); mcls('k-shake', 6200); speak('وای وای... نفسم بند اومد 😬', 6000); sfx.creak(); }, true);
      new MutationObserver(() => {
        if (!win.classList.contains('on')) return;
        const p = document.getElementById('w-p'); mcls('k-shake', 1); m.classList.remove('k-shake'); setMood('cheer', 7000);
        [0, 450, 900].forEach((d) => setTimeout(jump, d)); setTimeout(() => cls('k-spin', 1000), 1400);
        speak('🎉 تبریک! ' + (p ? p.textContent : ''), 7000); burstM(['🎉', '✨', '🍬', '💎', '🎃'], 22); sfx.fanfare();
      }).observe(win, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { if (!sb.disabled) { setMood('wink', 1800); speak(pick(WHEEL), 5200); } }, 4500);
    } else if (COUNT) setTimeout(() => { if (Math.random() < (window.HW_LOUD ? .5 : .2)) speak(COUNT, 4200); }, 9000);

    setTimeout(() => { mcls('k-wave', 1900); }, 1800);
    place(); flipCheck();
    window.hwKodoochi = { setMood, speak, gain, open: openMenu, close: closeMenu, torch: torchToggle, spell, treat, fortune, wear, state: () => ({ mood, candy, cos }) };
    return true;
  }
  (function boot(n) { if (!init() && n < 40) setTimeout(() => boot(n + 1), 150); })(0);
})();


/* ManhwaChi — Halloween v6 (Kodoochi 3.0). Additive: load/append AFTER the v5 block. Needs window.hwKodoochi. */
(function () {
  if (window.__hwK6) return; window.__hwK6 = 1;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const mk = (tag, cls, html, parent) => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; (parent || document.body).appendChild(e); return e; };

  let tries = 0;
  (function boot() {
    const m = document.querySelector('.hw-mascot');
    if (m && m.dataset.k && window.hwKodoochi && m.querySelector('.k-wrap')) init(m);
    else if (tries++ < 100) setTimeout(boot, 200);
  })();

  function init(m) {
    if (m.dataset.k6) return; m.dataset.k6 = '1';
    const K = window.hwKodoochi, wrap = m.querySelector('.k-wrap'), svg = wrap.firstElementChild;
    const centre = () => { const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * .52, r }; };

    /* ----- prettier: halo + fireflies ----- */
    mk('div', 'k6-halo', '', m); mk('div', 'k6-ff', '<i></i><i></i><i></i><i></i>', m);

    /* ----- accessories (SVG layer) ----- */
    svg.insertAdjacentHTML('beforeend', `<g class="k6-acc">
<g class="a-phones"><path d="M20 66Q18 20 60 20Q102 20 100 66" stroke="#241a3d" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="12" y="58" width="13" height="22" rx="6" fill="#ff4d7e" stroke="#7a0f2c" stroke-width="1.4"/><rect x="95" y="58" width="13" height="22" rx="6" fill="#ff4d7e" stroke="#7a0f2c" stroke-width="1.4"/></g>
<g class="a-shades"><rect x="30" y="53" width="27" height="19" rx="7" fill="#12091f" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1.2"/><rect x="63" y="53" width="27" height="19" rx="7" fill="#12091f" stroke="#a78bfa" stroke-opacity=".6" stroke-width="1.2"/><path d="M57 60h6" stroke="#12091f" stroke-width="3"/><path d="M34 58l9-2M67 58l9-2" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/></g>
<g class="a-stache"><path d="M60 74Q52 67 42 74Q49 82 60 76Q71 82 78 74Q68 67 60 74Z" fill="#2b1b45" stroke="#12091f" stroke-width="1"/></g>
<g class="a-bow"><path d="M60 103 44 94V112Z M60 103 76 94V112Z" fill="#e11d48" stroke="#7f1d1d" stroke-width="1.4" stroke-linejoin="round"/><circle cx="60" cy="103" r="4.4" fill="#be123c" stroke="#7f1d1d" stroke-width="1.2"/></g>
<g class="a-scarf"><path d="M28 98Q60 112 92 98L94 108Q60 122 26 108Z" fill="#38bdf8" stroke="#0369a1" stroke-width="1.4"/><path d="M78 109l7 16 9-3-6-15z" fill="#38bdf8" stroke="#0369a1" stroke-width="1.4"/><path d="M36 104q24 8 48 0" stroke="#fff" stroke-opacity=".4" stroke-width="2" fill="none"/></g>
</g>`);
    const ACC = ['', 'shades', 'stache', 'bow', 'scarf', 'phones'], ACCN = ['بدون اکسسوری', 'عینک آفتابی 😎', 'سبیل 🥸', 'پاپیون 🎀', 'شال گردن 🧣', 'هدفون 🎧'];
    let ai = Math.max(0, +store.get('hw-k6acc', 0) || 0) % ACC.length; svg.dataset.a = ACC[ai];

    /* ----- skins ----- */
    const SKIN = ['', 'hue-rotate(80deg) saturate(1.1)', 'hue-rotate(220deg)', 'hue-rotate(300deg) saturate(1.2)', 'grayscale(1) brightness(1.45)', 'hue-rotate(150deg) saturate(1.3)'];
    const bags6 = {}, last6 = {};
    const fresh6 = (k, arr) => { let b = bags6[k]; if (!b || !b.length) { b = bags6[k] = arr.slice().sort(() => Math.random() - .5); if (b.length > 1 && b[b.length - 1] === last6[k]) b.unshift(b.pop()); } return (last6[k] = b.pop()); };
    const SKINN = ['نارنجی کلاسیک 🎃', 'کدوی سبز 🟢', 'کدوی بنفش 🟣', 'کدوی صورتی 🌸', 'کدوی روح 👻', 'کدوی آبی 🧊'];
    let si = Math.max(0, +store.get('hw-k6skin', 0) || 0) % SKIN.length; svg.style.filter = SKIN[si] || '';

    /* ----- helpers ----- */
    const pop = (x, y, list, n, far) => {
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const s = mk('span', 'k6-p', pick(list)); s.style.left = x + 'px'; s.style.top = y + 'px';
        const a = rnd(0, 6.283), d = rnd(40, far || 120);
        s.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d - 30}px)) scale(1.15) rotate(${rnd(-140, 140)}deg)`, opacity: 0 }], { duration: rnd(700, 1200), easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
      }
    };
    const popM = (list, n) => { const c = centre(); pop(c.x, c.y - 10, list, n); };
    const rain = (list, n) => {
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const s = mk('span', 'k6-p', pick(list)); s.style.left = rnd(2, 96) + 'vw'; s.style.top = '-40px'; s.style.fontSize = rnd(18, 34) + 'px';
        s.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: `translateY(${innerHeight + 80}px) rotate(${rnd(-300, 300)}deg)`, opacity: .95 }], { duration: rnd(2200, 4200), delay: i * 70, easing: 'cubic-bezier(.4,.1,.7,.6)', fill: 'both' }).onfinish = () => s.remove();
      }
    };
    const cls = (el, c, ms) => { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); setTimeout(() => el.classList.remove(c), ms); };
    let ac = null;
    const tone = (f, d, type, v, delay) => {
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
        const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v || .07, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + .05);
      } catch (e) {}
    };
    const sfxOn = () => store.get('hw-ksfx', '0') === '1';
    let busy = false, follow = false, tx = innerWidth / 2, ty = innerHeight / 2, raf = 0, fn = 0;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
    addEventListener('pointerdown', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });

    /* ----- actions ----- */
    const dance = () => {
      if (busy) return; busy = true; K.setMood('cheer', 5200); cls(wrap, 'k6-dance', 5200); m.classList.add('k-wave'); setTimeout(() => m.classList.remove('k-wave'), 1900);
      K.speak(pick(['پیست رقص مال منه! 💃🕺', 'ببین چه حرکاتی بلدم 🎶', 'همه با من! 🎃🎵', 'یه کدو که می‌رقصه، یه ستاره که متولد می‌شه ⭐', 'نگاه نکن، دارم تمرین می‌کنم! ...خب نگاه کن 😎']), 3800);
      const notes = ['♪', '♫', '♬', '✨', '🎶'];
      for (let i = 0; i < 12; i++) setTimeout(() => { popM(notes, 3); if (sfxOn()) tone(i % 2 ? 196 : 130, .18, 'square', .04); }, i * 420);
      setTimeout(() => { busy = false; if (Math.random() < .6) K.gain(1); }, 5200);
    };
    const chase = () => {
      follow = !follow;
      if (!follow) { cancelAnimationFrame(raf); wrap.classList.remove('k6-walk'); store.set('hw-kpos', JSON.stringify({ l: parseFloat(m.style.left), b: parseFloat(m.style.bottom) })); K.setMood('happy'); K.speak(pick(['خب خسته شدم، وایسادم 😮‍💨', 'پاهام ندارم ولی خسته‌ام! 😮‍💨', 'خب بسه! یه کدو هم حق استراحت داره 😤'])); mark('chase', false); return; }
      mark('chase', true); K.setMood('cheer', 1800); K.speak('دنبالتم! موشت رو تکون بده... یا انگشتت رو 🏃‍♂️💨', 3600);
      const step = () => {
        if (!follow) return; const c = centre(), dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
        if (d > 90 && !m.classList.contains('k-hold')) {
          const s = Math.min(6.5, d * .06), r = c.r, L = parseFloat(m.style.left) || r.left, B = parseFloat(m.style.bottom) || (innerHeight - r.bottom);
          m.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, L + dx / d * s)) + 'px';
          m.style.bottom = Math.max(4, Math.min(innerHeight - r.height - 4, B - dy / d * s)) + 'px';
          wrap.classList.add('k6-walk'); if (++fn % 8 === 0) dispatchEvent(new Event('resize'));
        } else wrap.classList.remove('k6-walk');
        raf = requestAnimationFrame(step);
      }; raf = requestAnimationFrame(step);
    };
    const fire = () => {
      if (busy) return; busy = true; K.setMood('evil', 1800); cls(wrap, 'k-jump', 800);
      const c = centre(), dir = m.classList.contains('k-flip') ? -1 : 1; K.speak(pick(['هوووف! 🔥 مواظب باش!', 'اژدها؟ نه، کدو! 🔥 ولی همچنان خطرناک', 'هیچی نگو، فقط یه کم سوختی ام 🔥😳']), 2600);
      for (let i = 0; i < 18; i++) setTimeout(() => {
        const s = mk('span', 'k6-p', pick(['🔥', '🔥', '🧡', '✨'])); s.style.left = (c.x + dir * 20) + 'px'; s.style.top = (c.y + 8) + 'px'; s.style.fontSize = rnd(20, 38) + 'px';
        s.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 }, { transform: `translate(calc(-50% + ${dir * rnd(90, 230)}px),calc(-50% + ${rnd(-50, 30)}px)) scale(1.3)`, opacity: 0 }], { duration: rnd(600, 1000), easing: 'ease-out' }).onfinish = () => s.remove();
        if (sfxOn() && i % 4 === 0) tone(rnd(90, 160), .2, 'sawtooth', .03);
      }, i * 45);
      setTimeout(() => { busy = false; }, 1500);
    };
    const game = () => {
      if (busy) return; busy = true; let score = 0, left = 15; K.setMood('wow', 1200); K.speak('بازی! آب‌نبات‌ها رو بگیر 🍬 ولی از 💀 دوری کن؛ اون دشمنِ منه نه دوستم!', 4000);
      const hud = mk('div', 'k6-hud', ''), upd = () => { hud.textContent = '🍬 ' + fa(score) + '   ⏱ ' + fa(left); }; upd();
      const iv = setInterval(() => {
        if (left <= 0) return;
        const bad = Math.random() < .18, e = mk('span', 'k6-c', bad ? '💀' : pick(['🍬', '🍭', '🍫', '🧁', '🍬']));
        e.style.left = rnd(4, Math.max(10, innerWidth - 48)) + 'px';
        e.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (e.dataset.x) return; e.dataset.x = 1; const r = e.getBoundingClientRect(); score = Math.max(0, score + (bad ? -2 : 1)); upd(); pop(r.left + 18, r.top + 18, bad ? ['💥', '💀'] : ['✨', '💛'], 5, 70); if (sfxOn()) tone(bad ? 120 : 880, .12, bad ? 'sawtooth' : 'sine', .05); K.setMood(bad ? 'scared' : 'cheer', 500); e.remove(); });
        e.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(${innerHeight + 90}px) rotate(${rnd(-200, 200)}deg)` }], { duration: rnd(2000, 3400), easing: 'linear', fill: 'forwards' }).onfinish = () => e.remove();
      }, 420);
      const tk = setInterval(() => { left--; upd(); if (left <= 0) { clearInterval(tk); clearInterval(iv); setTimeout(() => { hud.remove(); busy = false; const win = Math.ceil(score / 4); if (win > 0) { K.speak('امتیازت ' + fa(score) + ' شد! 🏆 جایزه: ' + fa(win) + ' آب‌نبات', 5200); K.setMood('love', 3000); rain(['🍬', '🍭', '🎃'], 14); K.gain(win); } else { K.speak(pick(['این دفعه نشد! دوباره امتحان کن 😅', 'اوه... نه عیبی نداره، خودم هم اولش همین‌طور بودم 😅', 'امتیاز صفر؟! قوانین رو یه بار دیگه بخون 🫣']), 3800); K.setMood('sleepy', 1800); } }, 900); } }, 1000);
    };
    const sing = () => {
      if (busy) return; busy = true; const sc = [523, 587, 659, 784, 880, 1047, 784, 659, 587, 659, 523], n = ['♪', '♫', '♬'];
      K.speak(pick(['لالالا~ 🎤', 'یه آهنگ از طرف کدوهای دنیا 🎤', 'گوش کنید... ولی لطفاً نقد نکنید 🎤']), 3600); cls(wrap, 'k-sway', 2500); wrap.classList.add('k-sway'); setTimeout(() => wrap.classList.remove('k-sway'), 2600);
      sc.forEach((f, i) => setTimeout(() => { tone(f, .28, 'triangle', .07); K.setMood(i % 2 ? 'wow' : 'happy', 260); popM(n, 2); cls(wrap, 'k-hop', 600); }, i * 260));
      setTimeout(() => { busy = false; K.setMood('love', 1800); }, sc.length * 260 + 200);
    };
    const accessory = () => {
      ai = (ai + 1) % ACC.length; svg.dataset.a = ACC[ai]; store.set('hw-k6acc', ai); cls(wrap, 'k-spin', 1000); K.setMood('wink', 1600); popM(['✨', '💫'], 8);
      K.speak(ACCN[ai], 2600);
    };
    const skin = () => {
      si = (si + 1) % SKIN.length; svg.style.filter = SKIN[si]; store.set('hw-k6skin', si); cls(wrap, 'k-dizzy', 1000); K.setMood('wow', 1200); popM(['🎨', '✨'], 8);
      K.speak(SKINN[si], 2800);
    };
    const JOKES = [
      ['کدوی هالووینی چرا امتحان ریاضی رو خوب داد؟ 🎃', 'چون همه‌ی جواب‌ها رو گرد کرد و رد شد!'],
      ['چرا اسکلت‌ها همیشه آدم‌های محترمی‌ان؟ 💀', 'چون «استخوان‌دار»ن!'],
      ['چرا روح‌ها هیچ‌وقت دروغ نمی‌گن؟ 👻', 'چون همه‌ی حرف‌هاشون «شفاف»ه!'],
      ['چرا دراکولا تو مصاحبه‌ی کاری قبول نشد؟ 🧛', 'چون هر کاری رو می‌خواست «گردن بگیره»... ولی خیلی تحت‌اللفظی!'],
      ['چرا عنکبوت همیشه آنلاینه؟ 🕷️', 'چون خودش «وب» رو ساخته!'],
      ['نویسنده‌ی مانهوا وقتی ازش بپرسی چپتر جدید کی میاد، چی می‌گه؟ ✍️', '«هفته‌ی بعد!» ... (منظورش ماه بعده)'],
      ['چرا شخصیت اصلی مانهواها همیشه «برگشته»؟ 🔄', 'چون دفعه‌ی اول فقط چپتر ۱ رو خونده و بقیه‌ش رو نذاشتن بخونه!'],
      ['فرق مانهوای خوب با مانهوای عالی چیه؟ 📖', 'دومی رو ساعت ۳ شب شروع می‌کنی و ساعت ۶ صبح هنوز می‌گی «آخرین چپتر»!'],
      ['وقتی بهم می‌گن «سرت خالیه»، چی می‌گم؟ 🎃', 'می‌گم: «ولی دلم گرمه!» (شمع تو دلمه)'],
      ['مانهواخون‌ها چطور «فقط یه چپتر دیگه» می‌گن؟ 😴', 'همون‌جوری که من می‌گم «فقط یه آب‌نبات دیگه»: هیچ‌وقت راست نمی‌گن!'],
      ['قهرمان مانهوا چرا همیشه دیر می‌رسه؟ ⚔️', 'چون اول باید پنجاه چپتر فلش‌بک ببینه!'],
      ['چرا جادوگرها هیچ‌وقت دیر نمی‌رسن؟ 🧙‍♀️', 'چون ترافیک نمی‌شناسن... فقط یه «جارو» لازم دارن!'],
      ['خفاش‌ها چرا هیچ‌وقت سر کار دیر نمی‌کنن؟ 🦇', 'چون همیشه یه کم «بالاتر» از بقیه‌ان!']
    ];
    const joke = () => {
      const [q, a] = fresh6('joke', JOKES); K.setMood('wow', 1400); K.speak(q, Math.max(3800, 1500 + q.length * 58));
      setTimeout(() => {
        K.setMood('laugh', 3200); K.speak(a + ' 😂', Math.max(4200, 1500 + a.length * 60)); popM(['😂', '🤣', '✨'], 8);
        if (sfxOn()) [0, 1, 2, 3].forEach((i) => tone(600 + i * 60, .09, 'triangle', .05, i * .1));
      }, Math.max(3800, 1500 + q.length * 58) + 250);
    };
    const party = () => {
      K.setMood('cheer', 4200); cls(wrap, 'k-jump', 800); setTimeout(() => cls(wrap, 'k-spin', 1000), 900); K.speak(pick(['جشن! 🎉🎃🎊', 'هیچ دلیلی نیست؛ فقط می‌خواستم جشن بگیرم! 🎊', 'امشب مال ماست! 🎉']), 3600);
      rain(['🎉', '🎊', '🎃', '🍬', '👻', '⭐', '🦇'], 38); [0, 400, 800].forEach((d) => setTimeout(() => pop(rnd(60, innerWidth - 60), rnd(80, innerHeight * .5), ['✨', '🧡', '💜', '💛', '🎆'], 14, 160), d));
      if (sfxOn()) [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, .22, 'triangle', .06, i * .09));
    };

    /* ----- panel ----- */
    const LIST = [
      ['dance', '💃', 'رقص', dance], ['chase', '🏃', 'دنبالم کن', chase], ['fire', '🔥', 'آتش', fire],
      ['game', '🎮', 'بازی', game], ['sing', '🎵', 'آواز', sing], ['acc', '🎩', 'اکسسوری', accessory],
      ['skin', '🎨', 'رنگ', skin], ['joke', '🤡', 'جوک', joke], ['party', '🎊', 'جشن', party]
    ];
    const panel = mk('div', 'k6-panel', ''), btn = mk('button', 'k6-btn', '⚡', m), els = {};
    btn.type = 'button'; btn.setAttribute('aria-label', 'کارهای بیشتر'); btn.setAttribute('aria-expanded', 'false');
    LIST.forEach(([id, e, t, fn2]) => {
      const b = mk('button', 'k6-it', '<b>' + e + '</b>' + t, panel); b.type = 'button'; els[id] = b;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); if (id !== 'chase' || follow) closeP(); else closeP(); fn2(); });
    });
    const mark = (id, v) => els[id] && els[id].classList.toggle('act', v);
    let pOpen = false;
    function openP() {
      pOpen = true; try { K.close(); } catch (e) {}
      const r = m.getBoundingClientRect(), w = 216, h = 236;
      panel.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
      panel.style.top = Math.max(6, Math.min(innerHeight - h - 6, r.top > h + 16 ? r.top - h - 8 : r.bottom + 8)) + 'px';
      panel.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); K.setMood('wink', 1400);
    }
    function closeP() { pOpen = false; panel.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', (e) => { e.stopPropagation(); pOpen ? closeP() : openP(); });
    document.addEventListener('pointerdown', (e) => { if (pOpen && !panel.contains(e.target) && !btn.contains(e.target)) closeP(); }, true);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeP(); if (follow) chase(); } });

    /* ----- sparkle trail while being carried ----- */
    let lastSp = 0;
    addEventListener('pointermove', (e) => { if (!m.classList.contains('k-hold') || calm) return; const t = performance.now(); if (t - lastSp < 50) return; lastSp = t; pop(e.clientX, e.clientY, ['✨', '💫', '🧡'], 1, 50); }, { passive: true });

    /* ----- make v6 obvious: pulsing ⚡ + welcome line until first use ----- */
    if (store.get('hw-k6seen', '0') !== '1') {
      btn.classList.add('k6-ping');
      setTimeout(() => { K.setMood('wow', 1800); K.speak('کدوچی یه عالمه کار جدید یاد گرفته! ⚡ دکمه‌ی بنفش کنارم رو بزن: رقص، بازی، آتش، جوک، اکسسوری و کلی چیز دیگه 🎃', 7000); }, 2600);
    }
    btn.addEventListener('click', () => { store.set('hw-k6seen', '1'); btn.classList.remove('k6-ping'); });

    window.hwKodoochi6 = { dance, chase, fire, game, sing, accessory, skin, joke, party, open: openP, close: closeP };
  }
})();


/* ===== v8: prettier night sky — colored stars, sparkles, drifting clouds, shooting stars. Pairs with the "v8 sky" block in halloween.css ===== */
(function () {
  if (window.__hwSky8) return; window.__hwSky8 = 1;
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let tries = 0;
  (function init() {
    const sky = document.querySelector('.hw-sky');
    if (!sky) { if (tries++ < 40) setTimeout(init, 250); return; }
    if (sky.dataset.v8) return; sky.dataset.v8 = 1;
    const small = innerWidth < 768;
    const add = (cls) => { const e = document.createElement('i'); e.className = cls; sky.appendChild(e); return e; };

    /* colored stars (upper sky only, so they never sit on the village) */
    const cols = ['255,235,200', '200,185,255', '255,200,150', '190,230,255'];
    add('hw-stars c').style.boxShadow = Array.from({ length: small ? 22 : 46 }, () =>
      `${rnd(0, 100).toFixed(1)}vw ${rnd(0, 58).toFixed(1)}vh 0 ${rnd(.4, 1.6).toFixed(1)}px rgba(${cols[(Math.random() * cols.length) | 0]},${rnd(.5, .95).toFixed(2)})`).join(',');

    /* 4-point sparkle stars */
    for (let i = 0; i < (small ? 5 : 9); i++) {
      const s = add('hw-spk');
      s.style.cssText = `left:${rnd(4, 96).toFixed(1)}%;top:${rnd(3, 52).toFixed(1)}%;--s:${rnd(9, 18).toFixed(0)}px;animation-delay:${rnd(-6, 0).toFixed(1)}s;animation-duration:${rnd(3.5, 7).toFixed(1)}s`;
    }

    if (calm) return;

    /* slow clouds drifting past the moon */
    [{ t: small ? '70px' : '78px', d: 110, s: 1, o: .55, dl: -34 }, { t: '17%', d: 150, s: .7, o: .34, dl: -100 }, { t: '5%', d: 130, s: 1.25, o: .24, dl: -60 }].forEach((c) => {
      const e = add('hw-cloud');
      e.style.cssText = `top:${c.t};--s:${c.s};opacity:${c.o};animation-duration:${c.d}s;animation-delay:${c.dl}s`;
    });

    /* shooting stars */
    const star = add('hw-shoot');
    const shoot = () => {
      if (document.hidden || !root.classList.contains('hw')) return;
      star.style.left = rnd(6, 70).toFixed(0) + 'vw'; star.style.top = rnd(4, 30).toFixed(0) + 'vh';
      star.classList.remove('go'); void star.offsetWidth; star.classList.add('go');
    };
    setTimeout(shoot, 4000);
    (function loop() { setTimeout(() => { shoot(); loop(); }, rnd(9000, 22000)); })();
  })();
})();

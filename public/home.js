"use strict";

// تعریف متغیرهای گلوبال اسلایدر برای دسترسی و بازنشانی راحت‌تر
let slider, track, dots, prevBtn, nextBtn;
let width, index, current, target;
let startX, startOffset, lastX, lastTime, velocity, isDragging;
let rafId = 0;
let slideNodes = [];
let pendingBg = [];
function loadPendingBg() {
  while (pendingBg.length) {
    const { bg, url } = pendingBg.shift();
    bg.style.backgroundImage = `url("${url}")`;
  }
}

// عرض واقعی اسلایدر را برمی‌گرداند (نه عرض کل پنجره) تا در صفحات
// بزرگ که محتوا محدود به یک عرض حداکثری‌ست، اسلایدها درست چیده شوند
function getSliderWidth() {
  if (slider) {
    const rect = slider.getBoundingClientRect();
    if (rect.width) return rect.width;
  }
  return window.innerWidth;
}

const DEFAULT_SLIDES = [
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/4/manhwa-back4-v2.webp",
    product: "src-mobi/slider/4/manhwa-cover4-v2.webp",
    link: "https://manhwachi.ir/comic/regressed-mercenary-machinations"
  },
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/3/manhwa-back3-v2.webp",
    product: "src-mobi/slider/3/manhwa-cover3-v2.webp",
    link: "https://manhwachi.ir/comic/the-100-curses-of-illeston-mansion"
  },
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/2/manhwa-back2-v2.webp",
    product: "src-mobi/slider/2/manhwa-cover2-v2.webp",
    link: "https://manhwachi.ir/comic/the-white-tiger-clans-baby-cotton-ball"
  },
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/1/manhwa-back1.webp",
    product: "src-mobi/slider/1/manhwa-cover1.webp",
    link: "https://manhwachi.ir/comic/the-forgotten-field"
  }
];

// اسلایدها از فایل src-mobi/slider/slider.json خوانده می‌شوند (فقط ترتیب اسلاگ‌ها).
// اگر فایل خوانده نشد، همین لیست پیش‌فرض نمایش داده می‌شود.
// نکته: آرایه‌ی داخلی برعکسِ ترتیب نمایش است (اسلاید اول = آخرین عنصر)، پس بعد از خواندن JSON معکوس می‌شود.
let slides = DEFAULT_SLIDES;
const SLIDER_JSON_URL = "/src-mobi/slider/slider.json";

function buildSlidesFromConfig(cfg) {
  const list = cfg && Array.isArray(cfg.slides) ? cfg.slides : [];
  const out = list.map((entry, i) => {
    // هر مورد یا یک رشته (slug) است یا آبجکتی مثل { "slug": "...", "bg": "...", "product": "..." }
    const e = typeof entry === "string" ? { slug: entry } : (entry || {});
    if (!e.slug) return null;
    const n = i + 1; // پوشه‌ی تصاویر بر اساس جایگاه در JSON: src-mobi/slider/<n>/
    return {
      title: e.title || "",
      kicker: e.kicker || "",
      subtitle: e.subtitle || "",
      bg: e.bg || `src-mobi/slider/${n}/manhwa-back${n}.webp`,
      product: e.product || `src-mobi/slider/${n}/manhwa-cover${n}.webp`,
      link: e.link || `https://manhwachi.ir/comic/${encodeURIComponent(e.slug)}`
    };
  }).filter(Boolean);
  return out.reverse();
}

function fetchSliderConfig() {
  return fetch(SLIDER_JSON_URL, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((cfg) => {
      const built = buildSlidesFromConfig(cfg);
      return built.length ? built : DEFAULT_SLIDES;
    })
    .catch((err) => {
      console.warn("slider.json لود نشد، اسلایدهای پیش‌فرض استفاده می‌شود:", err);
      return DEFAULT_SLIDES;
    });
}

// درخواست همان لحظه‌ی لود اسکریپت شروع می‌شود؛ بار اول از همین نتیجه استفاده می‌شود،
// دفعات بعدی (جابه‌جایی بین صفحه‌ها) دوباره خوانده می‌شود.
let sliderConfigPromise = fetchSliderConfig();
function loadSliderConfig() {
  const p = sliderConfigPromise || fetchSliderConfig();
  sliderConfigPromise = null;
  return p;
}

const genreNames = {
  "Fantasy": "فانتزی",
  "Action": "اکشن",
  "Adventure": "ماجراجویی",
  "Comedy": "کمدی",
  "Drama": "درام",
  "Mystery": "معمایی",
  "Horror": "ترسناک",
  "Sci-Fi": "علمی-تخیلی",
  "Psychological": "روان‌شناختی",
  "Sports": "ورزشی",
  "Historical": "تاریخی",
  "School Life": "زندگی مدرسه‌ای",
  "Romance": "عاشقانه",
  "Martial Arts": "هنرهای رزمی"
};

function toPersianNumber(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
}

// داده‌ی صفحه‌ی اصلی از فید سبک (/api/home-feed) می‌آید؛ تعریفش در index.html است
// (اگر نبود مستقیم از data.json می‌خواند).
function getFeed() {
  if (window.getHomeFeed) return window.getHomeFeed();
  return fetch('/data/data.json').then((r) => r.json());
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='4'%3E%3Crect width='3' height='4' fill='%23161616'/%3E%3C/svg%3E";

let initToken = 0;

function setupSlider() {
  // پیدا کردن المان‌های جدید از روی HTML رندر شده
  slider = document.getElementById("slider");
  track = document.getElementById("track");
  dots = document.getElementById("dots");
  prevBtn = document.getElementById("sliderPrevBtn");
  nextBtn = document.getElementById("sliderNextBtn");

  if (slider && track && dots) {
    // تمیز کردن محتوای قبلی اسلایدر قبل از ساخت مجدد
    track.innerHTML = "";
    dots.innerHTML = "";

    // مقداردهی اولیه موقعیت‌ها (بر اساس عرض واقعی خود اسلایدر،
    // نه کل پنجره؛ چون در صفحات بزرگ محتوا محدود به یک عرض حداکثری‌ست)
    width = getSliderWidth();
    index = slides.length - 1; // اسلاید اول نمایش (آخرین عنصر آرایه)
    current = -index * width;
    target = current;

    // ساخت اسلایدها و دکمه‌ها
    buildSlides();
    updateUi();
    applyTransforms();

    startAutoplay();
    if (document.readyState === "complete") setTimeout(loadPendingBg, 800);
    else window.addEventListener("load", () => setTimeout(loadPendingBg, 800), { once: true });

    // ثبت مجدد رویدادها روی المان‌های جدید
    slider.removeEventListener("pointerdown", onPointerDown);
    slider.removeEventListener("pointermove", onPointerMove);
    slider.removeEventListener("pointerup", onPointerUp);
    slider.removeEventListener("pointercancel", onPointerUp);

    slider.addEventListener("pointerdown", onPointerDown, { passive: true });
    slider.addEventListener("pointermove", onPointerMove, { passive: true });
    slider.addEventListener("pointerup", onPointerUp);
    slider.addEventListener("pointercancel", onPointerUp);

    // دکمه‌های فلش قبلی/بعدی (مخصوص نمایش دسکتاپ/ویندوز)
    if (prevBtn && nextBtn) {
      prevBtn.replaceWith(prevBtn.cloneNode(true));
      nextBtn.replaceWith(nextBtn.cloneNode(true));
      prevBtn = document.getElementById("sliderPrevBtn");
      nextBtn = document.getElementById("sliderNextBtn");

      prevBtn.addEventListener("click", () => goTo(index - 1));
      nextBtn.addEventListener("click", () => goTo(index + 1));
    }
  } else {
    console.warn("المان‌های اسلایدر یافت نشدند.");
  }
}

// ==========================================
// تابع اصلی راه‌اندازی و بازسازی صفحه خانه
// ==========================================
window.initHome = function() {
  console.log("در حال راه‌اندازی مجدد اسکریپت‌های صفحه اصلی...");

  // ۱. پاکسازی انیمیشن‌ها و رویدادهای قبلی جهت جلوگیری از تداخل
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  clearInterval(autoTimer);
  
  // بازنشانی متغیرها و آرایه‌ها
  slideNodes = [];
  pendingBg = [];
  isDragging = false;

  // اسلایدر بعد از خواندن slider.json ساخته می‌شود؛ بقیه‌ی صفحه منتظرش نمی‌ماند
  const myInit = ++initToken;
  loadSliderConfig().then((list) => {
    if (myInit !== initToken) return; // initHome دوباره صدا زده شده
    slides = list;
    setupSlider();
  });

  // لود دیتاها از فایل‌های JSON و رندر آپدیت‌ها
  loadTopRated();
  if (document.getElementById('supabaseLibraryGrid')) fetchRandomManhwas();
  renderLatestFromJSON();
  initSocialButtons();   // <--- اضافه شده برای ثبت مجدد دکمه‌های شبکه اجتماعی
};

function buildSlides() {
  slides.forEach((slide, position) => {
    // تغییر از article به تگ a برای لینک شدن کل اسلاید
    const item = document.createElement("a"); 
    item.className = "slide";
    item.setAttribute("href", slide.link || "#");
    item.setAttribute("aria-label", slide.title);
    item.style.transform = `translate3d(${position * width}px, 0, 0)`;

    // جلوگیری از باز شدن لینک در صورت درگ کردن (کشیدن اسلاید)
    item.addEventListener("click", (e) => {
      if (Math.abs(velocity) > 0.05 || isDragging) {
        e.preventDefault();
      }
    });

    const isFirst = position === slides.length - 1; // اسلاید اولِ قابل‌نمایش
    const bg = document.createElement("div");
    bg.className = "layer bg-layer";
    if (isFirst) bg.style.backgroundImage = `url("${slide.bg}")`;
    else pendingBg.push({ bg, url: slide.bg });

    const productLayer = document.createElement("div");
    productLayer.className = "layer product-layer";
    const product = document.createElement("img");
    product.className = "product";
    product.alt = "";
    product.draggable = false;
    product.style.pointerEvents = "none";
    product.decoding = "async";
    product.loading = isFirst ? "eager" : "lazy";
    if (isFirst) product.fetchPriority = "high";
    product.src = slide.product;
    productLayer.append(product);

    const textLayer = document.createElement("div");
    textLayer.className = "layer text-layer";
    textLayer.innerHTML = `
      <div class="copy">
        <p class="kicker">${slide.kicker}</p>
        <h2 class="headline">${slide.title}</h2>
        <p class="subtitle">${slide.subtitle}</p>
      </div>
    `;

    item.append(bg, productLayer, textLayer);
    track.append(item);
    slideNodes.push({ item, bg, productLayer, textLayer, position });
  });

  // بخش ساخت دکمه‌های ناوبری (dots) بدون تغییر باقی می‌ماند...
  slides.forEach((_, dotIndex) => {
    const button = document.createElement("button");
    button.className = "dot";
    button.type = "button";
    button.setAttribute("aria-label", `رفتن به اسلاید ${toPersianNumber(dotIndex + 1)}`);
    button.addEventListener("click", () => goTo(dotIndex));
    dots.append(button);
  });
}

function realIndex() {
  return index + 1;
}

function updateUi() {
  if (dots && dots.children.length > 0) {
    [...dots.children].forEach((dot, dotIndex) => {
      dot.classList.toggle("is-active", dotIndex === realIndex() - 1);
    });
  }

  if (prevBtn) prevBtn.disabled = index <= 0;
  if (nextBtn) nextBtn.disabled = index >= slides.length - 1;
}

function applyTransforms() {
  if (!track) return;
  track.style.transform = `translate3d(${current}px, 0, 0)`;

  slideNodes.forEach(({ bg, productLayer, textLayer, position }) => {
    const slideX = position * width + current;
    bg.style.transform = `translate3d(${-slideX * 0.02}px, 0, 0) scale3d(1.07, 1.07, 1)`;
    productLayer.style.transform = `translate3d(${-slideX * 0.32}px, 0, 0)`;
    textLayer.style.transform = `translate3d(${-slideX * 0.16}px, 0, 0)`;
  });
}

// حلقه‌ی انیمیشن فقط وقتی اسلایدر در حال حرکت است اجرا می‌شود (در حالت سکون صفر مصرف CPU)
function kick() {
  if (!rafId) rafId = requestAnimationFrame(animate);
}
function animate() {
  rafId = 0;
  const ease = isDragging ? 1 : 0.11;
  current += (target - current) * ease;

  if (!isDragging && Math.abs(target - current) < 0.5) {
    current = target;
    applyTransforms();
    return;
  }

  applyTransforms();
  rafId = requestAnimationFrame(animate);
}

// پخش خودکار آرام (متوقف هنگام درگ، پنهان بودن تب، یا تنظیم «کاهش حرکت»)
let autoTimer = 0;
function startAutoplay() {
  clearInterval(autoTimer);
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  autoTimer = setInterval(() => {
    if (document.hidden || isDragging || !slider || !slider.isConnected) return;
    goTo(index <= 0 ? slides.length - 1 : index - 1);
  }, 6500);
}

function goTo(nextIndex) {
  index = Math.max(0, Math.min(slides.length - 1, nextIndex));
  target = -index * width;
  updateUi();
  loadPendingBg();
  kick();
}

function onPointerDown(event) {
  // اگر شروع کلیک روی دکمه‌های فلش (قبلی/بعدی) بوده، اجازه بده
  // به‌صورت عادی کلیک شود و درگ اسلایدر شروع نشود (این باعث می‌شد
  // در دسکتاپ/ویندوز کلیک روی فلش‌ها کار نکند)
  if (event.target.closest && event.target.closest(".slider-nav")) {
    return;
  }

  isDragging = true;
  slider.classList.add("is-dragging");
  startX = event.clientX;
  startOffset = current;
  lastX = event.clientX;
  lastTime = performance.now();
  velocity = 0;
  slider.setPointerCapture(event.pointerId);
  loadPendingBg();
  kick();
}

function onPointerMove(event) {
  if (!isDragging) return;

  const now = performance.now();
  const dx = event.clientX - startX;
  const frameDx = event.clientX - lastX;
  const dt = Math.max(now - lastTime, 16);
  velocity = frameDx / dt;
  target = startOffset + dx;
  lastX = event.clientX;
  lastTime = now;
}

function onPointerUp(event) {
  if (!isDragging) return;

  isDragging = false;
  slider.classList.remove("is-dragging");
  slider.releasePointerCapture(event.pointerId);

  const moved = target - startOffset;
  const projected = moved + velocity * 210;
  const threshold = Math.min(width * 0.25, 160);

  if (projected > threshold && index > 0) {
    index--;
  } else if (projected < -threshold && index < slides.length - 1) {
    index++;
  }

  goTo(index);
}

function onResize() {
  if (!slider) return;
  width = getSliderWidth();
  slideNodes.forEach(({ item }, position) => {
    item.style.transform = `translate3d(${position * width}px, 0, 0)`;
  });
  current = -index * width;
  target = current;
  applyTransforms();
}

function handleKeyboard(e) {
  if (!slider) return;
  if (e.key === "ArrowLeft") {
    goTo(index - 1);
  } else if (e.key === "ArrowRight") {
    goTo(index + 1);
  }
}

// رویدادهای سراسری ویندوز فقط یک بار ثبت می‌شوند
window.addEventListener("resize", onResize);
window.addEventListener("keydown", handleKeyboard);
window.addEventListener("pagehide", () => { cancelAnimationFrame(rafId); rafId = 0; });

// وقتی با دکمه‌ی بک برمی‌گردیم، مرورگر صفحه را از bfcache برمی‌گرداند:
// DOMContentLoaded دوباره اجرا نمی‌شود ولی pagehide حلقه‌ی انیمیشن را
// کشته بود، برای همین اسلایدر فریز می‌شد. اینجا حلقه را دوباره روشن می‌کنیم.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  if (!slider || !track) return;

  cancelAnimationFrame(rafId);
  isDragging = false;
  slider.classList.remove("is-dragging");
  onResize();
  rafId = 0;
  kick();
});

// اولین لود زمان لود ابتدایی سند
document.addEventListener("DOMContentLoaded", () => {
  window.initHome();
});


// ==========================================
// متد لود برترین‌ها (بخش اول تغییر یافته به فایل محلی)
// ==========================================
async function loadTopRated() {
  try {
    const data = await getFeed();

    const listArray = Object.keys(data).map(slug => ({
      slug: slug,
      ...data[slug]
    }));

    listArray.sort((a, b) => parseFloat(b.score || b.rating || 0) - parseFloat(a.score || a.rating || 0));
    const _g = window.__mcGenre;
    const topFive = (_g ? listArray.filter(i => (i.genres || []).includes(_g)) : listArray).slice(0, 5);

    const list = document.getElementById("topRatedList");
    if (!list) return;
    list.innerHTML = "";

    let topHtml = "";
    topFive.forEach((item, index) => {
      const coverSrc = `${window.IMG_BASE || ''}/manhwas/${item.slug}/${item.cover_image}`;
      const genresFormatted = item.genres 
        ? item.genres.map(genre => genreNames[genre] || genre).join(" • ") 
        : "نامشخص";

      topHtml += `
        <li>
          <a href="https://manhwachi.ir/comic/${encodeURIComponent(item.slug)}">
            <div class="row">
              <div class="col num">
                <span ${index === 0 ? 'class="rank1"' : ""}>
                  ${index + 1}
                </span>
              </div>
              <div class="col pic">
                <img src="${coverSrc}" width="100%" loading="lazy" decoding="async" alt="${escHtml(item.title_fa || item.title_en)}" onerror="this.onerror=null;this.src=PLACEHOLDER_IMG">
              </div>
              <div class="col info">
                <p class="subj">
                  <strong class="ellipsis">
                    ${escHtml(item.title_fa || item.title_en)}
                  </strong>
                </p>
                <p class="genre">
                  ${genresFormatted}
                </p>
              </div>
            </div>
          </a>
        </li>`;
    });
    list.innerHTML = topHtml;
  } catch (error) {
    console.error("خطا در بارگذاری برترین مانهواها:", error);
  }
}


// ==========================================
// متد دریافت مانهواهای تصادفی از فایل محلی
// ==========================================
async function fetchRandomManhwas() {
  try {
    const data = await getFeed();

    const listArray = Object.keys(data).map(slug => ({
      slug: slug,
      ...data[slug]
    }));

    const gridContainer = document.getElementById('supabaseLibraryGrid');
    if (!gridContainer) return;

    if (listArray.length === 0) {
      gridContainer.innerHTML = '<div class="library-loading">هیچ مانهوایی یافت نشد.</div>';
      return;
    }

    for (let i = listArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [listArray[i], listArray[j]] = [listArray[j], listArray[i]];
    }

    const randomSix = listArray.slice(0, 6);
    renderLibraryCards(randomSix);

  } catch (err) {
    console.error("خطا در بارگذاری اطلاعات کتابخانه:", err);
    const gridContainer = document.getElementById('supabaseLibraryGrid');
    if (gridContainer) {
      gridContainer.innerHTML = '<div class="library-loading">خطا در بارگذاری اطلاعات کتابخانه.</div>';
    }
  }
}


// ==========================================
// رندر کدهای HTML با ساختار فایل‌های محلی
// ==========================================
function renderLibraryCards(manhwas) {
  const gridContainer = document.getElementById('supabaseLibraryGrid');
  if (!gridContainer) return;
  gridContainer.innerHTML = '';

  manhwas.forEach(manhwa => {
    let mainGenre = "مانهوا";
    if (manhwa.genres) {
      mainGenre = Array.isArray(manhwa.genres) ? manhwa.genres[0] : manhwa.genres.split('•')[0].trim();
      mainGenre = genreNames[mainGenre] || mainGenre;
    }

    const originType = manhwa.origin || "کره‌ای";
    const detailPageLink = `manhwas/${manhwa.slug}/index.html`;
    const coverSrc = `${window.IMG_BASE || ''}/manhwas/${manhwa.slug}/${manhwa.cover_image}`;

    const cardHTML = `
      <div class="manhwa-card" data-link="${detailPageLink}">
        <img src="${coverSrc}" alt="${manhwa.title_fa || manhwa.title_en}" class="card-cover" loading="lazy" onerror="this.onerror=null;this.src=PLACEHOLDER_IMG">
        
        <div class="card-ui manhwa-title">${manhwa.title_fa || manhwa.title_en}</div>
        
        <div class="card-ui bottom-info">
          <span class="genre">${mainGenre}</span>
          <span class="origin">${originType}</span>
        </div>
        <div class="card-ui rating">⭐ ${manhwa.score || manhwa.rating || '4.5'}</div>

        <div class="red-overlay">
          <p class="synopsis">${manhwa.description || 'برای مشاهده جزئیات و چپترهای این مانهوا، وارد صفحه اختصاصی آن شوید.'}</p>
          <div class="click-again-hint">دوباره کلیک کنید تا وارد صفحه شوید</div>
        </div>

        <div class="progress-container">
          <div class="progress-bar"></div>
        </div>
      </div>
    `;
    gridContainer.insertAdjacentHTML('beforeend', cardHTML);
  });

  initCardInteractions();
}


// ==========================================
// مدیریت سیستم کلیک دوم و انیمیشن‌ها
// ==========================================
function initCardInteractions() {
  const cards = document.querySelectorAll('#supabaseLibraryGrid .manhwa-card');
  
  cards.forEach(card => {
    card.replaceWith(card.cloneNode(true));
  });

  const freshCards = document.querySelectorAll('#supabaseLibraryGrid .manhwa-card');

  freshCards.forEach(card => {
    let timer = null;

    card.addEventListener('click', function (e) {
      const targetLink = this.getAttribute('data-link');

      if (!this.classList.contains('preview-mode')) {
        e.preventDefault();

        freshCards.forEach(c => {
          if (c !== card) resetCard(c);
        });

        this.classList.add('preview-mode');

        timer = setTimeout(() => {
          resetCard(card);
        }, 4000);

        card.dataset.timerId = timer;

      } else {
        if (timer) clearTimeout(timer);
        if (card.dataset.timerId) clearTimeout(parseInt(card.dataset.timerId));

        this.classList.add('clicked-twice');

        setTimeout(() => {
          window.location.href = targetLink;
        }, 200);
      }
    });
  });
}

function resetCard(card) {
  card.classList.remove('preview-mode');
  card.classList.remove('clicked-twice');
  if (card.dataset.timerId) {
    clearTimeout(parseInt(card.dataset.timerId));
    delete card.dataset.timerId;
  }
}

 // telegram
function initSocialButtons() {
    const copyTg = document.getElementById("copyTelegramBtn");
    if (copyTg) {
        copyTg.onclick = async () => {
            const telegramLink = "@ManhwaChiOfficial";
            await navigator.clipboard.writeText(telegramLink);
            copyTg.textContent = "کپی شد ✓";
            setTimeout(() => { copyTg.textContent = "کپی لینک"; }, 2000);
        };
    }

    const copyInsta = document.getElementById("copyInstagramBtn");
    if (copyInsta) {
        copyInsta.onclick = async () => {
            const instagramLink = "ManhwaChiOfficial";
            await navigator.clipboard.writeText(instagramLink);
            copyInsta.textContent = "کپی شد ✓";
            setTimeout(() => { copyInsta.textContent = "کپی آیدی"; }, 2000);
        };
    }
}
async function renderLatestFromJSON() {
    const listContainer = document.getElementById('todaysList');
    if (!listContainer) return;

    try {
        const data = await getFeed();

        // تبدیل تاریخ شمسی "1405/06/10" به عدد قابل مقایسه (مثلاً 14050610)
        // تا مرتب‌سازی بر اساس جدیدترین تاریخ درست انجام بشه
        function dateToSortable(dateStr) {
            if (!dateStr) return 0;
            const parts = dateStr.split('/').map(Number);
            if (parts.length !== 3 || parts.some(isNaN)) return 0;
            const [y, m, d] = parts;
            return y * 10000 + m * 100 + d;
        }

        // استخراج و پیدا کردن واقعیِ جدیدترین قسمتِ هر مانهوا
        // (بدون فرض این‌که episodes[0] همیشه جدیدترینه)
        const items = Object.entries(data).map(([slug, item]) => {
            const episodes = item.episodes || [];
            let latestEp = { num: 0, date: '' };

            episodes.forEach(ep => {
                if (dateToSortable(ep.date) > dateToSortable(latestEp.date)) {
                    latestEp = ep;
                } else if (dateToSortable(ep.date) === dateToSortable(latestEp.date) && (ep.num || 0) > (latestEp.num || 0)) {
                    // اگر چند چپتر تاریخ یکسان داشتن، اونی که شماره‌ی بزرگتری داره (واقعاً جدیدتره) انتخاب بشه
                    latestEp = ep;
                }
            });

            return {
                slug: slug,
                ...item,
                latestEpNum: latestEp.num,
                latestEpDate: latestEp.date || '',
                isVip: item.is_vip || false
            };
        });

        // مرتب‌سازی بر اساس جدیدترین تاریخ آپدیت (نزولی)
        items.sort((a, b) => dateToSortable(b.latestEpDate) - dateToSortable(a.latestEpDate));

        // ۵ تای اول
        const _g = window.__mcGenre;
        const top5 = (_g ? items.filter(i => (i.genres || []).includes(_g)) : items).slice(0, 5);

        listContainer.innerHTML = top5.length ? '' : '<li class="mc-empty">در این ژانر چیزی پیدا نشد.</li>';

        top5.forEach(item => {
            const comicLink = `https://manhwachi.ir/comic/${encodeURIComponent(item.slug)}`;
            const g0 = item.genres && item.genres.length > 0 ? item.genres[0] : '';
            const mainGenre = g0 ? (genreNames[g0] || g0) : 'مانهوا';
            const titleFa = escHtml(item.title_fa || item.title_en);
            const scoreVal = parseFloat(item.score || item.rating || 0);

            const accessBadge = item.isVip 
                ? `<span class="badge-access badge-vip">اشتراکی</span>`
                : `<span class="badge-access badge-free">رایگان</span>`;

            const li = document.createElement('li');
            li.innerHTML = `
                <a class="comic-card" href="${comicLink}">
                    <div class="comic-pic">
                        ${accessBadge}
                        <img src="${window.IMG_BASE || ''}/manhwas/${item.slug}/${item.cover_image}" alt="${titleFa}" loading="lazy" decoding="async">
                        <div class="badge-chapter-box">
                            <span class="badge-chapter-num">چپتر ${item.latestEpNum}</span>
                            ${item.latestEpDate ? `<span class="badge-chapter-date">${item.latestEpDate}</span>` : ''}
                        </div>
                    </div>
                    <div class="comic-info">
                        <h3 class="comic-title" title="${titleFa}">${titleFa}</h3>
                        <div class="comic-meta">
                            <span class="comic-genre">${mainGenre}</span>
                            ${scoreVal > 0 ? `<span class="comic-score">★ ${scoreVal.toFixed(1)}</span>` : ''}
                        </div>
                    </div>
                </a>
            `;
            listContainer.appendChild(li);
        });

    } catch (err) {
        console.error("خطا در دریافت فایل JSON:", err);
        listContainer.innerHTML = `<li class="p-4 text-xs text-center" style="color: #ff2a5f;">خطا در بارگذاری اطلاعات.</li>`;
    }
}
// document.addEventListener("DOMContentLoaded", () => {
//     const modal = document.getElementById("updateModal");
//     const title = document.getElementById("modalTitle");
//     const text = document.getElementById("modalText");
//     const btnUnderstand = document.getElementById("closeUpdateModal");
//     const btnNotUnderstand = document.getElementById("notUnderstoodModal");

//     let stage = 1;

//     // دکمه فهمیدم اصلی (در هر مرحله‌ای کلیک شود، مودال را می‌بندد)
//     btnUnderstand.addEventListener("click", () => {
//         modal.classList.add("hidden");
//     });

//     // مدیریت کلیک روی دکمه نفهمیدم
//     btnNotUnderstand.addEventListener("click", () => {
//         if (stage === 1) {
//             // رفتن به مرحله دوم
//             title.textContent = "جرئت یبار دیگه بگو نفهمیدم😊";
//             text.textContent = "سایت در حال بروز رسانیهههه";
            
//             // دکمه فهمیدم بزرگ می‌شود
//             btnUnderstand.className = "update-modal-btn btn-stage2-large bg-red";
            
//             // دکمه نفهمیدم کوچولو و طوسی باقی می‌ماند
//             btnNotUnderstand.className = "update-modal-btn btn-stage2-small bg-gray";
            
//             stage = 2; // تغییر وضعیت به مرحله بعد
//         } 
//         else if (stage === 2) {
//             // رفتن به مرحله سوم
//             title.textContent = "حالا فهمیدی؟ ";
//             text.textContent = "";
            
//             // دکمه نفهمیدم تبدیل به فهمیدم می‌شود
//             btnNotUnderstand.textContent = "فهمیدم";
            
//             // هر دو دکمه هم‌اندازه (btn-equal) و هر دو قرمز (bg-red) می‌شوند
//             btnUnderstand.className = "update-modal-btn btn-equal bg-red";
//             btnNotUnderstand.className = "update-modal-btn btn-equal bg-red";

//             // در این مرحله، کلیک روی دکمه دوم هم مودال را می‌بندد
//             btnNotUnderstand.addEventListener("click", () => {
//                 modal.classList.add("hidden");
//             });
            
//             stage = 3;
//         }
//     });
// });

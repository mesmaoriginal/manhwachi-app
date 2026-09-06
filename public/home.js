"use strict";

// تعریف متغیرهای گلوبال اسلایدر برای دسترسی و بازنشانی راحت‌تر
let slider, track, dots;
let width, index, current, target;
let startX, startOffset, lastX, lastTime, velocity, isDragging;
let rafId = 0;
let slideNodes = [];

const slides = [
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/4/manhwa-back4.webp",
    product: "src-mobi/slider/4/manhwa-cover4.webp",
    link: "https://manhwachi.ir/comic/regressed-mercenary-machinations"
  },
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/3/manhwa-back3.webp",
    product: "src-mobi/slider/3/manhwa-cover3.webp",
    link: "https://manhwachi.ir/comic/the-100-curses-of-illeston-mansion"
  },
  {
    title: "",
    kicker: "",
    subtitle: "",
    bg: "src-mobi/slider/2/manhwa-back2.webp",
    product: "src-mobi/slider/2/manhwa-cover2.webp",
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

// ==========================================
// کش کردن دیتای data.json تا هر سه بخش (برترین‌ها،
// تصادفی، آخرین آپدیت‌ها) فقط یک بار آن را دانلود و
// پردازش کنند، نه سه بار جداگانه.
// ==========================================
let _manhwaDataPromise = null;
function getManhwaData() {
  if (!_manhwaDataPromise) {
    _manhwaDataPromise = fetch('data/data.json').then((response) => {
      if (!response.ok) {
        throw new Error(`خطای HTTP: ${response.status}`);
      }
      return response.json();
    });
  }
  return _manhwaDataPromise;
}

// ==========================================
// تابع اصلی راه‌اندازی و بازسازی صفحه خانه
// ==========================================
window.initHome = function() {
  console.log("در حال راه‌اندازی مجدد اسکریپت‌های صفحه اصلی...");

  // ۱. پاکسازی انیمیشن‌ها و رویدادهای قبلی جهت جلوگیری از تداخل
  if (rafId) {
    cancelAnimationFrame(rafId);
  }
  
  // بازنشانی متغیرها و آرایه‌ها
  slideNodes = [];
  isDragging = false;

  // پیدا کردن المان‌های جدید از روی HTML رندر شده
  slider = document.getElementById("slider");
  track = document.getElementById("track");
  dots = document.getElementById("dots");

  if (slider && track && dots) {
    // تمیز کردن محتوای قبلی اسلایدر قبل از ساخت مجدد
    track.innerHTML = "";
    dots.innerHTML = "";

    // مقداردهی اولیه موقعیت‌ها
    width = window.innerWidth;
    index = 3; 
    current = -3 * width;
    target = -3 * width;

    // ساخت اسلایدها و دکمه‌ها
    buildSlides();
    updateUi();
    applyTransforms();

    // اجرای مجدد حلقه انیمیشن
    rafId = requestAnimationFrame(animate);

    // ثبت مجدد رویدادها روی المان‌های جدید
    slider.removeEventListener("pointerdown", onPointerDown);
    slider.removeEventListener("pointermove", onPointerMove);
    slider.removeEventListener("pointerup", onPointerUp);
    slider.removeEventListener("pointercancel", onPointerUp);

    slider.addEventListener("pointerdown", onPointerDown, { passive: true });
    slider.addEventListener("pointermove", onPointerMove, { passive: true });
    slider.addEventListener("pointerup", onPointerUp);
    slider.addEventListener("pointercancel", onPointerUp);
  } else {
    console.warn("المان‌های اسلایدر یافت نشدند.");
  }

  // لود دیتاها از فایل‌های JSON و رندر آپدیت‌ها
  loadTopRated();
  fetchRandomManhwas();
  renderLatestFromJSON(); // <--- اضافه شده برای بارگذاری بخش آپدیت‌ها
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

    const bg = document.createElement("div");
    bg.className = "layer bg-layer";
    bg.style.backgroundImage = `url("${slide.bg}")`;

    const productLayer = document.createElement("div");
    productLayer.className = "layer product-layer";
    const product = document.createElement("img");
    product.className = "product";
    product.alt = "";
    product.draggable = false;
    product.style.pointerEvents = "none";
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

function animate() {
  const ease = isDragging ? 1 : 0.11;
  current += (target - current) * ease;

  if (!isDragging && Math.abs(target - current) < 0.5) {
    current = target;
  }

  applyTransforms();
  rafId = requestAnimationFrame(animate);
}

function goTo(nextIndex) {
  index = Math.max(0, Math.min(slides.length - 1, nextIndex));
  target = -index * width;
  updateUi();
}

function onPointerDown(event) {
  isDragging = true;
  slider.classList.add("is-dragging");
  startX = event.clientX;
  startOffset = current;
  lastX = event.clientX;
  lastTime = performance.now();
  velocity = 0;
  slider.setPointerCapture(event.pointerId);
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
  width = window.innerWidth;
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
window.addEventListener("pagehide", () => cancelAnimationFrame(rafId));

// اولین لود زمان لود ابتدایی سند
document.addEventListener("DOMContentLoaded", () => {
  window.initHome();
});


// ==========================================
// متد لود برترین‌ها (بخش اول تغییر یافته به فایل محلی)
// ==========================================
async function loadTopRated() {
  try {
    const data = await getManhwaData();

    const listArray = Object.keys(data).map(slug => ({
      slug: slug,
      ...data[slug]
    }));

    listArray.sort((a, b) => parseFloat(b.score || b.rating || 0) - parseFloat(a.score || a.rating || 0));
    const topFive = listArray.slice(0, 5);

    const list = document.getElementById("topRatedList");
    if (!list) return;
    list.innerHTML = "";

    topFive.forEach((item, index) => {
      const coverSrc = `manhwas/${item.slug}/${item.cover_image}`;
      const genresFormatted = item.genres 
        ? item.genres.map(genre => genreNames[genre] || genre).join(" • ") 
        : "نامشخص";

      list.innerHTML += `
        <li>
          <a href="https://manhwachi.ir/comic/${item.slug}">
            <div class="row">
              <div class="col num">
                <span ${index === 0 ? 'class="rank1"' : ""}>
                  ${index + 1}
                </span>
              </div>
              <div class="col pic">
                <img src="${coverSrc}" width="100%" alt="${item.title_fa || item.title_en}" onerror="this.onerror=null;this.src='https://picsum.photos/150/220?random=${index}'">
              </div>
              <div class="col info">
                <p class="subj">
                  <strong class="ellipsis">
                    ${item.title_fa || item.title_en}
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
  } catch (error) {
    console.error("خطا در بارگذاری برترین مانهواها:", error);
  }
}


// ==========================================
// متد دریافت مانهواهای تصادفی از فایل محلی
// ==========================================
async function fetchRandomManhwas() {
  try {
    const data = await getManhwaData();

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
    const coverSrc = `manhwas/${manhwa.slug}/${manhwa.cover_image}`;

    const cardHTML = `
      <div class="manhwa-card" data-link="${detailPageLink}">
        <img src="${coverSrc}" alt="${manhwa.title_fa || manhwa.title_en}" class="card-cover" loading="lazy" onerror="this.onerror=null;this.src='https://picsum.photos/400/600?random=${manhwa.slug}'">
        
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
        const data = await getManhwaData();

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
        const top5 = items.slice(0, 5);

        listContainer.innerHTML = '';

        top5.forEach(item => {
            const comicLink = `https://manhwachi.ir/comic/${item.slug}`;
            const mainGenre = item.genres && item.genres.length > 0 ? item.genres[0] : 'مانهوا';
            const titleFa = item.title_fa || item.title_en;

            const accessBadge = item.isVip 
                ? `<span class="badge-access badge-vip">اشتراکی</span>`
                : `<span class="badge-access badge-free">رایگان</span>`;

            const li = document.createElement('li');
            li.innerHTML = `
                <a class="comic-card" href="${comicLink}">
                    <div class="comic-pic">
                        ${accessBadge}
                        <img src="/manhwas/${item.slug}/${item.cover_image}" alt="${titleFa}" loading="lazy">
                        <div class="badge-chapter-box">
                            <span class="badge-chapter-num">چپتر ${item.latestEpNum}</span>
                            ${item.latestEpDate ? `<span class="badge-chapter-date">${item.latestEpDate}</span>` : ''}
                        </div>
                    </div>
                    <div class="comic-info">
                        <h3 class="comic-title" title="${titleFa}">${titleFa}</h3>
                        <div class="comic-meta">
                            <span class="comic-genre">${mainGenre}</span>
                            <span class="comic-score">★ ${item.score || '8.0'}</span>
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

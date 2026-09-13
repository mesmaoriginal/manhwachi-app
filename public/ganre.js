(function () { 
    tailwind.config = {
        darkMode: "class",
        theme: {
            extend: {
                "colors": {
                    "error": "#ffb4ab",
                    "tertiary-container": "#e2b6a2",
                    "outline-variant": "#3c4a3c",
                    "error-container": "#93000a",
                    "on-primary-container": "#5a0000ff",
                    "tertiary-fixed-dim": "#e9bda9",
                    "on-secondary-fixed": "#1c1b1b",
                    "inverse-surface": "#e2e2e2",
                    "on-tertiary-fixed": "#2d1509",
                    "on-background": "#e2e2e2",
                    "primary-fixed-dim": "#e41e1eff",
                    "surface-tint": "#e41e1eff",
                    "on-secondary-fixed-variant": "#474746",
                    "inverse-on-surface": "#303030",
                    "secondary-fixed-dim": "#c8c6c5",
                    "on-tertiary-container": "#664637",
                    "background": "#000000ff",
                    "surface-container-lowest": "#0e0e0e",
                    "primary": "#DC2626",
                    "outline": "#859584",
                    "on-primary-fixed": "#210000ff",
                    "surface-bright": "#393939",
                    "surface-container-low": "#1b1b1b",
                    "on-secondary-container": "#b7b5b4",
                    "surface-container-highest": "#353535",
                    "surface-container-high": "#2a2a2a",
                    "on-surface-variant": "#bacbb8",
                    "surface-variant": "#353535",
                    "on-primary-fixed-variant": "#530000ff",
                    "on-error": "#690005",
                    "on-tertiary": "#452a1c",
                    "on-error-container": "#ffdad6",
                    "on-surface": "#e2e2e2",
                    "secondary": "#c8c6c5",
                    "on-tertiary-fixed-variant": "#5f4030",
                    "surface": "#131313",
                    "secondary-container": "#474746",
                    "on-secondary": "#313030",
                    "tertiary-fixed": "#ffdbcb",
                    "inverse-primary": "#6e0000ff",
                    "surface-container": "#1f1f1f",
                    "secondary-fixed": "#e5e2e1",
                    "on-primary": "#390000ff",
                    "tertiary": "#ffd2bd",
                    "surface-dim": "#131313",
                    "primary-container": "#dc0000ff",
                    "primary-fixed": "#ff6767ff"
                },
                "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
                },
                "spacing": {
                    "margin-mobile": "16px",
                    "base": "4px",
                    "stack-md": "16px",
                    "stack-sm": "8px",
                    "gutter": "12px",
                    "stack-lg": "32px",
                    "margin-tablet": "24px"
                },
                fontFamily: {
                    "body-lg": ["Vazir", "Inter", "sans-serif"],
                    "title-md": ["Vazir", "Inter", "sans-serif"],
                    "headline-lg-mobile": ["Vazir", "Montserrat", "sans-serif"],
                    "headline-lg": ["Vazir", "Montserrat", "sans-serif"],
                    "body-sm": ["Vazir", "Inter", "sans-serif"],
                    "label-caps": ["Vazir", "Inter", "sans-serif"],
                    "display-lg": ["Vazir", "Montserrat", "sans-serif"]
                },
                "fontSize": {
                    "body-lg": ["16px", {"lineHeight": "26px", "fontWeight": "400"}],
                    "title-md": ["18px", {"lineHeight": "24px", "fontWeight": "600"}],
                    "headline-lg-mobile": ["24px", {"lineHeight": "30px", "fontWeight": "700"}],
                    "headline-lg": ["28px", {"lineHeight": "34px", "fontWeight": "700"}],
                    "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
                    "label-caps": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "700"}],
                    "display-lg": ["40px", {"lineHeight": "48px", "letterSpacing": "-0.02em", "fontWeight": "800"}]
                }
            },
        },
    };

    // این مپینگ به کدهای سیستم اجازه میده هم با نام انگلیسی و هم فارسی ژانرها ارتباط برقرار کنه
    const genreTranslation = {
        "Action": "اکشن",
        "Romance": "عاشقانه",
        "Fantasy": "فانتزی",
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
        "Martial Arts": "هنرهای رزمی",
        "Dark Fantasy": "دارک فانتزی",
        "Thriller": "هیجان انگیز"
    };

    // برعکس کردن مپینگ برای تبدیل فارسی به انگلیسی در صورت نیاز
    const reverseGenreTranslation = Object.fromEntries(
        Object.entries(genreTranslation).map(([k, v]) => [v, k])
    );

    const genreIcons = {
        "Fantasy": "auto_awesome",
        "Action": "swords",
        "Adventure": "explore",
        "Comedy": "theater_comedy",
        "Drama": "heart_broken",
        "Mystery": "help",
        "Horror": "skull",
        "Sci-Fi": "rocket_launch",
        "Psychological": "psychology",
        "Sports": "sports_kabaddi",
        "Historical": "history",
        "School Life": "school",
        "Romance": "favorite",
        "Martial Arts": "sports_martial_arts",
        "Dark Fantasy": "dark_mode",
        "Thriller": "bolt"
    };

    let itemsList = []; 

    // واکشی داده‌های فایل جیسون محلی
    async function loadLocalData() {
        if (itemsList.length > 0) return itemsList;
        try {
            const response = await fetch('/data/data.json'); 
            if (!response.ok) throw new Error('Failed to fetch local database.');
            const manhwaData = await response.json();
            
            // تبدیل آبجکت به آرایه
            itemsList = Object.keys(manhwaData).map(slug => ({
                slug: slug,
                ...manhwaData[slug]
            }));
            return itemsList;
        } catch (error) {
            console.error('Error reading JSON file:', error);
            return [];
        }
    }

    // لود کردن مانهواهای یک ژانر خاص با فیلتر زبان فارسی
    async function loadGenreRow(genreInEnglish, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const allItems = await loadLocalData();

        // پیدا کردن معادل فارسی ژانر برای سرچ در جیسون
        const genreInPersian = genreTranslation[genreInEnglish] || genreInEnglish;

        if (allItems.length === 0) {
            container.innerHTML = `
                <div class="empty-row-state">
                    <span class="material-symbols-outlined">wifi_off</span>
                    <span>مشکلی در دریافت اطلاعات پیش اومد.</span>
                </div>`;
            return;
        }

        // فیلتر کردن و مرتب‌سازی بر اساس امتیاز (score)
        const filteredData = allItems
            .filter(m => m.genres && (m.genres.includes(genreInPersian) || m.genres.includes(genreInEnglish)))
            .sort((a, b) => parseFloat(b.score || 0) - parseFloat(a.score || 0))
            .slice(0, 5);

        if (filteredData.length === 0) {
            container.innerHTML = `
                <div class="empty-row-state">
                    <span class="material-symbols-outlined">search_off</span>
                    <span>فعلاً محتوایی در این ژانر ثبت نشده.</span>
                </div>`;
            return;
        }

        container.innerHTML = filteredData.map((m, index) => {
            const fallbackCover = `https://ui-avatars.com/api/?name=${encodeURIComponent((m.title_fa || m.title_en || 'م').charAt(0))}&background=1b1b1b&color=DC2626&bold=true&size=256`;

            return `
            <a href="https://manhwachi.ir/comic/${m.slug}" class="poster-card flex-none w-40 snap-start">
                <div class="poster-frame relative aspect-[3/4] rounded-lg overflow-hidden mb-2">
                    <img src="manhwas/${m.slug}/${m.cover_image}" class="w-full h-full object-cover"
                         loading="lazy" alt="${m.title_fa || m.title_en}"
                         onerror="this.onerror=null;this.src='${fallbackCover}';this.classList.add('object-contain','p-6')">
                    <span class="poster-rank">${index + 1}</span>
                    <span class="poster-score">⭐ ${m.score || 'N/A'}</span>
                </div>
                <h4 class="font-title-md text-sm line-clamp-1 text-white">
                    ${m.title_fa || m.title_en}
                </h4>
            </a>
            `;
        }).join("");
    }

    // لود کردن تمامی ژانرهای موجود به صورت خودکار
    async function loadGenres() {
        const allItems = await loadLocalData();
        const container = document.getElementById("genres-grid");
        if (!container) return;

        const genresSet = new Set();
        allItems.forEach(m => {
            if (m.genres && Array.isArray(m.genres)) {
                m.genres.forEach(g => genresSet.add(g));
            }
        });

        const genres = [...genresSet].sort();

        if (genres.length === 0) {
            container.innerHTML = `
                <div class="empty-row-state col-span-full">
                    <span class="material-symbols-outlined">wifi_off</span>
                    <span>لیست ژانرها در دسترس نیست.</span>
                </div>`;
            return;
        }

        container.innerHTML = genres.map(g => {
            // پیدا کردن معادل انگلیسی برای آیکون‌ها و لینک‌ها
            const englishGenre = reverseGenreTranslation[g] || g;
            const icon = genreIcons[englishGenre] || "category";

            return `
            <a href="genre-page.html?genre=${encodeURIComponent(g)}" class="genre-card">
                <span class="genre-icon-badge">
                    <span class="material-symbols-outlined">${icon}</span>
                </span>
                <span class="genre-name">${g}</span>
            </a>
            `;
        }).join("");
    }

    async function init() {
        await loadLocalData();

        // اجرای هم‌زمان لود ردیف‌ها به‌جای پشت‌سرهم، برای نمایش سریع‌تر صفحه
        await Promise.all([
            loadGenreRow("Romance", "Romance-container"),
            loadGenreRow("Action", "action-container"),
            loadGenres()
        ]);
    }

    init();
})();
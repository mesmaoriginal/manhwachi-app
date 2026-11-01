(function () { 
    // نکته: تنظیمات Tailwind از اینجا حذف شد (روی صفحه‌ی اصلی Tailwind کامپایل‌شده است و آبجکت tailwind وجود ندارد).
    // کلاس‌های سفارشی این صفحه در ganre.css تعریف شده‌اند.

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

    function formatNum(n) {
        try { return Number(n).toLocaleString('fa-IR'); } catch (e) { return String(n); }
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

        // تعداد آثار هر ژانر (فقط در دسکتاپ نمایش داده می‌شه)
        const genreCounts = {};
        allItems.forEach(m => {
            if (Array.isArray(m.genres)) m.genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
        });

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
            <a href="/genre/${encodeURIComponent(englishGenre.toLowerCase().replace(/\s+/g, '-'))}" class="genre-card">
                <span class="genre-icon-badge">
                    <span class="material-symbols-outlined">${icon}</span>
                </span>
                <span class="genre-name">${g}</span>
                <span class="genre-count">${formatNum(genreCounts[g] || 0)} اثر</span>
                <span class="material-symbols-outlined genre-arrow">arrow_back</span>
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

    // لودر صفحه (index.html) بعد از هر بار نمایش صفحه، initGenres را صدا می‌زند
    window.initGenres = init;
})();
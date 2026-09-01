(function () { 
    console.log("Advanced local search engine loaded");
    
    tailwind.config = {
        darkMode: "class",
        theme: {
            extend: {
                "colors": {
                    "on-primary": "#390000ff",
                    "background": "#000000ff",
                    "on-surface-variant": "#bacbb8",
                    "on-background": "#e2e2e2",
                    "secondary-fixed": "#e5e2e1",
                    "on-secondary": "#313030",
                    "primary": "#DC2626",
                    "on-tertiary-fixed-variant": "#5f4030",
                    "on-secondary-fixed": "#1c1b1b",
                    "surface-container-highest": "#353535",
                    "secondary-container": "#474746",
                    "on-tertiary-container": "#664637",
                    "on-tertiary-fixed": "#2d1509",
                    "secondary": "#c8c6c5",
                    "surface-container-low": "#1b1b1b",
                    "primary-fixed": "#ff6767ff",
                    "on-error-container": "#ffdad6",
                    "on-error": "#690005",
                    "surface": "#131313",
                    "error": "#ffb4ab",
                    "inverse-surface": "#e2e2e2",
                    "on-primary-fixed": "#210000ff",
                    "outline-variant": "#3c4a3c",
                    "error-container": "#93000a",
                    "surface-tint": "#e41e1eff",
                    "primary-container": "#dc0000ff",
                    "on-secondary-fixed-variant": "#474746",
                    "secondary-fixed-dim": "#c8c6c5",
                    "surface-container-high": "#2a2a2a",
                    "surface-container": "#1f1f1f",
                    "inverse-on-surface": "#303030",
                    "on-surface": "#e2e2e2",
                    "primary-fixed-dim": "#e41e1eff",
                    "on-primary-container": "#5a0000ff",
                    "tertiary": "#ffd2bd",
                    "on-primary-fixed-variant": "#530000ff",
                    "inverse-primary": "#6e0000ff",
                    "outline": "#859584",
                    "tertiary-fixed-dim": "#e9bda9",
                    "surface-variant": "#353535",
                    "surface-container-lowest": "#0e0e0e",
                    "on-secondary-container": "#b7b5b4",
                    "surface-dim": "#131313",
                    "tertiary-fixed": "#ffdbcb",
                    "on-tertiary": "#452a1c",
                    "surface-bright": "#393939",
                    "tertiary-container": "#e2b6a2"
                },
                "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
                },
                "spacing": {
                    "stack-lg": "32px",
                    "margin-mobile": "16px",
                    "gutter": "12px",
                    "stack-sm": "8px",
                    "base": "4px",
                    "stack-md": "16px",
                    "margin-tablet": "24px"
                },
                "fontFamily": {
                    "body-lg": ["Vazir", "Inter", "sans-serif"],
                    "title-md": ["Vazir", "Inter", "sans-serif"],
                    "headline-lg-mobile": ["Vazir", "Montserrat", "sans-serif"],
                    "headline-lg": ["Vazir", "Montserrat", "sans-serif"],
                    "body-sm": ["Vazir", "Inter", "sans-serif"],
                    "label-caps": ["Vazir", "Inter", "sans-serif"],
                    "display-lg": ["Vazir", "Montserrat", "sans-serif"]
                },
                "fontSize": {
                    "label-caps": ["12px", { "lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "700" }],
                    "headline-lg": ["28px", { "lineHeight": "34px", "fontWeight": "700" }],
                    "body-sm": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
                    "headline-lg-mobile": ["24px", { "lineHeight": "30px", "fontWeight": "700" }],
                    "display-lg": ["40px", { "lineHeight": "48px", "letterSpacing": "-0.02em", "fontWeight": "800" }],
                    "title-md": ["18px", { "lineHeight": "24px", "fontWeight": "600" }],
                    "body-lg": ["16px", { "lineHeight": "26px", "fontWeight": "400" }]
                }
            },
        },
    };

    let itemsList = []; // این لیست بعد از Fetch پر می‌شود

    // المان‌های DOM
const searchInput = document.getElementById('main-search');
    const clearBtn = document.getElementById('clear-search');
    const defaultState = document.getElementById('default-state');
    const resultsState = document.getElementById('results-state');
    const emptyState = document.getElementById('empty-state');
    const resultsGrid = resultsState.querySelector('.grid');
    const typeFilter = document.getElementById('type-filter');
    const genreFilter = document.getElementById('genre-filter');
    const filterToggle = document.getElementById('filter-toggle');
    const filterOptions = document.getElementById('filter-options');
    const filterBar = document.getElementById('filter-bar');
    const recentContainer = document.getElementById("recent-searches");
    const clearHistoryBtn = document.getElementById("clear-history");

    async function loadData() {
        try {
            const response = await fetch('/data/manhwas.json'); 
            if (!response.ok) throw new Error('Failed to fetch local database.');
            const manhwaData = await response.json();
            
            itemsList = Object.keys(manhwaData).map(slug => ({
                slug: slug,
                ...manhwaData[slug]
            }));
            console.log(`Loaded ${itemsList.length} titles.`);
        } catch (error) {
            console.error('Database load error:', error);
        }
    }

    function normalizeText(text) {
        if (!text) return '';
        return text.toLowerCase()
            .replace(/ي/g, 'ی')
            .replace(/ك/g, 'ک')
            .replace(/‌/g, ' ') 
            .trim();
    }

    // Toggle Filters menu with styling adjustments
    filterToggle.addEventListener('click', () => {
        filterOptions.classList.toggle('hidden');
        if(!filterOptions.classList.contains('hidden')) {
            filterBar.classList.remove('w-fit');
            filterBar.classList.add('w-full', 'sm:w-fit');
        } else {
            filterBar.classList.add('w-fit');
            filterBar.classList.remove('w-full', 'sm:w-fit');
        }
    });

    function showDefaultState() {
        defaultState.classList.remove('hidden');
        resultsState.classList.add('hidden');
        emptyState.classList.add('hidden');
        emptyState.classList.remove('flex');
    }

    function showEmptyState() {
        defaultState.classList.add('hidden');
        resultsState.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
    }

    function showResultsState() {
        defaultState.classList.add('hidden');
        emptyState.classList.add('hidden');
        emptyState.classList.remove('flex');
        resultsState.classList.remove('hidden');
    }

    // Safely add history wrapper
    function tryAddToHistory() {
        const rawQuery = searchInput.value;
        const stopWords = ["مانهوا", "مانگا", "مانها", "manhwa", "manga", "manhua"];
        if (rawQuery.trim().length >= 3 && !stopWords.includes(rawQuery.toLowerCase().trim())) {
            addToHistory(rawQuery);
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- Search History Manager ---
    const HISTORY_KEY = "recentSearches";

    function getHistory() {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    }

    function saveHistory(history) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    function addToHistory(text) {
        text = text.trim();
        const stopWords = ["مانهوا", "مانگا", "مانها", "manhwa", "manga", "manhua"];
        if (text.length < 3 || stopWords.includes(text.toLowerCase())) return;

        let history = getHistory();
        history = history.filter(x => x !== text);
        history.unshift(text);
        history = history.slice(0, 5);
        saveHistory(history);
        renderHistory();
    }

    function renderHistory() {
        const history = getHistory();
        recentContainer.innerHTML = "";
        
        if (history.length === 0) {
            defaultState.classList.add('hidden');
            return;
        } else if (searchInput.value === "") {
            defaultState.classList.remove('hidden');
        }

        history.forEach(item => {
            recentContainer.insertAdjacentHTML(
                "beforeend",
                `
                <div class="flex items-center gap-2 bg-[#1b1b1f] hover:bg-primary/10 border border-white/5 px-4 py-2 rounded-xl group hover:border-primary/50 transition-all duration-300 cursor-pointer recent-pill-wrapper" data-value="${escapeHtml(item)}">
                    <span class="text-sm font-medium text-white/80 group-hover:text-white transition-colors recent-item">
                        ${escapeHtml(item)}
                    </span>
                    <button class="material-symbols-outlined text-base text-on-surface-variant hover:text-primary transition-colors remove-history" data-value="${escapeHtml(item)}">
                        close
                    </button>
                </div>
                `
            );
        });
    }

    recentContainer.addEventListener("click", e => {
        const wrapper = e.target.closest('.recent-pill-wrapper');
        if (!wrapper) return;

        const value = wrapper.dataset.value;

        if (e.target.classList.contains("remove-history")) {
            e.stopPropagation(); 
            let history = getHistory();
            history = history.filter(x => x !== value);
            saveHistory(history);
            renderHistory();
            
            if (searchInput.value === value) {
                searchInput.value = '';
                showDefaultState();
            }
            return;
        }

        searchInput.value = value;
        performSearch();
    });

    clearHistoryBtn.addEventListener("click", () => {
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
        searchInput.value = '';
        showDefaultState();
    });

    // --- Search Engine Algorithm ---
    function performSearch() {
        const rawQuery = searchInput.value;
        const query = normalizeText(rawQuery);
        const selectedType = typeFilter.value.toLowerCase();
        const selectedGenre = genreFilter.value.toLowerCase();

        if (query === "" && selectedType === "" && selectedGenre === "") {
            showDefaultState();
            return;
        }

        const stopWords = ["مانهوا", "مانگا", "مانها", "manhwa", "manga", "manhua"];
        
        const isQueryTooShort = query.length < 2;
        const isStopWord = stopWords.includes(query);
        const shouldIgnoreQuery = isQueryTooShort || isStopWord;

        if (shouldIgnoreQuery && selectedType === "" && selectedGenre === "") {
            showDefaultState();
            return;
        }

        const scoredItems = [];

        itemsList.forEach(item => {
            let score = 0;
            
            if (selectedType) {
                const typeMap = { 'manhwa': 'مانهوا', 'manga': 'مانگا', 'manhua': 'مانها' };
                const typeInFa = typeMap[selectedType] || selectedType;
                if (item.type.toLowerCase() !== typeInFa) return; 
            }

            if (selectedGenre) {
                const genreMap = {
                    'action': 'اکشن', 'fantasy': 'فانتزی', 'romance': 'عاشقانه', 
                    'drama': 'درام', 'adventure': 'ماجراجویی', 'comedy': 'کمدی', 
                    'dark fantasy': 'دارک فانتزی', 'horror': 'ترسناک'
                };
                const genreInFa = genreMap[selectedGenre] || selectedGenre;
                const hasGenre = item.genres.some(g => normalizeText(g) === normalizeText(genreInFa) || normalizeText(g) === selectedGenre);
                if (!hasGenre) return; 
            }

            if (query !== "" && !shouldIgnoreQuery) {
                const titleFa = normalizeText(item.title_fa);
                const titleEn = normalizeText(item.title_en);
                const desc = normalizeText(item.description);

                if (titleFa === query || titleEn === query) {
                    score += 200;
                } else if (titleFa.startsWith(query) || titleEn.startsWith(query)) {
                    score += 120;
                }
                
                if (titleFa.includes(query)) score += 60;
                if (titleEn.includes(query)) score += 60;

                const queryWords = query.split(/\s+/).filter(w => w.length > 1);
                queryWords.forEach(word => {
                    if (["در", "به", "از", "با", "و", "یک", "the", "and", "of", "in", "a"].includes(word)) return;
                    
                    if (titleFa.includes(word)) score += 20;
                    if (titleEn.includes(word)) score += 20;
                    if (desc.includes(word)) score += 3; 
                });

                if (score === 0) return; 
            } else {
                score = 1; 
            }

            scoredItems.push({ item, score });
        });

        scoredItems.sort((a, b) => b.score - a.score);

        const finalResults = scoredItems.map(wrapper => wrapper.item);

        if (finalResults.length === 0) {
            showEmptyState();
        } else {
            renderResults(finalResults);
            showResultsState();
        }
    }

    function renderResults(items) {
        resultsGrid.innerHTML = '';
        items.forEach(item => {
            

            resultsGrid.insertAdjacentHTML(
                'beforeend',
                `
                <a href="https://manhwachi.ir/comic/${item.slug}" class="group cursor-pointer block animate-fade-in">
                    <div class="aspect-[3/4] rounded-2xl overflow-hidden relative mb-3 shadow-lg border border-white/5 group-hover:border-primary/75 card-glow transition-all duration-300">
                        <img src="/manhwas/${item.slug}/${item.cover_image}" alt="${escapeHtml(item.title_en)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <!-- Dark Overlay at the bottom -->
                        <div class="absolute inset-0 bg-gradient-to-t from-[#0c0c0e] via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity"></div>
                        <div class="absolute top-3 right-3 bg-[#0c0c0e]/80 backdrop-blur-md text-[11px] font-bold px-2.5 py-1 rounded-xl text-white border border-white/5 flex items-center gap-1 shadow-md">
                            <span class="text-amber-400">★</span> ${item.score || 'N/A'}
                        </div>
                    </div>
                    <h3 class="font-bold text-sm sm:text-base text-white/90 line-clamp-1 group-hover:text-primary transition-colors text-right pl-2" style="direction: rtl;">
                        ${escapeHtml(item.title_fa)}
                    </h3>
                    <p class="text-xs text-on-surface-variant/80 mt-1 text-right">
                        ${item.genres.slice(0, 3).join(' • ')}
                    </p>
                </a>
                `
            );
        });
    }

    function debounce(fn, delay = 250) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    const debouncedSearch = debounce(performSearch, 250);

    // Event Listeners for searching
    searchInput.addEventListener('input', debouncedSearch);
    typeFilter.addEventListener('change', performSearch);
    genreFilter.addEventListener('change', performSearch);

    // Smart History Triggers
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            tryAddToHistory();
        }
    });

    searchInput.addEventListener('blur', () => {
        tryAddToHistory();
    });

    resultsGrid.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
            tryAddToHistory();
        }
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        typeFilter.value = '';
        genreFilter.value = '';
        showDefaultState();
    });

    window.resetSearch = function() {
        searchInput.value = '';
        typeFilter.value = '';
        genreFilter.value = '';
        showDefaultState();
    };

    async function init() {
        await loadData();
        renderHistory();
    }

    init();

})();
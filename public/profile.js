
        let currentUser = null;
        let profileLoadFailed = false; // اگر خواندن پروفایل خطا بده، دیگه اجازه نمی‌دیم فرم ذخیره، آواتار رو با مقدار خالی پاک کنه

// =====================================================================
// نوتیفیکیشن‌های شناور (toast) — برای فیدبک‌های سریع و کم‌مزاحم
// =====================================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('is-visible'));

    setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}

// کپی شماره‌ی عضویت با یک کلیک
function copyMemberId() {
    const idEl = document.getElementById('dispMemberId');
    const id = idEl ? idEl.innerText.trim() : '';
    if (!id) return;

    navigator.clipboard.writeText(id)
        .then(() => showToast('شماره عضویت کپی شد', 'success'))
        .catch(() => showToast('کپی انجام نشد، لطفاً دستی کپی کن', 'error'));
}

async function loadUserProfile() {
    const client = window.supabaseClient || window.supabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (!client) return;

    // ۱. چک کردن Session
    const { data: { user } } = await client.auth.getUser();

    // ۲. اگر کاربر لاگین نبود
    if (!user) {
        // اگر تابع باز کردن مدال ورود در صفحه وجود داشت (حالت SPA)
        if (typeof openAuthModal === 'function') {
            openAuthModal('login');
            // اگر تابع لود صفحه خانه وجود دارد، به خانه برگردد
            if (typeof loadPageByName === 'function') {
                loadPageByName('home');
            } else {
                window.location.href = '/?action=login';
            }
        } else {
            // اگر فایل جداگانه است، هدایت به صفحه اصلی با پارامتر ورود
            window.location.href = '/?action=login';
        }
        return;
    }

    // ۳. اگر کاربر لاگین بود
    currentUser = user;
    document.getElementById('dispEmail').innerText = user.email || '';

    // شماره‌ی عضویت (برگرفته از بخشی از شناسه‌ی کاربر) — صرفاً جنبه‌ی نمایشی دارد
    const memberIdEl = document.getElementById('dispMemberId');
    if (memberIdEl && user.id) {
        memberIdEl.innerText = user.id.replace(/-/g, '').slice(0, 8).toUpperCase();
    }

    // نمایش تاریخ عضویت + تعداد روزهایی که از عضویت گذشته
    const now = new Date();
    if (user.created_at) {
        const createdDateObj = new Date(user.created_at);
        document.getElementById('dispCreatedAt').innerText = createdDateObj.toLocaleDateString('fa-IR');

        const joinDaysEl = document.getElementById('dispJoinDays');
        if (joinDaysEl) {
            const daysSinceJoin = Math.max(0, Math.floor((now - createdDateObj) / (1000 * 60 * 60 * 24)));
            joinDaysEl.innerText = `(${daysSinceJoin} روز)`;
        }
    }

    // دریافت اطلاعات پروفایل
    const { data: profile, error } = await client
        .from('profiles')
        .select('full_name, avatar_url, is_vip, vip_until')
        .eq('id', user.id)
        .maybeSingle();

    if (error) {
        console.error("خطا در دریافت پروفایل:", error.message);
        profileLoadFailed = true;
        const msgBox = document.getElementById('msgBox');
        if (msgBox) {
            msgBox.innerText = "اطلاعات پروفایل کامل لود نشد (مشکل شبکه یا دسترسی). قبل از ذخیره تغییرات، صفحه رو رفرش کن تا آواتار قبلی پاک نشه.";
            msgBox.className = "p-3 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/30 block mb-4";
        }
    }

    const username = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'کاربر مانهواچی';
    document.getElementById('dispUsername').innerText = username;
    document.getElementById('usernameInput').value = username;

    // ست کردن آواتار
    if (profile?.avatar_url) {
        showAvatar(profile.avatar_url);
        document.getElementById('avatarUrlInput').value = profile.avatar_url;
    }

    // بررسی وضعیت VIP
    const vipStatusText = document.getElementById('vipStatusText');
    const vipIcon = document.getElementById('vipIcon');
    const vipActionBtn = document.getElementById('vipActionBtn');
    const vipBadge = document.getElementById('vipBadge');
    const vipDaysWrap = document.getElementById('vipDaysWrap');
    const vipDaysNumber = document.getElementById('vipDaysNumber');
    const vipProgressBar = document.getElementById('vipProgressBar');

    const vipUntilDate = profile?.vip_until ? new Date(profile.vip_until) : null;
    const isVip = profile?.is_vip && (!vipUntilDate || vipUntilDate > now);
    const isExpired = !isVip && vipUntilDate && vipUntilDate <= now;

    // مقدار پیش‌فرض: شمارشگر روزها مخفی است مگر این‌که بعداً پر شود
    if (vipDaysWrap) {
        vipDaysWrap.classList.add('hidden');
        vipDaysWrap.classList.remove('is-safe', 'is-warning', 'is-critical');
    }

    if (isVip) {
        if (vipBadge) vipBadge.classList.remove('hidden');
        if (vipIcon) vipIcon.className = "material-symbols-outlined text-emerald-400 text-3xl";

        if (vipUntilDate) {
            const endDate = vipUntilDate.toLocaleDateString('fa-IR');
            const msPerDay = 1000 * 60 * 60 * 24;
            const daysLeft = Math.max(0, Math.ceil((vipUntilDate - now) / msPerDay));

            let urgency = 'is-safe';
            if (daysLeft <= 3) urgency = 'is-critical';
            else if (daysLeft <= 7) urgency = 'is-warning';

            if (vipStatusText) {
                vipStatusText.innerHTML = `<span class="text-emerald-400 font-bold block mb-1">اشتراک ویژه شما فعال است</span> اعتبار تا: <span class="mono">${endDate}</span>`;
            }
            if (vipDaysWrap) {
                vipDaysWrap.classList.remove('hidden');
                vipDaysWrap.classList.add(urgency);
            }
            if (vipDaysNumber) vipDaysNumber.innerText = daysLeft;
            if (vipProgressBar) {
                // نوار پیشرفت روی یک بازه‌ی مرجع ۳۰ روزه محاسبه می‌شود تا همیشه قابل خواندن باشد
                const pct = Math.min(100, Math.max(4, (daysLeft / 30) * 100));
                vipProgressBar.style.width = pct + '%';
            }
        } else {
            if (vipStatusText) {
                vipStatusText.innerHTML = `<span class="text-emerald-400 font-bold block mb-1">اشتراک ویژه شما فعال است</span> اعتبار: <span class="mono">نامحدود</span>`;
            }
        }

        if (vipActionBtn) {
            vipActionBtn.innerText = "تمدید اشتراک VIP";
            vipActionBtn.className = "w-full py-3 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black font-bold text-xs transition-all text-center shadow-lg shadow-emerald-950/30 block";
        }
    } else if (isExpired) {
        if (vipIcon) vipIcon.className = "material-symbols-outlined text-red-500 text-3xl";
        if (vipStatusText) {
            vipStatusText.innerHTML = `<span class="text-red-400 font-bold block mb-1">اشتراک ویژه‌ی شما به پایان رسیده</span> تاریخ انقضا: <span class="mono">${vipUntilDate.toLocaleDateString('fa-IR')}</span>`;
        }
        if (vipActionBtn) {
            vipActionBtn.innerText = "تمدید اشتراک VIP";
            vipActionBtn.className = "w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold text-xs transition-all shadow-lg shadow-red-950/50 text-center block";
        }
    } else {
        if (vipStatusText) {
            vipStatusText.innerText = "شما در حال حاضر حساب معمولی دارید. با تهیه اشتراک VIP به آرشیو اختصاصی دسترسی پیدا کنید.";
        }
    }

    // بارگذاری بوکمارک‌ها و کامنت‌های خود کاربر
    loadUserBookmarks(client);
    loadUserComments(client);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =====================================================================
// بوکمارک‌های من
// =====================================================================
async function loadUserBookmarks(client) {
    const listEl = document.getElementById('bookmarksList');
    const hintEl = document.getElementById('bookmarksCountHint');
    if (!listEl || !currentUser) return;

    const { data: bookmarks, error } = await client
        .from('bookmarks')
        .select('id, manhwa_slug, title_en, title_fa, cover_url, created_at')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) {
        listEl.innerHTML = `<p class="col-span-full text-xs text-red-400">خطا در بارگذاری علامت‌گذاری‌ها.</p>`;
        return;
    }

    if (hintEl) hintEl.innerHTML = `<span class="text-white font-bold">${bookmarks.length}</span> مانهوای ذخیره شده`;

    if (!bookmarks || bookmarks.length === 0) {
        listEl.innerHTML = `
            <div class="col-span-full empty-panel">
                هنوز هیچ مانهوایی رو نشان نکردی.<br />
                از صفحه‌ی هر مانهوا روی دکمه‌ی 🔖 بزن تا اینجا اضافه بشه.
            </div>`;
        return;
    }

    listEl.innerHTML = bookmarks.map(b => {
        const title = b.title_fa || b.title_en || b.manhwa_slug;
        const cover = b.cover_url || '';
        return `
            <div class="shelf-item group" data-title="${escapeHtml(title.toLowerCase())}">
                <a href="/manga.php?slug=${encodeURIComponent(b.manhwa_slug)}" class="block aspect-[3/4] bg-zinc-800">
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" class="w-full h-full object-cover" />` : ''}
                </a>
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                    <p class="text-[11px] font-bold text-white truncate">${escapeHtml(title)}</p>
                </div>
                <button onclick="removeBookmark('${b.manhwa_slug}')" title="حذف نشان" class="shelf-item__remove">
                    <span class="material-symbols-outlined text-sm">close</span>
                </button>
            </div>
        `;
    }).join('');
}

async function removeBookmark(slug) {
    const client = window.supabaseClient || window.supabase;
    if (!client || !currentUser) return;

    const { error } = await client
        .from('bookmarks')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('manhwa_slug', slug);

    if (error) {
        showToast('خطا در حذف نشان: ' + error.message, 'error');
        return;
    }
    showToast('از علامت‌گذاری‌ها حذف شد', 'success');
    loadUserBookmarks(client);
}

// =====================================================================
// دیدگاه‌های من
// =====================================================================
async function loadUserComments(client) {
    const listEl = document.getElementById('commentsList');
    const hintEl = document.getElementById('commentsCountHint');
    if (!listEl || !currentUser) return;

    const { data: comments, error } = await client
        .from('messages')
        .select('id, text, manhwa_slug, approved, created_at, parent_message_id')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) {
        listEl.innerHTML = `<p class="text-xs text-red-400">خطا در بارگذاری دیدگاه‌ها.</p>`;
        return;
    }

    if (hintEl) hintEl.innerHTML = `<span class="text-white font-bold">${comments.length}</span> دیدگاه ثبت‌شده`;

    if (!comments || comments.length === 0) {
        listEl.innerHTML = `
            <div class="empty-panel">
                هنوز نظری ثبت نکردی.<br />
                زیر هر چپتر می‌تونی اولین دیدگاهت رو بنویسی.
            </div>`;
        return;
    }

    listEl.innerHTML = comments.map(c => {
        const statusBadge = c.approved
            ? `<span class="stamp stamp--ok">تایید شده</span>`
            : `<span class="stamp stamp--wait">در انتظار تایید</span>`;
        const typeLabel = c.parent_message_id ? 'پاسخ' : 'نظر';
        const date = new Date(c.created_at).toLocaleDateString('fa-IR');

        return `
            <div class="bubble">
                <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] text-zinc-500">${typeLabel} روی</span>
                        <a href="/manga.php?slug=${encodeURIComponent(c.manhwa_slug)}" class="text-[11px] font-bold text-red-400 hover:underline">${escapeHtml(c.manhwa_slug)}</a>
                        ${statusBadge}
                    </div>
                    <button onclick="deleteOwnComment('${c.id}')" title="حذف دیدگاه" class="text-zinc-500 hover:text-red-500 transition-colors">
                        <span class="material-symbols-outlined text-base">delete</span>
                    </button>
                </div>
                <p class="text-xs text-zinc-300 leading-relaxed">${escapeHtml(c.text)}</p>
                <p class="text-[10px] text-zinc-600 mt-2 mono">${date}</p>
            </div>
        `;
    }).join('');
}

async function deleteOwnComment(commentId) {
    const client = window.supabaseClient || window.supabase;
    if (!client || !currentUser) return;
    if (!confirm('این دیدگاه حذف بشه؟')) return;

    const { error } = await client
        .from('messages')
        .delete()
        .eq('id', commentId)
        .eq('user_id', currentUser.id);

    if (error) {
        showToast('خطا در حذف دیدگاه: ' + error.message, 'error');
        return;
    }
    showToast('دیدگاه حذف شد', 'success');
    loadUserComments(client);
}

// =====================================================================
// تاریخچه‌ی خواندن (فقط روی همین گوشی/مرورگر - در localStorage)
// نکته: این تاریخچه به اکانت کاربر متصل نیست و بین دستگاه‌ها سینک نمی‌شه.
// خودِ صفحه‌ی چپتر باید تابع saveReadingHistory را در هر بار باز شدن صدا بزند.
// =====================================================================
const READING_HISTORY_KEY = 'manhwachi_reading_history';
const READING_HISTORY_LIMIT = 40;

function getReadingHistory() {
    try {
        const raw = JSON.parse(localStorage.getItem(READING_HISTORY_KEY));
        return Array.isArray(raw) ? raw : [];
    } catch (e) {
        return [];
    }
}

// این تابع را باید از صفحه‌ی هر چپتر (نه از پروفایل) صدا بزنی، هر بار که کاربر یک چپتر را باز می‌کند
function saveReadingHistory({ slug, title, cover, chapter_number, chapter_title, url }) {
    if (!slug) return;
    let history = getReadingHistory();
    history = history.filter(h => h.slug !== slug); // یک ردیف برای هر مانهوا، همیشه آخرین چپتر دیده‌شده
    history.unshift({
        slug,
        title: title || slug,
        cover: cover || '',
        chapter_number: chapter_number || null,
        chapter_title: chapter_title || '',
        url: url || `/manga.php?slug=${encodeURIComponent(slug)}`,
        timestamp: Date.now()
    });
    if (history.length > READING_HISTORY_LIMIT) {
        history = history.slice(0, READING_HISTORY_LIMIT);
    }
    try {
        localStorage.setItem(READING_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('ذخیره‌ی تاریخچه‌ی خواندن با خطا مواجه شد:', e);
    }
}

function loadReadingHistory() {
    const listEl = document.getElementById('historyList');
    const hintEl = document.getElementById('historyCountHint');
    if (!listEl) return;

    const history = getReadingHistory().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (hintEl) hintEl.innerHTML = `<span class="text-white font-bold">${history.length}</span> مانهوا در تاریخچه`;

    if (!history.length) {
        listEl.innerHTML = `
            <div class="col-span-full empty-panel">
                هنوز چیزی نخوندی.<br />
                این تاریخچه فقط روی همین گوشی یا مرورگر ذخیره می‌شه، نه روی اکانتت.
            </div>`;
        return;
    }

    listEl.innerHTML = history.map(h => {
        const title = escapeHtml(h.title || h.slug);
        const cover = h.cover || '';
        const chapterLabel = h.chapter_number
            ? `چپتر ${escapeHtml(String(h.chapter_number))}`
            : escapeHtml(h.chapter_title || '');

        return `
            <div class="shelf-item group" data-title="${title.toLowerCase()}">
                <a href="${h.url}" class="block aspect-[3/4] bg-zinc-800">
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="${title}" class="w-full h-full object-cover" />` : ''}
                </a>
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                    <p class="text-[11px] font-bold text-white truncate">${title}</p>
                    ${chapterLabel ? `<p class="text-[10px] text-zinc-400 truncate">${chapterLabel}</p>` : ''}
                </div>
                <button onclick="removeReadingHistoryItem('${h.slug}')" title="حذف از تاریخچه" class="shelf-item__remove">
                    <span class="material-symbols-outlined text-sm">close</span>
                </button>
            </div>
        `;
    }).join('');
}

// جستجوی زنده روی بوکمارک‌ها/تاریخچه (سمت کلاینت، بدون درخواست جدید به سرور)
function filterShelf(listId, query) {
    const list = document.getElementById(listId);
    if (!list) return;
    const q = query.trim().toLowerCase();
    let visibleCount = 0;

    list.querySelectorAll('.shelf-item').forEach(item => {
        const matches = !q || (item.dataset.title || '').includes(q);
        item.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
    });

    let emptyState = list.querySelector('.shelf-search-empty');
    const hasItems = list.querySelectorAll('.shelf-item').length > 0;

    if (q && visibleCount === 0 && hasItems) {
        if (!emptyState) {
            emptyState = document.createElement('div');
            emptyState.className = 'col-span-full empty-panel shelf-search-empty';
            emptyState.innerText = 'چیزی با این عبارت پیدا نشد.';
            list.appendChild(emptyState);
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

function removeReadingHistoryItem(slug) {
    const history = getReadingHistory().filter(h => h.slug !== slug);
    localStorage.setItem(READING_HISTORY_KEY, JSON.stringify(history));
    loadReadingHistory();
    showToast('از تاریخچه حذف شد', 'success');
}

function clearReadingHistory() {
    if (!confirm('کل تاریخچه‌ی خواندن روی این گوشی پاک بشه؟')) return;
    localStorage.removeItem(READING_HISTORY_KEY);
    loadReadingHistory();
    showToast('تاریخچه خواندن پاک شد', 'success');
}

        // نمایش عکس پروفایل
        function showAvatar(url) {
            const avatarImg = document.getElementById('avatarImg');
            const avatarFallback = document.getElementById('avatarFallback');
            const removeBtn = document.getElementById('removeAvatarBtn');
            if (url) {
                avatarImg.src = url;
                avatarImg.classList.remove('hidden');
                avatarFallback.classList.add('hidden');
                if (removeBtn) removeBtn.classList.remove('hidden');
            }
        }

        // بازگرداندن آیکون پیش‌فرض (وقتی عکس پروفایل حذف می‌شود)
        function resetAvatarUI() {
            const avatarImg = document.getElementById('avatarImg');
            const avatarFallback = document.getElementById('avatarFallback');
            const removeBtn = document.getElementById('removeAvatarBtn');
            avatarImg.classList.add('hidden');
            avatarImg.src = '';
            avatarFallback.classList.remove('hidden');
            if (removeBtn) removeBtn.classList.add('hidden');
        }

        // حذف تمام فایل‌های آواتار قبلیِ کاربر از Storage
        // (چون هر کاربر باید فقط یک عکس پروفایل روی سرور داشته باشد)
        async function clearOldAvatarFiles(client) {
            const { data: existingFiles, error: listError } = await client.storage
                .from('avatars')
                .list(currentUser.id);

            if (listError || !existingFiles || existingFiles.length === 0) return;

            const pathsToRemove = existingFiles.map(f => `${currentUser.id}/${f.name}`);
            await client.storage.from('avatars').remove(pathsToRemove);
        }

        // نکته: عکس‌های موبایل معمولاً ۳-۸ مگابایت هستند. این تابع قبل از آپلود،
        // عکس را به حداکثر ۵۱۲ پیکسل تغییر اندازه می‌دهد و به JPEG با کیفیت ۸۲٪
        // فشرده می‌کند، تا هم آپلود سریع‌تر باشد و هم فشار کمتری به سرور بیاید.
        function compressImage(file, maxDimension = 512, quality = 0.82) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const reader = new FileReader();

                reader.onerror = () => reject(new Error('خطا در خواندن فایل تصویر.'));
                reader.onload = () => { img.src = reader.result; };

                img.onerror = () => reject(new Error('فایل انتخاب‌شده یک تصویر معتبر نیست.'));
                img.onload = () => {
                    let { width, height } = img;

                    if (width > height && width > maxDimension) {
                        height = Math.round(height * (maxDimension / width));
                        width = maxDimension;
                    } else if (height > maxDimension) {
                        width = Math.round(width * (maxDimension / height));
                        height = maxDimension;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob(
                        (blob) => {
                            if (!blob) return reject(new Error('فشرده‌سازی تصویر با خطا مواجه شد.'));
                            resolve(blob);
                        },
                        'image/jpeg',
                        quality
                    );
                };

                reader.readAsDataURL(file);
            });
        }

        // امکان رها کردن (drag & drop) مستقیم فایل عکس روی قاب آواتار
        function setupAvatarDropZone() {
            const dropZone = document.getElementById('avatarDropZone');
            if (!dropZone) return;

            const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };

            ['dragenter', 'dragover'].forEach(evt => {
                dropZone.addEventListener(evt, (e) => {
                    preventDefaults(e);
                    dropZone.classList.add('is-dragover');
                });
            });

            ['dragleave', 'drop'].forEach(evt => {
                dropZone.addEventListener(evt, (e) => {
                    preventDefaults(e);
                    dropZone.classList.remove('is-dragover');
                });
            });

            dropZone.addEventListener('drop', (e) => {
                const file = e.dataTransfer?.files?.[0];
                if (!file) return;
                if (!currentUser) {
                    showToast('برای تغییر عکس ابتدا وارد حساب شو', 'error');
                    return;
                }
                uploadAvatar({ target: { files: [file], value: '' } });
            });
        }

        // آپلود مستقیم عکس به Supabase Storage
        async function uploadAvatar(event) {
            const file = event.target.files[0];
            if (!file) return;

            const client = window.supabaseClient || window.supabase;
            const msgBox = document.getElementById('msgBox');

            // اعتبارسنجی نوع فایل سمت کلاینت (برای پیام خطای سریع‌تر؛
            // محدودیت واقعی و قابل‌اتکا همان محدودیت سمت سرور روی باکت است)
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            if (!allowedTypes.includes(file.type)) {
                msgBox.innerText = "فقط فایل‌های تصویری (JPG, PNG, WEBP, GIF) مجاز هستند.";
                msgBox.className = "p-3 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/30 block mb-4";
                event.target.value = '';
                return;
            }

            const MAX_RAW_SIZE = 15 * 1024 * 1024; // ۱۵ مگابایت — سقفی برای فایل خام قبل از فشرده‌سازی
            if (file.size > MAX_RAW_SIZE) {
                msgBox.innerText = "حجم فایل خیلی زیاده. لطفاً عکس کوچک‌تری انتخاب کن.";
                msgBox.className = "p-3 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/30 block mb-4";
                event.target.value = '';
                return;
            }

            try {
                msgBox.innerText = "در حال آماده‌سازی عکس...";
                msgBox.className = "p-3 rounded-xl text-xs bg-zinc-800/60 text-zinc-300 border border-zinc-700/50 block mb-4";

                // GIF را دست‌نخورده می‌فرستیم تا انیمیشنش خراب نشه؛ بقیه فرمت‌ها فشرده می‌شن
                const isGif = file.type === 'image/gif';
                const uploadBlob = isGif ? file : await compressImage(file);
                const fileExt = isGif ? 'gif' : 'jpg';

                // هر کاربر فقط یک عکس پروفایل می‌تواند داشته باشد:
                // قبل از آپلود عکس جدید، هر فایل قبلیِ همین کاربر پاک می‌شود.
                await clearOldAvatarFiles(client);

                const filePath = `${currentUser.id}/${Date.now()}.${fileExt}`;

                let { error: uploadError } = await client.storage
                    .from('avatars')
                    .upload(filePath, uploadBlob, {
                        upsert: true,
                        contentType: isGif ? 'image/gif' : 'image/jpeg'
                    });

                if (uploadError) throw uploadError;

                const { data } = client.storage.from('avatars').getPublicUrl(filePath);
                const publicUrl = data.publicUrl;

                // نکته: چون UPDATE مستقیم روی profiles با RLS مسدود شده،
                // از تابع امن update_own_profile استفاده می‌کنیم.
                const currentName = document.getElementById('usernameInput').value.trim();
                const { error: updateError } = await client.rpc('update_own_profile', {
                    p_full_name: currentName,
                    p_avatar_url: publicUrl
                });

                if (updateError) throw updateError;

                showAvatar(publicUrl);
                document.getElementById('avatarUrlInput').value = publicUrl;

                msgBox.innerText = "عکس پروفایل با موفقیت تغییر کرد.";
                msgBox.className = "p-3 rounded-xl text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 block mb-4";

            } catch (err) {
                console.error(err);
                msgBox.innerText = "خطا در آپلود عکس: " + (err.message || "لطفا مطمئن شوید باکت avatars ساخته شده است.");
                msgBox.className = "p-3 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/30 block mb-4";
            } finally {
                event.target.value = '';
            }
        }

        // حذف کامل عکس پروفایل (هم از Storage و هم از جدول profiles)
        async function removeAvatar() {
            if (!currentUser) return;
            if (!confirm('عکس پروفایل حذف بشه؟')) return;

            const client = window.supabaseClient || window.supabase;
            const msgBox = document.getElementById('msgBox');
            const removeBtn = document.getElementById('removeAvatarBtn');

            if (removeBtn) removeBtn.disabled = true;

            try {
                await clearOldAvatarFiles(client);

                const currentName = document.getElementById('usernameInput').value.trim();
                const { error } = await client.rpc('update_own_profile', {
                    p_full_name: currentName,
                    p_avatar_url: null
                });

                if (error) throw error;

                resetAvatarUI();
                document.getElementById('avatarUrlInput').value = '';

                msgBox.innerText = "عکس پروفایل حذف شد.";
                msgBox.className = "p-3 rounded-xl text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 block mb-4";

            } catch (err) {
                console.error(err);
                msgBox.innerText = "خطا در حذف عکس: " + err.message;
                msgBox.className = "p-3 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/30 block mb-4";
            } finally {
                if (removeBtn) removeBtn.disabled = false;
            }
        }

        // ذخیره فرم تنظیمات
        async function handleUpdateProfile(e) {
            e.preventDefault();
            const newName = document.getElementById('usernameInput').value.trim();
            const newAvatarUrl = document.getElementById('avatarUrlInput').value.trim();
            const saveBtn = document.getElementById('saveBtn');
            const msgBox = document.getElementById('msgBox');

            if (!newName) return;

            // اگر لود اولیه‌ی پروفایل خطا خورده باشه، فیلد آدرس آواتار ممکنه به‌اشتباه خالی مونده باشه؛
            // در این حالت این فیلد رو نمی‌فرستیم تا آواتار واقعیِ روی سرور پاک نشه.
            if (profileLoadFailed) {
                msgBox.innerText = "به‌خاطر خطای قبلی در لود پروفایل، فقط نام ذخیره می‌شه. لطفاً صفحه رو رفرش کن و دوباره امتحان کن.";
                msgBox.className = "p-3 rounded-xl text-xs bg-amber-500/10 text-amber-400 border border-amber-500/30 block mb-4";
            }

            saveBtn.disabled = true;
            saveBtn.innerText = "در حال ذخیره...";

            try {
                const client = window.supabaseClient || window.supabase;

                const rpcPayload = { p_full_name: newName };
                if (!profileLoadFailed) {
                    rpcPayload.p_avatar_url = newAvatarUrl;
                }

                const { error } = await client.rpc('update_own_profile', rpcPayload);

                if (error) throw error;

                msgBox.innerText = "اطلاعات با موفقیت به‌روزرسانی شد.";
                msgBox.className = "p-3 rounded-xl text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 block mb-4";
                document.getElementById('dispUsername').innerText = newName;
                if (newAvatarUrl) showAvatar(newAvatarUrl);

            } catch (err) {
                msgBox.innerText = "خطا در بروزرسانی اطلاعات: " + err.message;
                msgBox.className = "p-3 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/30 block mb-4";
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerText = "ذخیره تغییرات";
            }
        }

        // تغییر رمز عبور
        async function handleChangePassword(e) {
            e.preventDefault();
            const newPass = document.getElementById('newPasswordInput').value;
            const confirmPass = document.getElementById('confirmPasswordInput').value;
            const btn = document.getElementById('changePasswordBtn');

            if (newPass.length < 6) {
                showToast('رمز عبور باید حداقل ۶ کاراکتر باشد', 'error');
                return;
            }
            if (newPass !== confirmPass) {
                showToast('رمزهای عبور با هم یکسان نیستند', 'error');
                return;
            }

            const client = window.supabaseClient || window.supabase;
            if (!client) return;

            btn.disabled = true;
            const originalLabel = btn.innerText;
            btn.innerText = 'در حال تغییر...';

            try {
                const { error } = await client.auth.updateUser({ password: newPass });
                if (error) throw error;

                showToast('رمز عبور با موفقیت تغییر کرد', 'success');
                document.getElementById('newPasswordInput').value = '';
                document.getElementById('confirmPasswordInput').value = '';
            } catch (err) {
                showToast('خطا در تغییر رمز عبور: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerText = originalLabel;
            }
        }

        // خروج از حساب
        async function handleLogout() {
            const client = window.supabaseClient || window.supabase;
            if (client) {
                await client.auth.signOut();
            }
            window.location.href = '/';
        }

        document.addEventListener('DOMContentLoaded', loadUserProfile);
        // تاریخچه‌ی خواندن مستقل از لاگین بودن کاربره (روی خودِ گوشی ذخیره‌ست)، پس جدا صداش می‌زنیم
        document.addEventListener('DOMContentLoaded', loadReadingHistory);
        document.addEventListener('DOMContentLoaded', setupAvatarDropZone);

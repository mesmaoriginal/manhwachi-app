(function () {   

    let currentOffset = 0;
    const PAGE_SIZE = 10;
    let isLoading = false;
    let hasMore = true;
    let likedReels = new Set();
    let deviceId = null;
    let videoObserver = null;
    let currentPlayingVideo = null;
    let currentReelId = null;
    
    // تغییر به false: وضعیت سراسری صدا در ابتدا باز (صدادار) خواهد بود
    let isMuted = false; 

    function getDeviceId() {
        if (!deviceId) {
            deviceId = localStorage.getItem("device_id") || crypto.randomUUID();
            localStorage.setItem("device_id", deviceId);
        }
        return deviceId;
    }

    function createHeart(x, y) {
        const heart = document.createElement('span');
        heart.className = 'material-symbols-outlined absolute pointer-events-none z-50 text-red-500 text-6xl animate-ping';
        heart.style.left = (x - 30) + 'px';
        heart.style.top = (y - 30) + 'px';
        heart.style.fontVariationSettings = "'FILL' 1";
        heart.innerText = 'favorite';
        document.body.appendChild(heart);
        setTimeout(() => heart.remove(), 600);
    }

    async function fetchReels(offset = 0) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/reels?order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (!res.ok) throw new Error('خطا در دریافت ریل‌ها');
        return res.json();
    }

    async function fetchLikedReels() {
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/reel_likes?select=reel_id&device_id=eq.${getDeviceId()}`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            if (!res.ok) return new Set();
            const data = await res.json();
            return new Set(data.map(item => item.reel_id));
        } catch { return new Set(); }
    }

    async function fetchComments(reelId) {
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/comments?reel_id=eq.${reelId}&approved=eq.true&order=created_at.desc`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            return res.ok ? await res.json() : [];
        } catch { return []; }
    }

    async function fetchCommentCount(reelId) {
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/comments?reel_id=eq.${reelId}&approved=eq.true&limit=1&count=exact`, {
                headers: { 
                    'apikey': SUPABASE_KEY, 
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Prefer': 'count=exact'
                }
            });
            if (!res.ok) return 0;
            const count = res.headers.get('content-range') 
                ? parseInt(res.headers.get('content-range').split('/')[1]) 
                : 0;
            return count;
        } catch (err) {
            console.error(err);
            return 0;
        }
    }

    function toPersianDigits(num) {
        const id = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        return num.toString().replace(/[0-9]/g, function (w) {
            return id[+w];
        });
    }

    async function postComment() {
        const usernameInput = document.getElementById('username-input');
        const commentInput = document.getElementById('comment-input');
        const username = usernameInput.value.trim();
        const text = commentInput.value.trim();

        if (!username) return alert("لطفاً نام خود را وارد کنید");
        if (!text) return alert("نظر خود را بنویسید");
        if (text.length > 500) return alert("نظر نمی‌تواند بیشتر از ۵۰۰ کاراکتر باشد");
        if (!currentReelId) return;

        const sendBtn = document.getElementById('submit-comment-btn');
        if (sendBtn) sendBtn.disabled = true;

        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    reel_id: currentReelId,
                    device_id: getDeviceId(),
                    username: username,
                    text: text,
                    approved: true
                })
            });

            if (res.ok) {
                commentInput.value = '';
                document.getElementById('char-count').textContent = toPersianDigits('0/500');

                await loadComments(currentReelId);
                
                const reelRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/reels?id=eq.${currentReelId}&select=comments_count`,
                    {
                        headers: {
                            apikey: SUPABASE_KEY,
                            Authorization: `Bearer ${SUPABASE_KEY}`
                        }
                    }
                );

                const reelData = await reelRes.json();
                const countEl = document.getElementById(`comment-count-${currentReelId}`);

                if (countEl && reelData.length > 0) {
                    countEl.textContent = toPersianDigits(reelData[0].comments_count || 0);
                }
            } else {
                const errText = await res.text();
                alert(errText.includes('۳ نظر') || errText.includes('limit') 
                    ? 'شما فقط مجاز به ثبت ۳ نظر در این پست هستید!' 
                    : 'خطا در ارسال نظر');
            }
        } catch (err) {
            console.error(err);
            alert('خطا در ارتباط با سرور');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    function setupCharCounter() {
        const input = document.getElementById('comment-input');
        const counter = document.getElementById('char-count');
        if (!input || !counter) return;
        
        input.addEventListener('input', () => {
            counter.textContent = toPersianDigits(`${input.value.length}/500`);
        });
    }

    async function loadComments(reelId) {
        const list = document.getElementById('comments-list');
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 gap-3">
                <div class="w-8 h-8 border-4 border-t-red-500 border-white/10 rounded-full animate-spin"></div>
                <span class="text-white/60 text-sm">در حال بارگذاری نظرات...</span>
            </div>`;

        const comments = await fetchComments(reelId);
        if (comments.length === 0) {
            list.innerHTML = `
                <div class="text-center py-16 text-gray-400 flex flex-col items-center justify-center gap-2">
                    <span class="material-symbols-outlined text-5xl opacity-40">forum</span>
                    <p class="font-bold">هنوز نظری ثبت نشده است</p>
                    <p class="text-xs text-gray-500">اولین نفر باشید که نظر می‌دهید!</p>
                </div>`;
            return;
        }

        list.innerHTML = comments.map(c => {
            const dateStr = new Date(c.created_at).toLocaleString('fa-IR', {
                dateStyle: 'short', 
                timeStyle: 'short'
            });
            return `
                <div class="comment-item flex gap-3 p-4 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <div class="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex-shrink-0 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-red-500/20">
                        ${c.username[0]?.toUpperCase() || '؟'}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2">
                            <p class="font-bold text-white text-sm truncate">${c.username}</p>
                            <span class="text-[10px] text-gray-500 whitespace-nowrap">${toPersianDigits(dateStr)}</span>
                        </div>
                        <p class="text-white/90 leading-relaxed text-sm mt-1 break-words">${c.text}</p>
                    </div>
                </div>
            `;
        }).join('');
    }

    function openComments(reelId) {
        currentReelId = reelId;
        const sheet = document.getElementById('comments-sheet');
        sheet.style.transition = 'transform .4s cubic-bezier(0.16, 1, 0.3, 1)';
        sheet.style.transform = 'translateY(0)';
        sheet.classList.add('open');
        document.getElementById('comments-overlay').classList.remove('hidden');
        loadComments(reelId);
    }

    function closeComments() {
        const sheet = document.getElementById('comments-sheet');
        sheet.classList.remove('open');
        sheet.style.transition = 'transform .3s cubic-bezier(0.16, 1, 0.3, 1)';
        sheet.style.transform = 'translateY(100%)';
        document.getElementById('comments-overlay').classList.add('hidden');
        currentReelId = null;
    }

    function showVolumeIndicator(container, muted) {
        const oldIndicator = container.querySelector('.volume-indicator');
        if (oldIndicator) oldIndicator.remove();

        const indicator = document.createElement('div');
        indicator.className = 'volume-indicator absolute inset-0 flex items-center justify-center pointer-events-none z-40';
        indicator.innerHTML = `
            <div class="volume-indicator-box animate-ping-once">
                <span class="material-symbols-outlined text-4xl text-white">
                    ${muted ? 'volume_off' : 'volume_up'}
                </span>
            </div>
        `;
        container.appendChild(indicator);
        setTimeout(() => indicator.remove(), 600);
    }

    function createReelElement(reel, isLiked) {
        const isVideo = !!reel.video_url?.trim();
        // حذف صفت muted برای اینکه لود اولیه با صدا باشد
        const mediaHTML = isVideo ? `
            <div class="video-container relative">
                <video 
                    autoplay
                    loop
                    playsinline
                    webkit-playsinline
                    x5-playsinline
                    x5-video-player-type="h5"
                    x5-video-player-fullscreen="false"
                    controlsList="nodownload"
                    disablePictureInPicture
                    x-webkit-airplay="allow"
                    style="object-fit: contain;" 
                    class="w-full h-full object-cover"
                    data-reel-id="${reel.id}">
                    <source src="${reel.video_url}" type="video/mp4">
                </video>
            </div>` : 
            `<div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${reel.image_url}')"></div>`;

        const reelEl = document.createElement('div');
        reelEl.className = 'reel relative h-full w-full bg-black flex-shrink-0 select-none';
        reelEl.dataset.id = reel.id;
        
        reelEl.innerHTML = `
            ${mediaHTML}
            <div class="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/90 pointer-events-none z-10"></div>
            
<div class="absolute flex flex-col items-center z-20" style="gap: 0.5rem; bottom: calc(110px + 30vh); right: 13px;">
                <div onclick="toggleLike(event, '${reel.id}')" class="flex flex-col items-center cursor-pointer active:scale-95 transition-transform text-white">
                    <div class="w-14 h-14 rounded-full flex items-center justify-center">
                        <span class="material-symbols-outlined text-4xl ${isLiked ? 'text-red-500' : 'text-white'}" id="like-icon-${reel.id}">favorite</span>
                    </div>
                    <span class="text-sm mt-1" id="like-count-${reel.id}" data-count="${reel.likes_count || 0}">${(reel.likes_count || 0).toLocaleString('fa-IR')}</span> 
                </div>
                
                <div onclick="openComments('${reel.id}')" class="flex flex-col items-center cursor-pointer text-white">
                    <div class="w-14 h-14 rounded-full flex items-center justify-center">
                        <span class="material-symbols-outlined text-4xl text-white">chat_bubble</span>
                    </div>
                    <span class="text-sm mt-1" id="comment-count-${reel.id}">${(reel.comments_count || 0).toLocaleString('fa-IR')}</span>
                </div>
                
                <div onclick="shareReel('${reel.share_url}')" class="flex flex-col items-center cursor-pointer">
                    <div class="w-14 h-14 rounded-full flex items-center justify-center">
                        <span class="material-symbols-outlined text-4xl text-white">share</span>
                    </div>
                </div>
            </div>

            <div class="absolute z-20 w-full" style="bottom: 110px; direction: rtl; padding-inline: 20px;">
                ${reel.manhwa_url ? `
                <div class="mb-4">
                    <button onclick="goToManhwa('${reel.manhwa_url}')" class="manhwa-card">
                        <span class="material-symbols-outlined book-icon">auto_stories</span>
                        <span class="title-reels">خواندن مانهوا <strong>${reel.manhwa_title}</strong></span>
                        <span class="material-symbols-outlined arrow">chevron_right</span>
                    </button>
                </div>
                ` : ''}
                <div class="flex items-center gap-3 mb-4">
                    <div class="creator-avatar-container">
                        <img src="${reel.avatar_url || 'https://via.placeholder.com/60'}" class="creator-avatar-img">
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold truncate text-white">${reel.creator}@</p>
                        <p class="text-sm text-white/70">${reel.level || ''}</p>
                    </div>
                    <button class="bg-white text-black px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap" onclick="window.location.href='https://www.instagram.com/ManhwaChiOfficial'">دنبال کردن</button>
                </div>
                <div class="reel-description-wrapper mb-2">
                    <p class="reel-description collapsed text-white" onclick="toggleDescription(this)">
                        ${reel.description}
                    </p>
                    ${reel.description.length > 90 ? `<span class="more-text text-gray-300 font-bold">... بیشتر</span>` : ""}
                </div>
                <div class="flex gap-2 flex-wrap">
                    ${(reel.tags || []).map(tag => `<span class="text-blue-400 text-sm">#${tag}</span>`).join('')}
                </div>
            </div>
        `;

        if (isVideo) {
            const video = reelEl.querySelector('video');
            setupHoldToPauseAndNoDownload(video);
            setupVideoAudioControls(video, reelEl.querySelector('.video-container'));
        }
        return reelEl;
    }

    function setupHoldToPauseAndNoDownload(video) {
        let holdTimer = null;
        let isHolding = false;

        video.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        video.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) return;
            holdTimer = setTimeout(() => {
                if (!video.paused) {
                    video.pause();
                    isHolding = true;
                }
            }, 180);
        }, { passive: true });

        const releaseHold = () => {
            if (holdTimer) clearTimeout(holdTimer);
            if (isHolding) {
                video.play().catch(() => {});
                isHolding = false;
            }
        };

        video.addEventListener('touchend', releaseHold, { passive: true });
        video.addEventListener('touchcancel', releaseHold, { passive: true });
    }

    function setupVideoAudioControls(video, container) {
        video.addEventListener('click', (e) => {
            if (e.detail === 1) {
                isMuted = !isMuted;
                
                video.muted = isMuted;

                document.querySelectorAll('video').forEach(v => {
                    v.muted = isMuted;
                });

                showVolumeIndicator(container, isMuted);
            }
        });
    }

    async function loadReels(append = false) {
        if (isLoading || !hasMore) return;
        isLoading = true;

        const container = document.getElementById('reels-feed');
        if (!append) {
            container.innerHTML = '<div class="h-screen flex items-center justify-center text-white/60">در حال بارگذاری...</div>';
        }

        try {
            const [reels, likedSet] = await Promise.all([
                fetchReels(currentOffset),
                append ? Promise.resolve(likedReels) : fetchLikedReels()
            ]);

            if (!append) likedReels = likedSet;
            if (reels.length < PAGE_SIZE) hasMore = false;

            const fragment = document.createDocumentFragment();
            reels.forEach(reel => {
                const isLiked = likedReels.has(reel.id);
                fragment.appendChild(createReelElement(reel, isLiked));
            });

            if (append) container.appendChild(fragment);
            else {
                container.innerHTML = '';
                container.appendChild(fragment);
            }

            currentOffset += PAGE_SIZE;
            setupVideoObservers();
        } catch (err) {
            console.error(err);
            container.innerHTML = `<div class="h-screen flex items-center justify-center text-red-400">خطا در بارگذاری ریل‌ها</div>`;
        } finally {
            isLoading = false;
        }
    }

    function setupVideoObservers() {
        if (videoObserver) videoObserver.disconnect();
        videoObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const video = entry.target.querySelector('video');
                if (!video) return;
                if (entry.isIntersecting) {
                    if (currentPlayingVideo && currentPlayingVideo !== video) currentPlayingVideo.pause();
                    video.currentTime = 0;
                    
                    video.muted = isMuted; 
                    
                    video.play().catch((err) => {
                        // اگر مرورگر پخش خودکار صدادار را مسدود کرد، بی‌صدا رانده و پخش می‌کند
                        console.warn("پخش خودکار صدادار مسدود شد، به حالت بی‌صدا تغییر یافت:", err);
                        video.muted = true;
                        video.play().catch(() => {});
                    });
                    currentPlayingVideo = video;
                } else if (video === currentPlayingVideo) {
                    video.pause();
                    currentPlayingVideo = null;
                }
            });
        }, { threshold: 0.65 });
        document.querySelectorAll('.reel').forEach(reel => videoObserver.observe(reel));
    }

    const likeLoading = new Set();
    function setupInteractions() {
        const feed = document.getElementById('reels-feed');
        let lastTap = 0;

        feed.addEventListener('touchstart', (e) => {
            const now = Date.now();
            const reel = e.target.closest('.reel');
            if (!reel) return;

            if (now - lastTap < 280) {
                e.preventDefault();
                createHeart(e.touches[0].clientX, e.touches[0].clientY);
                const likeIcon = document.getElementById(`like-icon-${reel.dataset.id}`);
                if (likeIcon && !likeIcon.classList.contains('text-red-500')) {
                    toggleLike(e, reel.dataset.id);
                }
            }
            lastTap = now;
        }, { passive: false });

        feed.addEventListener('scroll', throttle(() => {
            if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 500) {
                loadReels(true);
            }
        }, 250));
    }

    function throttle(func, limit) {
        let inThrottle = false;
        return function () {
            if (!inThrottle) {
                func.apply(this, arguments);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
   
    async function toggleLike(e, reelId) {
        if (likeLoading.has(reelId)) return;
        likeLoading.add(reelId);

        const icon = document.getElementById(`like-icon-${reelId}`);
        const countEl = document.getElementById(`like-count-${reelId}`);
        const wasLiked = icon.classList.contains('text-red-500');
        const oldCount = Number(countEl.dataset.count || 0);

        if (wasLiked) {
            const newCount = Math.max(0, oldCount - 1);
            icon.classList.remove('text-red-500');
            countEl.dataset.count = newCount;
            countEl.textContent = newCount.toLocaleString('fa-IR');
        } else {
            const newCount = oldCount + 1;
            icon.classList.add('text-red-500');
            countEl.dataset.count = newCount;
            countEl.textContent = newCount.toLocaleString('fa-IR');
        }

        try {
            const res = await fetch(
                `${SUPABASE_URL}/functions/v1/toggle-like`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`
                    },
                    body: JSON.stringify({
                        reel_id: reelId,
                        device_id: getDeviceId()
                    })
                }
            );

            if (!res.ok) throw new Error();
            const data = await res.json();

            countEl.dataset.count = data.likes_count || 0;
            countEl.textContent = Number(data.likes_count || 0).toLocaleString('fa-IR');

            if (data.liked) {
                icon.classList.add('text-red-500');
            } else {
                icon.classList.remove('text-red-500');
            }
        } catch (err) {
            console.error(err);
            countEl.dataset.count = oldCount;
            countEl.textContent = oldCount.toLocaleString('fa-IR');

            if (wasLiked) {
                icon.classList.add('text-red-500');
            } else {
                icon.classList.remove('text-red-500');
            }
        } finally {
            likeLoading.delete(reelId);
        }
    }

    async function shareReel(url) {
        if (!url) {
            alert('لینک اشتراک وجود ندارد');
            return;
        }
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'مشاهده ریل',
                    url: url
                });
            } else {
                await navigator.clipboard.writeText(url);
                alert('لینک کپی شد');
            }
        } catch (err) {
            console.error(err);
        }
    }

    function setupBottomSheetDrag() {
        const sheet = document.getElementById('comments-sheet');
        const dragArea = document.querySelector('.drag-area');

        let startY = 0;
        let currentTranslate = 0;
        let dragging = false;

        dragArea.addEventListener('touchstart', (e) => {
            dragging = true;
            startY = e.touches[0].clientY;
            currentTranslate = 0;
            sheet.style.transition = 'none';
        }, { passive: true });

        dragArea.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const deltaY = e.touches[0].clientY - startY;
            if (deltaY < 0) return;
            currentTranslate = deltaY;
            sheet.style.transform = `translateY(${deltaY}px)`;
        }, { passive: true });

        dragArea.addEventListener('touchend', () => {
            if (!dragging) return;
            dragging = false;
            sheet.style.transition = 'transform .25s cubic-bezier(.22,.61,.36,1)';

            if (currentTranslate > 150) {
                sheet.classList.remove('open');
                sheet.style.transform = 'translateY(100%)';
                setTimeout(() => {
                    document.getElementById('comments-overlay').classList.add('hidden');
                    sheet.style.transform = '';
                }, 250);
            } else {
                sheet.style.transform = 'translateY(0)';
            }
        });
    }

    function toggleDescription(el){
        if(el.classList.contains("collapsed")){
            el.classList.remove("collapsed");
            el.classList.add("expanded");
        } else {
            el.classList.remove("expanded");
            el.classList.add("collapsed");
        }
    }

    function initReels() {
        currentOffset = 0;
        hasMore = true;
        isLoading = false;

        const container = document.getElementById('reels-feed');
        if (container) {
            container.innerHTML = '<div class="h-screen flex items-center justify-center text-white/60">در حال بارگذاری...</div>';
        }

        loadReels(false);

        setTimeout(() => {
            setupInteractions();
            setupCharCounter();
            setupBottomSheetDrag();
        }, 300);
    }

    function cleanupReels() {
        if (videoObserver) videoObserver.disconnect();
        if (currentPlayingVideo) {
            currentPlayingVideo.pause();
            currentPlayingVideo = null;
        }
        videoObserver = null;
        currentPlayingVideo = null;
    }

    function goToManhwa(url) {
        if (!url) return;
        window.location.href = url;
    }

    window.initReels = initReels;
    window.cleanupReels = cleanupReels;
    window.openComments = openComments;
    window.closeComments = closeComments;
    window.toggleLike = toggleLike;
    window.shareReel = shareReel;
    window.postComment = postComment;
    window.createHeart = createHeart;
    window.goToManhwa = goToManhwa;

    initReels();
})();
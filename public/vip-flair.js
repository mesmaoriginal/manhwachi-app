/* =====================================================================
   ManhwaChi — VIP / Premium helpers (window.MCVip)
   استفاده: MCVip.tierOf(profile) → 'premium' | 'vip' | ''
            MCVip.badge(tier)      → HTML نشان کنار اسم
            MCVip.confetti()       → جشن کوتاه (کنفتی طلایی)
            MCVip.PERKS            → فهرست امکانات برای نمایش در پروفایل
   ===================================================================== */
(function () {
    'use strict';
    var MC = window.MCVip = window.MCVip || {};

    // پروفایل (is_vip, vip_until, vip_tier) → سطح اشتراک فعلی
    MC.tierOf = function (p) {
        if (!p || !p.is_vip) return '';
        if (p.vip_until && new Date(p.vip_until) <= new Date()) return '';
        return p.vip_tier === 'premium' ? 'premium' : 'vip';
    };

    MC.badge = function (tier) {
        if (tier === 'premium') {
            return '<span class="vf-badge vf-badge--premium" title="عضو پرمیوم"><span class="material-symbols-outlined" aria-hidden="true">workspace_premium</span>پرمیوم</span>';
        }
        if (tier === 'vip') {
            return '<span class="vf-badge vf-badge--vip" title="عضو VIP"><span class="material-symbols-outlined" aria-hidden="true">verified</span>VIP</span>';
        }
        return '';
    };

    // امکانات هر سطح (با جدول مقایسه‌ی vip.html هماهنگ است)
    // on: برای کدام سطح‌ها فعال است
    MC.PERKS = [
        { id: 'free',    icon: 'bolt',                 title: 'چپترهای رایگان فوری',  desc: 'بدون انتظار ۲۴ ساعته',         on: ['vip', 'premium'] },
        { id: 'locked',  icon: 'lock_open',            title: 'چپترهای اشتراکی',      desc: 'خواندن چپترهای قفل‌شده',        on: ['vip', 'premium'] },
        { id: 'badge',   icon: 'workspace_premium',    title: 'نشان ویژه در نظرها',   desc: 'همه تو رو با نشانت می‌شناسن',    on: ['vip', 'premium'] },
        { id: 'offline', icon: 'download_for_offline', title: 'دانلود آفلاین',        desc: 'چپترها بدون اینترنت',            on: ['premium'], href: '/offline.html' },
        { id: 'request', icon: 'add_circle',           title: 'درخواست مانهوا',       desc: 'مانهوای دلخواهت رو بخواه',       on: ['premium'], href: '/manhwa-request.html' },
        { id: 'support', icon: 'support_agent',        title: 'پشتیبانی و تیکت',      desc: 'پاسخ مستقیم از تیم',             on: ['vip', 'premium', 'free'], href: '/support.html' }
    ];


    // ---------- حافظه‌ی سطح اشتراک (فقط ظاهری: همه‌ی دسترسی‌های واقعی سمت سرور بررسی می‌شود) ----------
    // هر صفحه‌ای که سطح را از سرور فهمید remember می‌کند؛ صفحه‌های بعدی بدون پرش/فلش همان لحظه ظاهر درست را می‌گیرند.
    var TIER_KEY = 'mc_tier';
    var TIER_TTL = 3 * 864e5; // اگر ۳ روز تازه نشد، نادیده گرفته می‌شود
    MC.remember = function (tier) {
        try {
            tier = (tier === 'premium' || tier === 'vip') ? tier : '';
            if (tier) localStorage.setItem(TIER_KEY, JSON.stringify({ t: tier, at: Date.now() }));
            else localStorage.removeItem(TIER_KEY);
        } catch (e) {}
        MC.apply(tier);
    };
    MC.cached = function () {
        try {
            var o = JSON.parse(localStorage.getItem(TIER_KEY) || 'null');
            if (o && (o.t === 'premium' || o.t === 'vip') && Date.now() - o.at < TIER_TTL) return o.t;
        } catch (e) {}
        return '';
    };
    MC.apply = function (tier) {
        var c = document.documentElement.classList;
        c.toggle('vf-t-premium', tier === 'premium');
        c.toggle('vf-t-vip', tier === 'vip');
    };
    // نتیجه‌ی /api/access/me → سطح (canOffline فقط برای پرمیوم true است)
    MC.tierFromAccess = function (acc) {
        if (!acc || !acc.loggedIn) return '';
        if (acc.canOffline === true) return 'premium';
        return acc.active ? 'vip' : '';
    };
    // اعمال فوری از حافظه تا قبل از آمدن جواب سرور
    MC.apply(MC.cached());

    // کنفتی سبک بدون هیچ کتابخانه‌ای
    MC.confetti = function (opts) {
        try {
            if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            opts = opts || {};
            var count = opts.count || 70;
            var colors = opts.colors || ['#f7d778', '#e8b64a', '#fff3c4', '#fbbf24', '#ef4444', '#34d399'];
            var box = document.createElement('div');
            box.className = 'vf-confetti';
            box.setAttribute('aria-hidden', 'true');
            for (var i = 0; i < count; i++) {
                var el = document.createElement('i');
                el.style.left = (Math.random() * 100) + 'vw';
                el.style.background = colors[(Math.random() * colors.length) | 0];
                el.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
                el.style.animationDelay = (Math.random() * 0.5) + 's';
                el.style.setProperty('--vf-dx', ((Math.random() - 0.5) * 220) + 'px');
                el.style.setProperty('--vf-rot', (360 + Math.random() * 720) + 'deg');
                el.style.width = (6 + Math.random() * 5) + 'px';
                el.style.height = (9 + Math.random() * 7) + 'px';
                box.appendChild(el);
            }
            document.body.appendChild(box);
            setTimeout(function () { box.remove(); }, 4800);
        } catch (e) { /* تزئینی است؛ خطا مهم نیست */ }
    };
})();

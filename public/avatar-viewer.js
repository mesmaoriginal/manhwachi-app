/* avatar-viewer.js — نمایش زیبای عکس پروفایل (لایت‌باکس)
   استفاده: به هر المانی data-avatar-view="URL" (و اختیاری data-avatar-name) بدهید.
   روی صفحه‌ی پروفایل، #avatarImg هم خودکار پشتیبانی می‌شود.
   بدون وابستگی؛ استایل را خودش تزریق می‌کند. */
(function () {
    if (window.MCAvatarViewer) return;

    var css = '\
.mcav{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;\
font-family:Vazirmatn,system-ui,sans-serif;direction:rtl;opacity:0;transition:opacity .35s ease}\
.mcav.is-on{opacity:1}\
.mcav__bg{position:absolute;inset:0;background:rgba(6,6,8,.82);-webkit-backdrop-filter:blur(22px) saturate(1.2);backdrop-filter:blur(22px) saturate(1.2)}\
.mcav__blur{position:absolute;inset:-12%;background-size:cover;background-position:center;filter:blur(70px) saturate(1.5);opacity:.38;transform:scale(1.2)}\
.mcav__glow{position:absolute;width:520px;height:520px;max-width:90vw;border-radius:50%;background:#dc2626;opacity:.16;filter:blur(110px);pointer-events:none}\
.mcav__box{position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;max-width:100%}\
.mcav__frame{position:relative;border-radius:32px;overflow:hidden;background:#161618;border:1px solid rgba(255,255,255,.16);\
box-shadow:0 50px 100px -30px #000,0 0 0 1px rgba(255,255,255,.04),0 0 110px -28px rgba(220,38,38,.65);\
transform-origin:0 0;will-change:transform}\
.mcav__img{display:block;max-width:min(88vw,560px);max-height:70vh;width:auto;height:auto;min-width:180px;min-height:180px;object-fit:contain;background:#161618}\
.mcav__cap{display:flex;align-items:center;gap:10px;opacity:0;transform:translateY(8px);transition:opacity .4s .25s,transform .4s .25s}\
.mcav.is-on .mcav__cap{opacity:1;transform:none}\
.mcav__name{max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:600;color:#fff}\
.mcav__open{display:inline-flex;align-items:center;gap:4px;height:36px;padding:0 14px;border-radius:99px;font-size:12.5px;color:#ddd;text-decoration:none;\
border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);transition:.2s}\
.mcav__open:hover{color:#fff;border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.1)}\
.mcav__x{position:absolute;top:max(16px,env(safe-area-inset-top));inset-inline-start:16px;width:46px;height:46px;border-radius:15px;display:grid;place-items:center;\
color:#fff;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);transition:.2s;font-size:0}\
.mcav__x:hover{background:#dc2626;border-color:#dc2626}.mcav__x:active{transform:scale(.93)}\
.mcav__x svg{width:20px;height:20px}\
.mcav a:focus-visible,.mcav button:focus-visible{outline:2px solid #ef4444;outline-offset:2px}\
[data-avatar-view]{cursor:zoom-in}\
@media (prefers-reduced-motion:reduce){.mcav,.mcav__cap{transition:none!important}}';

    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var current = null, lastFocus = null;

    function safe(url) {
        try { var u = new URL(url, location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; }
        catch (e) { return ''; }
    }

    function close() {
        if (!current) return;
        var o = current; current = null;
        document.removeEventListener('keydown', onKey, true);
        o.classList.remove('is-on');
        var f = o.querySelector('.mcav__frame');
        var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (f && o._from && !reduce) {
            f.style.transition = 'transform .32s cubic-bezier(.4,0,.2,1)';
            f.style.transform = o._from;
        }
        document.documentElement.style.overflow = o._prevOverflow || '';
        setTimeout(function () { o.remove(); }, reduce ? 0 : 340);
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
    }

    function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        else if (e.key === 'Tab' && current) {
            var items = current.querySelectorAll('button,a[href]');
            if (!items.length) return;
            var first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }

    function open(url, name, srcEl) {
        url = safe(url);
        if (!url || current) return;
        lastFocus = document.activeElement;
        var rect = srcEl && srcEl.getBoundingClientRect ? srcEl.getBoundingClientRect() : null;

        var o = document.createElement('div');
        o.className = 'mcav';
        o.setAttribute('role', 'dialog');
        o.setAttribute('aria-modal', 'true');
        o.setAttribute('aria-label', name ? 'عکس پروفایل ' + name : 'عکس پروفایل');

        var bg = document.createElement('div'); bg.className = 'mcav__bg';
        var blur = document.createElement('div'); blur.className = 'mcav__blur';
        blur.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        var glow = document.createElement('div'); glow.className = 'mcav__glow';
        var box = document.createElement('div'); box.className = 'mcav__box';
        var frame = document.createElement('div'); frame.className = 'mcav__frame';
        var img = document.createElement('img'); img.className = 'mcav__img';
        img.alt = name || ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        frame.appendChild(img);

        var cap = document.createElement('div'); cap.className = 'mcav__cap';
        if (name) { var n = document.createElement('span'); n.className = 'mcav__name'; n.textContent = name; cap.appendChild(n); }
        var a = document.createElement('a');
        a.className = 'mcav__open'; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'باز کردن اصلی';
        cap.appendChild(a);
        box.appendChild(frame); box.appendChild(cap);

        var x = document.createElement('button');
        x.type = 'button'; x.className = 'mcav__x'; x.setAttribute('aria-label', 'بستن');
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        x.addEventListener('click', close);
        bg.addEventListener('click', close);
        o.addEventListener('click', function (e) { if (e.target === o || e.target === box) close(); });

        o.appendChild(bg); o.appendChild(blur); o.appendChild(glow); o.appendChild(box); o.appendChild(x);
        o._prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        document.body.appendChild(o);
        current = o;
        document.addEventListener('keydown', onKey, true);

        function show() {
            var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (rect && rect.width && !reduce) {
                // انیمیشن «پرواز» از جای عکس کوچک تا اندازه‌ی کامل
                var to = frame.getBoundingClientRect();
                var s = Math.max(rect.width / to.width, rect.height / to.height);
                var dx = rect.left + rect.width / 2 - (to.left + to.width / 2);
                var dy = rect.top + rect.height / 2 - (to.top + to.height / 2);
                var from = 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')';
                frame.style.transformOrigin = 'center';
                frame.style.transform = from;
                frame.style.borderRadius = '18px';
                o._from = from;
                void frame.offsetWidth;
                frame.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1), border-radius .5s ease';
                frame.style.transform = 'none';
                frame.style.borderRadius = '32px';
            }
            o.classList.add('is-on');
            x.focus({ preventScroll: true });
        }
        img.onload = show;
        img.onerror = function () { close(); };
        img.src = url;
        if (img.complete && img.naturalWidth) { img.onload = null; show(); }
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-avatar-view], #avatarImg') : null;
        if (!el) return;
        var url, name;
        if (el.id === 'avatarImg') {
            if (el.classList.contains('hidden') || !el.getAttribute('src')) return;
            url = el.currentSrc || el.src;
            var nm = document.getElementById('dispUsername');
            name = nm ? nm.textContent.trim() : '';
        } else {
            url = el.getAttribute('data-avatar-view');
            name = el.getAttribute('data-avatar-name') || '';
        }
        e.preventDefault();
        e.stopPropagation();
        open(url, name, el);
    }, true);

    window.MCAvatarViewer = { open: open, close: close };
})();

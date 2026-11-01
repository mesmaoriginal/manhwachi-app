/* =====================================================================
   ManhwaChi — auth-modal.js  (مدال ورود / ثبت‌نام / فراموشی رمز — نسخه‌ی مشترک)
   قبلاً این کد دو بار کپی شده بود (index.html و manga.ejs) و نسخه‌ی مانهوا
   قدیمی‌تر بود (بدون کپچا و ثبت‌نام با موبایل). حالا هر دو صفحه همین فایل رو لود می‌کنن.
   استفاده: <script src="/auth-modal.js?v=1"></script>   (بعدش openAuthModal('login'|'register'))
   نیازها: کلاینت Supabase روی window.supabaseClient یا window.supabase
   ===================================================================== */

// قصد ورود از آدرس (قبل از اینکه آدرس تمیز بشه): ?action=login  و اختیاری  &next=/vip.html
window.__mcLoginIntent = (function () {
  try {
    var p = new URLSearchParams(location.search);
    if (p.get('action') !== 'login') return null;
    var n = p.get('next') || '';
    // فقط مسیر داخل خود سایت (جلوی open-redirect)
    if (!(n.charAt(0) === '/' && n.charAt(1) !== '/' && n.indexOf('\\') === -1 && n.length < 200)) n = '';
    return { next: n };
  } catch (e) { return null; }
})();

// استایل و قالب HTML مدال (قبلاً داخل index.html بود)
(function () {
  var CSS = "  @keyframes authBackdropIn { from { opacity: 0; } to { opacity: 1; } }\n  @keyframes authCardIn {\n    from { opacity: 0; transform: scale(.92) translateY(14px); }\n    to   { opacity: 1; transform: scale(1) translateY(0); }\n  }\n  @keyframes authMsgIn {\n    from { opacity: 0; transform: translateY(-6px); }\n    to   { opacity: 1; transform: translateY(0); }\n  }\n  @keyframes authGlow {\n    0%, 100% { opacity: .55; }\n    50%      { opacity: 1; }\n  }\n  #authModal.flex { animation: authBackdropIn .25s ease-out; }\n  #authModal.flex .auth-card { animation: authCardIn .4s cubic-bezier(.16,1,.3,1); }\n  .authMsg-in { animation: authMsgIn .3s ease-out; }\n  .auth-card { scrollbar-width: none; -ms-overflow-style: none; }\n  .auth-card::-webkit-scrollbar { display: none; }\n  .auth-orb { animation: authGlow 3.5s ease-in-out infinite; }\n  .auth-icon-input:focus ~ .auth-input-icon { color: #ef4444; }";
  var TPL = "<!-- Modal Container -->\n<div id=\"authModal\" class=\"fixed inset-0 z-[9999] hidden items-center justify-center bg-black/85 backdrop-blur-md p-4 transition-all duration-300\">\n\n  <div class=\"auth-card relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-[28px] bg-gradient-to-b from-zinc-900 to-black border border-zinc-800/80 shadow-[0_25px_70px_-15px_rgba(220,38,38,0.35)] text-zinc-100 font-sans dir-rtl text-right\">\n\n    <!-- نوار تزئینی بالای مودال -->\n    <div class=\"h-1.5 w-full bg-gradient-to-l from-red-700 via-red-500 to-red-700 rounded-t-[28px]\"></div>\n\n    <!-- دکمه بستن -->\n    <button onclick=\"closeAuthModal()\" aria-label=\"بستن\" class=\"absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800/60 text-zinc-400 hover:text-white hover:bg-zinc-700/80 active:scale-90 transition-all z-10\">\n      <svg class=\"w-4 h-4\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\">\n        <path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M6 18L18 6M6 6l12 12\"></path>\n      </svg>\n    </button>\n\n    <div class=\"p-6 pt-7\">\n\n      <!-- برند / لوگو -->\n      <div id=\"authBrand\" class=\"flex flex-col items-center text-center mb-6\">\n        <div id=\"authLogoWrap\" class=\"relative mb-3\">\n          <div class=\"auth-orb absolute inset-0 rounded-2xl bg-red-600/40 blur-xl\"></div>\n          <div class=\"relative w-14 h-14 rounded-2xl bg-zinc-800/80 border border-red-500/30 flex items-center justify-center overflow-hidden\">\n            <img src=\"ManhwaChi/LOGO-main-white.webp\" alt=\"ManhwaChi\" class=\"w-8 h-8 object-contain\" />\n          </div>\n        </div>\n        <h2 class=\"font-bold text-lg text-white font-['Montserrat']\">Manhwa<span class=\"text-red-600\">Chi</span></h2>\n        <p id=\"authSubtitle\" class=\"text-xs text-zinc-400 mt-1\">خوش برگشتی! برای ادامه وارد حساب خود شو</p>\n      </div>\n\n      <!-- تب‌ها (سگمنت شیشه‌ای) -->\n      <div id=\"authTabs\" class=\"flex items-center gap-1 bg-zinc-800/50 rounded-full p-1 mb-5 border border-zinc-700/40\">\n        <button id=\"tabLoginBtn\" type=\"button\" onclick=\"switchAuthTab('login')\" class=\"flex-1 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-300 bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-950/40\">\n          ورود\n        </button>\n        <button id=\"tabRegisterBtn\" type=\"button\" onclick=\"switchAuthTab('register')\" class=\"flex-1 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-300 text-zinc-400 hover:text-zinc-200\">\n          عضویت جدید\n        </button>\n      </div>\n\n      <!-- باکس نمایش پیام‌ها -->\n      <div id=\"authMessage\" class=\"hidden mb-4 p-3.5 rounded-xl text-xs flex items-start gap-2.5 transition-all duration-300\"></div>\n\n      <!-- ==================== فرم ورود ==================== -->\n      <form id=\"loginForm\" onsubmit=\"handleLogin(event)\" class=\"space-y-4\">\n        <div>\n          <label for=\"loginEmail\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">ایمیل یا شماره موبایل</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-user auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"text\" id=\"loginEmail\" required placeholder=\"example@gmail.com یا 09121234567\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          </div>\n        </div>\n        <div>\n          <label for=\"loginPassword\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">رمز عبور</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"loginPassword\" required placeholder=\"••••••••\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-11 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <button type=\"button\" onclick=\"toggleAuthPassword('loginPassword', this)\" tabindex=\"-1\" aria-label=\"نمایش رمز عبور\" class=\"absolute top-1/2 -translate-y-1/2 left-3.5 text-zinc-500 hover:text-zinc-300 transition-colors\">\n              <i class=\"fa-solid fa-eye text-sm\"></i>\n            </button>\n          </div>\n          <div class=\"text-left mt-1.5\">\n            <button type=\"button\" onclick=\"showForgotPasswordForm()\" class=\"text-xs text-red-500 hover:text-red-400 transition-all\">\n              رمز عبور را فراموش کرده‌اید؟\n            </button>\n          </div>\n        </div>\n\n        <button type=\"submit\" id=\"loginSubmitBtn\" class=\"w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2\">\n          <i class=\"fa-solid fa-right-to-bracket text-xs\"></i>\n          ورود به حساب\n        </button>\n      </form>\n\n      <!-- ==================== فرم فراموشی رمز عبور ==================== -->\n      <form id=\"forgotPasswordForm\" onsubmit=\"handleForgotPassword(event)\" class=\"space-y-4 hidden\">\n        <div class=\"text-center mb-1\">\n          <p class=\"text-xs text-zinc-300\">ایمیل حساب خود را وارد کنید تا لینک بازیابی رمز عبور برایتان ارسال شود.</p>\n        </div>\n        <div>\n          <label for=\"forgotEmail\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">ایمیل</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-envelope auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"email\" id=\"forgotEmail\" required placeholder=\"example@gmail.com\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          </div>\n        </div>\n        <button type=\"submit\" id=\"forgotSubmitBtn\" class=\"w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all\">\n          ارسال لینک بازیابی رمز عبور\n        </button>\n        <div class=\"text-center\">\n          <button type=\"button\" onclick=\"showForgotPasswordForm()\" class=\"text-xs text-red-500 hover:text-red-400 transition-all block mx-auto mb-2\">بازیابی با شماره موبایل</button>\n          <button type=\"button\" onclick=\"switchAuthTab('login')\" class=\"text-xs text-zinc-400 hover:text-zinc-200 transition-all\">\n            بازگشت به ورود\n          </button>\n        </div>\n      </form>\n\n      <!-- ==================== فرم فراموشی رمز عبور با شماره موبایل ==================== -->\n      <div id=\"forgotPhoneForm\" class=\"space-y-4 hidden\">\n        <!-- مرحله ۱: شماره (+ ایمیل در اولین بازیابی) + کپچا -->\n        <div id=\"fpStep1\" class=\"space-y-3.5\">\n          <p class=\"text-xs text-zinc-300 text-center\">شماره موبایل حسابت را وارد کن تا کد تایید برایت ارسال شود.</p>\n          <div>\n            <label for=\"fpPhone\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">شماره موبایل</label>\n            <div class=\"relative\">\n              <i class=\"fa-solid fa-mobile-screen auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n              <input type=\"tel\" id=\"fpPhone\" onfocus=\"if(!fpCaptchaId) fpLoadCaptcha()\" placeholder=\"09121234567\" dir=\"ltr\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all text-left\" />\n            </div>\n          </div>\n          <div id=\"fpEmailBox\" class=\"hidden\">\n            <label for=\"fpEmail\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">ایمیل (برای اتصال به حساب)</label>\n            <div class=\"relative\">\n              <i class=\"fa-solid fa-envelope auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n              <input type=\"email\" id=\"fpEmail\" placeholder=\"example@gmail.com\" dir=\"ltr\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all text-left\" />\n            </div>\n          </div>\n        </div>\n\n        <!-- کپچا (مرحله ۱ و هنگام «ارسال مجدد») -->\n        <div id=\"fpCaptchaBox\">\n          <label for=\"fpCaptchaAnswer\" class=\"block text-xs font-medium text-zinc-400 mb-1\">کد امنیتی</label>\n          <div class=\"flex items-center gap-2\">\n            <img id=\"fpCaptchaImg\" alt=\"کد امنیتی\" width=\"160\" height=\"56\" class=\"rounded-lg bg-slate-50 shrink-0 max-w-[45%] h-auto\" />\n            <button type=\"button\" onclick=\"fpLoadCaptcha()\" aria-label=\"کد جدید\" class=\"text-[11px] text-red-500 hover:text-red-400 transition-all shrink-0\"><i class=\"fa-solid fa-rotate-right\"></i></button>\n            <input type=\"text\" id=\"fpCaptchaAnswer\" autocomplete=\"off\" autocapitalize=\"characters\" maxlength=\"8\" dir=\"ltr\" placeholder=\"ABCDE\" class=\"w-full min-w-0 text-center uppercase tracking-widest rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          </div>\n        </div>\n\n        <button type=\"button\" id=\"fpStartBtn\" onclick=\"fpStart()\" class=\"w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2 fp-step1-only\">\n          <i class=\"fa-solid fa-paper-plane text-xs\"></i> ادامه\n        </button>\n\n        <!-- مرحله ۲: کد ایمیل -->\n        <div id=\"fpStep2\" class=\"hidden space-y-3.5\">\n          <p class=\"text-xs text-zinc-300 text-center\">کد ۶ رقمی به ایمیل <span id=\"fpEmailHint\" dir=\"ltr\" class=\"text-white font-semibold\"></span> ارسال شد.</p>\n          <input type=\"text\" id=\"fpEmailCode\" inputmode=\"numeric\" maxlength=\"6\" autocomplete=\"one-time-code\" dir=\"ltr\" placeholder=\"------\" class=\"w-full text-center tracking-widest rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          <button type=\"button\" id=\"fpVerifyEmailBtn\" onclick=\"fpVerifyEmail()\" class=\"w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all disabled:opacity-60\">تایید کد ایمیل</button>\n          <div class=\"text-center\"><button type=\"button\" id=\"fpResendEmailBtn\" onclick=\"fpResend('email')\" class=\"text-xs text-red-500 hover:text-red-400 disabled:text-zinc-500 transition-all\">ارسال مجدد کد</button></div>\n        </div>\n\n        <!-- مرحله ۳: کد پیامک (فقط اولین بازیابی) -->\n        <div id=\"fpStep3\" class=\"hidden space-y-3.5\">\n          <p class=\"text-xs text-zinc-300 text-center\">برای اثبات مالکیت شماره، کد ۶ رقمی پیامک‌شده را وارد کن.</p>\n          <input type=\"text\" id=\"fpSmsCode\" inputmode=\"numeric\" maxlength=\"6\" autocomplete=\"one-time-code\" dir=\"ltr\" placeholder=\"------\" class=\"w-full text-center tracking-widest rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          <button type=\"button\" id=\"fpVerifySmsBtn\" onclick=\"fpVerifySms()\" class=\"w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all disabled:opacity-60\">تایید کد پیامک</button>\n          <div class=\"text-center\"><button type=\"button\" id=\"fpResendSmsBtn\" onclick=\"fpResend('sms')\" class=\"text-xs text-red-500 hover:text-red-400 disabled:text-zinc-500 transition-all\">ارسال مجدد پیامک</button></div>\n        </div>\n\n        <!-- مرحله ۴: رمز جدید -->\n        <div id=\"fpStep4\" class=\"hidden space-y-3.5\">\n          <p class=\"text-xs text-zinc-300 text-center\">رمز عبور جدید خود را وارد کنید.</p>\n          <input type=\"password\" id=\"fpNewPassword\" minlength=\"6\" maxlength=\"72\" placeholder=\"رمز عبور جدید (حداقل ۶ کاراکتر)\" dir=\"ltr\" class=\"w-full text-center tracking-widest rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all text-left\" />\n          <input type=\"password\" id=\"fpConfirmPassword\" minlength=\"6\" maxlength=\"72\" placeholder=\"تکرار رمز عبور جدید\" dir=\"ltr\" class=\"w-full text-center tracking-widest rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all text-left\" />\n          <button type=\"button\" id=\"fpResetBtn\" onclick=\"fpSubmitPassword()\" class=\"w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all disabled:opacity-60\">ثبت رمز عبور جدید</button>\n        </div>\n\n        <div class=\"text-center space-y-2\">\n          <div><button type=\"button\" onclick=\"showForgotEmailForm()\" class=\"text-xs text-zinc-400 hover:text-zinc-200 transition-all\">بازیابی با لینک ایمیل (حساب‌های ساخته‌شده با ایمیل)</button></div>\n          <div><button type=\"button\" onclick=\"switchAuthTab('login')\" class=\"text-xs text-zinc-400 hover:text-zinc-200 transition-all\">بازگشت به ورود</button></div>\n        </div>\n      </div>\n\n      <!-- ==================== فرم تنظیم رمز عبور جدید ==================== -->\n      <form id=\"resetPasswordForm\" onsubmit=\"handleResetPassword(event)\" class=\"space-y-4 hidden\">\n        <div class=\"text-center mb-1\">\n          <p class=\"text-xs text-zinc-300\">رمز عبور جدید خود را وارد کنید.</p>\n        </div>\n        <div>\n          <label for=\"resetNewPassword\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">رمز عبور جدید (حداقل ۶ کاراکتر)</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"resetNewPassword\" minlength=\"6\" required placeholder=\"••••••••\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-11 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <button type=\"button\" onclick=\"toggleAuthPassword('resetNewPassword', this)\" tabindex=\"-1\" aria-label=\"نمایش رمز عبور\" class=\"absolute top-1/2 -translate-y-1/2 left-3.5 text-zinc-500 hover:text-zinc-300 transition-colors\">\n              <i class=\"fa-solid fa-eye text-sm\"></i>\n            </button>\n          </div>\n        </div>\n        <div>\n          <label for=\"resetConfirmPassword\" class=\"block text-xs font-medium text-zinc-400 mb-1.5\">تکرار رمز عبور جدید</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"resetConfirmPassword\" minlength=\"6\" required placeholder=\"••••••••\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          </div>\n        </div>\n        <button type=\"submit\" id=\"resetSubmitBtn\" class=\"w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all\">\n          ثبت رمز عبور جدید\n        </button>\n      </form>\n\n      <!-- سوییچ روش ثبت‌نام: ایمیل یا شماره موبایل -->\n      <div id=\"registerMethodSwitch\" class=\"flex items-center gap-1 bg-zinc-800/40 rounded-full p-1 mb-4 border border-zinc-700/30 hidden\">\n        <button id=\"regMethodEmailBtn\" type=\"button\" onclick=\"switchRegisterMethod('email')\" class=\"flex-1 py-2 rounded-full text-[11px] sm:text-xs font-bold transition-all duration-300 bg-zinc-700 text-white\">\n          <i class=\"fa-solid fa-envelope ml-1\"></i> ایمیل\n        </button>\n        <button id=\"regMethodPhoneBtn\" type=\"button\" onclick=\"switchRegisterMethod('phone')\" class=\"flex-1 py-2 rounded-full text-[11px] sm:text-xs font-bold transition-all duration-300 text-zinc-400 hover:text-zinc-200\">\n          <i class=\"fa-solid fa-mobile-screen ml-1\"></i> شماره موبایل\n        </button>\n      </div>\n\n      <!-- ==================== فرم ثبت‌نام ==================== -->\n      <form id=\"registerForm\" onsubmit=\"handleRegister(event)\" class=\"space-y-3.5 hidden\">\n        <div>\n          <label for=\"regFullName\" class=\"block text-xs font-medium text-zinc-400 mb-1\">نام و نام خانوادگی</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-user auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"text\" id=\"regFullName\" required placeholder=\"مثال: علی محمدی\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          </div>\n        </div>\n\n        <div>\n          <label for=\"regEmail\" class=\"block text-xs font-medium text-zinc-400 mb-1\">جیمیل (فقط Google Gmail)</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-envelope auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"email\" id=\"regEmail\" required placeholder=\"example@gmail.com\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n          </div>\n        </div>\n\n        <div>\n          <label for=\"regPassword\" class=\"block text-xs font-medium text-zinc-400 mb-1\">رمز عبور (حداقل ۶ کاراکتر)</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"regPassword\" oninput=\"checkPasswordStrength(this.value)\" minlength=\"6\" required placeholder=\"••••••••\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-11 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <button type=\"button\" onclick=\"toggleAuthPassword('regPassword', this)\" tabindex=\"-1\" aria-label=\"نمایش رمز عبور\" class=\"absolute top-1/2 -translate-y-1/2 left-3.5 text-zinc-500 hover:text-zinc-300 transition-colors\">\n              <i class=\"fa-solid fa-eye text-sm\"></i>\n            </button>\n          </div>\n\n          <!-- نوار سنجش قدرت رمز عبور -->\n          <div class=\"mt-2\">\n            <div class=\"w-full bg-zinc-800 h-1 rounded-full overflow-hidden\">\n              <div id=\"passwordStrengthBar\" class=\"h-1 rounded-full bg-zinc-700 transition-all duration-300 w-0\"></div>\n            </div>\n            <div id=\"passwordStrengthText\"></div>\n          </div>\n        </div>\n\n        <div>\n          <label for=\"regConfirmPassword\" class=\"block text-xs font-medium text-zinc-400 mb-1\">تکرار رمز عبور</label>\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"regConfirmPassword\" minlength=\"6\" required placeholder=\"••••••••\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-11 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <button type=\"button\" onclick=\"toggleAuthPassword('regConfirmPassword', this)\" tabindex=\"-1\" aria-label=\"نمایش رمز عبور\" class=\"absolute top-1/2 -translate-y-1/2 left-3.5 text-zinc-500 hover:text-zinc-300 transition-colors\">\n              <i class=\"fa-solid fa-eye text-sm\"></i>\n            </button>\n          </div>\n        </div>\n\n        <button type=\"submit\" id=\"regSubmitBtn\" class=\"w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2\">\n          <i class=\"fa-solid fa-paper-plane text-xs\"></i>\n          ارسال کد تایید به جیمیل\n        </button>\n        <p class=\"text-[11px] text-zinc-500 text-center leading-5\">با ثبت‌نام، قوانین و حریم خصوصی مانهواچی را می‌پذیرید.</p>\n      </form>\n\n      <!-- ==================== فرم ثبت‌نام با شماره موبایل (OTP پیامکی) ==================== -->\n      <form id=\"registerPhoneForm\" onsubmit=\"handleRegisterPhone(event)\" novalidate class=\"space-y-3.5 hidden\">\n\n        <!-- مرحله ۱: نام، شماره، کد امنیتی -->\n        <div id=\"phoneStep1\" class=\"space-y-3.5\">\n          <div>\n            <label for=\"regPhoneFullName\" class=\"block text-xs font-medium text-zinc-400 mb-1\">نام و نام خانوادگی</label>\n            <div class=\"relative\">\n              <i class=\"fa-solid fa-user auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n              <input type=\"text\" id=\"regPhoneFullName\" placeholder=\"مثال: علی محمدی\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            </div>\n          </div>\n\n          <div>\n            <label for=\"regPhoneNumber\" class=\"block text-xs font-medium text-zinc-400 mb-1\">شماره موبایل</label>\n            <div class=\"relative\">\n              <i class=\"fa-solid fa-mobile-screen auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n              <input type=\"tel\" id=\"regPhoneNumber\" onfocus=\"if(!regCaptchaId) loadRegCaptcha()\" placeholder=\"09121234567\" dir=\"ltr\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-4 py-2.5 text-sm text-white placeholder-zinc-500 text-left focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            </div>\n          </div>\n\n          <div>\n            <label for=\"regCaptchaAnswer\" class=\"block text-xs font-medium text-zinc-400 mb-1\">کد امنیتی</label>\n            <div class=\"flex items-center gap-2\">\n              <img id=\"regCaptchaImg\" alt=\"کد امنیتی\" width=\"160\" height=\"56\" class=\"rounded-lg bg-slate-50 shrink-0 max-w-[45%] h-auto\" />\n              <button type=\"button\" onclick=\"loadRegCaptcha()\" aria-label=\"کد جدید\" class=\"text-[11px] text-red-500 hover:text-red-400 transition-all shrink-0\">\n                <i class=\"fa-solid fa-rotate-right\"></i>\n              </button>\n              <input type=\"text\" id=\"regCaptchaAnswer\" autocomplete=\"off\" autocapitalize=\"characters\" maxlength=\"8\" dir=\"ltr\" placeholder=\"ABCDE\" class=\"w-full min-w-0 text-center uppercase tracking-widest rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            </div>\n          </div>\n\n          <button type=\"button\" id=\"regPhoneSendBtn\" onclick=\"handleSendPhoneOtp()\" class=\"w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2\">\n            <i class=\"fa-solid fa-paper-plane text-xs\"></i>\n            ارسال کد تایید\n          </button>\n        </div>\n\n        <!-- مرحله ۲: کد پیامک‌شده و رمز عبور (بعد از ارسال کد، مرحله ۱ محو می‌شه) -->\n        <div id=\"phoneOtpSection\" class=\"hidden space-y-3.5\">\n          <div class=\"flex items-center justify-between gap-2 rounded-xl bg-zinc-800/50 border border-zinc-700/40 px-3 py-2.5\">\n            <div class=\"flex items-center gap-2 min-w-0\">\n              <i class=\"fa-solid fa-mobile-screen text-red-500 text-sm\"></i>\n              <span class=\"text-xs text-zinc-400 shrink-0\">کد به</span>\n              <span id=\"regPhoneShown\" dir=\"ltr\" class=\"text-xs text-white font-semibold truncate\"></span>\n              <span class=\"text-xs text-zinc-400 shrink-0\">ارسال شد</span>\n            </div>\n            <button type=\"button\" onclick=\"editPhoneNumber()\" class=\"text-[11px] text-red-500 hover:text-red-400 transition-all shrink-0\">ویرایش شماره</button>\n          </div>\n\n          <div>\n            <label for=\"regPhoneOtpCode\" class=\"block text-xs font-medium text-zinc-400 mb-1\">کد ۶ رقمی پیامک‌شده</label>\n            <input type=\"text\" id=\"regPhoneOtpCode\" inputmode=\"numeric\" autocomplete=\"one-time-code\" maxlength=\"6\" placeholder=\"123456\" class=\"w-full text-center tracking-[0.5em] text-lg font-mono rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-4 py-2.5 text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <div class=\"flex items-center justify-between mt-1.5\">\n              <span id=\"regPhoneResendTimer\" class=\"text-[11px] text-zinc-500\"></span>\n              <button type=\"button\" id=\"regPhoneResendBtn\" onclick=\"resendPhoneOtp()\" class=\"text-[11px] text-red-500 hover:text-red-400 transition-all disabled:opacity-40 disabled:pointer-events-none\">\n                ارسال مجدد کد\n              </button>\n            </div>\n          </div>\n\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"regPhonePassword\" minlength=\"6\" aria-label=\"رمز عبور\" placeholder=\"رمز عبور (حداقل ۶ کاراکتر)\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-11 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <button type=\"button\" onclick=\"toggleAuthPassword('regPhonePassword', this)\" tabindex=\"-1\" aria-label=\"نمایش رمز عبور\" class=\"absolute top-1/2 -translate-y-1/2 left-3.5 text-zinc-500 hover:text-zinc-300 transition-colors\">\n              <i class=\"fa-solid fa-eye text-sm\"></i>\n            </button>\n          </div>\n\n          <div class=\"relative\">\n            <i class=\"fa-solid fa-lock auth-input-icon absolute top-1/2 -translate-y-1/2 right-4 text-zinc-500 text-sm transition-colors pointer-events-none\"></i>\n            <input type=\"password\" id=\"regPhoneConfirmPassword\" minlength=\"6\" aria-label=\"تکرار رمز عبور\" placeholder=\"تکرار رمز عبور\" class=\"auth-icon-input w-full rounded-xl bg-zinc-800/60 border border-zinc-700/50 pr-11 pl-11 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n            <button type=\"button\" onclick=\"toggleAuthPassword('regPhoneConfirmPassword', this)\" tabindex=\"-1\" aria-label=\"نمایش رمز عبور\" class=\"absolute top-1/2 -translate-y-1/2 left-3.5 text-zinc-500 hover:text-zinc-300 transition-colors\">\n              <i class=\"fa-solid fa-eye text-sm\"></i>\n            </button>\n          </div>\n\n          <button type=\"submit\" id=\"regPhoneSubmitBtn\" class=\"w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold text-sm text-white shadow-lg shadow-red-950/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2\">\n            <i class=\"fa-solid fa-circle-check text-xs\"></i>\n            تایید و ساخت حساب\n          </button>\n        </div>\n        <p id=\"phoneTermsNote\" class=\"text-[11px] text-zinc-500 text-center leading-5\">با ثبت‌نام، قوانین و حریم خصوصی مانهواچی را می‌پذیرید.</p>\n      </form>\n\n      <!-- ==================== فرم ورود کد OTP ==================== -->\n      <form id=\"otpForm\" onsubmit=\"handleVerifyOTP(event)\" class=\"space-y-4 hidden\">\n        <div class=\"text-center mb-2 flex flex-col items-center gap-2\">\n          <div class=\"w-12 h-12 rounded-full bg-red-600/10 border border-red-500/30 flex items-center justify-center text-red-500\">\n            <i class=\"fa-solid fa-envelope-open-text\"></i>\n          </div>\n          <p class=\"text-xs text-zinc-300\">کد ۶ رقمی ارسال‌شده به <span id=\"otpEmailDisplay\" class=\"text-white font-semibold\"></span> را وارد کنید:</p>\n        </div>\n        <div>\n          <input type=\"text\" id=\"otpCode\" inputmode=\"numeric\" autocomplete=\"one-time-code\" dir=\"ltr\" maxlength=\"12\" required placeholder=\"123456\" class=\"w-full text-center tracking-[0.5em] text-xl font-mono rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-4 py-3 text-white placeholder-zinc-600 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 focus:outline-none transition-all\" />\n        </div>\n\n        <button type=\"submit\" id=\"verifyOtpBtn\" class=\"w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 font-bold text-sm text-white shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2\">\n          <i class=\"fa-solid fa-circle-check text-xs\"></i>\n          تایید و فعال‌سازی حساب\n        </button>\n        <div class=\"flex items-center justify-between pt-1\">\n          <button type=\"button\" onclick=\"backFromOtp()\" class=\"text-xs text-zinc-400 hover:text-zinc-200 transition-all\">تغییر ایمیل</button>\n          <button type=\"button\" id=\"emailResendBtn\" onclick=\"resendSignupCode()\" class=\"text-xs text-red-500 hover:text-red-400 disabled:text-zinc-500 transition-all\">ارسال مجدد کد</button>\n        </div>\n        <p class=\"text-[11px] text-zinc-500 text-center leading-5\">ایمیل نرسید؟ پوشه‌ی اسپم (Junk) را هم نگاه کن.</p>\n      </form>\n\n    </div>\n  </div>\n</div>";
  function inject() {
    if (!document.getElementById('authModalStyle')) {
      var st = document.createElement('style');
      st.id = 'authModalStyle';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!document.getElementById('authModalTpl')) {
      var t = document.createElement('template');
      t.id = 'authModalTpl';
      t.innerHTML = TPL;
      document.body.appendChild(t);
    }
  }
  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();

// ==================== منطق مدال ====================
  // مقداردهی اولیه متغیر ایمیل موقت
  let tempRegistrationEmail = "";

  // ==================== کمکی‌های ثبت‌نام ایمیلی (ارسال مجدد، بازگشت، پیام فارسی) ====================
  let emailResendTimer = null;
  const PENDING_SIGNUP_KEY = 'pendingSignupEmail';
  const PENDING_SIGNUP_TTL_MS = 30 * 60 * 1000;

  // تبدیل خطاهای انگلیسی Supabase/شبکه به پیام فارسی قابل‌فهم
  function faAuthError(err) {
    const raw = String((err && (err.message || err.error_description)) || err || '');
    if (/[\u0600-\u06FF]/.test(raw)) return raw; // از قبل فارسیه
    const code = (err && err.code) || '';
    const m = raw.toLowerCase();
    if (code === 'otp_expired' || m.includes('expired') || (m.includes('invalid') && m.includes('token')))
      return "کد وارد شده اشتباه یا منقضی شده است. اگر کد قبلی کار نکرد، «ارسال مجدد کد» را بزن.";
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || (err && err.status === 429) || m.includes('rate limit') || m.includes('too many'))
      return "تعداد درخواست‌ها زیاد بود. یک دقیقه صبر کن و دوباره تلاش کن.";
    if (code === 'weak_password' || (m.includes('password') && m.includes('least')))
      return "رمز عبور باید حداقل ۶ کاراکتر باشد.";
    if (code === 'email_address_invalid' || (m.includes('email') && m.includes('invalid')))
      return "ایمیل واردشده معتبر نیست.";
    if (code === 'user_already_exists' || m.includes('already registered'))
      return "این ایمیل قبلاً ثبت‌نام شده است. وارد شو یا «فراموشی رمز عبور» را بزن.";
    if (code === 'invalid_credentials' || m.includes('invalid login credentials'))
      return "اطلاعات ورود اشتباه است.";
    if (code === 'email_not_confirmed' || m.includes('email not confirmed'))
      return "ایمیل شما هنوز تایید نشده است.";
    if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed'))
      return "ارتباط با سرور برقرار نشد. اینترنت (یا فیلترشکن) را بررسی کن و دوباره تلاش کن.";
    return "خطایی رخ داد. دوباره تلاش کن.";
  }

  function rememberPendingSignup(email) {
    try { localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ email, t: Date.now() })); } catch {}
  }
  function clearPendingSignup() {
    try { localStorage.removeItem(PENDING_SIGNUP_KEY); } catch {}
  }
  function getPendingSignupEmail() {
    try {
      const p = JSON.parse(localStorage.getItem(PENDING_SIGNUP_KEY) || 'null');
      if (p && p.email && Date.now() - p.t < PENDING_SIGNUP_TTL_MS) return p.email;
    } catch {}
    return "";
  }

  function startEmailResendCountdown(seconds = 60) {
    const btn = document.getElementById('emailResendBtn');
    if (!btn) return;
    clearInterval(emailResendTimer);
    let left = seconds;
    const tick = () => {
      if (left <= 0) {
        clearInterval(emailResendTimer);
        btn.disabled = false;
        btn.textContent = 'ارسال مجدد کد';
        return;
      }
      btn.disabled = true;
      btn.textContent = `ارسال مجدد تا ${left} ثانیه دیگر`;
      left--;
    };
    tick();
    emailResendTimer = setInterval(tick, 1000);
  }

  // نمایش فرم کد ایمیل (بعد از ثبت‌نام، بعد از ورود با حساب تاییدنشده، یا بعد از رفرش صفحه)
  function showEmailOtpForm(email, cooldownSeconds = 0) {
    tempRegistrationEmail = email;
    rememberPendingSignup(email);
    const display = document.getElementById('otpEmailDisplay');
    if (display) display.textContent = email;
    ['loginForm', 'registerForm', 'registerPhoneForm', 'registerMethodSwitch', 'forgotPasswordForm', 'forgotPhoneForm', 'resetPasswordForm']
      .forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('otpForm')?.classList.remove('hidden');
    const input = document.getElementById('otpCode');
    if (input) input.value = '';
    clearInterval(emailResendTimer);
    const btn = document.getElementById('emailResendBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'ارسال مجدد کد'; }
    if (cooldownSeconds > 0) startEmailResendCountdown(cooldownSeconds);
    input?.focus();
  }

  async function resendSignupCode() {
    const email = tempRegistrationEmail || getPendingSignupEmail();
    if (!email) {
      showAuthMessage("ایمیل پیدا نشد. دوباره ثبت‌نام کن.", true);
      backFromOtp();
      return;
    }
    const btn = document.getElementById('emailResendBtn');
    if (btn) btn.disabled = true;
    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");
      const { error } = await client.auth.resend({ type: 'signup', email });
      if (error) throw error;
      showAuthMessage("کد جدید به ایمیلت ارسال شد. پوشه‌ی اسپم را هم نگاه کن.", false);
      startEmailResendCountdown(60);
    } catch (err) {
      showAuthMessage(faAuthError(err), true);
      startEmailResendCountdown(20);
    }
  }

  // «تغییر ایمیل»: برگشت به فرم ثبت‌نام
  function backFromOtp() {
    clearPendingSignup();
    tempRegistrationEmail = "";
    clearInterval(emailResendTimer);
    switchAuthTab('register');
  }

  // کاربر با حساب تاییدنشده وارد شده: به‌جای خطا، کد جدید بفرست و فرم کد رو نشون بده
  async function continueUnconfirmedSignup(email) {
    showEmailOtpForm(email);
    showAuthMessage("حساب شما ساخته شده ولی ایمیلش هنوز تایید نشده. در حال ارسال کد جدید...", false, 'warning');
    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");
      const { error } = await client.auth.resend({ type: 'signup', email });
      if (error) throw error;
      showAuthMessage("کد جدید به ایمیلت ارسال شد. آن را وارد کن تا حسابت فعال شود.", false);
      startEmailResendCountdown(60);
    } catch (err) {
      showAuthMessage(faAuthError(err), true);
      startEmailResendCountdown(20);
    }
  }

  // کاربر وسط تایید ایمیل از صفحه خارج شده (مثلاً برای دیدن ایمیل) و برگشته
  function restorePendingSignup() {
    const email = getPendingSignupEmail();
    if (!email) return;
    showEmailOtpForm(email);
    showAuthMessage("کد تایید قبلاً برای " + email + " ارسال شده. اگر نرسید «ارسال مجدد کد» را بزن.", false, 'warning');
  }
  let tempRegistrationPhone = "";
  let currentRegisterMethod = "email";
  let phoneResendInterval = null;
  let regCaptchaId = "";

  // نرمال‌سازی شماره موبایل ایران سمت کلاینت - معادل lib/phone.js سمت
  // سرور. عمداً تکرار شده چون این کد سمت مرورگر اجرا می‌شه و به فایل‌های
  // سرور دسترسی نداره؛ اگه فرمت رو اونجا عوض کردی، اینجا رو هم عوض کن.
  // ارقام فارسی/عربی → انگلیسی (سرور هم همین کار رو می‌کنه؛ بدون این، شماره‌ی
  // تایپ‌شده با کیبورد فارسی همین‌جا «نامعتبر» رد می‌شد و اصلاً به سرور نمی‌رسید)
  function toEnDigitsClient(input) {
    return String(input ?? "")
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  }

  function normalizeIranPhoneClient(raw) {
    if (!raw) return null;
    let digits = toEnDigitsClient(raw).replace(/[\s\-().\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
    digits = digits.replace(/^\+/, "");
    digits = digits.replace(/^0098/, "98");
    digits = digits.replace(/^0/, "98");
    if (/^9\d{9}$/.test(digits)) digits = "98" + digits;
    return /^989\d{9}$/.test(digits) ? digits : null;
  }

  // تابع دسترسی امن به Supabase
  function getSupabase() {
    return window.supabaseClient || window.supabase || (typeof supabase !== 'undefined' ? supabase : null);
  }

  // ==================== توابع کنترل نمایش مودال ====================
  function ensureAuthModal() {
    if (document.getElementById('authModal')) return;
    const t = document.getElementById('authModalTpl');
    if (t) document.body.appendChild(t.content.cloneNode(true));
  }

  function openAuthModal(tab = 'login') {
    ensureAuthModal();
    switchAuthTab(tab);
    if (tab === 'register') restorePendingSignup();
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    hideAuthMessage();
    document.getElementById('otpForm')?.classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.add('hidden');
    document.getElementById('forgotPhoneForm')?.classList.add('hidden');
    fpReset();
    document.getElementById('resetPasswordForm')?.classList.add('hidden');

    // ریست کردن فرم ثبت‌نام با موبایل تا دفعه‌ی بعد که مودال باز می‌شه
    // حالت قبلی (کد ارسال‌شده، شماره غیرفعال و ...) نمونه.
    clearInterval(phoneResendInterval);
    tempRegistrationPhone = "";
    document.getElementById('phoneOtpSection')?.classList.add('hidden');
    const phoneInput = document.getElementById('regPhoneNumber');
    if (phoneInput) { phoneInput.disabled = false; phoneInput.value = ''; }
    ['regPhoneFullName','regPhoneOtpCode','regPhonePassword','regPhoneConfirmPassword'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    setPhoneStep(1);
    document.getElementById('registerMethodSwitch')?.classList.add('hidden');
    regCaptchaId = "";
    const capAns = document.getElementById('regCaptchaAnswer');
    if (capAns) capAns.value = '';
    const capImg = document.getElementById('regCaptchaImg');
    if (capImg) capImg.removeAttribute('src');
  }

  function switchAuthTab(type) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const otpForm = document.getElementById('otpForm');
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const registerMethodSwitch = document.getElementById('registerMethodSwitch');

    hideAuthMessage();
    otpForm?.classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.add('hidden');
    document.getElementById('forgotPhoneForm')?.classList.add('hidden');
    document.getElementById('resetPasswordForm')?.classList.add('hidden');

    const activeCls = "flex-1 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-300 bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-950/40";
    const inactiveCls = "flex-1 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-300 text-zinc-400 hover:text-zinc-200";
    const subtitle = document.getElementById('authSubtitle');

    if (type === 'login') {
      loginForm?.classList.remove('hidden');
      registerForm?.classList.add('hidden');
      document.getElementById('registerPhoneForm')?.classList.add('hidden');
      registerMethodSwitch?.classList.add('hidden');
      setPhoneStep(1);
      if (tabLoginBtn) tabLoginBtn.className = activeCls;
      if (tabRegisterBtn) tabRegisterBtn.className = inactiveCls;
      if (subtitle) subtitle.textContent = "خوش برگشتی! برای ادامه وارد حساب خود شو";
    } else {
      loginForm?.classList.add('hidden');
      registerMethodSwitch?.classList.remove('hidden');
      switchRegisterMethod(currentRegisterMethod);
      if (tabRegisterBtn) tabRegisterBtn.className = activeCls;
      if (tabLoginBtn) tabLoginBtn.className = inactiveCls;
      if (subtitle) subtitle.textContent = "چند قدم تا ساخت حساب جدیدت باقی مونده";
    }
  }

  // ==================== سوییچ روش ثبت‌نام (ایمیل / شماره موبایل) ====================
  function switchRegisterMethod(method) {
    currentRegisterMethod = method;
    hideAuthMessage();
    const emailForm = document.getElementById('registerForm');
    const phoneForm = document.getElementById('registerPhoneForm');
    const emailBtn = document.getElementById('regMethodEmailBtn');
    const phoneBtn = document.getElementById('regMethodPhoneBtn');
    const activeCls = "flex-1 py-2 rounded-full text-[11px] sm:text-xs font-bold transition-all duration-300 bg-zinc-700 text-white";
    const inactiveCls = "flex-1 py-2 rounded-full text-[11px] sm:text-xs font-bold transition-all duration-300 text-zinc-400 hover:text-zinc-200";

    if (method === 'phone') {
      emailForm?.classList.add('hidden');
      phoneForm?.classList.remove('hidden');
      if (phoneBtn) phoneBtn.className = activeCls;
      if (emailBtn) emailBtn.className = inactiveCls;
    } else {
      phoneForm?.classList.add('hidden');
      emailForm?.classList.remove('hidden');
      if (emailBtn) emailBtn.className = activeCls;
      if (phoneBtn) phoneBtn.className = inactiveCls;
    }
  }

  // ==================== نمایش/مخفی‌سازی رمز عبور ====================
  function toggleAuthPassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const willShow = input.type === 'password';
    input.type = willShow ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-eye', !willShow);
      icon.classList.toggle('fa-eye-slash', willShow);
    }
  }

  // ==================== مدیریت پیام‌های خطا، هشدار و موفقیت ====================
  function showAuthMessage(msg, isError = false, type = null) {
    const msgBox = document.getElementById('authMessage');
    if (!msgBox) return;

    const kind = type || (isError ? 'error' : 'success');
    const styleMap = {
      error:   { icon: 'fa-circle-exclamation',   classes: ['bg-red-500/10', 'text-red-400', 'border-red-500/30'] },
      success: { icon: 'fa-circle-check',         classes: ['bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30'] },
      warning: { icon: 'fa-triangle-exclamation', classes: ['bg-amber-500/10', 'text-amber-300', 'border-amber-500/30'] }
    };
    const cfg = styleMap[kind] || styleMap.error;

    msgBox.classList.remove(
      'hidden',
      'bg-red-500/10', 'text-red-400', 'border-red-500/30',
      'bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30',
      'bg-amber-500/10', 'text-amber-300', 'border-amber-500/30',
      'authMsg-in'
    );
    msgBox.classList.add('border', ...cfg.classes);
    // force re-trigger of the entrance animation
    void msgBox.offsetWidth;
    msgBox.classList.add('authMsg-in');

    msgBox.innerHTML = '';
    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${cfg.icon} mt-0.5 text-sm shrink-0`;
    const textEl = document.createElement('span');
    textEl.className = 'leading-5';
    textEl.textContent = msg;
    msgBox.appendChild(iconEl);
    msgBox.appendChild(textEl);
  }

  function hideAuthMessage() {
    const msgBox = document.getElementById('authMessage');
    if (msgBox) msgBox.classList.add('hidden');
  }

  // ==================== سنجش قدرت رمز عبور ====================
  function checkPasswordStrength(password) {
    const bar = document.getElementById('passwordStrengthBar');
    const text = document.getElementById('passwordStrengthText');
    if (!bar || !text) return;

    if (!password) {
      bar.className = "h-1 rounded-full bg-zinc-700 transition-all duration-300 w-0";
      text.innerText = "";
      return;
    }

    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password) || /[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 1) {
      bar.className = "h-1 rounded-full bg-red-500 transition-all duration-300 w-1/3";
      text.innerText = "رمز عبور ضعیف است";
      text.className = "text-[11px] mt-1 text-red-400";
    } else if (score === 2 || score === 3) {
      bar.className = "h-1 rounded-full bg-yellow-500 transition-all duration-300 w-2/3";
      text.innerText = "رمز عبور متوسط است";
      text.className = "text-[11px] mt-1 text-yellow-400";
    } else {
      bar.className = "h-1 rounded-full bg-emerald-500 transition-all duration-300 w-full";
      text.innerText = "رمز عبور بسیار قوی است ✓";
      text.className = "text-[11px] mt-1 text-emerald-400";
    }
  }

  // ==================== تابع ورود ====================
  async function handleLogin(e) {
    e.preventDefault();
    const idRaw = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginSubmitBtn');

    btn.disabled = true;
    btn.innerText = "در حال بررسی...";

    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");

      // اگه ورودی شامل @ باشه یعنی ایمیله، وگرنه شماره موبایل در نظر
      // گرفته می‌شه - چون کاربر ممکنه با هرکدوم از این دو ثبت‌نام کرده باشه.
      let credentials;
      if (idRaw.includes('@')) {
        credentials = { email: idRaw.toLowerCase(), password };
      } else {
        const phone = normalizeIranPhoneClient(idRaw);
        if (!phone) throw new Error("ایمیل یا شماره موبایل وارد شده معتبر نیست.");
        credentials = { phone, password };
      }

      const { data, error } = await client.auth.signInWithPassword(credentials);

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          throw new Error("اطلاعات ورود اشتباه است.");
        } else if (error.message.includes('Email not confirmed')) {
          if (credentials.email) {
            await continueUnconfirmedSignup(credentials.email);
            return;
          }
          throw new Error("ایمیل شما هنوز تایید نشده است. ابتدا کد ارسال شده را تایید کنید.");
        } else {
          throw error;
        }
      }

      showAuthMessage("با موفقیت وارد شدید!", false);
      // اگر کاربر از مسیری اومده که action=login داشته (مثلا از صفحه VIP)،
      // بعد از لاگین موفق به جای رفرش خام، به پروفایل هدایتش می‌کنیم
      // مقصد بعد از ورود: اگه کاربر با ?action=login&next=/مسیر اومده بود برمی‌گرده همون‌جا؛
      // اگه فقط ?action=login بود و صفحه SPA (صفحه‌ی اصلی) باشه می‌ره پروفایل؛ وگرنه همین صفحه رفرش می‌شه.
      // (قبلاً پارامتر action پیش از لاگین از آدرس پاک می‌شد و این شرط هیچ‌وقت برقرار نبود.)
      const loginIntent = window.__mcLoginIntent;
      if (loginIntent && loginIntent.next) {
        setTimeout(() => { location.href = loginIntent.next; }, 1000);
      } else {
        if (loginIntent && typeof loadPageByName === 'function') {
          sessionStorage.setItem('redirectAfterLogin', 'profile');
        }
        setTimeout(() => { location.reload(); }, 1000);
      }

    } catch (err) {
      if (isDeviceLimitError(err)) {
        showAuthMessage(faAuthError(err), true, 'warning');
        showDeviceLimitPanel();
      } else {
        hideDeviceLimitPanel();
        showAuthMessage(faAuthError(err), true);
      }
    } finally {
      btn.disabled = false;
      btn.innerText = "ورود به حساب";
    }
  }

  // ==================== سقف دستگاه (هر حساب حداکثر ۲ دستگاه) ====================
  // سرور بعد از رمز درست ولی پر بودن سقف، خطای device_limit می‌دهد و یک کوکی ۱۰ دقیقه‌ای می‌گذارد؛
  // با آن لیست دستگاه‌های فعال را می‌گیریم تا کاربر یکی را خارج کند و ورود دوباره خودکار تکرار شود.
  function isDeviceLimitError(err) {
    const m = String((err && err.message) || '');
    return !!err && (err.code === 'device_limit' || m.includes('device_limit') || m.includes('دستگاه فعال است'));
  }
  function hideDeviceLimitPanel() {
    document.getElementById('deviceLimitPanel')?.remove();
  }
  async function showDeviceLimitPanel() {
    hideDeviceLimitPanel();
    const anchor = document.getElementById('authMessage');
    if (!anchor || !anchor.parentNode) return;
    const panel = document.createElement('div');
    panel.id = 'deviceLimitPanel';
    panel.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:8px';
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);

    let info;
    try {
      const r = await fetch('/api/devices/blocked', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error('expired');
      info = await r.json();
    } catch {
      panel.remove();
      return;
    }
    const fmt = (iso) => { try { return new Date(iso).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
    const note = document.createElement('p');
    note.style.cssText = 'font-size:12px;opacity:.8;margin:0';
    note.textContent = 'کدام دستگاه خارج شود؟ (بعد از خروج، ورود به‌صورت خودکار تکرار می‌شود)';
    panel.appendChild(note);

    info.devices.forEach((d) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;font-size:13px';
      const left = document.createElement('div');
      const t = document.createElement('b');
      t.textContent = d.label;
      const sub = document.createElement('small');
      sub.style.cssText = 'display:block;opacity:.7';
      sub.textContent = 'آخرین فعالیت: ' + fmt(d.last_seen_at) + (d.ip_hint ? ' · ' + d.ip_hint : '');
      left.appendChild(t); left.appendChild(sub);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'خروج این دستگاه';
      b.style.cssText = 'padding:6px 10px;border-radius:8px;background:#ef4444;color:#fff;font-size:12px;white-space:nowrap;cursor:pointer';
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await fetch('/api/devices/release', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mc' },
            body: JSON.stringify({ id: d.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'خروج دستگاه ناموفق بود.');
          hideDeviceLimitPanel();
          showAuthMessage('دستگاه خارج شد. در حال ورود...', false);
          const form = document.getElementById('loginForm');
          if (form && form.requestSubmit) form.requestSubmit();
        } catch (e) {
          b.disabled = false;
          showAuthMessage(e.message, true);
        }
      };
      row.appendChild(left); row.appendChild(b);
      panel.appendChild(row);
    });
  }

  // ==================== تابع ثبت‌نام ====================
  async function handleRegister(e) {
    e.preventDefault();
    
    const fullName = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;
    const btn = document.getElementById('regSubmitBtn');

    if (!email.endsWith('@gmail.com')) {
      showAuthMessage("فقط ایمیل جیمیل پذیرفته می‌شود (مثلاً name@gmail.com).", true);
      return;
    }

    if (password.length < 6) {
      showAuthMessage("رمز عبور باید حداقل ۶ کاراکتر باشد.", true);
      return;
    }

    if (password !== confirmPassword) {
      showAuthMessage("رمز عبور و تکرار آن یکسان نیستند.", true);
      return;
    }

    btn.disabled = true;
    btn.innerText = "در حال ارسال کد...";

    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");

      const { data, error } = await client.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: fullName
          }
        }
      });

      if (error) throw error;

      // اگر کاربر قبلاً ثبت‌نام و ایمیلش تایید شده باشد، Supabase به دلایل امنیتی
      // خطا برنمی‌گرداند، ولی آرایه identities خالی برمی‌گردد. این تنها راه
      // تشخیص «کاربر تکراری» در سمت کلاینت است.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        switchAuthTab('login');
        const loginEmailInput = document.getElementById('loginEmail');
        if (loginEmailInput) {
          loginEmailInput.value = email;
          document.getElementById('loginPassword')?.focus();
        }
        showAuthMessage("این ایمیل قبلاً در مانهواچی ثبت‌نام شده. برای ورود، رمز عبورت را وارد کن یا از «فراموشی رمز عبور» استفاده کن.", true, 'warning');
        return;
      }

      showEmailOtpForm(email, 60);
      showAuthMessage("کد ۶ رقمی تایید به جیمیل شما ارسال شد. اگر نرسید، پوشه‌ی اسپم را هم نگاه کن.", false);

    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('already registered')) {
        switchAuthTab('login');
        const loginEmailInput = document.getElementById('loginEmail');
        if (loginEmailInput) {
          loginEmailInput.value = email;
          document.getElementById('loginPassword')?.focus();
        }
        showAuthMessage("این ایمیل قبلاً در مانهواچی ثبت‌نام شده. برای ورود، رمز عبورت را وارد کن.", true, 'warning');
      } else {
        showAuthMessage(faAuthError(err), true);
      }
    } finally {
      btn.disabled = false;
      btn.innerText = "ارسال کد تایید به جیمیل";
    }
  }

  // ==================== ثبت‌نام با شماره موبایل (OTP پیامکی) ====================

  // ثبت‌نام با موبایل دو مرحله‌ایه تا مودال بلند نشه و اسکرول نخوره:
  //   مرحله ۱: نام + شماره + کد امنیتی + دکمه‌ی «ارسال کد»
  //   مرحله ۲: (بعد از ارسال کد، مرحله ۱ و تب‌ها و لوگو محو می‌شن) کد پیامک + رمز عبور
  function setPhoneStep(step) {
    const second = step === 2;
    document.getElementById('phoneStep1')?.classList.toggle('hidden', second);
    document.getElementById('phoneOtpSection')?.classList.toggle('hidden', !second);
    document.getElementById('authTabs')?.classList.toggle('hidden', second);
    document.getElementById('authLogoWrap')?.classList.toggle('hidden', second);
    if (second) {
      document.getElementById('registerMethodSwitch')?.classList.add('hidden');
      const subtitle = document.getElementById('authSubtitle');
      if (subtitle) subtitle.textContent = "تایید شماره موبایل";
    }
  }

  function editPhoneNumber() {
    clearInterval(phoneResendInterval);
    tempRegistrationPhone = "";
    hideAuthMessage();
    setPhoneStep(1);
    document.getElementById('registerMethodSwitch')?.classList.remove('hidden');
    const subtitle = document.getElementById('authSubtitle');
    if (subtitle) subtitle.textContent = "چند قدم تا ساخت حساب جدیدت باقی مونده";
    const otp = document.getElementById('regPhoneOtpCode');
    if (otp) otp.value = '';
    loadRegCaptcha();
    document.getElementById('regPhoneNumber')?.focus();
  }

  // ارسال مجدد کد به کپچای تازه نیاز داره؛ پس برمی‌گردیم به مرحله‌ی ۱ (نام و شماره حفظ می‌شن)
  function resendPhoneOtp() {
    const keepPhone = document.getElementById('regPhoneNumber')?.value;
    editPhoneNumber();
    const phoneInput = document.getElementById('regPhoneNumber');
    if (phoneInput && keepPhone) phoneInput.value = keepPhone;
    showAuthMessage("برای ارسال مجدد کد، کد امنیتی را وارد کن.", false);
    document.getElementById('regCaptchaAnswer')?.focus();
  }

  function startPhoneResendCountdown(seconds) {
    const btn = document.getElementById('regPhoneResendBtn');
    const timerText = document.getElementById('regPhoneResendTimer');
    if (!btn) return;

    let remaining = Math.max(0, Math.floor(seconds));
    btn.disabled = true;
    clearInterval(phoneResendInterval);

    const tick = () => {
      if (remaining <= 0) {
        clearInterval(phoneResendInterval);
        btn.disabled = false;
        if (timerText) timerText.textContent = '';
        return;
      }
      if (timerText) timerText.textContent = `ارسال مجدد تا ${remaining} ثانیه دیگر`;
      remaining -= 1;
    };
    tick();
    phoneResendInterval = setInterval(tick, 1000);
  }

  // کپچای تصویری: هر کپچا یک‌بار مصرفه (چه جواب درست چه غلط)، پس بعد از هر
  // تلاش ارسال کد، یکی جدید می‌گیریم. تصویر با data: URL داخل <img> نشون داده
  // می‌شه (نه innerHTML) تا SVG هیچ‌وقت اسکریپتی اجرا نکنه.
  async function loadRegCaptcha() {
    const img = document.getElementById('regCaptchaImg');
    const ans = document.getElementById('regCaptchaAnswer');
    if (!img) return;
    if (ans) ans.value = '';
    try {
      const res = await fetch('/api/captcha', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.captchaId || !data.image) throw new Error();
      regCaptchaId = data.captchaId;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data.image);
    } catch {
      regCaptchaId = "";
      img.removeAttribute('src');
      showAuthMessage("بارگذاری کد امنیتی ناموفق بود. روی «کد جدید» بزن.", true);
    }
  }

  async function handleSendPhoneOtp() {
    const phoneInput = document.getElementById('regPhoneNumber');
    const phone = normalizeIranPhoneClient(phoneInput.value);
    const sendBtn = document.getElementById('regPhoneSendBtn');
    const activeBtn = sendBtn;

    if (!document.getElementById('regPhoneFullName').value.trim()) {
      showAuthMessage("نام و نام خانوادگی را وارد کن.", true);
      return;
    }

    if (!phone) {
      showAuthMessage("شماره موبایل معتبر نیست. مثال: 09121234567", true);
      return;
    }

    const captchaAnswer = (document.getElementById('regCaptchaAnswer')?.value || '').trim();
    if (!regCaptchaId) {
      await loadRegCaptcha();
      showAuthMessage("کد امنیتی را از روی تصویر وارد کن.", true);
      return;
    }
    if (!captchaAnswer) {
      showAuthMessage("کد امنیتی را از روی تصویر وارد کن.", true);
      return;
    }

    const originalHtml = activeBtn.innerHTML;
    activeBtn.disabled = true;
    activeBtn.textContent = "در حال ارسال...";

    try {
      const usedCaptchaId = regCaptchaId;
      regCaptchaId = ""; // یک‌بار مصرفه؛ چه موفق چه ناموفق دیگه معتبر نیست
      const res = await fetch('/api/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, captchaId: usedCaptchaId, captchaAnswer })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "ارسال کد ناموفق بود.");

      tempRegistrationPhone = phone;
      const shown = document.getElementById('regPhoneShown');
      if (shown) shown.textContent = phoneInput.value.trim();
      setPhoneStep(2);
      showAuthMessage("کد ۶ رقمی تایید برای شماره‌ات پیامک شد.", false);
      startPhoneResendCountdown(data.resendAfterSeconds || 90);
      document.getElementById('regPhoneOtpCode')?.focus();
    } catch (err) {
      showAuthMessage(err.message || "ارسال کد ناموفق بود.", true);
    } finally {
      activeBtn.disabled = false;
      activeBtn.innerHTML = originalHtml;
      loadRegCaptcha(); // برای تلاش بعدی (ارسال مجدد) کپچای تازه
    }
  }

  async function handleRegisterPhone(e) {
    e.preventDefault();

    const fullName = document.getElementById('regPhoneFullName').value.trim();
    const code = toEnDigitsClient(document.getElementById('regPhoneOtpCode').value).trim();
    const password = document.getElementById('regPhonePassword').value;
    const confirmPassword = document.getElementById('regPhoneConfirmPassword').value;
    const btn = document.getElementById('regPhoneSubmitBtn');

    if (!fullName) {
      showAuthMessage("نام و نام خانوادگی را وارد کن.", true);
      return;
    }
    if (!tempRegistrationPhone) {
      showAuthMessage("ابتدا با دکمه‌ی «ارسال کد» یک کد تایید برای شماره‌ات بگیر.", true);
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      showAuthMessage("کد تایید باید ۶ رقم باشد.", true);
      return;
    }
    if (password.length < 6) {
      showAuthMessage("رمز عبور باید حداقل ۶ کاراکتر باشد.", true);
      return;
    }
    if (password !== confirmPassword) {
      showAuthMessage("رمز عبور و تکرار آن یکسان نیستند.", true);
      return;
    }

    btn.disabled = true;
    btn.innerText = "در حال بررسی کد...";

    try {
      const verifyRes = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: tempRegistrationPhone, code })
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        throw new Error(
          verifyData.error ||
          "کد وارد شده اشتباه یا منقضی شده است." +
          (verifyData.attemptsLeft != null ? ` (${verifyData.attemptsLeft} تلاش باقی مانده)` : "")
        );
      }

      btn.innerText = "در حال ساخت حساب...";
      const registerRes = await fetch('/api/register/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: tempRegistrationPhone,
          password,
          fullName,
          ticket: verifyData.ticket
        })
      });
      const registerData = await registerRes.json().catch(() => ({}));

      if (!registerRes.ok) {
        if (registerData.code === 'PHONE_ALREADY_REGISTERED') {
          switchAuthTab('login');
          const loginEmailInput = document.getElementById('loginEmail');
          if (loginEmailInput) {
            loginEmailInput.value = tempRegistrationPhone;
            document.getElementById('loginPassword')?.focus();
          }
        }
        throw new Error(registerData.error || "ثبت‌نام ناموفق بود.");
      }

      // حساب ساخته و از قبل تاییدشده - بلافاصله با همون رمز وارد می‌کنیم
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");
      const { error: signInError } = await client.auth.signInWithPassword({
        phone: tempRegistrationPhone,
        password,
      });
      if (signInError) {
        console.error('[signin-after-register]', signInError.code, signInError.message);
        switchAuthTab('login');
        const li = document.getElementById('loginEmail');
        if (li) li.value = tempRegistrationPhone;
        showAuthMessage("حساب شما ساخته شد. لطفاً با همین شماره و رمز وارد شوید.", false, 'warning');
        return;
      }

      showAuthMessage("حساب شما با موفقیت ساخته شد و وارد شدید!", false);
      setTimeout(() => { location.reload(); }, 1000);

    } catch (err) {
      showAuthMessage(faAuthError(err), true);
    } finally {
      btn.disabled = false;
      btn.innerText = "تایید و ساخت حساب";
    }
  }

  // ==================== تابع فراموشی رمز عبور (ارسال لینک بازیابی) ====================
  async function handleForgotPassword(e) {
    e.preventDefault();

    const email = document.getElementById('forgotEmail').value.trim().toLowerCase();
    const btn = document.getElementById('forgotSubmitBtn');

    btn.disabled = true;
    btn.innerText = "در حال ارسال...";

    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");

      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });

      if (error) throw error;

      showAuthMessage("لینک بازیابی رمز عبور به ایمیل شما ارسال شد. لطفاً صندوق ایمیل خود را بررسی کنید.", false);

    } catch (err) {
      showAuthMessage(err.message || "خطا در ارسال لینک بازیابی رمز عبور", true);
    } finally {
      btn.disabled = false;
      btn.innerText = "ارسال لینک بازیابی رمز عبور";
    }
  }

  // ==================== تابع تنظیم رمز عبور جدید (بعد از کلیک روی لینک ایمیل) ====================
  async function handleResetPassword(e) {
    e.preventDefault();

    const newPassword = document.getElementById('resetNewPassword').value;
    const confirmNewPassword = document.getElementById('resetConfirmPassword').value;
    const btn = document.getElementById('resetSubmitBtn');

    if (newPassword.length < 6) {
      showAuthMessage("رمز عبور باید حداقل ۶ کاراکتر باشد.", true);
      return;
    }

    if (newPassword !== confirmNewPassword) {
      showAuthMessage("رمز عبور و تکرار آن یکسان نیستند.", true);
      return;
    }

    btn.disabled = true;
    btn.innerText = "در حال ثبت...";

    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");

      const { error } = await client.auth.updateUser({ password: newPassword });

      if (error) throw error;

      showAuthMessage("رمز عبور شما با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.", false);
      setTimeout(() => {
        switchAuthTab('login');
      }, 1200);

    } catch (err) {
      showAuthMessage(err.message || "خطا در تغییر رمز عبور", true);
    } finally {
      btn.disabled = false;
      btn.innerText = "ثبت رمز عبور جدید";
    }
  }

  // نمایش فرم فراموشی رمز عبور
  function showForgotPasswordForm() {
    hideAuthMessage();
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('otpForm')?.classList.add('hidden');
    document.getElementById('resetPasswordForm')?.classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.add('hidden');
    fpReset();
    document.getElementById('forgotPhoneForm')?.classList.remove('hidden');
    fpLoadCaptcha();
  }

  // بازیابی با لینک ایمیل (Supabase) - برای حساب‌هایی که با ایمیل ساخته شده‌اند
  function showForgotEmailForm() {
    hideAuthMessage();
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('otpForm')?.classList.add('hidden');
    document.getElementById('resetPasswordForm')?.classList.add('hidden');
    document.getElementById('forgotPhoneForm')?.classList.add('hidden');
    document.getElementById('forgotPasswordForm')?.classList.remove('hidden');
  }

  // ==================== فراموشی رمز عبور با شماره موبایل (فلوی سروری) ====================
  // مراحل: ۱) شماره (+ایمیل در اولین بار) + کپچا ۲) کد ایمیل ۳) کد پیامک (فقط اولین بار) ۴) رمز جدید
  let fpSessionId = "";
  let fpCaptchaId = "";
  const fpTimers = {};
  const fpEl = (id) => document.getElementById(id);

  function fpSetStep(n) {
    [1, 2, 3, 4].forEach((i) => fpEl('fpStep' + i)?.classList.toggle('hidden', i !== n));
    fpEl('fpCaptchaBox')?.classList.toggle('hidden', n !== 1);
    document.querySelectorAll('.fp-step1-only').forEach((el) => el.classList.toggle('hidden', n !== 1));
  }

  function fpReset() {
    Object.keys(fpTimers).forEach((k) => { clearInterval(fpTimers[k]); delete fpTimers[k]; });
    fpSessionId = "";
    fpCaptchaId = "";
    ['fpPhone', 'fpEmail', 'fpCaptchaAnswer', 'fpEmailCode', 'fpSmsCode', 'fpNewPassword', 'fpConfirmPassword']
      .forEach((id) => { const el = fpEl(id); if (el) el.value = ''; });
    fpEl('fpEmailBox')?.classList.add('hidden');
    fpEl('fpCaptchaImg')?.removeAttribute('src');
    ['fpResendEmailBtn', 'fpResendSmsBtn'].forEach((id) => {
      const b = fpEl(id);
      if (b) { b.disabled = false; b.textContent = id === 'fpResendSmsBtn' ? 'ارسال مجدد پیامک' : 'ارسال مجدد کد'; }
    });
    fpSetStep(1);
  }

  async function fpLoadCaptcha() {
    const img = fpEl('fpCaptchaImg');
    const ans = fpEl('fpCaptchaAnswer');
    if (!img) return;
    if (ans) ans.value = '';
    try {
      const res = await fetch('/api/captcha', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.captchaId || !data.image) throw new Error();
      fpCaptchaId = data.captchaId;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data.image);
    } catch {
      fpCaptchaId = "";
      img.removeAttribute('src');
      showAuthMessage("بارگذاری کد امنیتی ناموفق بود. روی «کد جدید» بزن.", true);
    }
  }

  // فراخوانی API؛ در خطا Error با فیلدهای code و data پرتاب می‌کنه
  async function fpCall(path, body) {
    const res = await fetch('/api/password/forgot/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'RESET_SESSION_EXPIRED') {
        fpReset();
        fpLoadCaptcha();
      }
      const err = new Error(data.error || "خطایی رخ داد. دوباره تلاش کن.");
      err.code = data.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  function fpCountdown(btnId, seconds, label) {
    const btn = fpEl(btnId);
    if (!btn) return;
    clearInterval(fpTimers[btnId]);
    let left = Math.max(0, Math.floor(seconds));
    const tick = () => {
      if (left <= 0) {
        clearInterval(fpTimers[btnId]);
        btn.disabled = false;
        btn.textContent = label;
        return;
      }
      btn.disabled = true;
      btn.textContent = `${label} (${left})`;
      left -= 1;
    };
    tick();
    fpTimers[btnId] = setInterval(tick, 1000);
  }

  function fpBusy(btn, busy, text) {
    if (!btn) return;
    if (busy) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.textContent = text; }
    else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
  }

  // مرحله ۱
  async function fpStart() {
    const phone = normalizeIranPhoneClient(fpEl('fpPhone').value);
    if (!phone) { showAuthMessage("شماره موبایل معتبر نیست. مثال: 09121234567", true); return; }

    const emailVisible = !fpEl('fpEmailBox').classList.contains('hidden');
    const email = emailVisible ? fpEl('fpEmail').value.trim().toLowerCase() : '';
    if (emailVisible && !email) { showAuthMessage("ایمیل را وارد کن.", true); return; }

    const captchaAnswer = (fpEl('fpCaptchaAnswer').value || '').trim();
    if (!fpCaptchaId) { await fpLoadCaptcha(); showAuthMessage("کد امنیتی را از روی تصویر وارد کن.", true); return; }
    if (!captchaAnswer) { showAuthMessage("کد امنیتی را از روی تصویر وارد کن.", true); return; }

    const btn = fpEl('fpStartBtn');
    fpBusy(btn, true, "در حال ارسال...");
    let keepCaptcha = false;
    let advanced = false;
    try {
      const body = { phone, captchaId: fpCaptchaId, captchaAnswer };
      if (email) body.email = email;
      const data = await fpCall('start', body);

      if (data.needsEmail) {
        // اولین بازیابی: حساب ایمیل تاییدشده ندارد. همین کپچا (keep) برای مرحله بعد معتبر می‌مونه.
        keepCaptcha = true;
        fpEl('fpEmailBox').classList.remove('hidden');
        fpEl('fpEmail').focus();
        showAuthMessage("این حساب هنوز ایمیل تاییدشده ندارد. ایمیلت را وارد کن تا کد تایید به آن ارسال شود.", false, 'warning');
        return;
      }

      advanced = true;
      fpSessionId = data.sessionId;
      fpCaptchaId = "";
      fpEl('fpEmailHint').textContent = data.emailHint || '';
      fpSetStep(2);
      fpCountdown('fpResendEmailBtn', data.resendAfterSeconds || 90, 'ارسال مجدد کد');
      showAuthMessage("کد ۶ رقمی تایید به ایمیلت ارسال شد.", false);
      fpEl('fpEmailCode').focus();
    } catch (err) {
      showAuthMessage(err.message, true);
    } finally {
      fpBusy(btn, false);
      if (!keepCaptcha) {
        fpCaptchaId = "";
        // اگه هنوز تو مرحله ۱ هستیم کپچای تازه بگیر؛ وگرنه در «ارسال مجدد» گرفته می‌شه
        if (!advanced) fpLoadCaptcha();
      }
    }
  }

  // مرحله ۲
  async function fpVerifyEmail() {
    const code = toEnDigitsClient(fpEl('fpEmailCode').value).trim();
    if (!/^\d{6}$/.test(code)) { showAuthMessage("کد تایید باید ۶ رقم باشد.", true); return; }
    const btn = fpEl('fpVerifyEmailBtn');
    fpBusy(btn, true, "در حال تایید...");
    try {
      const data = await fpCall('verify-email', { sessionId: fpSessionId, code });
      if (data.nextStep === 'phone') {
        fpSetStep(3);
        fpCountdown('fpResendSmsBtn', data.resendAfterSeconds || 90, 'ارسال مجدد پیامک');
        showAuthMessage("ایمیل تایید شد. کد پیامک‌شده به شماره‌ات را وارد کن.", false);
        fpEl('fpSmsCode').focus();
      } else {
        fpSetStep(4);
        showAuthMessage("تایید شد. رمز جدید را وارد کن.", false);
        fpEl('fpNewPassword').focus();
      }
    } catch (err) {
      if (err.data && err.data.emailVerified && err.data.nextStep === 'phone') {
        // ایمیل تایید شده ولی ارسال پیامک شکست خورد؛ با «ارسال مجدد پیامک» دوباره امتحان می‌شه
        fpSetStep(3);
        const b = fpEl('fpResendSmsBtn');
        if (b) { clearInterval(fpTimers['fpResendSmsBtn']); b.disabled = false; b.textContent = 'ارسال مجدد پیامک'; }
      }
      showAuthMessage(err.message, true);
    } finally {
      fpBusy(btn, false);
    }
  }

  // مرحله ۳
  async function fpVerifySms() {
    const code = toEnDigitsClient(fpEl('fpSmsCode').value).trim();
    if (!/^\d{6}$/.test(code)) { showAuthMessage("کد تایید باید ۶ رقم باشد.", true); return; }
    const btn = fpEl('fpVerifySmsBtn');
    fpBusy(btn, true, "در حال تایید...");
    try {
      await fpCall('verify-phone', { sessionId: fpSessionId, code });
      fpSetStep(4);
      showAuthMessage("شماره تایید شد. رمز جدید را وارد کن.", false);
      fpEl('fpNewPassword').focus();
    } catch (err) {
      showAuthMessage(err.message, true);
    } finally {
      fpBusy(btn, false);
    }
  }

  // ارسال مجدد (کپچا لازمه): بار اول کپچا نشون داده می‌شه، بار دوم ارسال انجام می‌شه
  async function fpResend(channel) {
    const box = fpEl('fpCaptchaBox');
    if (box.classList.contains('hidden')) {
      box.classList.remove('hidden');
      await fpLoadCaptcha();
      showAuthMessage("کد امنیتی را وارد کن و دوباره روی «ارسال مجدد» بزن.", false, 'warning');
      return;
    }
    const captchaAnswer = (fpEl('fpCaptchaAnswer').value || '').trim();
    if (!fpCaptchaId || !captchaAnswer) { showAuthMessage("کد امنیتی را از روی تصویر وارد کن.", true); return; }

    const btnId = channel === 'sms' ? 'fpResendSmsBtn' : 'fpResendEmailBtn';
    const label = channel === 'sms' ? 'ارسال مجدد پیامک' : 'ارسال مجدد کد';
    const btn = fpEl(btnId);
    btn.disabled = true;
    const usedId = fpCaptchaId;
    fpCaptchaId = "";
    try {
      const data = await fpCall('resend', { sessionId: fpSessionId, channel, captchaId: usedId, captchaAnswer });
      box.classList.add('hidden');
      fpCountdown(btnId, data.resendAfterSeconds || 90, label);
      showAuthMessage(channel === 'sms' ? "کد جدید پیامک شد." : "کد جدید به ایمیلت ارسال شد.", false);
    } catch (err) {
      btn.disabled = false;
      showAuthMessage(err.message, true);
      if (fpSessionId) fpLoadCaptcha();
    }
  }

  // مرحله ۴
  async function fpSubmitPassword() {
    const password = fpEl('fpNewPassword').value;
    const confirm = fpEl('fpConfirmPassword').value;
    if (password.length < 6 || password.length > 72) { showAuthMessage("رمز عبور باید بین ۶ تا ۷۲ کاراکتر باشد.", true); return; }
    if (password !== confirm) { showAuthMessage("رمز عبور و تکرار آن یکسان نیستند.", true); return; }
    const btn = fpEl('fpResetBtn');
    fpBusy(btn, true, "در حال ثبت...");
    try {
      await fpCall('reset', { sessionId: fpSessionId, password });
      fpReset();
      switchAuthTab('login');
      showAuthMessage("رمز عبور با موفقیت تغییر کرد. حالا می‌تونی وارد شی.", false);
    } catch (err) {
      showAuthMessage(err.message, true);
    } finally {
      fpBusy(btn, false);
    }
  }


  // بررسی رویداد بازیابی رمز عبور (وقتی کاربر روی لینک ایمیل کلیک می‌کند)
  document.addEventListener('DOMContentLoaded', () => {
    const client = getSupabase();
    if (client && client.auth && typeof client.auth.onAuthStateChange === 'function') {
      client.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          if (typeof openAuthModal === 'function') openAuthModal('login');
          document.getElementById('loginForm')?.classList.add('hidden');
          document.getElementById('registerForm')?.classList.add('hidden');
          document.getElementById('otpForm')?.classList.add('hidden');
          document.getElementById('forgotPasswordForm')?.classList.add('hidden');
          document.getElementById('forgotPhoneForm')?.classList.add('hidden');
          document.getElementById('resetPasswordForm')?.classList.remove('hidden');
          showAuthMessage("لطفاً رمز عبور جدید خود را وارد کنید.", false);
        }
      });
    }
  });

  // ==================== تابع تایید کد OTP ====================
  async function handleVerifyOTP(e) {
    e.preventDefault();
    
    const otpCode = toEnDigitsClient(document.getElementById('otpCode').value).replace(/\D/g, '');
    if (otpCode.length !== 6) {
      showAuthMessage("کد تایید باید ۶ رقم باشد.", true);
      return;
    }
    const btn = document.getElementById('verifyOtpBtn');

    btn.disabled = true;
    btn.innerText = "در حال تایید...";

    try {
      const client = getSupabase();
      if (!client) throw new Error("ارتباط با دیتابیس برقرار نشد.");

      const { data, error } = await client.auth.verifyOtp({
        email: tempRegistrationEmail || getPendingSignupEmail(),
        token: otpCode,
        type: 'signup'
      });

      if (error) throw error;

      clearPendingSignup();
      showAuthMessage("حساب شما با موفقیت تایید و فعال شد!", false);
      setTimeout(() => { location.reload(); }, 1200);

    } catch (err) {
      showAuthMessage(faAuthError(err), true);
    } finally {
      btn.disabled = false;
      btn.innerText = "تایید و فعال‌سازی حساب";
    }
  }

async function handleLogout() {
  const client = window.supabaseClient || window.supabase;
  // دانلودهای آفلاین (رمزشده) از این دستگاه پاک شوند
  try { localStorage.removeItem('mc_off_uid'); indexedDB.deleteDatabase('mc-offline-v1'); } catch (e) {}
  await client.auth.signOut();
  location.reload();
}

// باز کردن خودکار مدال با ?action=login و تمیز کردن آدرس (تا با رفرش دوباره باز نشه)
document.addEventListener('DOMContentLoaded', function () {
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'login') {
    openAuthModal('login');
    urlParams.delete('action');
    urlParams.delete('next');
    var q = urlParams.toString();
    history.replaceState({}, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
  }
});

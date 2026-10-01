// server.js
// این فایل کارهای زیر رو انجام می‌دهد:
// ۱) نمایش فایل‌های استاتیک سایت (HTML/CSS) از پوشه‌ی public
// ۲) نمایش صفحه‌ی مانهوا (که قبلاً manga.php بود) با EJS - همان منطق PHP قبلی
// ۳) رله‌ی درخواست‌های پرداخت بین سایت و زیبال (چون Supabase از ایران رد نمی‌شود)
// ۴) تصاویر چپتر با signed URL موقت از باکت پارس‌پک، با کش برای جلوگیری از 429

const express = require("express");
const helmet = require('helmet');
const compression = require("compression");
const path = require("path");
const app = express();

// ⚠️ نکته‌ی حیاتی، حتماً قبل از production چک کنید:
// اگه سرور Node پشت یک reverse proxy (مثلاً Nginx) باشه - که رایج‌ترین
// حالت روی هاست/VPS ایرانیه - بدون این خط، req.ip همیشه IP خودِ پراکسی
// رو برمی‌گردونه، نه IP واقعی کاربر. یعنی همه‌ی کاربرها زیر یک IP یکسان
// حساب می‌شن و به محض این‌که سقف rate limit پر بشه، سایت برای همه قفل
// می‌شه، نه فقط برای یک نفر.
// "1" یعنی فقط به اولین پراکسی (Nginx) اعتماد کن. اگه یه لایه‌ی دیگه هم
// جلوترش هست (مثلاً Cloudflare + Nginx)، باید عدد رو ۲ کنی.
// برعکسش هم خطرناکه: اگه اصلاً پراکسی‌ای جلوی Node نیست (اتصال مستقیم)،
// این خط رو نباید فعال بذارید - چون هر کسی می‌تونه با ست کردن دستیِ هدر
// X-Forwarded-For یک IP جعلی/تصادفی بفرسته و کل rate limit رو دور بزنه.
// => قبل از deploy مطمئن شید توپولوژی واقعی سرورتون چیه و همین مطابقش تنظیم کنید.
app.set("trust proxy", 1);

// ---------- نرمال‌سازی IP کلاینت برای همه‌ی rate limit ها ----------
// همه‌ی محدودیت‌های IP (کپچا، verify، ثبت‌نام، پیامک، ریست رمز) روی req.ip
// کلید می‌خورن. یک کاربر/سرور با IPv6 معمولاً یک بلوک /64 کامل (۲^۶۴ آدرس) داره
// و می‌تونه برای هر درخواست یک آدرس جدید بفرسته؛ یعنی هیچ سقف IP‌ای عملاً کار
// نمی‌کنه، و علاوه بر اون با پر کردن Map ردیاب‌ها (سقف ۲۰٬۰۰۰ کلید) سابقه‌ی بقیه
// (از جمله کاربرهای VIP) رو evict می‌کنه. راه‌حل استاندارد: IPv6 رو به /64
// تبدیل کن (و ::ffff:a.b.c.d رو به IPv4 ساده). این middleware فقط req.ip رو
// عوض می‌کنه؛ مصرف‌کننده‌ها (smsGuard، otpStore، chapterRateLimit) بدون تغییر
// کار می‌کنن.
const net = require("net");
function expandIPv6(ip) {
  ip = ip.split("%")[0];
  if (ip.includes(".")) {
    const i = ip.lastIndexOf(":");
    const v4 = ip.slice(i + 1).split(".").map(Number);
    ip = ip.slice(0, i + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const [h, t] = ip.split("::");
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const fill = t === undefined ? 0 : 8 - head.length - tail.length;
  return [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail].map((x) => x.padStart(4, "0"));
}
function normalizeClientIp(ip) {
  if (!ip || typeof ip !== "string") return ip;
  if (ip.toLowerCase().startsWith("::ffff:") && net.isIPv4(ip.slice(7))) return ip.slice(7);
  if (!net.isIPv6(ip.split("%")[0])) return ip;
  return expandIPv6(ip.toLowerCase()).slice(0, 4).join(":") + "::/64";
}
app.use((req, res, next) => {
  const n = normalizeClientIp(req.ip);
  if (n && n !== req.ip) {
    Object.defineProperty(req, "ip", { value: n, configurable: true, enumerable: true });
  }
  next();
});


// فعال‌سازی Helmet و تنظیم هدرهای امنیتی از جمله CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // برای اجرای اسکریپت‌های داخلی EJS/HTML
          "https://cdn.jsdelivr.net", // اگر از CDN خاصی استفاده می‌کنید اینجا اضافه کنید
          "https://code.jquery.com",
          "https://cdn.tailwindcss.com", // اسکریپت Tailwind (CDN) - بدونش کل layout سایت می‌شکنه
          "https://www.googletagmanager.com", // Google Tag Manager / gtag.js
        ],
        // 🔧 پیش‌فرض Helmet برای این دایرکتیو "'none'"ـه و اگه صریح ست نشه،
        // همون پیش‌فرض فعال می‌مونه حتی وقتی scriptSrc بالا رو کاستوم می‌کنید.
        // چون تو HTML/JS سایت از onclick و مشابهش (inline event handler)
        // استفاده شده، بدون این خط همه‌شون بلاک می‌شن.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com", // استایل Font Awesome
        ],
        imgSrc: ["'self'", "data:", "https:"], // اجازه بارگذاری تصاویر از لینک‌ها یا CDN
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com", // فونت‌های آیکون Font Awesome
          "https://cdn.jsdelivr.net", // فونت Vazir
        ],
        connectSrc: [
          "'self'",
          "https://*.supabase.co", // اتصال به دیتابیس Supabase
          "https://www.google-analytics.com", // ارسال دیتای Google Analytics/gtag
          "https://region1.google-analytics.com",
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // مخفی کردن هدر افشاکننده Node/Express
    hidePoweredBy: true,
  })
);
// فشرده‌سازی gzip/brotli برای همه‌ی جواب‌ها (JSON، HTML، فایل‌های استاتیک).
// قبلاً وجود نداشت - یعنی همه‌چیز بدون فشرده‌سازی رد و بدل می‌شد.
app.use(compression());

// ۵۰ کیلوبایت برای بدنه‌ی JSON کافیه (بیشترین بدنه‌ی واقعی همین الان چند
// فیلد کوتاهه: slug/chapterNum/planKey/trackId). قبلاً express.json() بدون
// آرگومان صدا زده می‌شد که به‌صورت ضمنی همون ۱۰۰kb پیش‌فرض خودِ Express رو
// اعمال می‌کرد - این خط همون رفتار رو صریح و کمی سخت‌گیرانه‌تر می‌کنه، تا
// معلوم باشه عمدیه، نه یک پیش‌فرض فراموش‌شده.
app.use(express.json({ limit: "50kb" }));

// ---------- پنل ادمین (مدیریت مانهواها و چپترها بدون ویرایش دستی data.json) ----------
const { router: adminRouter } = require("./admin/adminRouter");
app.use("/admin", adminRouter);

// ---------- تنظیمات EJS برای صفحه‌ی مانهوا ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));



// ---------- بخش ۱: نمایش سایت ----------
// maxAge اضافه شد تا مرورگر فایل‌های استاتیک (CSS/JS/فونت/عکس) رو کش کنه
// و مجبور نباشه هر بار دوباره از سرور دانلودشون کنه.
app.use("/.well-known", express.static("public/.well-known", { dotfiles: "allow" }));
app.use(express.static("public", { maxAge: "7d", etag: true }));

// ---------- بخش ۱٫۵: تصاویر عمومی (کاور مانهوا / تامبنیل چپتر) از S3 ----------
// این عکس‌ها (کاور اصلی هر مانهوا + تصویر بندانگشتی هر چپتر تو
// chapterPictures) برخلاف صفحات چپتر private نیستن، نیازی به چک VIP یا
// rate-limit سنگین ندارن، و تعدادشون هم خیلی کمتر از صفحات چپتره - پس
// نیازی به presigned URL/Bunny نیست، یه استریم ساده کافیه.
//
// چرا این route اصلاً لازم شد: قبلاً (نسخه‌ی قدیمی PHP) فایل‌های /manhwas/
// مستقیم روی دیسک خودِ سرور بودن، پس خودِ وب‌سرور این مسیر رو سرو می‌کرد.
// بعد از انتقال کامل این فایل‌ها به فضای ابری پارس‌پک، دیگه همچین فایلی
// رو دیسک نیست - این route جای همون سرو کردن قدیمی رو می‌گیره: هر
// درخواست /manhwas/<هرچی> رو به کلید معادلش رو باکت (manhwas/<هرچی>)
// نگاشت می‌کنه، می‌خونه، و مستقیم استریم می‌کنه.
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { s3 } = require("./lib/chapterCache");
const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

// 🔒 امنیت: این route فقط و فقط برای دو الگوی عمومی مجازه:
//   ۱) کاور اصلی:      manhwas/<slug>/<file>
//   ۲) تامبنیل چپتر:   manhwas/<slug>/chapterPictures/<file>
// هر مسیر دیگه‌ای - مخصوصاً صفحات خودِ چپتر (manhwas/<slug>/CH<n>/srcCH<n>/...)
// - اینجا سرو نمی‌شه و 404 می‌گیره. قبلاً هر کلیدی زیر manhwas/ بدون هیچ
// چکی استریم می‌شد؛ یعنی هر کسی با حدس زدن مسیر (که از data.json و الگوی
// ثابت اسم‌گذاری معلومه) می‌تونست صفحات VIP رو مستقیم و بدون توکن،
// بدون لاگین و بدون rate-limit بگیره. صفحات چپتر فقط از /chapter-image با
// توکن زمان‌دار (که خروجی /api/get-chapter-images هست) در دسترسن.
const PUBLIC_MANHWA_PATH_RE =
  /^[^/]+\/(?:chapterPictures\/)?[^/]+\.(?:jpe?g|png|webp|gif|avif|svg)$/i;

const { getCachedImage, UpstreamBusyError } = require("./lib/imageProxyCache");

// وقتی پارس‌پک 429 می‌ده، به‌جای 500 و یک خط لاگ برای هر درخواست، 503 با
// Retry-After برمی‌گردونیم و لاگ رو حداکثر هر ۱۰ ثانیه یک بار چاپ می‌کنیم.
let lastBusyLogAt = 0;
function handleImageError(err, res, label) {
  const throttled =
    err instanceof UpstreamBusyError ||
    err?.$metadata?.httpStatusCode === 429 ||
    /too many requests/i.test(err?.message || "");
  if (throttled) {
    const now = Date.now();
    if (now - lastBusyLogAt > 10_000) {
      lastBusyLogAt = now;
      console.warn(`${label}: پارس‌پک محدودیت نرخ داده (لاگ این پیام هر ۱۰ ثانیه یک‌بار چاپ می‌شه)`);
    }
    res.set("Retry-After", String(err.retryAfterSeconds || 20));
    return res.status(503).send("سرور موقتاً شلوغ است، چند ثانیه بعد دوباره تلاش کنید");
  }
  console.error(`${label}:`, err.message);
  return res.status(500).send("خطای داخلی سرور");
}

app.get("/manhwas/*", async (req, res) => {
  // req.params[0] یعنی همه‌چیز بعد از "/manhwas/" (مثلاً "<slug>/cover.jpg"
  // یا "<slug>/chapterPictures/chapterpicture12.png")
  const rest = req.params[0] || "";
  if (rest.includes("..") || rest.includes("\\") || !PUBLIC_MANHWA_PATH_RE.test(rest)) {
    return res.status(404).send("تصویر یافت نشد");
  }
  const key = `manhwas/${rest}`;
  try {
    // از کش دیسک (imageProxyCache) استفاده می‌کنیم تا هر بازدیدکننده‌ی جدید
    // یک GetObject مستقیم به پارس‌پک نزنه (سقف ۳۰۰ در دقیقه برای کل باکت).
    const { buffer, contentType } = await getCachedImage(key);
    res.set("Content-Type", contentType);
    // این تصاویر به‌ندرت عوض می‌شن (فقط وقتی از پنل ادمین آپلود جدید
    // می‌گیرن)، پس کش طولانی‌مدت مثل بقیه‌ی فایل‌های استاتیک منطقیه.
    res.set("Cache-Control", "public, max-age=604800");
    return res.send(buffer);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).send("تصویر یافت نشد");
    }
    return handleImageError(err, res, "خطا در گرفتن تصویر از S3");
  }
});

// ---------- بخش ۱٫۶: پراکسی کش‌شده‌ی تصاویر چپتر (راه‌حل سریع جای BunnyCDN) ----------
// این مسیر با route قبلی (/manhwas/*) فرق داره: اون یکی برای عکس‌های
// عمومی (کاور/تامبنیل) بود که نیازی به چک دسترسی/rate-limit ندارن. این
// یکی برای تصاویر خودِ چپتره - دسترسی (رایگان/VIP) و rate-limit همچنان
// توی /api/get-chapter-images چک می‌شن؛ لینکی که از اونجا برمی‌گرده به
// همین مسیر اشاره می‌کنه، با یک توکنِ زمان‌دار (lib/localImageToken.js)
// که هم‌سطح امنیتی presigned URL قبلی رو حفظ می‌کنه.
//
// چرا این route لازم شد: قبلاً لینک نهایی مستقیم presigned URL پارس‌پک
// بود - یعنی هر بازدیدکننده برای هر عکس یک GetObject جدا مستقیم به
// پارس‌پک می‌زد و به‌راحتی سقف نرخ پارس‌پک (۳۰۰/دقیقه) رو رد می‌کرد، حتی
// وقتی خودِ این کاربر چیزی نخونده بود - چون سقف روی کل باکت شمرده می‌شه،
// نه به‌ازای هر کاربر. حالا اولین درخواست هر عکس از پارس‌پک خونده و روی
// دیسک سرور کش می‌شه (lib/imageProxyCache.js)، بقیه‌ی درخواست‌ها برای
// همون عکس مستقیم از دیسک سرو می‌شن.
//
// این راه‌حل موقته - وقتی BunnyCDN کامل راه‌اندازی بشه، chapterCache.js
// خودکار برمی‌گرده به اون (اولویت اول همیشه Bunyه، این فقط fallback دومه).
const { isValidToken } = require("./lib/localImageToken");

app.get("/chapter-image/:key(*)", async (req, res) => {
  const { key } = req.params;
  const { token, expires } = req.query;

  if (!isValidToken(key, expires, token)) {
    return res.status(403).send("لینک نامعتبر یا منقضی شده است");
  }

  try {
    const { buffer, contentType } = await getCachedImage(key);
    res.set("Content-Type", contentType);
    // فایل عوض نمی‌شه بدون این‌که کلید (مسیر) عوض بشه، پس کش طولانی‌مدت
    // سمت مرورگر هم بی‌خطره - شبیه همون /manhwas/* بالا.
    res.set("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).send("تصویر یافت نشد");
    }
    return handleImageError(err, res, "خطا در گرفتن تصویر از کش/پارس‌پک");
  }
});

// ---------- بخش ۲: صفحه‌ی مانهوا (جایگزین manga.php + آدرس زیبای comic/) ----------
// نکته‌ی مهم: قبلاً این تابع هر بار data.json رو با fs.readFileSync (synchronous)
// از دیسک می‌خوند - یعنی هر ریکوئست صفحه‌ی مانهوا، کل event loop رو تا پایان
// خوندن فایل قفل می‌کرد و همه‌ی کاربرهای دیگه (از جمله کسایی که فقط دارن عکس
// چپتر می‌گیرن) رو معطل می‌ذاشت. حالا از lib/dataStore.js استفاده می‌کنیم که
// فقط یک بار از دیسک می‌خونه و در حافظه کش می‌مونه.
const { getData, getRawJson } = require("./lib/dataStore");

function renderMangaPage(req, res, slugRaw) {
  const slug = (slugRaw || "").toString().trim();
  const data = getData();
  const manhwa = data[slug] || null;

  function stripTags(str) {
    return (str || "").replace(/<[^>]*>/g, "");
  }

  let vars;

  if (manhwa) {
    const title_en = manhwa.title_en || "";
    const title_fa = manhwa.title_fa || "";
    const origin = manhwa.origin || "مانهوا";
    const type = manhwa.type || "مانهوا";

    const seo_title = title_fa
      ? `خواندن مانهوا ${title_fa} (${title_en}) با ترجمه اختصاصی | مانهواچی`
      : `${title_en} | مانهواچی`;

    const raw_desc = stripTags(manhwa.description || "");
    const seo_desc = raw_desc.substring(0, 160) + "...";

    const cover_url = `/manhwas/${encodeURIComponent(slug)}/${manhwa.cover_image || ""}`;
    const full_cover_url = `https://manhwachi.ir${cover_url}`;
    const canonical_url = `https://manhwachi.ir/comic/${encodeURIComponent(slug)}`;

    const score = manhwa.score || "0.0";
    const scans_by = manhwa.scans_by || "تیم ترجمه";
    const episodes = manhwa.episodes || [];
    const genres = manhwa.genres || [];
    const release_date = manhwa.release_date || "";

    const has_locked = episodes.some((ep) => !ep.free);

    vars = {
      manhwa, slug, title_en, title_fa, origin, type,
      seo_title, seo_desc, raw_desc,
      cover_url, full_cover_url, canonical_url,
      score, scans_by, episodes, genres, has_locked, release_date,
    };
  } else {
    vars = {
      manhwa: null, slug,
      seo_title: "مانهوا یافت نشد | مانهواچی",
      seo_desc: "خواندن آنلاین جدیدترین مانهواها، مانگاها و مانهواهای جذاب با ترجمه فارسی در مانهواچی.",
      canonical_url: "https://manhwachi.ir/comic",
      full_cover_url: "https://manhwachi.ir/ManhwaChi/favicon-192x192.png",
      title_en: "Not Found",
      title_fa: "",
      raw_desc: "مانهوا مورد نظر پیدا نشد.",
      cover_url: "",
      origin: "مانهوا",
      type: "مانهوا",
      score: "0",
      scans_by: "",
      episodes: [],
      genres: [],
      has_locked: false,
      release_date: "",
    };
  }

  res.render("manga", vars);
}

app.get("/comic/:slug", (req, res) => {
  renderMangaPage(req, res, req.params.slug);
});

app.get("/manga.php", (req, res) => {
  renderMangaPage(req, res, req.query.slug);
});

// ---------- بخش ۳: خرید VIP (مستقیم، بدون pg_net) ----------

// همون ماژول rate-limitِ چپترها، برای مسیرهای خرید هم استفاده می‌شه (پایین‌تر
// در بخش ۵ هم import می‌شه - require دوم هزینه‌ای نداره چون Node ماژول رو
// کش می‌کنه، فقط این‌جا هم لازمش داریم چون این بخش زودتر از بخش ۵ تعریف می‌شه).
const { checkAndRecordChapterRequest: checkAndRecordPurchaseRequest } = require("./lib/chapterRateLimit");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ZIBAL_MERCHANT = process.env.ZIBAL_MERCHANT;
const PURCHASE_CALLBACK_URL =
  process.env.PURCHASE_CALLBACK_URL || "https://manhwachi.ir/vip-verify.html";

const PLAN_DEFS = {
  weekly: { amount: 250000, days: 7 },
  monthly: { amount: 550000, months: 1 },
  quarterly: { amount: 1500000, months: 3 },
};

function supabaseAdminHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function getUserFromAccessToken(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(10_000), // بدون timeout، کندی Supabase درخواست رو بی‌نهایت باز نگه می‌داشت
  });
  // فقط وقتی Supabase صریحاً توکن رو رد کرده «نشست نامعتبر» حساب می‌شه.
  // خطای ۵xx/۴۲۹ یعنی مشکل از Supabase‌ه، نه کاربر - پس throw می‌کنیم تا
  // کاربر بی‌دلیل «دوباره وارد شوید» نبینه.
  if (res.status === 400 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`auth/v1/user ${res.status}`);
  return res.json();
}

// زمان انقضای JWT (ms) - برای این‌که کش هیچ‌وقت از عمر خودِ توکن بیشتر نشه
function jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// ---------- کش کوتاه‌مدت برای احراز هویت + وضعیت VIP ----------
// قبلاً هر درخواست چپتر VIP، ۲ ریکوئست جدا به Supabase می‌زد (تایید توکن +
// خواندن پروفایل) - یعنی برای کاربری که پشت‌سرهم چپتر عوض می‌کنه، هر بار
// این round-trip شبکه تکرار می‌شد. حالا نتیجه رو برای مدت کوتاهی کش می‌کنیم.
// نکته: یعنی اگه کاربر همین الان VIP بشه، ممکنه تا AUTH_CACHE_TTL_MS طول
// بکشه که تغییرش روی چپترهای قفل اعمال بشه - این یه trade-off عمدیه.
const AUTH_CACHE_TTL_MS = 90 * 1000; // ۹۰ ثانیه
const AUTH_CACHE_MAX_ENTRIES = 5000;
const authCache = new Map(); // accessToken -> { user, isVip, expiresAt }

async function getAuthContext(accessToken) {
  const cached = authCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user || !user.id) return null;

  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_vip,vip_until`,
    { headers: supabaseAdminHeaders(), signal: AbortSignal.timeout(10_000) }
  );
  // اگه خواندن پروفایل خطا داد، نباید «غیر VIP» رو ۹۰ ثانیه کش کنیم (کاربر VIP
  // قفل می‌شد). throw می‌کنیم تا هیچ چیزی کش نشه.
  if (!profRes.ok) throw new Error(`profiles ${profRes.status}`);
  const profRows = await profRes.json();
  // فقط is_vip کافی نیست: هیچ‌جا (سمت سرور) is_vip بعد از انقضا false نمی‌شه، و
  // فرانت هم جدا vip_until رو چک می‌کنه. پس اشتراک منقضی‌شده باید اینجا هم رد بشه.
  const prof = Array.isArray(profRows) ? profRows[0] : null;
  const vipUntilMs = prof?.vip_until ? new Date(prof.vip_until).getTime() : null;
  const isVip = !!prof?.is_vip && (vipUntilMs === null || (Number.isFinite(vipUntilMs) && vipUntilMs > Date.now()));

  const tokenExp = jwtExpiryMs(accessToken);
  const result = {
    user,
    isVip,
    // کش هیچ‌وقت از عمر توکن یا از لحظه‌ی انقضای اشتراک بیشتر نمی‌شه
    expiresAt: Math.min(Date.now() + AUTH_CACHE_TTL_MS, tokenExp ?? Infinity, isVip && vipUntilMs ? vipUntilMs : Infinity),
  };
  authCache.set(accessToken, result);
  while (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    authCache.delete(authCache.keys().next().value);
  }
  return result;
}

// 💡 رفع گپِ ۹۰ ثانیه‌ای «خریدم ولی فعال نشد»: authCache با accessToken
// کلید می‌شه، نه userId - پس اگه همین الان یک کاربر VIP بشه، نمی‌تونیم
// مستقیم authCache.delete(accessToken) بزنیم چون توی verifyAndCreditPayment
// (که هم از روت /purchase/verify صدا زده می‌شه، هم از reconcilePendingPayments
// پس‌زمینه) اصلاً accessToken در دسترس نیست - فقط userId (از رکورد
// payments) رو داریم. به همین خاطر روی همه‌ی ورودی‌های authCache می‌گردیم
// و هر کدوم که متعلق به همین userId باشه رو پاک می‌کنیم. authCache حداکثر
// AUTH_CACHE_MAX_ENTRIES (۵۰۰۰) ورودی داره، پس این پیمایش خطی فقط همون
// لحظه‌ی نادرِ «یک نفر تازه VIP شد» اتفاق می‌افته، نه روی مسیر پرترافیک
// خوندن چپتر - هزینه‌ش ناچیزه.
//
// نتیجه: بلافاصله بعد از تایید موفق پرداخت (چه کلاینت verify رو صدا زده
// باشه، چه job پس‌زمینه)، دفعه‌ی بعدی که همون کاربر با همون accessToken
// یک چپتر VIP رو باز کنه، getAuthContext مجبور می‌شه دوباره از Supabase
// بپرسه و is_vip تازه رو می‌بینه - به‌جای این‌که تا ۹۰ ثانیه صبر کنه.
function invalidateAuthCacheForUser(userId) {
  if (!userId) return;
  for (const [token, entry] of authCache.entries()) {
    if (entry?.user?.id === userId) {
      authCache.delete(token);
    }
  }
}

// ---------- بخش ۳٫۵: ثبت‌نام با OTP پیامکی (شماره موبایل) ----------
// این بخش یک روش ثبت‌نام دوم، موازی با ثبت‌نام ایمیلی بالا، اضافه می‌کنه.
// نکته‌ی طراحی مهم: به‌جای فعال کردن Phone Auth خودِ Supabase (که نیازمند
// تنظیم یک SMS Provider یا Auth Hook در پنل Supabase است و دقیقاً همون
// مشکل رله‌ی پرداخت زیبال رو تکرار می‌کنه - چون Supabase از ایران رد
// نمی‌شه و فراخوانی مستقیم ippanel از سمت زیرساخت Supabase قابل‌اتکا
// نیست)، کل چرخه‌ی OTP (تولید، ارسال با ippanel، تایید) رو خودِ همین
// سرور Node - که همین الان با موفقیت به زیبال هم وصل می‌شه - انجام
// می‌ده. فقط بعد از تایید موفق کد، با SERVICE_ROLE_KEY یک کاربر
// از قبل تایید‌شده (phone_confirm: true) مستقیم توی Supabase می‌سازیم -
// دقیقاً هم‌سطح امنیتی سیستم OTP خودِ Supabase، بدون وابستگی بهش.
const { checkIpRateLimit, createOtp, discardOtp, verifyOtp, issueVerifiedTicket, checkVerifiedTicket, consumeVerifiedTicket, OtpRateLimitError } = require("./lib/otpStore");
const { sendOtpSms, SmsSendError } = require("./lib/smsProvider");
const { normalizeIranPhone, toEnglishDigits } = require("./lib/phone");

// ---------- کپچا و محافظ شارژ پنل پیامک ----------
const captcha = require("./lib/captcha");
const smsGuard = require("./lib/smsGuard");

// تصویر کپچا (یک‌بار مصرف، ۳ دقیقه اعتبار). سقف IP برای جلوگیری از پر کردن حافظه.
app.get("/api/captcha", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(`captcha-ip:${req.ip}`, { maxBurst: 15, maxSustained: 60 });
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);
  res.setHeader("Cache-Control", "no-store");
  return res.json(captcha.generate());
});

// keep=true → اگه جواب درست بود کپچا نسوزه (برای مرحله‌ی بررسی اولیه)
function requireCaptcha(req, res, { keep = false } = {}) {
  const { captchaId, captchaAnswer } = req.body || {};
  if (!captcha.verify(captchaId, captchaAnswer, keep)) {
    res.status(400).json({
      error: "کد امنیتی اشتباه یا منقضی است. کد جدید را وارد کن.",
      code: "CAPTCHA_INVALID",
    });
    return false;
  }
  return true;
}

// پیدا کردن کاربر Supabase با شماره یا ایمیل (تابع SQL: supabase_find_auth_user.sql)
async function findAuthUser({ phone = null, email = null }) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_auth_user`, {
    method: "POST",
    headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ p_phone: phone, p_email: email }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`find_auth_user ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

app.post("/api/otp/request", async (req, res) => {
  const phone = normalizeIranPhone((req.body || {}).phone);
  if (!phone) {
    return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
  }

  // کپچا قبل از هر کار پرهزینه‌ای (لوکاپ Supabase / پیامک)
  if (!requireCaptcha(req, res)) return;

  try {
    checkIpRateLimit(req.ip);

    // کاربری که قبلاً ثبت‌نام کرده اصلاً کد نمی‌گیره (نه پیامک، نه هزینه):
    // قبل از createOtp/sendOtpSms چک می‌کنیم. اگه چک ناموفق باشه (مثلاً تابع
    // SQL ساخته نشده) عمداً fail-closed می‌شیم تا پیامک بی‌جهت نره.
    let existingUser;
    try {
      existingUser = await findAuthUser({ phone });
    } catch (lookupErr) {
      console.error("[otp/request] بررسی وجود کاربر ناموفق بود:", lookupErr.message);
      return res.status(503).json({ error: "سرویس موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید." });
    }
    if (existingUser) {
      return res.status(409).json({
        error: "شما قبلاً ثبت‌نام کرده‌اید. برای ورود رمز عبورتان را وارد کنید (در صورت فراموشی از «فراموشی رمز عبور» استفاده کنید).",
        code: "PHONE_ALREADY_REGISTERED",
      });
    }

    // سهمیه‌ی پیامک (۲ بار در ساعت برای هر شماره + بلاک + سقف روزانه) - قبل از createOtp
    const smsSlot = smsGuard.reserve(phone, req.ip);
    let code, resendAfterSeconds;
    try {
      ({ code, resendAfterSeconds } = createOtp(phone));
    } catch (otpErr) {
      smsSlot.release();
      throw otpErr;
    }

    try {
      await sendOtpSms(phone, code);
    } catch (sendErr) {
      smsSlot.release(); // پیامک نرفت → سهمیه‌ی کاربر نسوزه
      // اگه پیامک واقعاً نرسید، رکورد رو پاک می‌کنیم که کاربر مجبور نشه
      // برای کدی که هیچ‌وقت بهش نرسیده، ۹۰ ثانیه صبر کنه.
      discardOtp(phone);
      const status = sendErr instanceof SmsSendError ? 502 : 500;
      console.error("[otp/request] ارسال پیامک شکست خورد:", sendErr.message, sendErr.details || "");
      return res.status(status).json({
        error: sendErr instanceof SmsSendError && sendErr.message ? sendErr.message : "ارسال پیامک ناموفق بود.",
      });
    }

    return res.json({ ok: true, resendAfterSeconds });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
      return res.status(429).json({ error: err.message, retryAfterSeconds: err.retryAfterSeconds });
    }
    console.error("[otp/request] خطای غیرمنتظره:", err);
    return res.status(500).json({ error: "خطای داخلی سرور." });
  }
});

// سقف IP برای مسیرهای verify و register (همون limiter مسیرهای خرید). سقف
// «تعداد تلاش برای هر شماره» جدا و داخل verifyOtp اعمال می‌شه؛ این لایه
// جلوی حدس زدن کد روی شماره‌های مختلف از یک IP رو می‌گیره.
const OTP_VERIFY_IP_LIMITS = { maxBurst: 10, maxSustained: 40 };
const REGISTER_PHONE_IP_LIMITS = { maxBurst: 5, maxSustained: 15 };

app.post("/api/otp/verify", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(
    `otp-verify-ip:${req.ip}`,
    OTP_VERIFY_IP_LIMITS
  );
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const phone = normalizeIranPhone((req.body || {}).phone);
  if (!phone) {
    return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
  }
  // همیشه string + ارقام فارسی/عربی → انگلیسی (قبلاً کد با ارقام فارسی رد
  // می‌شد، و اگه code عدد یا آبجکت بود verifyOtp با خطا کرش می‌کرد)
  const code = toEnglishDigits((req.body || {}).code).trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "کد تایید باید ۶ رقم باشد." });
  }

  const result = verifyOtp(phone, code);
  if (!result.ok) {
    return res.status(400).json({ error: result.error, attemptsLeft: result.attemptsLeft });
  }

  const ticket = issueVerifiedTicket(phone);
  return res.json({ ok: true, ticket });
});

app.post("/api/register/phone", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(
    `register-phone-ip:${req.ip}`,
    REGISTER_PHONE_IP_LIMITS
  );
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const { fullName, ticket } = req.body || {};
  const phone = normalizeIranPhone((req.body || {}).phone);
  // همیشه string (قبلاً آرایه/آبجکت هم رد می‌شد و خام به Supabase می‌رفت)
  // و سقف ۷۲ کاراکتر مثل مسیر ریست رمز
  const password = typeof (req.body || {}).password === "string" ? req.body.password : "";

  if (!phone) {
    return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: "رمز عبور باید بین ۶ تا ۷۲ کاراکتر باشد." });
  }
  if (!checkVerifiedTicket(ticket, phone)) {
    return res.status(401).json({
      error: "ابتدا باید شماره موبایل با کد تایید شود (یا زمان تاییدت منقضی شده).",
      code: "PHONE_NOT_VERIFIED",
    });
  }

  try {
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        phone,
        password,
        phone_confirm: true, // چون خودمون همین الان با ippanel تاییدش کردیم
        user_metadata: { full_name: (fullName || "").toString().trim().slice(0, 100) },
      }),
    });
    const createData = await createRes.json();

    if (!createRes.ok) {
      const msg = (createData?.msg || createData?.message || createData?.error_description || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return res.status(409).json({
          error: "این شماره قبلاً ثبت‌نام شده. برای ورود، رمز عبورت را وارد کن.",
          code: "PHONE_ALREADY_REGISTERED",
        });
      }
      console.error("[register/phone] خطای Supabase:", createRes.status, createData);
      return res.status(500).json({ error: "خطا در ساخت حساب کاربری." });
    }

    consumeVerifiedTicket(ticket); // تیکت یک‌بار مصرفه
    return res.json({ ok: true });
  } catch (err) {
    console.error("[register/phone] خطای غیرمنتظره:", err);
    return res.status(500).json({ error: "خطای داخلی سرور." });
  }
});

// ---------- بخش ۳٫۶: فراموشی رمز عبور (تایید با ایمیل) ----------
// قانون: بعد از اولین بازیابی، هیچ پیامکی برای فراموشی رمز ارسال نمی‌شه.
//  • حساب موبایلیِ بدون ایمیل تاییدشده (اولین بار): ایمیل → کد ایمیل → کد پیامک
//    (فقط برای اثبات مالکیت شماره و اتصال ایمیل به حساب) → رمز جدید.
//  • حساب با ایمیل تاییدشده: فقط کد به همون ایمیل → رمز جدید. هیچ پیامکی نمی‌ره.
const { sendOtpEmail, EmailSendError } = require("./lib/emailProvider");
const resetSessions = require("./lib/resetSessions");

const PW_RESET_IP_LIMITS = { maxBurst: 5, maxSustained: 20 };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(raw) {
  const e = String(raw ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}
function maskEmail(e) {
  const [local, domain] = e.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function sendResetEmailCode(email) {
  const { code, resendAfterSeconds } = createOtp(`pr-email:${email}`);
  try {
    await sendOtpEmail(email, code);
  } catch (e) {
    discardOtp(`pr-email:${email}`);
    throw e;
  }
  return resendAfterSeconds;
}
async function sendResetSmsCode(phone, ip) {
  const slot = smsGuard.reserve(phone, ip); // همون سهمیه/بلاک/سقف روزانه‌ی ثبت‌نام
  let code, resendAfterSeconds;
  try {
    ({ code, resendAfterSeconds } = createOtp(`pr-sms:${phone}`));
  } catch (e) {
    slot.release();
    throw e;
  }
  try {
    await sendOtpSms(phone, code);
  } catch (e) {
    slot.release();
    discardOtp(`pr-sms:${phone}`);
    throw e;
  }
  return resendAfterSeconds;
}

function handleResetError(res, err, tag, extra = {}) {
  if (err instanceof OtpRateLimitError) {
    res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(429).json({ error: err.message, retryAfterSeconds: err.retryAfterSeconds, ...extra });
  }
  if (err instanceof EmailSendError || err instanceof SmsSendError) {
    return res.status(502).json({ error: err.message, ...extra });
  }
  console.error(`[${tag}] خطای غیرمنتظره:`, err);
  return res.status(500).json({ error: "خطای داخلی سرور." });
}

function getResetSessionOr401(req, res) {
  const session = resetSessions.get((req.body || {}).sessionId);
  if (!session) {
    res.status(401).json({
      error: "نشست بازیابی منقضی شده. از اول شروع کن.",
      code: "RESET_SESSION_EXPIRED",
    });
    return null;
  }
  return session;
}

function readSixDigitCode(req, res) {
  const code = toEnglishDigits((req.body || {}).code).trim();
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "کد تایید باید ۶ رقم باشد." });
    return null;
  }
  return code;
}

// مرحله ۱: شماره (و در اولین بار ایمیل) → ارسال کد به ایمیل
app.post("/api/password/forgot/start", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(`pw-start-ip:${req.ip}`, PW_RESET_IP_LIMITS);
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const phone = normalizeIranPhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: "شماره موبایل معتبر نیست." });
  // keep: اگه سرور بگه «ایمیل لازمه»، کاربر مجبور نشه دوباره کپچا حل کنه
  if (!requireCaptcha(req, res, { keep: true })) return;

  try {
    const user = await findAuthUser({ phone });
    if (!user) {
      return res.status(404).json({
        error: "با این شماره ثبت‌نام انجام نشده است.",
        code: "PHONE_NOT_REGISTERED",
      });
    }

    const linkedEmail = user.email && user.email_confirmed_at ? String(user.email).toLowerCase() : null;
    let targetEmail = linkedEmail;
    let needsPhoneStep = false;

    if (!linkedEmail) {
      // اولین بازیابی: ایمیل لازمه (هنوز چیزی ارسال نمی‌کنیم)
      if (!(req.body || {}).email) return res.json({ ok: true, needsEmail: true });
      const email = normalizeEmail(req.body.email);
      if (!email) return res.status(400).json({ error: "ایمیل معتبر نیست." });
      const other = await findAuthUser({ email });
      if (other && other.id !== user.id) {
        return res.status(409).json({
          error: "این ایمیل قبلاً برای حساب دیگری استفاده شده است.",
          code: "EMAIL_IN_USE",
        });
      }
      targetEmail = email;
      needsPhoneStep = true;
    }

    // سقف تعداد شروع بازیابی برای هر شماره (جلوگیری از ایمیل‌بمبارانِ ایمیل‌های دلخواه)
    captcha.consume((req.body || {}).captchaId); // از اینجا به بعد ارسال واقعی انجام می‌شه
    checkIpRateLimit(`pw-phone:${phone}`);
    const resendAfterSeconds = await sendResetEmailCode(targetEmail);
    const sessionId = resetSessions.create({ userId: user.id, phone, email: targetEmail, needsPhoneStep });

    return res.json({
      ok: true,
      sessionId,
      emailHint: maskEmail(targetEmail),
      needsPhoneStep,
      resendAfterSeconds,
    });
  } catch (err) {
    return handleResetError(res, err, "password/start");
  }
});

// مرحله ۲: تایید کد ایمیل (و فقط در اولین بار، ارسال کد پیامک)
app.post("/api/password/forgot/verify-email", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(`pw-verify-ip:${req.ip}`, OTP_VERIFY_IP_LIMITS);
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const session = getResetSessionOr401(req, res);
  if (!session) return;
  const code = readSixDigitCode(req, res);
  if (!code) return;

  // ایمیل قبلاً تایید شده: فقط وضعیت رو برمی‌گردونیم. قبلاً هر تکرار این
  // endpoint (با هر کد دلخواه) یک پیامک جدید می‌فرستاد؛ ارسال مجدد فقط از /resend.
  if (session.emailVerified) {
    const next = session.needsPhoneStep && !session.phoneVerified ? "phone" : "password";
    return res.json({ ok: true, nextStep: next });
  }

  const result = verifyOtp(`pr-email:${session.email}`, code);
  if (!result.ok) return res.status(400).json({ error: result.error, attemptsLeft: result.attemptsLeft });
  session.emailVerified = true;

  if (!session.needsPhoneStep) return res.json({ ok: true, nextStep: "password" });

  try {
    const resendAfterSeconds = await sendResetSmsCode(session.phone, req.ip);
    return res.json({ ok: true, nextStep: "phone", resendAfterSeconds });
  } catch (err) {
    // ایمیل تایید شده؛ کاربر می‌تونه با /resend (channel: "sms") دوباره پیامک بگیره
    return handleResetError(res, err, "password/verify-email", { emailVerified: true, nextStep: "phone" });
  }
});

// ارسال مجدد کد
app.post("/api/password/forgot/resend", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(`pw-start-ip:${req.ip}`, PW_RESET_IP_LIMITS);
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const session = getResetSessionOr401(req, res);
  if (!session) return;
  if (!requireCaptcha(req, res)) return;
  const channel = (req.body || {}).channel;

  try {
    if (channel === "email" && !session.emailVerified) {
      const resendAfterSeconds = await sendResetEmailCode(session.email);
      return res.json({ ok: true, resendAfterSeconds });
    }
    // پیامک فقط برای اولین بازیابی و فقط بعد از تایید ایمیل مجازه
    if (channel === "sms" && session.needsPhoneStep && session.emailVerified && !session.phoneVerified) {
      const resendAfterSeconds = await sendResetSmsCode(session.phone, req.ip);
      return res.json({ ok: true, resendAfterSeconds });
    }
    return res.status(400).json({ error: "درخواست نامعتبر است." });
  } catch (err) {
    return handleResetError(res, err, "password/resend");
  }
});

// مرحله ۳ (فقط اولین بار): تایید کد پیامک
app.post("/api/password/forgot/verify-phone", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(`pw-verify-ip:${req.ip}`, OTP_VERIFY_IP_LIMITS);
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const session = getResetSessionOr401(req, res);
  if (!session) return;
  if (!session.needsPhoneStep || !session.emailVerified) {
    return res.status(400).json({ error: "درخواست نامعتبر است." });
  }
  const code = readSixDigitCode(req, res);
  if (!code) return;

  const result = verifyOtp(`pr-sms:${session.phone}`, code);
  if (!result.ok) return res.status(400).json({ error: result.error, attemptsLeft: result.attemptsLeft });

  session.phoneVerified = true;
  return res.json({ ok: true, nextStep: "password" });
});

// مرحله آخر: تعیین رمز جدید (و در اولین بار، اتصال ایمیل تاییدشده به حساب)
app.post("/api/password/forgot/reset", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(`pw-reset-ip:${req.ip}`, REGISTER_PHONE_IP_LIMITS);
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const session = getResetSessionOr401(req, res);
  if (!session) return;

  const ready = session.emailVerified && (!session.needsPhoneStep || session.phoneVerified);
  if (!ready) {
    return res.status(403).json({ error: "مراحل تایید کامل نشده است.", code: "RESET_NOT_VERIFIED" });
  }

  const password = String((req.body || {}).password ?? "");
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: "رمز عبور باید بین ۶ تا ۷۲ کاراکتر باشد." });
  }

  try {
    const update = { password };
    if (session.needsPhoneStep) {
      update.email = session.email;
      update.email_confirm = true; // خودمون همین الان تاییدش کردیم
    }
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${session.userId}`, {
      method: "PUT",
      headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data?.msg || data?.message || data?.error_description || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return res.status(409).json({ error: "این ایمیل قبلاً برای حساب دیگری استفاده شده است.", code: "EMAIL_IN_USE" });
      }
      console.error("[password/reset] خطای Supabase:", r.status, data);
      return res.status(500).json({ error: "خطا در تغییر رمز عبور." });
    }

    resetSessions.remove((req.body || {}).sessionId); // یک‌بار مصرف
    return res.json({ ok: true });
  } catch (err) {
    console.error("[password/reset] خطای غیرمنتظره:", err);
    return res.status(500).json({ error: "خطای داخلی سرور." });
  }
});

// جلوگیری از اسپم درگاه پرداخت/دیتابیس: قبلاً این مسیر هیچ سقفی نداشت،
// یعنی یک اسکریپت می‌تونست هزاران بار صداش بزنه، هر بار یک درخواست به
// Zibal بزنه و یک ردیف pending تو payments بسازه. دو لایه‌ی جدا:
//  ۱) سقف روی IP، همون اول route - قبل از هر تماس شبکه‌ای - تا حتی
//     تلاش‌های ناموفق (accessToken نامعتبر و امثالش) هم رو دیسک/شبکه
//     بی‌رویه فشار نیارن.
//  ۲) سقف روی userId، بعد از احراز هویت - چون هدف اصلی، جلوگیری از یک
//     اکانت واقعی/لاگین‌شده‌ست که داره اسکریپتی می‌زنه، نه فقط IP (که
//     ممکنه پشت VPN/CGNAT مشترک باشه).
const PURCHASE_IP_LIMITS = { maxBurst: 6, maxSustained: 20 };
const PURCHASE_USER_LIMITS = { maxBurst: 3, maxSustained: 10 };

function purchaseRateLimited(res, result) {
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  const text =
    result.reason === "burst"
      ? "تعداد درخواست‌های شما زیاده. کمی صبر کنید و دوباره امتحان کنید."
      : "شما به سقف مجاز درخواست در این بازه‌ی زمانی رسیدید.";
  // هم message (مسیرهای خرید) هم error (مسیرهای ثبت‌نام/OTP که فرانت data.error می‌خونه)
  res.status(429).json({ message: text, error: text, retryAfterSeconds: result.retryAfterSeconds });
}

app.post("/purchase/request", async (req, res) => {
  try {
    const ipLimit = await checkAndRecordPurchaseRequest(
      `purchase-req-ip:${req.ip}`,
      PURCHASE_IP_LIMITS
    );
    if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!accessToken) {
      return res.status(401).json({ message: "برای خرید ابتدا وارد حساب شوید." });
    }

    const { planKey } = req.body || {};
    const plan = PLAN_DEFS[planKey];
    if (!plan) {
      return res.status(400).json({ message: "پلن انتخابی نامعتبر است." });
    }

    const user = await getUserFromAccessToken(accessToken);
    if (!user || !user.id) {
      return res.status(401).json({ message: "نشست کاربری نامعتبر است. دوباره وارد شوید." });
    }

    const userLimit = await checkAndRecordPurchaseRequest(
      `purchase-req-user:${user.id}`,
      PURCHASE_USER_LIMITS
    );
    if (!userLimit.allowed) return purchaseRateLimited(res, userLimit);

    const orderId = require("crypto").randomUUID();
    const zibalRes = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: ZIBAL_MERCHANT,
        amount: plan.amount,
        callbackUrl: PURCHASE_CALLBACK_URL,
        description: `اشتراک VIP مانهواچی - پلن ${planKey}`,
        orderId,
      }),
    });
    const zibalData = await zibalRes.json();

    if (zibalData.result !== 100) {
      throw new Error(zibalData.message || "خطا در ایجاد درگاه پرداخت.");
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: "POST",
      headers: supabaseAdminHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify([
        {
          user_id: user.id,
          plan_key: planKey,
          amount: plan.amount,
          status: "pending",
          track_id: String(zibalData.trackId),
        },
      ]),
    });
    if (!insertRes.ok) {
      throw new Error("ثبت تراکنش در پایگاه داده ناموفق بود: " + (await insertRes.text()));
    }

    res.json({ trackId: zibalData.trackId });
  } catch (err) {
    res.status(400).json({ message: err.message || "خطا در ایجاد درگاه پرداخت." });
  }
});

// ---------- منطق مشترک تایید+شارژ VIP ----------
// ⚠️ نکته‌ی کلیدی درباره‌ی باگ "بعضیا خریدن ولی فعال نشده":
// تا قبل از این تغییر، تنها راهی که این تابع اجرا می‌شد این بود که
// مرورگرِ کاربر با موفقیت به vip-verify.html برسه و fetch به این
// endpoint رو کامل انجام بده. یعنی اگه بین لحظه‌ی تایید پرداخت توسط
// زیبال/بانک و اجرای کامل اون fetch هر اتفاقی بیفته - قطعی اینترنت،
// بستن زودهنگام تب، بستن وب‌ویو داخل اینستاگرام/تلگرام، بلاک شدن
// اسکریپت توسط afilter/ad-block، کرش مرورگر موبایل، یا حتی رفرش
// کردن صفحه قبل از اتمام درخواست - پول از کاربر کم می‌شد ولی هیچ‌وقت
// سمت سرور verify صدا زده نمی‌شد و رکورد pending برای همیشه pending
// می‌موند. این تابع رو مستقل از request/response اکسپرس کردیم تا هم
// از روت زیر (تایید لحظه‌ای سمت کلاینت) و هم از یک job پس‌زمینه
// (reconcilePendingPayments پایین‌تر) صداش بزنیم؛ اون job هر چند
// دقیقه یک‌بار پرداخت‌های pending رو مستقل از مرورگر کاربر با
// استعلام زیبال چک و در صورت موفقیت VIP رو فعال می‌کنه.
async function verifyAndCreditPayment(trackId) {
  trackId = (trackId || "").toString();
  if (!trackId) {
    return { httpStatus: 400, body: { message: "کد پیگیری ارائه نشده است." } };
  }

  try {
    const zibalRes = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: ZIBAL_MERCHANT, trackId }),
    });
    const zibalData = await zibalRes.json();

    if (![100, 101, 201].includes(zibalData.result)) {
      const declineErr = new Error(`پرداخت تایید نشد (کد خطا: ${zibalData.result})`);
      declineErr.final = true; // زیبال قطعاً رد کرده - دیگه لازم نیست reconciler دوباره امتحان کنه
      throw declineErr;
    }
    // زیبال نتیجه‌ی 102 (trackId نامعتبر)، 201 (قبلاً تایید شده - بی‌ضرره،
    // پایین‌تر با claim اتمیک هندل می‌شه) و بقیه‌ی خطاها رو برمی‌گردونه.
    // کدهای واقعاً ناموفق (مثل انصراف کاربر یا خطای بانک) این‌جا throw
    // می‌کنن و توسط reconcilePendingPayments به‌عنوان "failed" علامت
    // زده می‌شن تا برای همیشه در حلقه‌ی retry نمونن.

    // 💡 رفع race condition: قبلاً اینجا اول با یک GET وضعیت رکورد چک
    // می‌شد و بعد جدا با PATCH آپدیت می‌شد. اگه دو تا ریکوئست verify با
    // همون trackId تقریباً هم‌زمان می‌رسیدن (مثلاً کاربر دوبار دکمه رو
    // می‌زد یا صفحه رو رفرش می‌کرد)، هر دو می‌تونستن رکورد رو با
    // status="pending" ببینن و هر دو VIP رو جدا تمدید کنن (دو برابر
    // اعتبار). حالا "claim" کردن رکورد با یک PATCH شرطی
    // (WHERE status=eq.pending) در پایگاه‌داده به‌صورت اتمیک انجام
    // می‌شه - این کوئری در سطح دیتابیس روی همون ردیف lock می‌گیره، پس
    // فقط یکی از دو ریکوئست هم‌زمان می‌تونه واقعاً match/آپدیت کنه.
    const claimRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}&status=eq.pending&select=*`,
      {
        method: "PATCH",
        headers: supabaseAdminHeaders({
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify({ status: "processing", ref_number: zibalData.refNumber }),
      }
    );
    if (!claimRes.ok) {
      throw new Error("خطا در قفل کردن تراکنش برای پردازش: " + (await claimRes.text()));
    }
    const claimedRows = await claimRes.json();
    let paymentRecord = claimedRows[0];

    if (!paymentRecord) {
      // یا رکورد اصلاً وجود نداره، یا یکی دیگه (یا همین ریکوئست تو یه
      // تلاش قبلی) قبلاً claim/تکمیلش کرده - وضعیت فعلی رو چک می‌کنیم
      // تا پیام درست بدیم، نه این‌که کور کورانه خطا بدیم.
      const existingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}&select=status,user_id`,
        { headers: supabaseAdminHeaders() }
      );
      const existingRows = await existingRes.json();
      const existing = existingRows[0];

      if (existing && (existing.status === "success" || existing.status === "processing")) {
        // اگه یک ریکوئست verify دیگه (یا reconciler) دقیقاً هم‌زمان داره
        // همین trackId رو claim/تکمیل می‌کنه، بازم بی‌ضرره authCache رو
        // برای این کاربر پاک کنیم - چه الان چه چند لحظه‌ی دیگه تکمیل بشه.
        invalidateAuthCacheForUser(existing.user_id);
        return { httpStatus: 200, body: { status: 100, message: "تراکنش قبلاً ثبت شده است." } };
      }
      const notFoundErr = new Error("تراکنش مربوطه در دیتابیس پیدا نشد.");
      notFoundErr.final = true; // رکورد وجود نداره، retry هیچ‌وقت درستش نمی‌کنه
      throw notFoundErr;
    }

    try {
      const planKey = paymentRecord.plan_key;
      const duration = PLAN_DEFS[planKey];
      if (!duration) throw new Error("پلن ثبت‌شده برای این تراکنش نامعتبر است.");

      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${paymentRecord.user_id}&select=vip_until`,
        { headers: supabaseAdminHeaders() }
      );
      const profRows = await profRes.json();
      const profile = profRows[0];

      let currentVipDate = new Date();
      if (profile?.vip_until && new Date(profile.vip_until) > new Date()) {
        currentVipDate = new Date(profile.vip_until);
      }
      if (duration.days) currentVipDate.setDate(currentVipDate.getDate() + duration.days);
      if (duration.months) currentVipDate.setMonth(currentVipDate.getMonth() + duration.months);

      const updateProfRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${paymentRecord.user_id}`,
        {
          method: "PATCH",
          headers: supabaseAdminHeaders({
            "Content-Type": "application/json",
            // 🐛 باگ اصلی که احتمالاً پشتِ «عده‌ی زیادی خریدن ولی فعال
            // نشده» بود: بدون Prefer: return=representation، PostgREST
            // حتی وقتی هیچ ردیفی با این id پیدا نشه (مثلاً پروفایل کاربر
            // به هر دلیلی - تاخیر/شکست تریگرِ ساخت پروفایل موقع signup -
            // اصلاً وجود نداشته)، بازم HTTP 200/204 (یعنی res.ok === true)
            // برمی‌گردوند. کد قبلی فقط res.ok رو چک می‌کرد، پس این حالت
            // رو "موفق" حساب می‌کرد، پرداخت status="success" می‌شد، ولی
            // is_vip هیچ‌وقت واقعاً ست نمی‌شد چون ردیفی برای آپدیت نبود -
            // کاربر پول داده بود ولی برای همیشه (نه فقط چند دقیقه) قفل
            // می‌موند، و چون status دیگه "pending" نبود، حتی
            // reconcilePendingPayments هم دیگه هیچ‌وقت دوباره سراغش
            // نمی‌رفت.
            Prefer: "return=representation",
          }),
          body: JSON.stringify({
            is_vip: true,
            vip_until: currentVipDate.toISOString(),
          }),
        }
      );
      if (!updateProfRes.ok) throw new Error("بروزرسانی پروفایل کاربر ناموفق بود.");

      const updatedProfileRows = await updateProfRes.json();
      if (!Array.isArray(updatedProfileRows) || updatedProfileRows.length === 0) {
        // هیچ ردیفی match نشد یعنی پروفایل کاربر اصلاً وجود نداره - به‌جای
        // این‌که خطا بدیم و کاربر رو معطل reconcile بذاریم، همین‌جا با
        // upsert ردیف رو می‌سازیم تا اشتراک واقعاً و فوراً فعال بشه.
        // نکته: این فرض می‌کنه ستون id در جدول profiles کلید اصلی/یکتاست
        // (همون چیزی که برای resolution=merge-duplicates لازمه).
        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method: "POST",
          headers: supabaseAdminHeaders({
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation",
          }),
          body: JSON.stringify([
            {
              id: paymentRecord.user_id,
              is_vip: true,
              vip_until: currentVipDate.toISOString(),
            },
          ]),
        });
        if (!upsertRes.ok) {
          throw new Error(
            "پروفایل کاربر برای اعمال VIP پیدا نشد و ساخت (upsert) آن هم ناموفق بود: " +
              (await upsertRes.text())
          );
        }
        console.warn(
          `[VIP] پروفایل از پیش موجود برای userId=${paymentRecord.user_id} پیدا نشد؛ با upsert ساخته شد. این احتمالاً یعنی جایی در فرآیند signup پروفایل ساخته نمی‌شه - ارزش بررسی داره.`
        );
      }

      await fetch(`${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "success", ref_number: zibalData.refNumber }),
      });

      // VIP همین الان فعال شد - کش احراز هویتِ این کاربر رو پاک کن تا
      // درخواست بعدیِ چپتر قفل، بدون صبر برای انقضای AUTH_CACHE_TTL_MS،
      // وضعیت تازه رو ببینه.
      invalidateAuthCacheForUser(paymentRecord.user_id);

      return { httpStatus: 200, body: { status: 100, message: "اشتراک VIP با موفقیت فعال شد." } };
    } catch (creditErr) {
      // اگه بعد از claim کردن، جایی وسط کار (مثلاً آپدیت پروفایل) خطا
      // بخوره، رکورد رو به pending برمی‌گردونیم تا تو "processing" برای
      // همیشه گیر نکنه و بشه verify رو دوباره امتحان کرد.
      await fetch(`${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "pending" }),
      }).catch(() => {});
      throw creditErr;
    }
  } catch (err) {
    if (err.final) {
      // پرداخت قطعاً ناموفق بوده (رد شده توسط زیبال، یا اصلاً رکوردی
      // نیست) - وضعیت رو "failed" می‌کنیم تا reconciler برای همیشه
      // بی‌خودی سراغش نره. این PATCH فقط زمانی چیزی رو تغییر می‌ده که
      // رکورد هنوز pending باشه، پس رکوردهای success/processing رو دست
      // نمی‌زنه.
      await fetch(
        `${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}&status=eq.pending`,
        {
          method: "PATCH",
          headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ status: "failed" }),
        }
      ).catch(() => {});
    }
    return { httpStatus: 400, body: { message: err.message || "خطا در تایید اشتراک VIP" } };
  }
}

// ⚠️ این مسیر برخلاف /purchase/request هیچ accessToken نمی‌گیره (طراحی
// شده که از vip-verify.html بعد از برگشت از درگاه صدا زده بشه)، پس تنها
// سیگنالی که برای rate-limit در دسترسه IP هست - ولی همچنان لازمه، چون هر
// صدا زدن این route یک درخواست verify به Zibal + چند کوئری Supabase
// (claim/profile/update) رو trigger می‌کنه، حتی برای یک trackId جعلی/تصادفی.
const PURCHASE_VERIFY_IP_LIMITS = { maxBurst: 10, maxSustained: 40 };

app.post("/purchase/verify", async (req, res) => {
  const ipLimit = await checkAndRecordPurchaseRequest(
    `purchase-verify-ip:${req.ip}`,
    PURCHASE_VERIFY_IP_LIMITS
  );
  if (!ipLimit.allowed) return purchaseRateLimited(res, ipLimit);

  const trackId = (req.body && (req.body.trackId || req.body.track_id)) || "";
  const result = await verifyAndCreditPayment(trackId);
  res.status(result.httpStatus).json(result.body);
});

// ---------- Job پس‌زمینه: تسویه‌ی پرداخت‌های pending رهاشده ----------
// این همون رفعِ اصلیِ باگ "بعضیا خریدن ولی فعال نشد"ه: مستقل از این‌که
// مرورگر کاربر بعد از پرداخت به vip-verify.html برسه یا نه، هر چند
// دقیقه یک‌بار سراغ پرداخت‌های "pending" می‌ریم و با استعلام از زیبال
// (که بعد از پرداخت موفق، جدا از رفتار مرورگر کاربر، وضعیت واقعی
// تراکنش رو نگه می‌داره) خودمون verify/credit رو انجام می‌دیم.
// پنجره‌ی RECONCILE_MIN_AGE_MS باعث می‌شه به پرداخت‌هایی که همین الان
// ساخته شدن (کاربر داره تازه وارد درگاه می‌شه) دست نزنیم، چون هنوز
// پرداختی انجام نشده و زیبال به‌درستی نتیجه‌ی "ناموفق" برمی‌گردونه.
// RECONCILE_MAX_AGE_MS هم جلوی این رو می‌گیره که هر بار کل تاریخچه‌ی
// پرداخت‌های رهاشده‌ی قدیمی (که واقعاً هیچ‌وقت پرداخت نشدن) رو دوباره
// و دوباره از زیبال استعلام بگیریم.
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // هر ۵ دقیقه
const RECONCILE_MIN_AGE_MS = 3 * 60 * 1000; // حداقل ۳ دقیقه از ساخته‌شدنش گذشته باشه
const RECONCILE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // حداکثر تا ۳ روز قبل

async function reconcilePendingPayments() {
  try {
    const now = Date.now();
    const oldestIso = new Date(now - RECONCILE_MAX_AGE_MS).toISOString();
    const newestIso = new Date(now - RECONCILE_MIN_AGE_MS).toISOString();

    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?status=eq.pending&created_at=gte.${encodeURIComponent(
        oldestIso
      )}&created_at=lte.${encodeURIComponent(newestIso)}&select=track_id`,
      { headers: supabaseAdminHeaders() }
    );
    if (!pendingRes.ok) {
      console.error("reconcilePendingPayments: خطا در خواندن پرداخت‌های pending", await pendingRes.text());
      return;
    }
    const pendingRows = await pendingRes.json();
    if (!pendingRows.length) return;

    console.log(`reconcilePendingPayments: بررسی ${pendingRows.length} پرداخت pending رهاشده...`);
    for (const row of pendingRows) {
      try {
        const result = await verifyAndCreditPayment(row.track_id);
        console.log(
          `reconcilePendingPayments: trackId=${row.track_id} -> ${result.httpStatus} ${result.body?.message || ""}`
        );
      } catch (rowErr) {
        console.error(`reconcilePendingPayments: خطای غیرمنتظره روی trackId=${row.track_id}`, rowErr);
      }
    }
  } catch (err) {
    console.error("reconcilePendingPayments: خطای کلی", err);
  }
}

setInterval(reconcilePendingPayments, RECONCILE_INTERVAL_MS);
// یک بار هم کمی بعد از بالا اومدن سرور اجرا می‌شه (نه بلافاصله، تا
// startup رو کند نکنه).
setTimeout(reconcilePendingPayments, 30 * 1000);

// ---------- بخش ۴: رله‌ی قدیمی زیبال (نگه داشته شده برای سازگاری) ----------

const RELAY_SECRET = process.env.RELAY_SECRET;

function checkSecret(req, res, next) {
  const provided = req.headers["x-relay-secret"];
  if (!RELAY_SECRET || provided !== RELAY_SECRET) {
    return res.status(401).json({ error: "دسترسی غیرمجاز به رله" });
  }
  next();
}

app.post("/zibal/request", checkSecret, async (req, res) => {
  try {
    const response = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "خطا در ارتباط با زیبال", details: String(err) });
  }
});

app.post("/zibal/verify", checkSecret, async (req, res) => {
  try {
    const response = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "خطا در ارتباط با زیبال", details: String(err) });
  }
});

// ---------- بخش ۵: تصاویر چپتر (signed URL موقت از باکت پارس‌پک + کش) ----------
// منطق S3 به lib/chapterCache.js منتقل شد تا هم اینجا و هم پنل ادمین
// (برای دکمه‌ی "بررسی همگام‌سازی") از یک نمونه‌ی مشترک استفاده کنن.
const { buildSignedUrls } = require("./lib/chapterCache");

// جلوگیری از دانلود انبوه/اسکرپ چپترها - چه با یک اکانت VIP (کلید = userId)
// چه بدون لاگین روی چپترهای رایگان (کلید = IP). این جدا از کش پارس‌پک/Bunny
// عمل می‌کنه، چون اون کش فقط از فشار روی باکت جلوگیری می‌کنه، نه از این‌که
// یک نفر کل سایت رو با یک اشتراک بخونه/دانلود کنه.
// نکته: این توابع الان async هستن (همیشه Promise برمی‌گردونن) - اگه
// REDIS_URL در .env ست شده باشه، شمارش سقف‌ها روی Redis مشترک انجام می‌شه
// (چند instance/process رو هم پوشش می‌ده)؛ وگرنه به همون in-memory
// تک-سرورِ قبلی فال‌بک می‌کنه. جزئیات کامل بالای lib/chapterRateLimit.js.
const { checkAndRecordChapterRequest, checkAndRecordGuestChapterRequest } = require("./lib/chapterRateLimit");

// ---------- شناسه‌ی مهمان (guestId) برای rate limit چپترهای رایگان ----------
//
// چرا لازم شد: قبلاً کاربر مهمون فقط با IP شناسایی می‌شد. کاربرهای موبایل
// ایران معمولاً پشت CGNAT هستن، یعنی ده‌ها کاربر واقعی می‌تونن IP یکسان
// داشته باشن - چند نفر که هم‌زمان دارن چپتر رایگان می‌خونن به‌راحتی به سقف
// ۲۰ درخواست/دقیقه‌یِ همون IP می‌رسیدن و برای همه‌شون 429 می‌اومد، حتی برای
// کاربری که فقط عادی داره مانگا می‌خونه.
//
// راه‌حل: به هر مرورگرِ مهمون یک شناسه‌ی تصادفی (guestId) توی یک کوکی
// HttpOnly بلندمدت می‌دیم و همون رو - نه IP رو - به‌عنوان کلید اصلیِ
// rate limit به chapterRateLimit.js می‌دیم (جزئیات کامل همون‌جا کنار
// checkAndRecordGuestChapterRequest توضیح داده شده).
//
// از cookie-parser استفاده نکردیم تا یه وابستگی جدید اضافه نشه - پارس
// کردن هدر Cookie برای فقط یک کلید، چند خط ساده‌ست.
const crypto = require("crypto");

const GUEST_COOKIE_NAME = "mc_gid";
const GUEST_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // ۱۸۰ روز
const GUEST_ID_RE = /^[a-f0-9-]{36}$/i;

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  });
  return out;
}

// کوکی guestId حالا امضا (HMAC) داره: مقدارش "<uuid>.<signature>" ه و فقط
// وقتی معتبر حساب می‌شه که امضاش با GUEST_COOKIE_SECRET بخونه. قبلاً فقط
// فرمت UUID چک می‌شد، پس یک بات می‌تونست هر بار یک UUID تصادفی بفرسته و
// سقف per-guest رو کاملاً دور بزنه.
//
// خروجی: { guestId, isNew }
//   isNew=false -> کاربر کوکی معتبر داره؛ فقط با guestId خودش سنجیده می‌شه
//                  (و به سقف IP مشترکِ CGNAT دست نمی‌خوره).
//   isNew=true  -> کوکی نداشته/نامعتبر/جعلی بوده؛ یکی جدید ست می‌شه و این
//                  درخواست به سقف «بدون کوکی» روی IP شمرده می‌شه - همون
//                  چیزی که یک بات کوکی‌دور رو محدود می‌کنه.
//
// GUEST_COOKIE_SECRET رو تو .env ثابت کنید (openssl rand -hex 32). رو
// production اگه ست نشده باشه، سرور اصلاً بالا نمیاد (fail-fast، جزئیات
// تو lib/requireSecret.js)؛ رو dev فقط warn می‌ده و یک مقدار موقت می‌سازه -
// وگرنه با هر ری‌استارت همه‌ی کوکی‌های قبلی نامعتبر می‌شن (فقط یک‌بار کوکی
// جدید می‌گیرن).
const { requireSecret } = require("./lib/requireSecret");
const GUEST_SECRET = requireSecret(
  "GUEST_COOKIE_SECRET",
  "[guestId]",
  "با هر ری‌استارت، کوکی‌های مهمان‌ها نامعتبر می‌شن و سقف rate-limit مهمان‌ها دوباره صفر می‌شه."
);

function signGuestId(id) {
  return crypto
    .createHmac("sha256", GUEST_SECRET)
    .update(id)
    .digest("base64url")
    .slice(0, 22);
}

function readGuestId(req) {
  const raw = parseCookies(req)[GUEST_COOKIE_NAME];
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const id = raw.slice(0, dot);
  if (!GUEST_ID_RE.test(id)) return null;
  const a = Buffer.from(raw.slice(dot + 1));
  const b = Buffer.from(signGuestId(id));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function getOrSetGuestId(req, res) {
  const existing = readGuestId(req);
  if (existing) return { guestId: existing, isNew: false };

  const guestId = crypto.randomUUID();
  res.cookie(GUEST_COOKIE_NAME, `${guestId}.${signGuestId(guestId)}`, {
    maxAge: GUEST_COOKIE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
  return { guestId, isNew: true };
}

// خواندن اطلاعات یک چپتر مشخص از روی slug و شماره چپتر - از همون کش
// مشترک dataStore استفاده می‌کنه (دیگه فایل رو دوباره از دیسک نمی‌خونه).
function findEpisode(slug, chapterNum) {
  const data = getData();
  const manhwa = data[slug];
  if (!manhwa || !Array.isArray(manhwa.episodes)) {
    return null;
  }
  const numTarget = Number(chapterNum);
  return manhwa.episodes.find((ep) => Number(ep.num) === numTarget) || null;
}

app.post("/api/get-chapter-images", async (req, res) => {
  try {
    let { slug, chapterNum } = req.body || {};
if (chapterNum !== undefined && chapterNum !== null) {
  chapterNum = parseInt(chapterNum, 10);
}
    // نکته: چون چپتر شماره 0 هم معتبره، نباید با !chapterNum چک بشه
    if (!slug || chapterNum === undefined || chapterNum === null || chapterNum === "") {
      return res.status(400).json({ error: "پارامترهای ناقص" });
    }

    // ۱. چک وضعیت چپتر (رایگان یا قفل) از کش data.json
    const episode = findEpisode(slug, chapterNum);

    if (!episode) {
      console.warn(`چپتر پیدا نشد برای slug=${slug} num=${chapterNum}`);
      return res.status(404).json({ error: "چپتر پیدا نشد" });
    }

    // ۲. اگه رایگانه، بدون چک کاربر، URLها رو بده - ولی همچنان از نظر IP
    // محدود می‌کنیم، وگرنه چپترهای رایگان بی‌هیچ محدودیتی قابل اسکرپ می‌مونن.
    if (episode.free) {
      const { guestId, isNew } = getOrSetGuestId(req, res);
      const rl = await checkAndRecordGuestChapterRequest(guestId, req.ip, isNew);
      if (!rl.allowed) {
        // لاگ تشخیصی: نشون می‌ده 429 از سقف کدوم سطل (guest یا ip) اومده و
        // آیا req.ip واقعاً IP کاربره (ips / xff رو با هم مقایسه کن). اگه
        // ip همیشه 127.0.0.1 یا IP یک CDN بود، trust proxy/Nginx غلطه.
        console.warn("[RL-429]", {
          bucket: rl.bucket,
          reason: rl.reason,
          ip: req.ip,
          ips: req.ips,
          xff: req.headers["x-forwarded-for"],
          ua: (req.headers["user-agent"] || "").slice(0, 60),
          slug,
          chapterNum,
        });
        res.setHeader("Retry-After", String(rl.retryAfterSeconds));
        return res.status(429).json({
          error:
            rl.reason === "burst"
              ? "تعداد درخواست‌های شما در این دقیقه زیاده. کمی صبر کنید."
              : "شما به سقف مجاز خواندن چپتر در این ساعت رسیدید.",
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }

      const urls = await buildSignedUrls(slug, chapterNum, episode.images);
      if (urls.length === 0) {
        return res.status(404).json({ error: "تصاویری برای این چپتر یافت نشد یا هنوز آپلود نشده است." });
      }
      return res.json({ urls });
    }

    // ۳. چپتر VIP است -> باید کاربر لاگین و مشترک باشه
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!accessToken) {
      return res
        .status(401)
        .json({ error: "برای این قسمت باید وارد حساب شوید", code: "AUTH_REQUIRED" });
    }

    const authContext = await getAuthContext(accessToken);
    if (!authContext) {
      return res
        .status(401)
        .json({ error: "نشست شما نامعتبر است، دوباره وارد شوید", code: "AUTH_REQUIRED" });
    }

    if (!authContext.isVip) {
      return res
        .status(403)
        .json({ error: "این قسمت مخصوص کاربران VIP است", code: "VIP_REQUIRED" });
    }

    // ۳.۵ اینجاست که همون سناریوی نگران‌کننده رو می‌گیریم: یک اکانت VIP که
    // اسکریپتی/بات مستقیم به همین endpoint می‌زنه. کلید rate limit روی
    // userId ثابته - چون این اکانته که رفتار غیرعادی داره، نه IPش (که ممکنه
    // پشت VPN عوض بشه).
    const rl = await checkAndRecordChapterRequest(`user:${authContext.user.id}`);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSeconds));
      return res.status(429).json({
        error:
          rl.reason === "burst"
            ? "تعداد درخواست‌های شما در این دقیقه زیاده. کمی صبر کنید."
            : "شما به سقف مجاز خواندن چپتر در این ساعت رسیدید.",
        retryAfterSeconds: rl.retryAfterSeconds,
        code: "RATE_LIMITED",
      });
    }

    // ۴. کاربر مجازه -> URLهای امضاشده رو بده
    const urls = await buildSignedUrls(slug, chapterNum, episode.images);
    if (urls.length === 0) {
      return res.status(404).json({ error: "تصاویری برای این چپتر یافت نشد یا هنوز آپلود نشده است." });
    }
    return res.json({ urls });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "خطای داخلی سرور" });
  }
});

// ---------- دادن data.json به کلاینت (سمت مرورگر) به صورت امن ----------
// چون data.json بیرون از پوشه‌ی public قرار داره، مرورگر مستقیم بهش دسترسی نداره
// پس یک روت مشخص می‌سازیم که فقط همین فایل رو، فقط با متد GET، برمی‌گردونه.
// حالا این روت هم از همون کش مشترک dataStore استفاده می‌کنه، نه یک کش جدا.
app.get("/data/data.json", (req, res) => {
  res.type("application/json").send(getRawJson());
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`سرور روی پورت ${PORT} روشن شد`);
});

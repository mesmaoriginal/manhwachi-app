// server.js
// این فایل کارهای زیر رو انجام می‌دهد:
// ۱) نمایش فایل‌های استاتیک سایت (HTML/CSS) از پوشه‌ی public
// ۲) نمایش صفحه‌ی مانهوا (که قبلاً manga.php بود) با EJS - همان منطق PHP قبلی
// ۳) رله‌ی درخواست‌های پرداخت بین سایت و زیبال (چون Supabase از ایران رد نمی‌شود)
// ۴) تصاویر چپتر با signed URL موقت از باکت پارس‌پک، با کش برای جلوگیری از 429

const express = require("express");
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

// فشرده‌سازی gzip/brotli برای همه‌ی جواب‌ها (JSON، HTML، فایل‌های استاتیک).
// قبلاً وجود نداشت - یعنی همه‌چیز بدون فشرده‌سازی رد و بدل می‌شد.
app.use(compression());

app.use(express.json());
// ---------- میدل‌ور حالت بروزرسانی (مخصوص IPهای خاص) ----------
// 💡 آی‌پی خودتان را در متغیر زیر جایگزین کنید
const ALLOWED_IPS = [
  "5.239.172.3",  // آی‌پی شما (آی‌پی خودتان را اینجا بنویسید)
  "::1",           // دسترسی از طریق localhost
  "127.0.0.1"      // دسترسی محلی سرور
];

app.use((req, res, next) => {
  // گرفتن IP واقعی کاربر (با توجه به app.set("trust proxy", 1))
  const clientIp = req.ip || req.connection.remoteAddress;

  // ۱) اگر IP کاربر در لیست مجاز بود، اجازه ورود بده
  if (ALLOWED_IPS.includes(clientIp)) {
    return next();
  }

  // ۲) اجازه دسترسی به پنل ادمین (در صورت نیاز)
  if (req.path.startsWith('/admin')) {
    return next();
  }

  // ۳) اجازه بارگذاری فایل‌های استاتیک برای نمایش درست صفحه بروزرسانی (لوگو، فونت و...)
  if (
    req.path.startsWith('/ManhwaChi/') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.png') ||
    req.path.endsWith('.webp') ||
    req.path.endsWith('.ico')
  ) {
    return next();
  }

  // ۴) اگر کاربر در خود صفحه بروزرسانی است، بگذارید بماند (جلوگیری از حلقه هدایت)
  if (req.path === '/maintenance.html') {
    return next();
  }

  // ۵) هدایت تمام بقیه کاربران به صفحه بروزرسانی
  return res.redirect('/maintenance.html');
});
// ---------- پنل ادمین (مدیریت مانهواها و چپترها بدون ویرایش دستی data.json) ----------
const { router: adminRouter } = require("./admin/adminRouter");
app.use("/admin", adminRouter);

// ---------- تنظیمات EJS برای صفحه‌ی مانهوا ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---------- بخش ۱: نمایش سایت ----------
// maxAge اضافه شد تا مرورگر فایل‌های استاتیک (CSS/JS/فونت/عکس) رو کش کنه
// و مجبور نباشه هر بار دوباره از سرور دانلودشون کنه.
app.use(express.static("public", { maxAge: "7d", etag: true }));

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
  });
  if (!res.ok) return null;
  return res.json();
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
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_vip`,
    { headers: supabaseAdminHeaders() }
  );
  const profRows = await profRes.json();
  const isVip = !!profRows[0]?.is_vip;

  const result = { user, isVip, expiresAt: Date.now() + AUTH_CACHE_TTL_MS };
  authCache.set(accessToken, result);
  while (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    authCache.delete(authCache.keys().next().value);
  }
  return result;
}

app.post("/purchase/request", async (req, res) => {
  try {
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

app.post("/purchase/verify", async (req, res) => {
  try {
    const trackId = (req.body && (req.body.trackId || req.body.track_id) || "").toString();
    if (!trackId) throw new Error("کد پیگیری ارائه نشده است.");

    const zibalRes = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: ZIBAL_MERCHANT, trackId }),
    });
    const zibalData = await zibalRes.json();

    if (![100, 101, 201].includes(zibalData.result)) {
      throw new Error(`پرداخت تایید نشد (کد خطا: ${zibalData.result})`);
    }

    const payRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}&select=*`,
      { headers: supabaseAdminHeaders() }
    );
    const payRows = await payRes.json();
    const paymentRecord = payRows[0];
    if (!paymentRecord) throw new Error("تراکنش مربوطه در دیتابیس پیدا نشد.");

    if (paymentRecord.status === "success") {
      return res.json({ status: 100, message: "تراکنش قبلاً ثبت شده است." });
    }

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
        headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          is_vip: true,
          vip_until: currentVipDate.toISOString(),
        }),
      }
    );
    if (!updateProfRes.ok) throw new Error("بروزرسانی پروفایل کاربر ناموفق بود.");

    await fetch(`${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}`, {
      method: "PATCH",
      headers: supabaseAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status: "success", ref_number: zibalData.refNumber }),
    });

    res.json({ status: 100, message: "اشتراک VIP با موفقیت فعال شد." });
  } catch (err) {
    res.status(400).json({ message: err.message || "خطا در تایید اشتراک VIP" });
  }
});

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
const { checkAndRecordChapterRequest } = require("./lib/chapterRateLimit");

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
      const rl = checkAndRecordChapterRequest(`ip:${req.ip}`);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfterSeconds));
        return res.status(429).json({
          error:
            rl.reason === "burst"
              ? "تعداد درخواست‌های شما در این دقیقه زیاده. کمی صبر کنید."
              : "شما به سقف مجاز خواندن چپتر در این ساعت رسیدید.",
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }

      const urls = await buildSignedUrls(slug, chapterNum);
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
    const rl = checkAndRecordChapterRequest(`user:${authContext.user.id}`);
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
    const urls = await buildSignedUrls(slug, chapterNum);
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

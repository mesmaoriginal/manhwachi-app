// server.js
// این فایل سه کار انجام می‌دهد:
// ۱) نمایش فایل‌های استاتیک سایت (HTML/CSS) از پوشه‌ی public
// ۲) نمایش صفحه‌ی مانهوا (که قبلاً manga.php بود) با EJS - همان منطق PHP قبلی
// ۳) رله‌ی درخواست‌های پرداخت بین سایت و زیبال (چون Supabase از ایران رد نمی‌شود)

const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(express.json());

// ---------- تنظیمات EJS برای صفحه‌ی مانهوا ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---------- بخش ۱: نمایش سایت ----------
app.use(express.static("public"));

// ---------- بخش ۲: صفحه‌ی مانهوا (جایگزین manga.php + آدرس زیبای comic/) ----------
// این تابع منطق مشترک رندر صفحه‌ی مانهوا رو نگه می‌داره تا هم از مسیر
// قدیمی /manga.php?slug=... و هم مسیر جدید و زیبای /comic/:slug قابل استفاده باشه
function renderMangaPage(req, res, slugRaw) {
  const slug = (slugRaw || "").toString().trim();

  const jsonPath = path.join(__dirname, "data", "data.json");
  let data = {};
  try {
    if (fs.existsSync(jsonPath)) {
      data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    }
  } catch (err) {
    console.error("خطا در خواندن data.json:", err);
  }

  const manhwa = data[slug] || null;

  // تابع کمکی معادل strip_tags در PHP
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

    const has_locked = episodes.some((ep) => !ep.free);

    vars = {
      manhwa, slug, title_en, title_fa, origin, type,
      seo_title, seo_desc, raw_desc,
      cover_url, full_cover_url, canonical_url,
      score, scans_by, episodes, genres, has_locked,
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
    };
  }

  res.render("manga", vars);
}

// آدرس زیبا و اصلی (همونی که گوگل ایندکس کرده و کارت‌های سایت باید بهش لینک بدن)
app.get("/comic/:slug", (req, res) => {
  renderMangaPage(req, res, req.params.slug);
});

// آدرس قدیمی؛ برای سازگاری نگه داشته شده تا اگه جایی هنوز لینک قدیمی هست خراب نشه
app.get("/manga.php", (req, res) => {
  renderMangaPage(req, res, req.query.slug);
});

// ---------- بخش ۳: خرید VIP (مستقیم، بدون pg_net) ----------
// این بخش جایگزین Edge Function های zibal-request / zibal-verify شده.
// چون این اپ (روی پارس‌پک) خروجی آزاد داره، هم مستقیم به Supabase REST/Auth
// وصل میشه و هم مستقیم به زیبال - بدون واسطه‌ی Postgres/pg_net.

const SUPABASE_URL = process.env.SUPABASE_URL; // مثلا: https://vumnujygswotstvwljaz.supabase.co
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ZIBAL_MERCHANT = process.env.ZIBAL_MERCHANT;
const PURCHASE_CALLBACK_URL =
  process.env.PURCHASE_CALLBACK_URL || "https://manhwachi.ir/vip-verify.html";

// قیمت‌ها به ریال (زیبال مبلغ رو به ریال می‌گیره) + مدت هر پلن
// این اعداد باید دقیقا با قیمت‌های نمایش داده شده در vip.html یکی باشن
const PLAN_DEFS = {
  weekly: { amount: 250000, days: 7 },
  monthly: { amount: 550000, months: 1 },
  quarterly: { amount: 1500000, months: 3 },
};

// کمکی: هدرهای PostgREST با Service Role (فقط سمت سرور استفاده میشه)
function supabaseAdminHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

// کمکی: گرفتن کاربر از روی access_token با Supabase Auth API
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

// ۱) ساخت درخواست پرداخت
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

    // احراز هویت کاربر
    const user = await getUserFromAccessToken(accessToken);
    if (!user || !user.id) {
      return res.status(401).json({ message: "نشست کاربری نامعتبر است. دوباره وارد شوید." });
    }

    // نکته مهم: ستون track_id در جدول payments به صورت NOT NULL تعریف شده،
    // پس دیگه نمی‌تونیم اول یک رکورد بدون track_id بسازیم و بعدا اون رو
    // با PATCH پر کنیم (همون چیزی که باعث خطای 23502 می‌شد).
    // به همین دلیل ترتیب کار عوض شد:
    // ۱) اول تراکنش رو در زیبال می‌سازیم (با یک orderId موقت چون هنوز رکورد
    //    payments وجود نداره و id‌ای در کار نیست)
    // ۲) بعد، فقط در صورت موفقیت زیبال، رکورد payments رو یکجا و کامل
    //    (همراه با track_id) در دیتابیس ثبت می‌کنیم
    // این‌طوری اگه زیبال خطا بده، اصلا رکورد ناقص/یتیمی در دیتابیس ساخته نمیشه.

    const tempOrderId = `${user.id}-${Date.now()}`;

    // ساخت تراکنش در زیبال
    const zibalRes = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: ZIBAL_MERCHANT,
        amount: plan.amount,
        callbackUrl: PURCHASE_CALLBACK_URL,
        description: `اشتراک VIP مانهواچی - پلن ${planKey}`,
        orderId: tempOrderId,
      }),
    });
    const zibalData = await zibalRes.json();

    if (zibalData.result !== 100) {
      throw new Error(zibalData.message || "خطا در ایجاد درگاه پرداخت.");
    }

    // ثبت رکورد pending در جدول payments - این بار همراه با track_id
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

// ۲) تایید پرداخت و فعال‌سازی VIP
app.post("/purchase/verify", async (req, res) => {
  try {
    const trackId = (req.body && (req.body.trackId || req.body.track_id) || "").toString();
    if (!trackId) throw new Error("کد پیگیری ارائه نشده است.");

    // تایید از سمت زیبال
    const zibalRes = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: ZIBAL_MERCHANT, trackId }),
    });
    const zibalData = await zibalRes.json();

    // ۱۰۰ و ۱۰۱ یعنی موفق؛ ۲۰۱ یعنی قبلا verify شده (رفرش کاربر) - این هم موفقه
    if (![100, 101, 201].includes(zibalData.result)) {
      throw new Error(`پرداخت تایید نشد (کد خطا: ${zibalData.result})`);
    }

    // پیدا کردن رکورد تراکنش
    const payRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?track_id=eq.${encodeURIComponent(trackId)}&select=*`,
      { headers: supabaseAdminHeaders() }
    );
    const payRows = await payRes.json();
    const paymentRecord = payRows[0];
    if (!paymentRecord) throw new Error("تراکنش مربوطه در دیتابیس پیدا نشد.");

    // جلوگیری از تمدید تکراری (مثلا رفرش صفحه توسط کاربر)
    if (paymentRecord.status === "success") {
      return res.json({ status: 100, message: "تراکنش قبلاً ثبت شده است." });
    }

    // مدت اشتراک از روی جدول ثابت پلن‌ها، نه از ورودی کلاینت
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
      currentVipDate = new Date(profile.vip_until); // اگه هنوز VIP هست، به ادامه‌اش اضافه بشه
    }
    if (duration.days) currentVipDate.setDate(currentVipDate.getDate() + duration.days);
    if (duration.months) currentVipDate.setMonth(currentVipDate.getMonth() + duration.months);

    // فعال‌سازی VIP روی پروفایل
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

    // تغییر وضعیت تراکنش به موفق
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

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`سرور روی پورت ${PORT} روشن شد`);
});

// server.js
// این فایل کارهای زیر رو انجام می‌دهد:
// ۱) نمایش فایل‌های استاتیک سایت (HTML/CSS) از پوشه‌ی public
// ۲) نمایش صفحه‌ی مانهوا (که قبلاً manga.php بود) با EJS - همان منطق PHP قبلی
// ۳) رله‌ی درخواست‌های پرداخت بین سایت و زیبال (چون Supabase از ایران رد نمی‌شود)
// ۴) تصاویر چپتر با signed URL موقت از باکت پارس‌پک، با کش برای جلوگیری از 429

const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(express.json());

// ---------- پنل ادمین (مدیریت مانهواها و چپترها بدون ویرایش دستی data.json) ----------
const { router: adminRouter } = require("./admin/adminRouter");
app.use("/admin", adminRouter);

// ---------- تنظیمات EJS برای صفحه‌ی مانهوا ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---------- بخش ۱: نمایش سایت ----------
app.use(express.static("public"));

// ---------- بخش ۲: صفحه‌ی مانهوا (جایگزین manga.php + آدرس زیبای comic/) ----------
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

// خواندن data.json و پیدا کردن اطلاعات یک چپتر مشخص از روی slug و شماره چپتر
function findEpisodeFromJson(slug, chapterNum) {
  const jsonPath = path.join(__dirname, "data", "data.json");
  let data = {};
  try {
    if (fs.existsSync(jsonPath)) {
      data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    }
  } catch (err) {
    console.error("خطا در خواندن data.json:", err);
    return { readError: true };
  }

  const manhwa = data[slug];
  if (!manhwa || !Array.isArray(manhwa.episodes)) {
    return { episode: null };
  }

  const numTarget = Number(chapterNum);
  const episode = manhwa.episodes.find((ep) => Number(ep.num) === numTarget);
  return { episode: episode || null };
}

app.post("/api/get-chapter-images", async (req, res) => {
  try {
    const { slug, chapterNum } = req.body || {};

    // نکته: چون چپتر شماره 0 هم معتبره، نباید با !chapterNum چک بشه
    if (!slug || chapterNum === undefined || chapterNum === null || chapterNum === "") {
      return res.status(400).json({ error: "پارامترهای ناقص" });
    }

    // ۱. چک وضعیت چپتر (رایگان یا قفل) مستقیم از data.json
    const { episode, readError } = findEpisodeFromJson(slug, chapterNum);

    if (readError) {
      return res.status(500).json({ error: "خطا در خواندن اطلاعات مانهوا" });
    }

    if (!episode) {
      console.warn(`چپتر پیدا نشد برای slug=${slug} num=${chapterNum}`);
      return res.status(404).json({ error: "چپتر پیدا نشد" });
    }

    // ۲. اگه رایگانه، بدون چک کاربر، URLها رو بده
    if (episode.free) {
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

    const user = await getUserFromAccessToken(accessToken);
    if (!user || !user.id) {
      return res
        .status(401)
        .json({ error: "نشست شما نامعتبر است، دوباره وارد شوید", code: "AUTH_REQUIRED" });
    }

    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_vip`,
      { headers: supabaseAdminHeaders() }
    );
    const profRows = await profRes.json();
    const profile = profRows[0];

    if (!profile?.is_vip) {
      return res
        .status(403)
        .json({ error: "این قسمت مخصوص کاربران VIP است", code: "VIP_REQUIRED" });
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
// پس یک روت مشخص می‌سازیم که فقط همین فایل رو، فقط با متد GET، برمی‌گردونه
let cachedDataJson = null;

app.get("/data/data.json", (req, res) => {
  // اگه قبلاً کش شده، از کش برگردون (سرعت بالاتر، خوندن کمتر از دیسک)
  if (cachedDataJson) {
    return res.type("application/json").send(cachedDataJson);
  }

  // مسیر فایل رو خودِ کد مشخص می‌کنه، نه ورودی کاربر
  // پس امکان path traversal (مثل ../../etc/passwd) وجود نداره
  const jsonPath = path.join(__dirname, "data", "data.json");

  fs.readFile(jsonPath, "utf-8", (err, content) => {
    if (err) {
      console.error("خطا در خواندن data.json برای کلاینت:", err);
      return res.status(500).json({ error: "خطا در خواندن اطلاعات" });
    }
    cachedDataJson = content; // کش کردن برای درخواست‌های بعدی، تا از دیسک دوباره نخونه
    res.type("application/json").send(content);
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`سرور روی پورت ${PORT} روشن شد`);
});

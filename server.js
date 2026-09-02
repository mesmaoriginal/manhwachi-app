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

// ---------- بخش ۳: رله‌ی زیبال ----------

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

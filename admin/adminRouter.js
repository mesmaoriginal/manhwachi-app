// admin/adminRouter.js
//
// همه‌ی مسیرهای پنل ادمین زیر /admin مانت می‌شن (به server.js نگاه کن).
// احراز هویت: Basic Auth ساده با ADMIN_USER / ADMIN_PASS از env.
// (چیزی نصب نمی‌کنه، پکیج جدید نمی‌خواد، امن‌تر از رمز داخل کد.)

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { readData, updateData } = require("./dataStore");
const { invalidateChapterCache, listChapterFoldersFromS3, listChapterImageKeys } = require("../lib/chapterCache");
const {
  uploadPages,
  uploadCover,
  processPageImage,
  processCoverThumbnail,
  putObject,
  pageKey,
  coverKey,
  removeTempFile,
} = require("./imageUpload");

const router = express.Router();

// ---------- تاریخ شمسی امروز (بدون نیاز به پکیج جانبی) ----------
// الگوریتم استاندارد تبدیل میلادی به جلالی
function toJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm, jd;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return { jy, jm, jd };
}

function todayJalaliString() {
  const now = new Date();
  const { jy, jm, jd } = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const pad = (n) => String(n).padStart(2, "0");
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

// ---------- Basic Auth ----------
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function auth(req, res, next) {
  const USER = process.env.ADMIN_USER;
  const PASS = process.env.ADMIN_PASS;
  if (!USER || !PASS) {
    return res
      .status(500)
      .send("متغیرهای محیطی ADMIN_USER و ADMIN_PASS تنظیم نشده‌اند. پنل ادمین غیرفعال است.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="Manhwachi Admin"');
    return res.status(401).send("نیاز به ورود دارید.");
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return res.status(400).send("درخواست نامعتبر");
  }
  const idx = decoded.indexOf(":");
  const u = idx === -1 ? decoded : decoded.slice(0, idx);
  const p = idx === -1 ? "" : decoded.slice(idx + 1);

  if (safeEqual(u, USER) && safeEqual(p, PASS)) return next();

  res.set("WWW-Authenticate", 'Basic realm="Manhwachi Admin"');
  return res.status(401).send("نام کاربری یا رمز عبور اشتباه است.");
}

router.use(auth);

// ---------- صفحه‌ی پنل ----------
router.use(express.static(path.join(__dirname, "public")));

// ---------- API: لیست خلاصه‌ی مانهواها ----------
router.get("/api/manga", (req, res) => {
  const data = readData();
  const list = Object.entries(data).map(([slug, m]) => {
    const nums = Array.isArray(m.episodes) ? m.episodes.map((e) => Number(e.num)) : [];
    return {
      slug,
      title_fa: m.title_fa || "",
      title_en: m.title_en || "",
      cover_image: m.cover_image || "",
      is_vip: !!m.is_vip,
      release_date: m.release_date || "",
      episodeCount: nums.length,
      lastEpisode: nums.length ? Math.max(...nums) : null,
    };
  });
  res.json(list);
});

// ---------- API: جزئیات کامل یک مانهوا ----------
router.get("/api/manga/:slug", (req, res) => {
  const data = readData();
  const m = data[req.params.slug];
  if (!m) return res.status(404).json({ error: "مانهوا یافت نشد" });
  res.json({ slug: req.params.slug, ...m });
});

// ---------- API: ساخت مانهوای جدید ----------
router.post("/api/manga", async (req, res) => {
  try {
    const {
      slug, title_en, title_fa, origin, type,
      genres, score, is_vip, scans_by, description, cover_image, release_date,
    } = req.body || {};

    if (!slug || !/^[a-zA-Z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: "slug الزامی است و فقط باید شامل حروف انگلیسی، عدد و خط تیره باشد" });
    }
    if (!title_en) return res.status(400).json({ error: "title_en الزامی است" });

    await updateData((data) => {
      if (data[slug]) throw new Error("این slug قبلاً وجود دارد");
      data[slug] = {
        title_en,
        title_fa: title_fa || "",
        origin: origin || "کره ای",
        type: type || "مانهوا",
        genres: Array.isArray(genres)
          ? genres
          : (genres || "").split(",").map((s) => s.trim()).filter(Boolean),
        score: score || "0.0",
        is_vip: !!is_vip,
        scans_by: scans_by || "",
        description: description || "",
        cover_image: cover_image || "",
        release_date: release_date || "",
        episodes: [],
      };
    });
    res.json({ ok: true, slug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API: ویرایش اطلاعات مانهوا ----------
router.put("/api/manga/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const fields = req.body || {};
    const allowed = [
      "title_en", "title_fa", "origin", "type", "genres",
      "score", "is_vip", "scans_by", "description", "cover_image", "release_date",
    ];
    await updateData((data) => {
      if (!data[slug]) throw new Error("مانهوا یافت نشد");
      for (const key of allowed) {
        if (key in fields) {
          if (key === "genres" && typeof fields[key] === "string") {
            data[slug][key] = fields[key].split(",").map((s) => s.trim()).filter(Boolean);
          } else {
            data[slug][key] = fields[key];
          }
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API: حذف کامل یک مانهوا ----------
router.delete("/api/manga/:slug", async (req, res) => {
  try {
    await updateData((data) => {
      if (!data[req.params.slug]) throw new Error("مانهوا یافت نشد");
      delete data[req.params.slug];
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API: افزودن چپتر جدید ----------
// اگه num فرستاده نشه، خودش شماره‌ی بعدی رو حساب می‌کنه (max موجود + ۱)
// اگه date فرستاده نشه، تاریخ شمسی امروز رو می‌ذاره
//
// 💡 نکته‌ی مهم (اصلاح ساختاری): همین‌جا، یک‌بار برای همیشه، لیست واقعی
// فایل‌های این چپتر رو از S3 می‌گیریم و داخل خودِ data.json (فیلد images)
// ذخیره می‌کنیم. از این به بعد، هر بار کاربری این چپتر رو باز کنه، سرور
// دیگه لازم نیست ListObjectsV2 بزنه - مستقیم از همین لیست ذخیره‌شده امضا
// می‌کنه. این چیزیه که فشار روی پارس‌پک رو عملاً از بین می‌بره.
// اگه هنوز عکس‌ها آپلود نشده باشن یا S3 موقتاً در دسترس نباشه، چپتر رو
// بدون images ثبت می‌کنیم (سایت خراب نمی‌شه، فقط برای همون چپتر به‌صورت
// موقت به روش قدیمی - لیست زنده - fallback می‌شه)؛ بعداً می‌شه با
// endpoint زیر (resync-images) دوباره امتحان کرد.
router.post("/api/manga/:slug/episodes", async (req, res) => {
  try {
    const { slug } = req.params;
    let { num, date, free } = req.body || {};

    const snapshot = readData();
    const mSnapshot = snapshot[slug];
    if (!mSnapshot) throw new Error("مانهوا یافت نشد");

    if (num === undefined || num === null || num === "") {
      const episodesSnap = Array.isArray(mSnapshot.episodes) ? mSnapshot.episodes : [];
      const max = episodesSnap.length ? Math.max(...episodesSnap.map((e) => Number(e.num))) : 0;
      num = max + 1;
    }
    num = Number(num);
    if (Number.isNaN(num)) throw new Error("شماره چپتر نامعتبر است");

    let images = [];
    try {
      images = await listChapterImageKeys(slug, num);
      if (images.length === 0) {
        console.warn(
          `[admin] چپتر ${num} از ${slug} روی S3 هیچ فایلی نداشت - مطمئن شو عکس‌ها قبل از ثبت آپلود شدن.`
        );
      }
    } catch (listErr) {
      console.warn(
        `[admin] لیست‌کردن تصاویر چپتر ${num} از ${slug} ناموفق بود، چپتر بدون images ثبت می‌شه:`,
        listErr.message
      );
    }

    await updateData((data) => {
      const m = data[slug];
      if (!m) throw new Error("مانهوا یافت نشد");
      if (!Array.isArray(m.episodes)) m.episodes = [];

      if (m.episodes.some((e) => Number(e.num) === num)) {
        throw new Error(`چپتر ${num} از قبل در JSON موجود است`);
      }

      m.episodes.push({
        num,
        date: date || todayJalaliString(),
        free: free === undefined ? true : !!free,
        images,
      });
      m.episodes.sort((a, b) => Number(b.num) - Number(a.num));
    });

    res.json({ ok: true, num, imageCount: images.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API: آپلود مستقیم عکس‌های صفحات یک چپتر از پنل ادمین ----------
// جایگزینِ کاملِ آپلود دستی رو S3: ادمین فقط عکس‌ها رو از گوشی/کامپیوترش
// انتخاب می‌کنه، این endpoint اونا رو (به ترتیبی که فرستاده شدن) پردازش
// می‌کنه (کوچیک/فشرده اگه لازم بود)، با اسم‌های استاندارد (001.jpg,
// 002.jpg, ...) رو S3 آپلود می‌کنه، و خودش چپتر رو تو data.json ثبت یا
// (اگه از قبل بود) لیست images‌ش رو به‌روزرسانی می‌کنه - دقیقاً مثل اینکه
// از همون endpoint قدیمیِ افزودن چپتر استفاده شده باشه.
router.post("/api/manga/:slug/episodes/upload", uploadPages, async (req, res) => {
  const files = req.files || [];
  try {
    const { slug } = req.params;
    let { num, date, free } = req.body || {};

    if (!files.length) {
      return res.status(400).json({ error: "هیچ تصویری ارسال نشده" });
    }

    const snapshot = readData();
    const mSnapshot = snapshot[slug];
    if (!mSnapshot) throw new Error("مانهوا یافت نشد");

    if (num === undefined || num === null || num === "") {
      const episodesSnap = Array.isArray(mSnapshot.episodes) ? mSnapshot.episodes : [];
      const max = episodesSnap.length ? Math.max(...episodesSnap.map((e) => Number(e.num))) : 0;
      num = max + 1;
    }
    num = Number(num);
    if (Number.isNaN(num)) throw new Error("شماره چپتر نامعتبر است");

    // پردازش و آپلود یکی‌یکی (نه موازی) تا فشار حافظه/CPU سرور روی
    // چپترهای پرصفحه یک‌جا بالا نره.
    const keys = [];
    for (let i = 0; i < files.length; i++) {
      const processed = await processPageImage(files[i].path);
      const key = pageKey(slug, num, i);
      await putObject(key, processed, "image/jpeg");
      keys.push(key);
    }

    const freeBool = free === undefined ? true : free === "true" || free === true;

    await updateData((data) => {
      const m = data[slug];
      if (!m) throw new Error("مانهوا یافت نشد");
      if (!Array.isArray(m.episodes)) m.episodes = [];

      const existing = m.episodes.find((e) => Number(e.num) === num);
      if (existing) {
        existing.images = keys;
        if (date) existing.date = date;
        existing.free = freeBool;
      } else {
        m.episodes.push({
          num,
          date: date || todayJalaliString(),
          free: freeBool,
          images: keys,
        });
      }
      m.episodes.sort((a, b) => Number(b.num) - Number(a.num));
    });

    invalidateChapterCache(slug, num);

    res.json({ ok: true, num, imageCount: keys.length });
  } catch (err) {
    res.status(400).json({ error: "خطا در آپلود چپتر: " + err.message });
  } finally {
    await Promise.all(files.map((f) => removeTempFile(f.path)));
  }
});

// ---------- API: آپلود تصویر بندانگشتی (کاور) یک چپتر ----------
// همون تصویری که تو صفحه‌ی مانهوا کنار شماره‌ی هر اپیزود نشون داده می‌شه.
// نیازی به تغییر data.json نداره - manga.ejs مستقیم از روی الگوی اسم
// فایل (chapterpicture<شماره>.png) صداش می‌زنه.
router.post("/api/manga/:slug/episodes/:num/cover-image", uploadCover, async (req, res) => {
  try {
    const { slug, num } = req.params;
    const chapterNum = Number(num);
    if (Number.isNaN(chapterNum)) {
      return res.status(400).json({ error: "شماره چپتر نامعتبر است" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "فایلی ارسال نشده" });
    }

    const data = readData();
    if (!data[slug]) return res.status(404).json({ error: "مانهوا یافت نشد" });

    const processed = await processCoverThumbnail(req.file.path);
    await putObject(coverKey(slug, chapterNum), processed, "image/png");

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: "خطا در آپلود تصویر: " + err.message });
  } finally {
    if (req.file) await removeTempFile(req.file.path);
  }
});

// ---------- API: هم‌گام‌سازی دستی لیست تصاویر یک چپتر ----------
// برای دو حالت لازمه: ۱) چپترهای قدیمی که از قبل ثبت شدن و هنوز images
// ندارن (تا وقتی اسکریپت migration اجرا بشه)، ۲) وقتی صفحات یک چپتر رو
// بعداً جایگزین/اضافه کردی و لیست ذخیره‌شده دیگه با S3 هم‌خون نیست.
router.post("/api/manga/:slug/episodes/:num/resync-images", async (req, res) => {
  try {
    const { slug, num } = req.params;
    const chapterNum = Number(num);
    if (Number.isNaN(chapterNum)) {
      return res.status(400).json({ error: "شماره چپتر نامعتبر است" });
    }

    const images = await listChapterImageKeys(slug, chapterNum);
    if (images.length === 0) {
      return res.status(404).json({
        error: "هیچ فایلی برای این چپتر روی S3 پیدا نشد؛ آپلود رو چک کن.",
      });
    }

    await updateData((data) => {
      const m = data[slug];
      if (!m) throw new Error("مانهوا یافت نشد");
      const ep = (m.episodes || []).find((e) => Number(e.num) === chapterNum);
      if (!ep) throw new Error("چپتر یافت نشد");
      ep.images = images;
    });

    // چون لیست تصاویر عوض شده، هر لینک امضاشده‌ی قدیمی که تو کش مونده رو
    // هم پاک می‌کنیم تا کاربر بعدی حتماً لینک‌های تازه بگیره.
    invalidateChapterCache(slug, chapterNum);

    res.json({ ok: true, imageCount: images.length });
  } catch (err) {
    res.status(400).json({ error: "خطا در sync تصاویر: " + err.message });
  }
});

// ---------- API: ویرایش یک چپتر (تاریخ / رایگان یا VIP) ----------
router.put("/api/manga/:slug/episodes/:num", async (req, res) => {
  try {
    const { slug, num } = req.params;
    const { date, free } = req.body || {};
    await updateData((data) => {
      const m = data[slug];
      if (!m) throw new Error("مانهوا یافت نشد");
      const ep = (m.episodes || []).find((e) => Number(e.num) === Number(num));
      if (!ep) throw new Error("چپتر یافت نشد");
      if (date !== undefined) ep.date = date;
      if (free !== undefined) ep.free = !!free;
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API: حذف یک چپتر ----------
router.delete("/api/manga/:slug/episodes/:num", async (req, res) => {
  try {
    const { slug, num } = req.params;
    await updateData((data) => {
      const m = data[slug];
      if (!m) throw new Error("مانهوا یافت نشد");
      const before = (m.episodes || []).length;
      m.episodes = (m.episodes || []).filter((e) => Number(e.num) !== Number(num));
      if (m.episodes.length === before) throw new Error("چپتر یافت نشد");
    });
    invalidateChapterCache(slug, num);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API: بررسی همگام‌سازی JSON با S3 (راه‌حل اصلی دردسرت) ----------
// چپترهایی که آپلود کردی ولی تو JSON ثبت نکردی، و برعکس، رو نشون می‌ده
router.get("/api/sync-check/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const data = readData();
    const m = data[slug];
    if (!m) return res.status(404).json({ error: "مانهوا یافت نشد" });

    const s3Chapters = await listChapterFoldersFromS3(slug);
    const jsonChapters = (m.episodes || []).map((e) => Number(e.num)).sort((a, b) => a - b);

    const missingInJson = s3Chapters.filter((n) => !jsonChapters.includes(n));
    const missingInS3 = jsonChapters.filter((n) => !s3Chapters.includes(n));

    res.json({ s3Chapters, jsonChapters, missingInJson, missingInS3 });
  } catch (err) {
    res.status(500).json({ error: "خطا در ارتباط با S3: " + err.message });
  }
});

// ---------- API: پاک کردن دستی کش لینک‌های امضاشده یک چپتر ----------
router.post("/api/cache/invalidate", (req, res) => {
  const { slug, num } = req.body || {};
  if (!slug || num === undefined) return res.status(400).json({ error: "پارامتر ناقص" });
  invalidateChapterCache(slug, num);
  res.json({ ok: true });
});

module.exports = { router };
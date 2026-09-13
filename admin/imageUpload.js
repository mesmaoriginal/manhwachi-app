// admin/imageUpload.js
//
// آپلود عکس از پنل ادمین مستقیم به S3 (پارس‌پک) - بدون نیاز به آپلود دستی
// و بدون نگرانی از اسم فایل یا حجمش. دو نوع تصویر پشتیبانی می‌شه:
//
// ۱. تصاویر صفحات یک چپتر (چندتایی) -> با همون قرارداد فعلی سایت که
//    lib/chapterCache.js انتظارش رو داره: manhwas/<slug>/CH<num>/srcCH<num>/...
// ۲. تصویر بندانگشتی/کاور یک چپتر (تکی) -> همون چیزی که manga.ejs مستقیم
//    و با اسم ثابت صداش می‌زنه: manhwas/<slug>/chapterPictures/chapterpicture<num>.png
//
// اسم فایل نهایی رو خودِ این ماژول تعیین می‌کنه (ادمین لازم نیست به اسم
// فایلی که از گوشی/کامپیوترش انتخاب کرده دقت کنه) و قبل از آپلود با sharp
// پردازش می‌شه: اگه ابعاد خیلی بزرگ باشه کوچیک می‌شه، و اگه حجم بعد از
// فشرده‌سازی اولیه هنوز زیاد بود، کیفیت پله‌پله کم می‌شه تا به یک حجم
// هدف معقول برسه.
//
// چرا diskStorage و نه memoryStorage: یک چپتر ممکنه ده‌ها صفحه داشته
// باشه؛ اگه همه‌شون هم‌زمان تو RAM سرور نگه داشته بشن (memoryStorage)
// ممکنه فشار حافظه‌ی زیادی ایجاد کنه. با diskStorage، فایل‌های خام رو
// موقتاً روی دیسک می‌ذاریم و یکی‌یکی پردازش/آپلود/پاک می‌کنیم، پس اوج
// مصرف حافظه فقط برای یک تصویر در هر لحظه‌ست.

const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3 } = require("../lib/chapterCache");

const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

// ---------- محل موقت فایل‌های خام آپلودی ----------
const TMP_UPLOAD_DIR = path.join(os.tmpdir(), "manhwachi-admin-uploads");
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

// حداکثر حجم هر فایلِ خام (قبل از پردازش) - فقط برای جلوگیری از آپلود
// چیزهای عجیب‌وغریب حجیم، نه محدودیت نهایی (اون رو sharp حل می‌کنه).
const MAX_RAW_UPLOAD_BYTES = 30 * 1024 * 1024; // ۳۰ مگابایت

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || "").slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);
  },
});

function imagesOnlyFilter(req, file, cb) {
  if (!file.mimetype || !file.mimetype.startsWith("image/")) {
    return cb(new Error("فقط فایل تصویر مجاز است"));
  }
  cb(null, true);
}

const diskUpload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_RAW_UPLOAD_BYTES },
  fileFilter: imagesOnlyFilter,
});

// این‌ها میان‌افزار خام multer هستن؛ برای خطای تمیز به‌صورت JSON (به‌جای
// صفحه‌ی خطای پیش‌فرض Express)، تو adminRouter.js با wrapUpload صدا زده
// می‌شن، نه مستقیم.
const rawUploadPages = diskUpload.array("pages", 300);
const rawUploadCover = diskUpload.single("cover");

// میان‌افزار multer رو طوری می‌پیچه که خطاهاش (حجم زیاد، فرمت غلط و...)
// به‌جای صفحه‌ی HTML پیش‌فرض Express، به‌صورت JSON یکدست با بقیه‌ی API
// برگردونده بشه.
function wrapUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) return res.status(400).json({ error: "خطا در دریافت فایل: " + err.message });
      next();
    });
  };
}

async function removeTempFile(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // فایل موقت بود؛ اگه پاک نشد مهم نیست (بدترین حالت یک فایل اضافه تو tmp می‌مونه)
  }
}

// ---------- پردازش تصویر صفحه‌ی چپتر ----------
// حداکثر عرض معقول برای خوندن مانهوا؛ عریض‌تر از این فقط حجم رو زیاد
// می‌کنه بدون فایده‌ی بصری محسوس روی گوشی/مانیتور معمولی.
const PAGE_MAX_WIDTH = 1600;
// هدف: بعد از فشرده‌سازی، هر صفحه معمولاً زیر این حجم بمونه.
const PAGE_TARGET_BYTES = 1.2 * 1024 * 1024; // ۱٫۲ مگابایت
const JPEG_QUALITY_STEPS = [85, 78, 70, 60, 50];

async function processPageImage(filePath) {
  const meta = await sharp(filePath).metadata();
  const resizeOpt =
    meta.width && meta.width > PAGE_MAX_WIDTH ? { width: PAGE_MAX_WIDTH } : undefined;

  let out = await sharp(filePath)
    .rotate() // بر اساس EXIF درست می‌چرخونه (خیلی از عکس‌های موبایل EXIF چرخش دارن)
    .resize(resizeOpt)
    .jpeg({ quality: JPEG_QUALITY_STEPS[0], mozjpeg: true })
    .toBuffer();

  for (let i = 1; i < JPEG_QUALITY_STEPS.length && out.length > PAGE_TARGET_BYTES; i++) {
    out = await sharp(filePath)
      .rotate()
      .resize(resizeOpt)
      .jpeg({ quality: JPEG_QUALITY_STEPS[i], mozjpeg: true })
      .toBuffer();
  }

  return out;
}

// ---------- پردازش تصویر بندانگشتی/کاور چپتر ----------
// این فقط یک تامبنیل کوچیکه (تو صفحه‌ی مانهوا کنار شماره‌ی هر اپیزود نشون
// داده می‌شه)، پس عرض کوچیک کافیه. اسم فایل روی S3 باید دقیقاً با الگویی
// که manga.ejs هاردکد کرده (chapterpicture<num>.png) یکی باشه.
const COVER_MAX_WIDTH = 480;

async function processCoverThumbnail(filePath) {
  return sharp(filePath)
    .rotate()
    .resize({ width: COVER_MAX_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function putObject(key, buffer, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: PARSPACK_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

function pageKey(slug, chapterNum, index) {
  const padded = String(index + 1).padStart(3, "0");
  return `manhwas/${slug}/CH${chapterNum}/srcCH${chapterNum}/${padded}.jpg`;
}

function coverKey(slug, chapterNum) {
  return `manhwas/${slug}/chapterPictures/chapterpicture${chapterNum}.png`;
}

module.exports = {
  uploadPages: wrapUpload(rawUploadPages),
  uploadCover: wrapUpload(rawUploadCover),
  processPageImage,
  processCoverThumbnail,
  putObject,
  pageKey,
  coverKey,
  removeTempFile,
};

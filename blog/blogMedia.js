// blog/blogMedia.js
// آپلود تصویر وبلاگ به همان باکت پارس‌پک (کلیدها زیر blog/ هستن، جدا از manhwas/)
// و سرو عمومی آن‌ها از /blog-media/... با کش طولانی.
//
// تصویر با sharp به webp تبدیل و کوچک می‌شه (حداکثر عرض ۱۹۲۰). اسم فایل تصادفیه،
// پس اسم اصلی کاربر هیچ‌وقت وارد کلید نمی‌شه.

const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { s3 } = require("../lib/chapterCache");

const BUCKET = () => process.env.PARSPACK_BUCKET;
const TMP_DIR = path.join(os.tmpdir(), "manhwachi-blog-uploads");
fs.mkdirSync(TMP_DIR, { recursive: true });

const MAX_RAW_BYTES = 15 * 1024 * 1024;
const MAX_WIDTH = 1920;
// سقف تعداد پیکسل ورودی (کل فریم‌ها)؛ جلوی «بمب پیکسلی» و پر شدن رم سرور کوچک رو می‌گیره
const MAX_INPUT_PIXELS = 50_000_000;
const ALLOWED_MIME = /^image\/(jpeg|png|webp|gif|avif)$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString("hex")),
  }),
  limits: { fileSize: MAX_RAW_BYTES, files: 1 },
  fileFilter: (req, file, cb) =>
    ALLOWED_MIME.test(file.mimetype || "") ? cb(null, true) : cb(new Error("فقط تصویر JPG/PNG/WebP/GIF/AVIF مجاز است")),
}).single("file");

// خطاهای multer به‌صورت JSON برگردونده می‌شن
function uploadMiddleware(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "حجم فایل بیش از ۱۵ مگابایت است" : "خطا در دریافت فایل: " + err.message;
    res.status(400).json({ error: msg });
  });
}

// فایل خام رو پردازش و روی S3 می‌ذاره؛ فایل موقت همیشه پاک می‌شه.
async function storeImage(filePath) {
  try {
    let data, info;
    try {
      // GIF و WebP متحرک، متحرک می‌مونن (قبلاً فقط فریم اول ذخیره می‌شد)
      const meta = await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      const animated = (meta.pages || 1) > 1;
      let img = sharp(filePath, { animated, limitInputPixels: MAX_INPUT_PIXELS });
      if (!animated) img = img.rotate(); // اصلاح جهت EXIF
      ({ data, info } = await img
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true }));
    } catch (e) {
      // فایل خراب/غیرتصویر/بزرگ‌تر از سقف پیکسل: خطای کاربر است، نه خطای سرور
      throw Object.assign(new Error("فایل تصویر معتبر نیست یا ابعادش بیش از حد بزرگ است"), { userError: true });
    }

    const month = new Date().toISOString().slice(0, 7); // 2026-10
    const name = `${crypto.randomBytes(12).toString("hex")}.webp`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: `blog/${month}/${name}`,
        Body: data,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    // برای animated، ارتفاع کل = مجموع فریم‌هاست؛ ارتفاع واقعی هر فریم رو برمی‌گردونیم
    const height = info.pageHeight || info.height;
    return { url: `/blog-media/${month}/${name}`, width: info.width, height, bytes: data.length };
  } finally {
    fsp.unlink(filePath).catch(() => {});
  }
}

// ---------- سرو عمومی (در server.js مستقیم روی app مانت می‌شه، نه زیر /panel) ----------
const publicRouter = express.Router();
const KEY_RE = /^(\d{4}-\d{2})\/([a-f0-9]{24}\.webp)$/;

publicRouter.get("/blog-media/:month/:file", async (req, res) => {
  const m = KEY_RE.exec(`${req.params.month}/${req.params.file}`);
  if (!m) return res.status(404).end();
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: `blog/${m[1]}/${m[2]}` }));
    if (obj.ContentLength) res.set("Content-Length", String(obj.ContentLength));
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    obj.Body.on("error", () => res.destroy());
    obj.Body.pipe(res);
  } catch (e) {
    res.status(e?.name === "NoSuchKey" ? 404 : 502).end();
  }
});

module.exports = { uploadMiddleware, storeImage, publicRouter };

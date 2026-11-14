const os = require("os");

const fs = require("fs");

const fsp = require("fs/promises");

const path = require("path");

const multer = require("multer");

const sharp = require("sharp");

const {PutObjectCommand: PutObjectCommand, HeadObjectCommand: HeadObjectCommand} = require("@aws-sdk/client-s3");

const {s3: s3} = require("../lib/chapterCache");

const PARSPACK_BUCKET = process.env.PARSPACK_BUCKET;

const TMP_UPLOAD_DIR = path.join(os.tmpdir(), "manhwachi-admin-uploads");

fs.mkdirSync(TMP_UPLOAD_DIR, {
  recursive: true
});

function sweepTmpUploads() {
  fs.readdir(TMP_UPLOAD_DIR, (e, names) => {
    if (e) return;
    for (const n of names) {
      const f = path.join(TMP_UPLOAD_DIR, n);
      fs.stat(f, (er, st) => {
        if (!er && st.isFile() && Date.now() - st.mtimeMs > 30 * 60 * 1e3) fs.unlink(f, () => {});
      });
    }
  });
}

sweepTmpUploads();

setInterval(sweepTmpUploads, 10 * 60 * 1e3).unref();

const MAX_RAW_UPLOAD_BYTES = 30 * 1024 * 1024;

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || "").slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);
  }
});

function imagesOnlyFilter(req, file, cb) {
  if (!file.mimetype || !file.mimetype.startsWith("image/")) {
    return cb(new Error("فقط فایل تصویر مجاز است"));
  }
  cb(null, true);
}

const diskUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: MAX_RAW_UPLOAD_BYTES
  },
  fileFilter: imagesOnlyFilter
});

const rawUploadPage = diskUpload.single("page");

const rawUploadCover = diskUpload.single("cover");

function wrapUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, err => {
      if (err) return res.status(400).json({
        error: "خطا در دریافت فایل: " + err.message
      });
      next();
    });
  };
}

async function removeTempFile(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {}
}

const PAGE_MAX_WIDTH = 1600;

const PAGE_TARGET_BYTES = 1.2 * 1024 * 1024;

const JPEG_QUALITY_STEPS = [ 85, 78, 70, 60, 50 ];

async function processPageImage(filePath) {
  const meta = await sharp(filePath).metadata();
  const resizeOpt = meta.width && meta.width > PAGE_MAX_WIDTH ? {
    width: PAGE_MAX_WIDTH
  } : undefined;
  let out = await sharp(filePath).rotate().resize(resizeOpt).jpeg({
    quality: JPEG_QUALITY_STEPS[0],
    mozjpeg: true
  }).toBuffer();
  for (let i = 1; i < JPEG_QUALITY_STEPS.length && out.length > PAGE_TARGET_BYTES; i++) {
    out = await sharp(filePath).rotate().resize(resizeOpt).jpeg({
      quality: JPEG_QUALITY_STEPS[i],
      mozjpeg: true
    }).toBuffer();
  }
  return out;
}

const COVER_MAX_WIDTH = 480;

async function processCoverThumbnail(filePath) {
  return sharp(filePath).rotate().resize({
    width: COVER_MAX_WIDTH,
    withoutEnlargement: true
  }).png({
    compressionLevel: 9
  }).toBuffer();
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: PARSPACK_BUCKET,
      Key: key
    }));
    return true;
  } catch (err) {
    const status = err && err.$metadata && err.$metadata.httpStatusCode;
    if (status === 404 || err.name === "NotFound" || err.name === "NoSuchKey") return false;
    throw err;
  }
}

async function putObject(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: PARSPACK_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
}

function pageKey(slug, chapterNum, index) {
  const padded = String(index + 1).padStart(3, "0");
  return `manhwas/${slug}/CH${chapterNum}/${padded}.jpg`;
}

function coverKey(slug, chapterNum) {
  return `manhwas/${slug}/chapterPictures/chapterpicture${chapterNum}.png`;
}

module.exports = {
  uploadPage: wrapUpload(rawUploadPage),
  uploadCover: wrapUpload(rawUploadCover),
  processPageImage: processPageImage,
  processCoverThumbnail: processCoverThumbnail,
  putObject: putObject,
  objectExists: objectExists,
  pageKey: pageKey,
  coverKey: coverKey,
  removeTempFile: removeTempFile
};
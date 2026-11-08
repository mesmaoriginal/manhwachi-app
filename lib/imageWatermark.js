"use strict";
/**
 * lib/imageWatermark.js — چاپ ریزِ IP دریافت‌کننده روی عکس‌های چپتر (ردیابی کپی)
 *
 * هر بار که عکسی از /chapter-image سرو می‌شود، IP همان درخواست‌کننده (+ یک کد کوتاه از کوکی مهمان)
 * به‌صورت نوشته‌ی ریز و کم‌رنگ، چند جا در طول عکس چاپ می‌شود. اگر عکسی از سایت دیگری پیدا شد،
 * از روی همین نوشته معلوم است از چه IP/کوکی‌ای گرفته شده.
 *
 * نکات فنی:
 *  - نوشته با فونت پیکسلیِ داخلی ساخته می‌شود (بدون وابستگی به فونت سرور).
 *  - فقط یک PNG کوچک ساخته و کش می‌شود؛ هزینه‌ی اصلی decode/encode خود عکس است، پس تعداد
 *    پردازش هم‌زمان محدود است و نتیجه‌ی هر (عکس + IP) در یک LRU کوچک می‌ماند.
 *  - اگر پردازش شکست بخورد یا شلوغ باشد، عکس بدون واترمارک سرو نمی‌شود (WatermarkBusyError → 503).
 *  - خاموش‌کردن: AS_WATERMARK=0
 */
let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("[watermark] sharp نصب نیست؛ واترمارک غیرفعال است");
}

if (sharp) { try { sharp.cache({ memory: 32, files: 0, items: 32 }); sharp.concurrency(1); } catch (e) {} } // حافظه‌ی کش libvips را کم نگه دار
const ENABLED = process.env.AS_WATERMARK !== "0" && !!sharp;
const MAX_PARALLEL = Math.max(1, Number(process.env.AS_WM_PARALLEL) || 2); // os.cpus() روی Kubernetes تعداد هسته‌ی نود است نه پاد؛ پس ثابت و کم
const MAX_QUEUE = Math.max(1, Number(process.env.AS_WM_QUEUE) || 20);
const MAX_PIXELS = Number(process.env.AS_WM_MAX_PIXELS) || 60e6;
const LRU_MAX_BYTES = (Number(process.env.AS_WM_LRU_MB) || 32) * 1024 * 1024;
const LRU_MAX_ITEMS = 120;
const OPACITY = Math.min(0.9, Math.max(0.05, Number(process.env.AS_WM_OPACITY) || 0.3));
const SPACING = Math.max(600, Number(process.env.AS_WM_SPACING_PX) || 3000); // فاصله‌ی عمودی نوشته‌ها (پیکسل)
// چه کسری از عکس‌های هر چپتر واترمارک بخورند (۰ تا ۱). بر اساس hash ثابت (عکس + IP) تعیین می‌شود، نه تصادفی.
const COVERAGE = Math.min(1, Math.max(0.05, Number(process.env.AS_WM_COVERAGE) || 0.5));

class WatermarkBusyError extends Error {
  constructor() {
    super("watermark busy");
    this.name = "WatermarkBusyError";
    this.retryAfterSeconds = 5;
  }
}

// فونت پیکسلی ۵×۷
const FONT = {
  "0": "01110,10001,10011,10101,11001,10001,01110",
  "1": "00100,01100,00100,00100,00100,00100,01110",
  "2": "01110,10001,00001,00010,00100,01000,11111",
  "3": "11110,00001,00001,01110,00001,00001,11110",
  "4": "00010,00110,01010,10010,11111,00010,00010",
  "5": "11111,10000,11110,00001,00001,10001,01110",
  "6": "00110,01000,10000,11110,10001,10001,01110",
  "7": "11111,00001,00010,00100,01000,01000,01000",
  "8": "01110,10001,10001,01110,10001,10001,01110",
  "9": "01110,10001,10001,01111,00001,00010,01100",
  a: "00000,00000,01110,00001,01111,10001,01111",
  b: "10000,10000,10110,11001,10001,11001,10110",
  c: "00000,00000,01110,10000,10000,10001,01110",
  d: "00001,00001,01101,10011,10001,10011,01101",
  e: "00000,00000,01110,10001,11111,10000,01110",
  f: "00110,01001,01000,11100,01000,01000,01000",
  ".": "00000,00000,00000,00000,00000,01100,01100",
  ":": "00000,01100,01100,00000,01100,01100,00000",
  "/": "00001,00010,00010,00100,01000,01000,10000",
  "-": "00000,00000,00000,11111,00000,00000,00000",
};
const GLYPHS = {};
for (const [ch, rows] of Object.entries(FONT)) GLYPHS[ch] = rows.split(",");

function cleanText(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^0-9a-f.:/-]/g, "")
    .slice(0, 48);
}

/** متن → SVG (فقط rect؛ بدون فونت). هر پیکسل فونت = scale پیکسل. */
function textSvg(text, scale) {
  const chars = [...text];
  const adv = 6 * scale; // ۵ ستون + ۱ فاصله
  const w = chars.length * adv + 2 * scale;
  const h = 9 * scale;
  let fill = "";
  let shadow = "";
  chars.forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) return;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] !== "1") continue;
        const px = i * adv + x * scale;
        const py = y * scale;
        fill += `<rect x="${px}" y="${py}" width="${scale}" height="${scale}"/>`;
        shadow += `<rect x="${px + scale}" y="${py + scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g fill="#000" fill-opacity="${OPACITY}">${shadow}</g>` +
    `<g fill="#fff" fill-opacity="${OPACITY}">${fill}</g></svg>`;
  return { svg, w, h };
}

// کش علامت‌های ساخته‌شده (PNG کوچک)
const markCache = new Map();
async function getMark(text, scale) {
  const k = scale + "|" + text;
  const hit = markCache.get(k);
  if (hit) return hit;
  const { svg, w, h } = textSvg(text, scale);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const m = { png, w, h };
  if (markCache.size > 500) markCache.delete(markCache.keys().next().value);
  markCache.set(k, m);
  return m;
}

// LRU نتیجه‌ها
const lru = new Map(); // key → { out, bytes }
let lruBytes = 0;
function lruGet(k) {
  const v = lru.get(k);
  if (!v) return null;
  lru.delete(k);
  lru.set(k, v);
  return v.out;
}
function lruSet(k, out) {
  const bytes = out.buffer.length;
  if (bytes > LRU_MAX_BYTES / 4) return;
  lru.set(k, { out, bytes });
  lruBytes += bytes;
  while (lruBytes > LRU_MAX_BYTES || lru.size > LRU_MAX_ITEMS) {
    const [ok, ov] = lru.entries().next().value;
    lru.delete(ok);
    lruBytes -= ov.bytes;
  }
}

// محدودکننده‌ی هم‌زمانی
let running = 0;
const waiters = [];
function acquire() {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUE) return Promise.reject(new WatermarkBusyError());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      reject(new WatermarkBusyError());
    }, 15000);
    const entry = { resolve: () => { clearTimeout(t); resolve(); } };
    waiters.push(entry);
  });
}
function release() {
  const next = waiters.shift();
  if (next) next.resolve(); // همان slot به نفر بعد منتقل می‌شود
  else running--;
}

/** جای نوشته‌ها: چند نقطه در طول عکس، با x متغیر (بر اساس hash) تا الگوی ثابت نباشد */
function positions(width, height, mw, mh, seed) {
  const out = [];
  const margin = Math.round(mh * 1.2);
  const maxX = Math.max(0, width - mw - margin);
  let n = 0;
  for (let y = Math.round(mh * 2.5) + (seed % 300); y < height - mh - margin; y += SPACING) {
    // سه جای ثابت چرخشی: چپ، وسط، راست
    const slot = (n + seed) % 3;
    const x = slot === 0 ? margin : slot === 1 ? Math.round(maxX / 2) : maxX;
    out.push({ left: Math.max(0, x), top: y });
    n++;
  }
  // علامت انتهایی فقط اگه آخرین علامت دوره‌ای خیلی با انتها فاصله دارد (تا تعداد علامت‌ها بی‌دلیل زیاد نشود)
  const endTop = Math.max(0, height - mh - margin);
  const lastTop = out.length ? out[out.length - 1].top : -Infinity;
  if (endTop - lastTop > SPACING * 0.6) out.push({ left: Math.max(0, maxX - (seed % 40)), top: endTop });
  return out;
}

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 997;
}

/**
 * @returns {Promise<{buffer:Buffer, contentType:string, watermarked:boolean}>}
 */
async function apply({ buffer, contentType, cacheKey, ip, tag }) {
  if (!ENABLED) return { buffer, contentType, watermarked: false };
  const text = cleanText(tag ? `${ip}-${tag}` : ip);
  if (!text) return { buffer, contentType, watermarked: false };

  // فقط COVERAGE از عکس‌ها علامت می‌خورند؛ بقیه همان عکس اصلی (و قابل کش عمومی) هستند.
  if (COVERAGE < 1 && hashSeed(`${cacheKey}|${text}|cov`) / 997 >= COVERAGE) return { buffer, contentType, watermarked: false };

  const lk = `${cacheKey}|${text}`;
  const hit = lruGet(lk);
  if (hit) return hit;

  await acquire();
  try {
    const again = lruGet(lk);
    if (again) return again;

    let meta;
    try {
      meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch (e) {
      return { buffer, contentType, watermarked: false }; // فرمت ناشناخته/خراب: همان عکس اصلی
    }
    const fmt = meta.format;
    if (!["webp", "jpeg", "png"].includes(fmt) || !meta.width || !meta.height || meta.pages > 1) {
      return { buffer, contentType, watermarked: false }; // انیمیشن/فرمت ناشناخته: دست نمی‌زنیم
    }
    const scale = Math.max(2, Math.round(meta.width / 400));
    const mark = await getMark(text, scale);
    const seed = hashSeed(text);
    const comps = positions(meta.width, meta.height, mark.w, mark.h, seed).map((p) => ({ input: mark.png, left: p.left, top: p.top }));

    let pipe = sharp(buffer, { limitInputPixels: MAX_PIXELS }).composite(comps);
    if (fmt === "webp") pipe = pipe.webp({ quality: 92, effort: 2 });
    else if (fmt === "jpeg") pipe = pipe.jpeg({ quality: 92 });
    else pipe = pipe.png({ compressionLevel: 3 });
    const out = { buffer: await pipe.toBuffer(), contentType: `image/${fmt}`, watermarked: true };
    lruSet(lk, out);
    return out;
  } finally {
    release();
  }
}

module.exports = { apply, WatermarkBusyError, ENABLED, _textSvg: textSvg, _positions: positions, _hashSeed: hashSeed };

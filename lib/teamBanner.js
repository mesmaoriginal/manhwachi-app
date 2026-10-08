// lib/teamBanner.js — ساخت خودکار بنر چپتر (بدون Adobe؛ فقط sharp)
// قالب = assets/banner/template-bg.png (لایه‌ی پس‌زمینه‌ی PSD، بدون اسم‌ها)
// اسم‌ها با فونت (Diba) رندر می‌شوند و افکت PSD (سایه، استروک، بِوِل، گرادیان) روی‌شان اعمال می‌شود،
// بعد تصویر مانهوا (اختیاری) زیر بنر چسبانده می‌شود.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const BUCKET = process.env.PARSPACK_BUCKET;
const ASSETS = process.env.TEAM_BANNER_ASSETS || path.join(__dirname, "..", "assets", "banner");
const CFG = {
  template: process.env.TEAM_BANNER_TEMPLATE || path.join(ASSETS, "template-bg.png"),
  // فونت فارسی (و در صورت نیاز انگلیسی): اول فایل محلی، اگر نبود از S3 (کش در tmp)
  fa: { file: process.env.TEAM_BANNER_FA_FONT || path.join(ASSETS, "Diba.ttf"), key: process.env.TEAM_BANNER_FA_FONT_KEY || "team-assets/fonts/Diba.ttf" },
  en: { file: process.env.TEAM_BANNER_EN_FONT || path.join(ASSETS, "en.ttf"), key: process.env.TEAM_BANNER_EN_FONT_KEY || null },
  size: Number(process.env.TEAM_BANNER_SIZE || 37.5),      // اندازه‌ی فونت اسم (px) مثل PSD
  maxW: Number(process.env.TEAM_BANNER_MAX_W || 250),      // حداکثر عرض اسم؛ اگر بلندتر بود کوچک می‌شود
  maxH: Number(process.env.TEAM_BANNER_MAX_H || 60),
  dy: Number(process.env.TEAM_BANNER_DY || 0),             // تنظیم دستی بالا/پایین (px)
};
// مرکز اسم روی هر کادر (از مختصات لایه‌های PSD)
const SLOTS = {
  translator: { cx: 402, cy: 797 },   // ۵px بالاتر از مرکز PSD
  typist: { cx: 405, cy: 987 },
  cleaner: { cx: 405, cy: 1173 },
};
const isLatin = (s) => /[A-Za-z]/.test(s) && !/[\u0600-\u06FF]/.test(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const configured = () => fs.existsSync(CFG.template) && (fs.existsSync(CFG.fa.file) || !!BUCKET);

let _s3 = null;
const s3c = () => (_s3 = _s3 || require("./chapterCache").s3);
async function readKey(key) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  return Buffer.from(await (await s3c().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToByteArray());
}
// فایل فونت را برمی‌گرداند؛ اگر محلی نبود از S3 در tmp کش می‌کند
async function ensureFont(f, label) {
  if (fs.existsSync(f.file)) return f.file;
  if (!f.key || !BUCKET) throw new Error(`فونت ${label} پیدا نشد (${f.file}).`);
  const dst = path.join(os.tmpdir(), "banner-" + path.basename(f.key));
  if (!fs.existsSync(dst)) fs.writeFileSync(dst, await readKey(f.key));
  return dst;
}
// نام family فونت را از جدول name می‌خواند (fontconfig با همین نام پیدا می‌کند)
const famCache = new Map();
function fontFamily(file) {
  if (famCache.has(file)) return famCache.get(file);
  const b = fs.readFileSync(file);
  let fam = path.basename(file, path.extname(file));
  try {
    const n = b.readUInt16BE(4), tabs = {};
    for (let i = 0; i < n; i++) { const o = 12 + i * 16; tabs[b.toString("latin1", o, o + 4)] = b.readUInt32BE(o + 8); }
    const t = tabs.name, cnt = b.readUInt16BE(t + 2), so = t + b.readUInt16BE(t + 4);
    let best = null;
    for (let i = 0; i < cnt; i++) {
      const o = t + 6 + i * 12;
      const pl = b.readUInt16BE(o), lang = b.readUInt16BE(o + 4), id = b.readUInt16BE(o + 6), len = b.readUInt16BE(o + 8), off = b.readUInt16BE(o + 10);
      if (id !== 1 && id !== 16) continue;
      const raw = b.subarray(so + off, so + off + len);
      let s;
      if (pl === 3 || pl === 0) { const sw = Buffer.from(raw); sw.swap16(); s = sw.toString("utf16le"); } else s = raw.toString("latin1");
      const score = (pl === 3 && lang === 0x409 ? 4 : pl === 1 ? 2 : 1) + (id === 16 ? 0.5 : 0);
      if (!best || score > best.score) best = { s, score };
    }
    if (best && best.s) fam = best.s;
  } catch {}
  famCache.set(file, fam);
  return fam;
}

// ---- ابزار ماسک (آرایه‌ی Uint8 با ابعاد w×h) ----
const shift = (a, w, h, dx, dy) => {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - dx, sy = y - dy;
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) o[y * w + x] = a[sy * w + sx];
  }
  return o;
};
const sub = (a, b) => a.map((v, i) => Math.max(0, v - b[i]));
const mul = (a, k) => a.map((v) => Math.min(255, v * k));
async function blur(a, w, h, sigma) {
  if (sigma < 0.3) return a;
  const { data } = await sharp(Buffer.from(a), { raw: { width: w, height: h, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (data.length !== w * h) throw new Error("blur: ابعاد ماسک نامعتبر");
  return new Uint8Array(data);
}
// ماسک تک‌رنگ → لایه‌ی RGBA (opacity 0..1)
const solid = (mask, w, h, rgb, op = 1) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < mask.length; i++) { buf[i * 4] = rgb[0]; buf[i * 4 + 1] = rgb[1]; buf[i * 4 + 2] = rgb[2]; buf[i * 4 + 3] = Math.round(mask[i] * op); }
  return buf;
};
// گرادیان عمودی داخل ماسک (از رنگ top تا bottom بر اساس جعبه‌ی مرکب)
const gradient = (mask, w, h, top, bot, y0, y1) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = Math.min(1, Math.max(0, (y - y0) / Math.max(1, y1 - y0)));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (let c = 0; c < 3; c++) buf[i * 4 + c] = Math.round(top[c] + (bot[c] - top[c]) * t);
      buf[i * 4 + 3] = mask[i];
    }
  }
  return buf;
};

// ---- کیفیت: همه‌چیز در S برابر اندازه رندر می‌شود و آخر با lanczos کوچک می‌شود ----
const S = 3;
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// متن → ماسک آلفا در مقیاس S + ابعاد ink (به px مقیاس S)
async function textMask(name, fontFile, latin) {
  const fam = fontFamily(fontFile);
  const png = await sharp({ text: { text: `<span foreground="white">${esc(name)}</span>`, font: `${fam} ${CFG.size * S}`, fontfile: fontFile, rgba: true, rtl: !latin, dpi: 72 } }).png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++)
    if (data[(y * info.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error(`رندر اسم «${name}» خالی شد (فونت این حروف را ندارد؟)`);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const f = Math.min(1, (CFG.maxW * S) / cw, (CFG.maxH * S) / ch);          // کوچک‌کردن تا جا شود
  let img = sharp(png).ensureAlpha().extract({ left: x0, top: y0, width: cw, height: ch }).extractChannel(3);
  const tw = Math.max(1, Math.round(cw * f)), th = Math.max(1, Math.round(ch * f));
  if (f < 1) img = img.resize(tw, th, { kernel: "lanczos3" });
  const alpha = await img.raw().toBuffer();
  return { alpha: new Uint8Array(alpha), w: tw, h: th };
}

// Bevel & Emboss (Inner Bevel): ارتفاع = بلور ماسک؛ نور از بالا (زاویه ۹۰)
// PSD: Depth 357% ، Size 3px ، هایلایت سفید ۵۰٪ ، سایه (73,36,1) ۵۰٪
async function bevel(A, W, H, depth, size) {
  const hgt = await blur(A, W, H, size * S * 0.6);
  const hi = new Uint8Array(W * H), lo = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const gy = ((hgt[i + W] - hgt[i - W]) / 2) * S * depth;   // >0 : سطح رو به بالا
    if (gy > 0) hi[i] = clamp(gy * 1.6); else lo[i] = clamp(-gy * 1.6);
  }
  const m = (v, i) => Math.min(v, A[i]);                      // فقط داخل حروف
  return { hi: (await blur(hi, W, H, 0.5 * S)).map(m), lo: (await blur(lo, W, H, 0.5 * S)).map(m) };
}

// افکت PSD: Drop Shadow + Stroke + Gradient + Bevel + Inner Shadow → یک لایه‌ی RGBA در اندازه‌ی نهایی
async function styledName(name, slot, fontFile) {
  const m = await textMask(name, fontFile, isLatin(name));
  const padPx = 24, wf = Math.ceil(m.w / S) + padPx * 2, hf = Math.ceil(m.h / S) + padPx * 2;   // ابعاد نهایی (1x)
  const W = wf * S, H = hf * S;
  const ox = Math.round((W - m.w) / 2), oy = Math.round((H - m.h) / 2);
  const A = new Uint8Array(W * H);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) A[(y + oy) * W + x + ox] = m.alpha[y * m.w + x];

  const shadow = mul(await blur(shift(A, W, H, 0, 2 * S), W, H, 4 * S), 2.4);        // Drop Shadow: مشکی ۷۳٪
  const stroke = (await blur(A, W, H, 1.1 * S)).map((v) => (v > 24 ? 255 : 0));        // Stroke ۱px
  const strokeA = await blur(new Uint8Array(stroke), W, H, 0.5 * S);
  const { hi, lo } = await bevel(A, W, H, 3.57, 3);
  const inner = (await blur(sub(A, shift(A, W, H, 0, 3 * S)), W, H, 3 * S)).map((v, i) => Math.min(v, A[i]));   // Inner Shadow

  const L = [
    solid(shadow, W, H, [0, 0, 0], 0.73),
    solid(strokeA, W, H, [149, 100, 52], 0.65),
    gradient(A, W, H, [248, 217, 186], [226, 178, 138], oy, oy + m.h),
    solid(inner, W, H, [0, 0, 0], 0.12),
    solid(lo, W, H, [73, 36, 1], 0.5),
    solid(hi, W, H, [255, 255, 255], 0.5),
  ];
  const layers = [];
  for (const buf of L) layers.push({ input: await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(), left: 0, top: 0 });
  const big = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
  const small = await sharp(big).resize(wf, hf, { kernel: "lanczos3" }).png().toBuffer();
  return { input: small, left: Math.round(slot.cx - wf / 2), top: Math.round(slot.cy - hf / 2 + CFG.dy) };
}

// names = { translator, typist, cleaner } ، coverKey = کلید S3 تصویر مانهوا (یا null) → Buffer از PNG نهایی
async function buildBanner({ names, coverKey }) {
  if (!fs.existsSync(CFG.template)) throw new Error(`قالب بنر پیدا نشد: ${CFG.template}`);
  const faFile = await ensureFont(CFG.fa, "فارسی");
  const overlays = [];
  for (const [role, slot] of Object.entries(SLOTS)) {
    const name = String((names && names[role]) || "").trim() || "—";
    const latin = isLatin(name);
    const font = latin && (fs.existsSync(CFG.en.file) || CFG.en.key) ? await ensureFont(CFG.en, "انگلیسی") : faFile;
    overlays.push(await styledName(name, slot, font));
  }
  const banner = await sharp(CFG.template).ensureAlpha().composite(overlays).png().toBuffer();
  if (!coverKey) return banner;
  const cover = await readKey(coverKey);
  const [bm, cm] = [await sharp(banner).metadata(), await sharp(cover).metadata()];
  if (cm.width !== bm.width) throw new Error(`عرض تصویر مانهوا ${cm.width} است؛ باید ${bm.width} (هم‌عرض بنر) باشد.`);
  return sharp({ create: { width: bm.width, height: bm.height + cm.height, channels: 4, background: "#000000" } })
    .composite([{ input: banner, top: 0, left: 0 }, { input: cover, top: bm.height, left: 0 }]).png().toBuffer();
}
module.exports = { buildBanner, configured, CFG };

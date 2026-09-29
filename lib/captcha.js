// lib/captcha.js
// کپچای تصویری (SVG) بدون هیچ وابستگی. API مطابق server.js:
//   generate() -> { captchaId, image }   (image = رشته‌ی SVG)
//   verify(id, answer, keep=false) -> boolean
//   consume(id)
// قوانین امنیتی:
//  • هر کپچا ۳ دقیقه اعتبار دارد و جواب غلط همان لحظه آن را می‌سوزاند (بات نمی‌تواند حدس بزند).
//  • جواب درست، کپچا را می‌سوزاند؛ مگر keep=true (فقط مرحله‌ی بررسی اولیه) که حداکثر ۳ بار قابل استفاده است.
//  • سقف تعداد کپچاهای زنده، تا حافظه با درخواست انبوه پر نشود.
const crypto = require("crypto");

const TTL_MS = 3 * 60 * 1000;
const MAX_LIVE = 5000;
const MAX_KEEP_USES = 3;
const LENGTH = 5;
// حروف/ارقام گیج‌کننده (0 O 1 I l ...) حذف شده‌اند
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const store = new Map(); // id -> { answer, expiresAt, uses }

const rnd = (min, max) => crypto.randomInt(min, max + 1);
const pick = (arr) => arr[rnd(0, arr.length - 1)];

function randomText() {
  let t = "";
  for (let i = 0; i < LENGTH; i++) t += ALPHABET[rnd(0, ALPHABET.length - 1)];
  return t;
}

// ⚠️ چرا فونت داخلی: نسخه‌ی قبلی حروف را با تگ <text> در SVG می‌نوشت، یعنی
// جواب کپچا عیناً داخل پاسخ /api/captcha بود و هر بات با یک regex آن را
// می‌خواند. حالا هر حرف از یک فونت ۵×۷ ساخته و به شکل path/polygon رسم
// می‌شود؛ هیچ متن خوانایی در SVG نیست.
const FONT = {
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
};

const jit = (v, a) => (v + (crypto.randomInt(-100, 101) / 100) * a).toFixed(1);

// یک حرف → مجموعه‌ای از چندضلعی‌های کمی لرزان (هر «run» افقی یک چندضلعی)
function glyphPaths(ch, cell) {
  const rows = FONT[ch];
  let d = "";
  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    while (c < 5) {
      if (rows[r][c] !== "#") { c++; continue; }
      let e = c;
      while (e < 5 && rows[r][e] === "#") e++;
      const x1 = c * cell, x2 = e * cell, y1 = r * cell, y2 = (r + 1) * cell;
      d += `M${jit(x1, 0.5)} ${jit(y1, 0.5)}L${jit(x2, 0.5)} ${jit(y1, 0.5)}L${jit(x2, 0.5)} ${jit(y2, 0.5)}L${jit(x1, 0.5)} ${jit(y2, 0.5)}Z`;
      c = e;
    }
  }
  return d;
}

function renderSvg(text) {
  const W = 160, H = 56;
  const colors = ["#111827", "#1d4ed8", "#b91c1c", "#047857", "#7c3aed", "#b45309"];
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  out += `<rect width="100%" height="100%" fill="#f8fafc"/>`;
  for (let i = 0; i < 7; i++) {
    out += `<path d="M${rnd(0, W)} ${rnd(0, H)} Q${rnd(0, W)} ${rnd(0, H)} ${rnd(0, W)} ${rnd(0, H)}" stroke="${pick(colors)}" stroke-width="${rnd(1, 2)}" fill="none" opacity="0.55"/>`;
  }
  for (let i = 0; i < 40; i++) {
    out += `<circle cx="${rnd(0, W)}" cy="${rnd(0, H)}" r="${rnd(1, 2)}" fill="${pick(colors)}" opacity="0.5"/>`;
  }
  const step = (W - 20) / LENGTH;
  for (let i = 0; i < text.length; i++) {
    const cell = rnd(36, 44) / 10; // ۳٫۶ تا ۴٫۴ پیکسل
    const gw = 5 * cell, gh = 7 * cell;
    const x = 12 + i * step + rnd(-2, 2);
    const y = (H - gh) / 2 + rnd(-4, 4);
    const rot = rnd(-18, 18);
    out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot} ${(gw / 2).toFixed(1)} ${(gh / 2).toFixed(1)})">`;
    out += `<path d="${glyphPaths(text[i], cell)}" fill="${pick(colors)}"/></g>`;
  }
  // خطوط مزاحم روی حروف
  for (let i = 0; i < 2; i++) {
    out += `<path d="M0 ${rnd(10, 46)} C${rnd(30, 60)} ${rnd(0, 56)} ${rnd(90, 120)} ${rnd(0, 56)} ${W} ${rnd(10, 46)}" stroke="#111827" stroke-width="1.5" fill="none" opacity="0.6"/>`;
  }
  return out + "</svg>";
}

function sweep(now = Date.now()) {
  for (const [id, c] of store) if (c.expiresAt < now) store.delete(id);
}

function generate() {
  const now = Date.now();
  if (store.size >= MAX_LIVE) {
    sweep(now);
    // هنوز پر است → قدیمی‌ترین‌ها را حذف کن (Map به ترتیب درج نگه می‌دارد)
    while (store.size >= MAX_LIVE) store.delete(store.keys().next().value);
  }
  const answer = randomText();
  const captchaId = crypto.randomBytes(18).toString("base64url");
  store.set(captchaId, { answer, expiresAt: now + TTL_MS, uses: 0 });
  return { captchaId, image: renderSvg(answer) };
}

function normalize(s) {
  return String(s ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim()
    .toUpperCase();
}

function verify(id, answer, keep = false) {
  if (typeof id !== "string" || !id) return false;
  const c = store.get(id);
  if (!c) return false;
  if (c.expiresAt < Date.now()) {
    store.delete(id);
    return false;
  }
  const a = Buffer.from(c.answer);
  const b = Buffer.from(normalize(answer));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    store.delete(id); // جواب غلط → کپچا سوخت
    return false;
  }
  if (keep) {
    c.uses += 1;
    if (c.uses >= MAX_KEEP_USES) store.delete(id);
  } else {
    store.delete(id);
  }
  return true;
}

function consume(id) {
  if (typeof id === "string") store.delete(id);
}

setInterval(() => sweep(), 60 * 1000).unref();

module.exports = { generate, verify, consume };

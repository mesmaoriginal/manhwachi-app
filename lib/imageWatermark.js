"use strict";

let sharp = null;

try {
  sharp = require("sharp");
} catch (e) {
  console.warn("[watermark] sharp نصب نیست؛ واترمارک غیرفعال است");
}

if (sharp) {
  try {
    sharp.cache({
      memory: 32,
      files: 0,
      items: 32
    });
    sharp.concurrency(1);
  } catch (e) {}
}

const ENABLED = process.env.AS_WATERMARK !== "0" && !!sharp;

const MAX_PARALLEL = Math.max(1, Number(process.env.AS_WM_PARALLEL) || 1);

const MAX_QUEUE = Math.max(1, Number(process.env.AS_WM_QUEUE) || 20);

const MAX_PIXELS = Number(process.env.AS_WM_MAX_PIXELS) || 15e6;

const LRU_MAX_BYTES = (Number(process.env.AS_WM_LRU_MB) || 32) * 1024 * 1024;

const LRU_MAX_ITEMS = 120;

const OPACITY = Math.min(.9, Math.max(.03, Number(process.env.AS_WM_OPACITY) || .09));

const SPACING = Math.max(600, Number(process.env.AS_WM_SPACING_PX) || 3e3);

const CANDIDATES = 6;

const COVERAGE = Math.min(1, Math.max(.05, Number(process.env.AS_WM_COVERAGE) || .5));

class WatermarkBusyError extends Error {
  constructor() {
    super("watermark busy");
    this.name = "WatermarkBusyError";
    this.retryAfterSeconds = 5;
  }
}

const FONT = {
  0: "01110,10001,10011,10101,11001,10001,01110",
  1: "00100,01100,00100,00100,00100,00100,01110",
  2: "01110,10001,00001,00010,00100,01000,11111",
  3: "11110,00001,00001,01110,00001,00001,11110",
  4: "00010,00110,01010,10010,11111,00010,00010",
  5: "11111,10000,11110,00001,00001,10001,01110",
  6: "00110,01000,10000,11110,10001,10001,01110",
  7: "11111,00001,00010,00100,01000,01000,01000",
  8: "01110,10001,10001,01110,10001,10001,01110",
  9: "01110,10001,10001,01111,00001,00010,01100",
  a: "00000,00000,01110,00001,01111,10001,01111",
  b: "10000,10000,10110,11001,10001,11001,10110",
  c: "00000,00000,01110,10000,10000,10001,01110",
  d: "00001,00001,01101,10011,10001,10011,01101",
  e: "00000,00000,01110,10001,11111,10000,01110",
  f: "00110,01001,01000,11100,01000,01000,01000",
  ".": "00000,00000,00000,00000,00000,01100,01100",
  ":": "00000,01100,01100,00000,01100,01100,00000",
  "/": "00001,00010,00010,00100,01000,01000,10000",
  "-": "00000,00000,00000,11111,00000,00000,00000"
};

const GLYPHS = {};

for (const [ch, rows] of Object.entries(FONT)) GLYPHS[ch] = rows.split(",");

function cleanText(t) {
  return String(t || "").toLowerCase().replace(/[^0-9a-f.:/-]/g, "").slice(0, 16);
}

function textSvg(text, scale, tone) {
  const chars = [ ...text ];
  const adv = 6 * scale;
  const w = chars.length * adv + 2 * scale;
  const h = 9 * scale;
  let fill = "";
  chars.forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) return;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] !== "1") continue;
        fill += `<rect x="${i * adv + x * scale}" y="${y * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  });
  const color = tone === "dark" ? "#000" : "#fff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` + `<g fill="${color}" fill-opacity="${OPACITY}">${fill}</g></svg>`;
  return {
    svg: svg,
    w: w,
    h: h
  };
}

const markCache = new Map;

async function getMark(text, scale, tone) {
  const k = `${scale}|${tone}|${text}`;
  const hit = markCache.get(k);
  if (hit) return hit;
  const {svg: svg, w: w, h: h} = textSvg(text, scale, tone);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const m = {
    png: png,
    w: w,
    h: h
  };
  if (markCache.size > 300) markCache.delete(markCache.keys().next().value);
  markCache.set(k, m);
  return m;
}

const lru = new Map;

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
  lru.set(k, {
    out: out,
    bytes: bytes
  });
  lruBytes += bytes;
  while (lruBytes > LRU_MAX_BYTES || lru.size > LRU_MAX_ITEMS) {
    const [ok, ov] = lru.entries().next().value;
    lru.delete(ok);
    lruBytes -= ov.bytes;
  }
}

let running = 0;

const waiters = [];

function acquire() {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUE) return Promise.reject(new WatermarkBusyError);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      reject(new WatermarkBusyError);
    }, 15e3);
    const entry = {
      resolve: () => {
        clearTimeout(t);
        resolve();
      }
    };
    waiters.push(entry);
  });
}

function release() {
  const next = waiters.shift();
  if (next) next.resolve(); else running--;
}

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 997;
}

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function positions(width, height, mw, mh, seed32, score) {
  const out = [];
  const rnd = mulberry32(seed32 || 1);
  const margin = Math.round(mh * 1.2);
  const maxX = Math.max(0, width - mw - margin);
  const minX = Math.min(margin, maxX);
  const randX = () => minX + Math.floor(rnd() * (maxX - minX + 1));
  const pickX = top => {
    if (!score) return randX();
    let best = randX(), bestScore = score(best, top);
    for (let k = 1; k < CANDIDATES; k++) {
      const x = randX();
      const sc = score(x, top);
      if (sc > bestScore) {
        best = x;
        bestScore = sc;
      }
    }
    return best;
  };
  let y = Math.round(mh * 2.5) + Math.floor(rnd() * SPACING * .6);
  while (y < height - mh - margin) {
    out.push({
      left: pickX(y),
      top: y
    });
    y += Math.round(SPACING * (.8 + rnd() * .4));
  }
  const endTop = Math.max(0, height - mh - margin);
  const lastTop = out.length ? out[out.length - 1].top : -Infinity;
  if (endTop - lastTop > SPACING * .6) out.push({
    left: pickX(endTop),
    top: endTop
  });
  return out;
}

function regionStats(th, imgW, imgH, left, top, w, h) {
  const sx = th.info.width / imgW;
  const sy = th.info.height / imgH;
  const x0 = Math.max(0, Math.floor(left * sx));
  const y0 = Math.max(0, Math.floor(top * sy));
  const x1 = Math.min(th.info.width, Math.max(x0 + 1, Math.ceil((left + w) * sx)));
  const y1 = Math.min(th.info.height, Math.max(y0 + 1, Math.ceil((top + h) * sy)));
  let sum = 0, sum2 = 0, n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const v = th.data[yy * th.info.width + xx];
      sum += v;
      sum2 += v * v;
      n++;
    }
  }
  if (!n) return {
    mean: 128,
    std: 0
  };
  const mean = sum / n;
  return {
    mean: mean,
    std: Math.sqrt(Math.max(0, sum2 / n - mean * mean))
  };
}

async function apply({buffer: buffer, contentType: contentType, cacheKey: cacheKey, ip: ip, tag: tag, code: code}) {
  if (!ENABLED) return {
    buffer: buffer,
    contentType: contentType,
    watermarked: false
  };
  const text = cleanText(code || (tag ? `${ip}-${tag}` : ip));
  if (!text) return {
    buffer: buffer,
    contentType: contentType,
    watermarked: false
  };
  if (COVERAGE < 1 && hashSeed(`${cacheKey}|${text}|cov`) / 997 >= COVERAGE) return {
    buffer: buffer,
    contentType: contentType,
    watermarked: false
  };
  const lk = `${cacheKey}|${text}`;
  const hit = lruGet(lk);
  if (hit) return hit;
  await acquire();
  try {
    const again = lruGet(lk);
    if (again) return again;
    let meta;
    try {
      meta = await sharp(buffer, {
        limitInputPixels: MAX_PIXELS
      }).metadata();
    } catch (e) {
      return {
        buffer: buffer,
        contentType: contentType,
        watermarked: false
      };
    }
    const fmt = meta.format;
    if (![ "webp", "jpeg", "png" ].includes(fmt) || !meta.width || !meta.height || meta.pages > 1) {
      return {
        buffer: buffer,
        contentType: contentType,
        watermarked: false
      };
    }
    const scale = Math.max(2, Math.round(meta.width / 300));
    const seed = hash32(`${cacheKey}|${text}`);
    const probe = await getMark(text, scale, "dark");
    const th = await sharp(buffer, {
      limitInputPixels: MAX_PIXELS
    }).resize({
      width: Math.min(200, meta.width)
    }).greyscale().raw().toBuffer({
      resolveWithObject: true
    });
    const score = (l, t) => regionStats(th, meta.width, meta.height, l, t, probe.w, probe.h).std;
    const pos = positions(meta.width, meta.height, probe.w, probe.h, seed, score);
    const comps = [];
    for (const p of pos) {
      const lum = regionStats(th, meta.width, meta.height, p.left, p.top, probe.w, probe.h).mean;
      const mark = await getMark(text, scale, lum >= 128 ? "dark" : "light");
      comps.push({
        input: mark.png,
        left: p.left,
        top: p.top
      });
    }
    let pipe = sharp(buffer, {
      limitInputPixels: MAX_PIXELS
    }).composite(comps);
    if (fmt === "webp") pipe = pipe.webp({
      quality: 90,
      effort: 1
    }); else if (fmt === "jpeg") pipe = pipe.jpeg({
      quality: 90
    }); else pipe = pipe.png({
      compressionLevel: 3
    });
    const out = {
      buffer: await pipe.toBuffer(),
      contentType: `image/${fmt}`,
      watermarked: true
    };
    lruSet(lk, out);
    return out;
  } finally {
    release();
  }
}

module.exports = {
  apply: apply,
  WatermarkBusyError: WatermarkBusyError,
  ENABLED: ENABLED,
  _textSvg: textSvg,
  _positions: positions,
  _hashSeed: hashSeed,
  _regionStats: regionStats
};
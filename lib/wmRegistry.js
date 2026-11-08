"use strict";
/**
 * lib/wmRegistry.js — نگاشت «کد کوتاه روی عکس» ← «IP / کوکی مهمان / حساب کاربری»
 *
 * به‌جای نوشتن خودِ IP روی عکس، یک کد ۸ حرفی (hex) روی عکس می‌رود:
 *   code = HMAC(SECRET, روز | ip | guestId)[0..8]
 * - بدون SECRET نمی‌شود برای IP دلخواه کد جعل کرد یا از روی کد IP را حدس زد.
 * - هر روز کدها عوض می‌شوند (حریم خصوصی + جدول کوچک می‌ماند).
 * - فقط وقتی کدِ جدیدی دیده می‌شود یک خط به data/wm-codes.jsonl اضافه می‌شود (نه برای هر عکس).
 * جستجو: node scripts/wm-lookup.js <code>
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.WM_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "wm-codes.jsonl");
const MAX_BYTES = 10 * 1024 * 1024; // بعد از این حجم، فایل می‌چرخد (یک نسخه‌ی .1 نگه داشته می‌شود)
const SECRET = process.env.WM_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || crypto.randomBytes(24).toString("hex");

const seen = new Map(); // code → { userId }
const day = () => new Date().toISOString().slice(0, 10);

function codeFor(ip, gid) {
  return crypto.createHmac("sha256", SECRET).update(`${day()}|${ip || ""}|${gid || ""}`).digest("hex").slice(0, 8);
}

function append(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      if (fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, FILE + ".1");
    } catch (e) {}
    fs.appendFile(FILE, JSON.stringify(entry) + "\n", () => {});
  } catch (e) {}
}

/** ثبت (یا به‌روزرسانی با userId). کد را برمی‌گرداند. */
function note({ ip, gid, userId }) {
  const code = codeFor(ip, gid);
  const cur = seen.get(code);
  if (!cur || (userId && !cur.userId)) {
    seen.set(code, { userId: userId || (cur && cur.userId) || null });
    if (seen.size > 20000) seen.delete(seen.keys().next().value);
    append({ t: new Date().toISOString(), code, ip: ip || null, gid: gid || null, userId: userId || null });
  }
  return code;
}

module.exports = { codeFor, note };

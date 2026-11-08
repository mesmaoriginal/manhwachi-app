"use strict";
/**
 * lib/diskGuard.js — نگهبان دیسک
 *
 * دیسک موقتِ پارس‌پک ۵۱۲MB است و عبور از آن = ریستارت (سایت از دسترس خارج می‌شود).
 * هر ۳۰ دقیقه (و یک‌بار موقع بالا اومدن) حجم پوشه‌های پرخطر را لاگ می‌کند:
 *   image-cache، data، و پوشه‌های tmp (zip تیم / آپلود ادمین).
 * اگر مجموع از DISK_WARN_MB (پیش‌فرض ۳۵۰) بیشتر شد، هشدار می‌دهد و کش عکس را به نصفِ سقفش می‌رساند.
 * فقط می‌خواند و (در حالت اضطراری) کش عکس را کم می‌کند؛ به دیتابیس و آواتار دست نمی‌زند.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const WARN_BYTES = (Number(process.env.DISK_WARN_MB) || 350) * 1024 * 1024;

function dirSize(dir, depth = 0) {
  let total = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const st = fs.lstatSync(f);
      if (st.isDirectory()) { if (depth < 4) total += dirSize(f, depth + 1); }
      else total += st.size;
    } catch {}
  }
  return total;
}
const mb = (b) => Math.round(b / 1048576);

function start() {
  let cache = null;
  try { cache = require("./imageProxyCache"); } catch {}
  const dataDir = path.join(__dirname, "..", "data");
  const tmp = os.tmpdir();

  function check() {
    try {
      const img = cache ? dirSize(cache.CACHE_DIR) : 0;
      const data = dirSize(dataDir);
      const tmpSize = dirSize(path.join(tmp, "team_tmp")) + dirSize(path.join(tmp, "manhwachi-admin-uploads"));
      // اگه data روی دیسک جداگانه (ماندگار) مونت شده باشه، از سقف دیسک موقت حساب نمی‌شه
      let dataIsEphemeral = true;
      try { dataIsEphemeral = fs.statSync(dataDir).dev === fs.statSync(tmp).dev; } catch {}
      // کش عکس هم اگه روی دیسک جدا (مثلاً داخل data روی دیسک ۵ گیگی) باشه، از سقف دیسک موقت حساب نمی‌شه
      let imgIsEphemeral = true;
      try { imgIsEphemeral = !cache || fs.statSync(cache.CACHE_DIR).dev === fs.statSync(tmp).dev; } catch {}
      const sum = (imgIsEphemeral ? img : 0) + tmpSize + (dataIsEphemeral ? data : 0);
      console.log(`[disk] image-cache=${mb(img)}MB${imgIsEphemeral ? "" : "(دیسک جدا)"} data=${mb(data)}MB${dataIsEphemeral ? "" : "(دیسک جدا)"} tmp=${mb(tmpSize)}MB (جمع موقت ${mb(sum)}MB)`);
      if (sum > WARN_BYTES && cache && imgIsEphemeral) {
        console.warn(`[disk] هشدار: مجموع از ${mb(WARN_BYTES)}MB بیشتر شد؛ کش عکس کم می‌شود`);
        cache.cleanupCache(Math.max(10, mb(img) / 2) * 1048576);
      }
    } catch (e) {
      console.warn("[disk] بررسی ناموفق:", e.message);
    }
  }
  setTimeout(check, 20 * 1000).unref();
  setInterval(check, 30 * 60 * 1000).unref();
}

module.exports = { start, dirSize };

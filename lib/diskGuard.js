"use strict";

const fs = require("fs");

const os = require("os");

const path = require("path");

const WARN_BYTES = (Number(process.env.DISK_WARN_MB) || 350) * 1024 * 1024;

function dirSize(dir, depth = 0) {
  let total = 0;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const st = fs.lstatSync(f);
      if (st.isDirectory()) {
        if (depth < 4) total += dirSize(f, depth + 1);
      } else total += st.size;
    } catch {}
  }
  return total;
}

const mb = b => Math.round(b / 1048576);

function start() {
  let cache = null;
  try {
    cache = require("./imageProxyCache");
  } catch {}
  const dataDir = path.join(__dirname, "..", "data");
  const tmp = os.tmpdir();
  function check() {
    try {
      let dataIsEphemeral = true;
      try {
        dataIsEphemeral = fs.statSync(dataDir).dev === fs.statSync(tmp).dev;
      } catch {}
      let imgIsEphemeral = true;
      try {
        imgIsEphemeral = !cache || fs.statSync(cache.CACHE_DIR).dev === fs.statSync(tmp).dev;
      } catch {}
      const img = cache && imgIsEphemeral ? dirSize(cache.CACHE_DIR) : 0;
      const data = dataIsEphemeral ? dirSize(dataDir) : 0;
      const tmpSize = dirSize(path.join(tmp, "team_tmp")) + dirSize(path.join(tmp, "manhwachi-admin-uploads"));
      const sum = (imgIsEphemeral ? img : 0) + tmpSize + (dataIsEphemeral ? data : 0);
      console.log(`[disk] image-cache=${mb(img)}MB${imgIsEphemeral ? "" : "(دیسک جدا)"} data=${mb(data)}MB${dataIsEphemeral ? "" : "(دیسک جدا)"} tmp=${mb(tmpSize)}MB (جمع موقت ${mb(sum)}MB)`);
      if (sum > WARN_BYTES && cache && imgIsEphemeral) {
        console.warn(`[disk] هشدار: مجموع از ${mb(WARN_BYTES)}MB بیشتر شد؛ کش عکس کم می‌شود`);
        cache.cleanupCache(Math.max(10, mb(img) / 2) * 1048576).catch(() => {});
      }
    } catch (e) {
      console.warn("[disk] بررسی ناموفق:", e.message);
    }
  }
  setTimeout(check, 20 * 1e3).unref();
  setInterval(check, 30 * 60 * 1e3).unref();
}

module.exports = {
  start: start,
  dirSize: dirSize
};
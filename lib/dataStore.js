const fs = require("fs");

const path = require("path");

const {dataEvents: dataEvents, DATA_UPDATED: DATA_UPDATED} = require("./dataEvents");

const JSON_PATH = path.join(__dirname, "..", "data", "data.json");

let cachedData = null;

let cachedRaw = null;

let cachedMtimeMs = null;

let forceReload = false;

function loadFromDisk() {
  forceReload = false;
  let stat = null;
  try {
    stat = fs.existsSync(JSON_PATH) ? fs.statSync(JSON_PATH) : null;
    const raw = stat ? fs.readFileSync(JSON_PATH, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    cachedRaw = raw;
    cachedData = parsed;
    cachedMtimeMs = stat ? stat.mtimeMs : 0;
    try {
      require("./chapterTimes").sync(parsed, cachedMtimeMs);
    } catch (e) {
      console.error("[chapterTimes] sync:", e.message);
    }
  } catch (err) {
    console.error("خطا در خواندن data.json (آخرین نسخه‌ی سالم نگه داشته شد):", err.message);
    cachedData = cachedData || {};
    cachedRaw = cachedRaw || "{}";
    if (stat) cachedMtimeMs = stat.mtimeMs;
  }
}

function isStaleOnDisk() {
  try {
    const stat = fs.statSync(JSON_PATH);
    return stat.mtimeMs !== cachedMtimeMs;
  } catch {
    return false;
  }
}

function ensureFresh() {
  if (cachedData === null || forceReload || isStaleOnDisk()) {
    loadFromDisk();
  }
}

function getData() {
  ensureFresh();
  return cachedData;
}

function getRawJson() {
  ensureFresh();
  return cachedRaw;
}

dataEvents.on(DATA_UPDATED, () => {
  forceReload = true;
});

module.exports = {
  getData: getData,
  getRawJson: getRawJson
};
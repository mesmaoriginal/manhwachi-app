const fs = require("fs");

const path = require("path");

const {parseJalaliDateMs: parseJalaliDateMs, explicitReleaseMs: explicitReleaseMs, HOUR_MS: HOUR_MS} = require("./accessPolicy");

const FILE = process.env.CHAPTER_TIMES_PATH || path.join(__dirname, "..", "data", "chapter-times.json");

const OLD_IMPORT_MS = 36 * HOUR_MS;

let times = null;

function keyOf(slug, num) {
  return `${slug}|${Number(num)}`;
}

function load() {
  if (times) return times;
  times = new Map;
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [k, v] of Object.entries(obj)) if (Number.isFinite(v)) times.set(k, v);
    times.__existed = true;
  } catch (e) {
    times.__existed = false;
    if (e.code !== "ENOENT") console.error("[chapterTimes] خواندن فایل ناموفق بود:", e.message);
  }
  return times;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), {
      recursive: true
    });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(times)), "utf8");
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error("[chapterTimes] ذخیره ناموفق بود:", e.message);
  }
}

function sync(data, savedAtMs) {
  const map = load();
  const firstRun = !map.__existed;
  const stamp = Number.isFinite(savedAtMs) && savedAtMs > 0 ? savedAtMs : Date.now();
  let dirty = false;
  for (const [slug, manhwa] of Object.entries(data || {})) {
    if (!manhwa || !Array.isArray(manhwa.episodes)) continue;
    for (const ep of manhwa.episodes) {
      if (!ep || ep.num === undefined || ep.num === null) continue;
      const k = keyOf(slug, ep.num);
      if (map.has(k)) continue;
      const dayStart = parseJalaliDateMs(ep.date);
      let ms;
      if (firstRun) ms = dayStart ?? 0; else if (dayStart !== null && stamp - dayStart > OLD_IMPORT_MS) ms = dayStart; else ms = stamp;
      map.set(k, ms);
      dirty = true;
    }
  }
  if (dirty || firstRun) {
    map.__existed = true;
    persist();
  }
}

function getReleaseMs(slug, episode) {
  const explicit = explicitReleaseMs(episode);
  if (explicit !== null) return explicit;
  const map = load();
  const v = map.get(keyOf(slug, episode.num));
  if (v !== undefined) return v;
  return parseJalaliDateMs(episode.date) ?? 0;
}

module.exports = {
  sync: sync,
  getReleaseMs: getReleaseMs
};
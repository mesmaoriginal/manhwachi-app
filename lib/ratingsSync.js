// lib/ratingsSync.js
// کپی نمایشیِ امتیازها داخل data.json (مقیاس ۵ تایی، هم‌سان با خودِ سیستم امتیازدهی).
// منبع اصلی همیشه Supabase است؛ این job فقط دو فیلد را در data.json به‌روز می‌کند:
//   score         → میانگین از ۵، رشته با یک رقم اعشار (مثل "4.3") - هم‌شکل با فیلد فعلی
//   rating_count  → تعداد رأی‌ها
// بقیه‌ی فیلدهای data.json دست‌نخورده می‌مانند.
const fs = require("fs");
const path = require("path");

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

module.exports = function createRatingsSync({ dataFilePath, supabaseUrl, adminHeaders, reload, log = console }) {
  let running = false;

  async function fetchTotals() {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/manhwa_rating_totals`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`manhwa_rating_totals ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error("manhwa_rating_totals: پاسخ نامعتبر");
    return rows;
  }

  // خواندن → تغییر → نوشتن، همه هم‌زمان (sync) تا بین خواندن و نوشتن
  // هیچ نوشتن دیگه‌ای (مثلاً پنل ادمین در همین پروسه) فاصله نیفته.
  function patchFile(rows) {
    const raw = fs.readFileSync(dataFilePath, "utf8");
    const data = JSON.parse(raw);

    const byslug = new Map();
    for (const t of rows) if (typeof t?.slug === "string") byslug.set(t.slug, t);

    let changed = 0;
    for (const slug of Object.keys(data)) {
      const m = data[slug];
      if (!m || typeof m !== "object") continue;
      const t = byslug.get(slug);
      const count = Number(t?.total) || 0;

      if (count > 0) {
        const score = (Number(t.average) || 0).toFixed(1);
        if (m.score !== score || m.rating_count !== count) {
          m.score = score;
          m.rating_count = count;
          changed++;
        }
      } else if (m.rating_count) {
        // همه‌ی رأی‌ها حذف شدن؛ score قبلی دست‌نخورده می‌مونه
        m.rating_count = 0;
        changed++;
      }
    }
    if (!changed) return 0;

    const endsWithNl = raw.endsWith("\n");
    const out = JSON.stringify(data, null, 2) + (endsWithNl ? "\n" : "");
    const tmp = path.join(path.dirname(dataFilePath), `.${path.basename(dataFilePath)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, out, "utf8");
    fs.renameSync(tmp, dataFilePath); // جایگزینی اتمیک؛ فایل هیچ‌وقت نصفه نمی‌مونه
    return changed;
  }

  async function run() {
    if (running) return { skipped: true };
    running = true;
    try {
      const rows = await fetchTotals();
      const changed = patchFile(rows);
      if (changed) {
        try { reload && reload(); } catch (e) { log.error("[ratingsSync] reload failed:", e.message); }
      }
      log.log(`[ratingsSync] ${changed} مانهوا به‌روز شد`);
      return { changed };
    } catch (err) {
      log.error("[ratingsSync] failed:", err.message);
      return { error: err.message };
    } finally {
      running = false;
    }
  }

  // اولین اجرا ۶۰ ثانیه بعد از بالا آمدن سرور، بعد هر ۲۴ ساعت
  function start({ firstDelayMs = 60_000, everyMs = 24 * 60 * 60 * 1000 } = {}) {
    setTimeout(run, firstDelayMs).unref();
    setInterval(run, everyMs).unref();
  }

  return { run, start };
};

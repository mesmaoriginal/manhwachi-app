// blog/blockSchema.js
//
// تصمیم امنیتی کلیدی: محتوای مقاله هیچ‌وقت HTML ذخیره نمی‌کنه. متن هر بلوک
// آرایه‌ای از «run» هاست: { t: "متن", b:1, i:1, u:1, s:1, code:1, c:"#rrggbb",
// h:"#rrggbb", z:"lg", f:"naskh", a:{href, blank} }. سرور فقط همین فیلدهای
// مجاز رو (با اعتبارسنجی سخت‌گیرانه) نگه می‌داره و رندر عمومی همه‌چیز رو
// escape می‌کنه؛ پس حتی اگه حساب یک نویسنده هک بشه، راهی برای تزریق
// اسکریپت به سایت نیست. هر فیلد ناشناخته‌ای دور ریخته می‌شه.

class SchemaError extends Error {}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const SIZES = ["sm", "lg", "xl", "2xl"];
const FONTS = ["vazir", "naskh", "kufi", "mono"];
const ALIGNS = ["right", "center", "left", "justify"];
const TONES = ["info", "warn", "success", "danger"];
const IMG_WIDTHS = ["sm", "md", "lg", "full"];
const MAX_BLOCKS = 300;
const MAX_RUNS = 600;
const MAX_RUN_CHARS = 5000;
const MAX_LIST_ITEMS = 100;
const MAX_CODE_CHARS = 20000;
const MAX_TABLE_ROWS = 40;
const MAX_TABLE_COLS = 8;
const MAX_FAQ_ITEMS = 20;
const CODE_LANGS = ["", "js", "ts", "html", "css", "json", "python", "php", "sql", "bash", "java", "kotlin", "xml", "yaml"];

const fail = (msg) => {
  throw new SchemaError(msg);
};

function cleanText(s, max) {
  // کاراکترهای کنترلی (به جز \n) حذف می‌شن
  return String(s ?? "").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").slice(0, max);
}

function safeHref(h) {
  const s = String(h || "").trim();
  if (
    s.length <= 800 &&
    (/^(https?:\/\/|mailto:)[^\s<>"'`\\]+$/i.test(s) || /^\/(?!\/)[^\s<>"'`\\]*$/.test(s) || /^#[\w-]+$/.test(s))
  ) {
    return s;
  }
  return fail("یکی از لینک‌ها نامعتبر است (فقط http/https، mailto، مسیر داخلی یا #)");
}

function safeUrl(u, field) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.length > 1000 || !/^(https:\/\/|\/(?!\/))[^\s<>"'`\\]*$/.test(s)) return fail(`${field} نامعتبر است`);
  return s;
}

function normRuns(runs) {
  if (runs === undefined) return [];
  if (!Array.isArray(runs) || runs.length > MAX_RUNS) return fail("متن بلوک نامعتبر است");
  const out = [];
  for (const r of runs) {
    if (!r || typeof r !== "object") return fail("متن بلوک نامعتبر است");
    const t = cleanText(r.t, MAX_RUN_CHARS);
    if (!t) continue;
    const n = { t };
    for (const k of ["b", "i", "u", "s", "code"]) if (r[k]) n[k] = 1;
    if (typeof r.c === "string" && COLOR_RE.test(r.c)) n.c = r.c.toLowerCase();
    if (typeof r.h === "string" && COLOR_RE.test(r.h)) n.h = r.h.toLowerCase();
    if (SIZES.includes(r.z)) n.z = r.z;
    if (FONTS.includes(r.f)) n.f = r.f;
    if (r.a && typeof r.a === "object" && r.a.href) {
      n.a = { href: safeHref(r.a.href) };
      if (r.a.blank) n.a.blank = 1;
    }
    out.push(n);
  }
  return out;
}

// بلوکِ بدون محتوا (فقط فاصله/خالی) ذخیره نمی‌شه؛ تگ خالیِ <h2></h2> یا <p></p>
// برای سئو و دسترس‌پذیری بده.
const isBlank = (runs) => !runs.some((r) => r.t.trim());

const align = (v) => (ALIGNS.includes(v) ? v : "right");

function normBlock(b) {
  if (!b || typeof b !== "object" || Array.isArray(b) || typeof b.type !== "string") return fail("ساختار یکی از بلوک‌ها نامعتبر است");
  const d = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : {};

  // بلوک‌های ناقص (خالی) null برمی‌گردونن و حذف می‌شن؛ مقدار پُر ولی نامعتبر خطا می‌ده.
  switch (b.type) {
    case "paragraph": {
      const runs = normRuns(d.runs);
      return isBlank(runs) ? null : { type: "paragraph", data: { runs, al: align(d.al) } };
    }

    case "heading": {
      const level = [2, 3, 4].includes(Number(d.level)) ? Number(d.level) : 2;
      const runs = normRuns(d.runs);
      return isBlank(runs) ? null : { type: "heading", data: { level, runs, al: align(d.al) } };
    }

    case "list": {
      if (!Array.isArray(d.items) || d.items.length > MAX_LIST_ITEMS) return fail("لیست نامعتبر است");
      const items = d.items.map(normRuns).filter((r) => !isBlank(r));
      return items.length ? { type: "list", data: { ordered: !!d.ordered, items } } : null;
    }

    case "quote": {
      const runs = normRuns(d.runs);
      return isBlank(runs) ? null : { type: "quote", data: { runs, cite: cleanText(d.cite, 120).replace(/\n+/g, " ").trim(), al: align(d.al) } };
    }

    case "callout": {
      const runs = normRuns(d.runs);
      return isBlank(runs) ? null : { type: "callout", data: { tone: TONES.includes(d.tone) ? d.tone : "info", runs } };
    }

    case "image": {
      const src = safeUrl(d.src, "آدرس تصویر");
      if (!src) return null;
      return {
        type: "image",
        data: {
          src,
          alt: cleanText(d.alt, 200).replace(/\s+/g, " ").trim(),
          caption: cleanText(d.caption, 300).replace(/\n+/g, " ").trim(),
          width: IMG_WIDTHS.includes(d.width) ? d.width : "lg",
          al: ["right", "center", "left"].includes(d.al) ? d.al : "center",
        },
      };
    }

    case "button": {
      const text = cleanText(d.text, 60).replace(/\s+/g, " ").trim();
      const href = d.href && String(d.href).trim() ? safeHref(d.href) : "";
      if (!text || !href) return null;
      return {
        type: "button",
        data: {
          text,
          href,
          style: d.style === "outline" ? "outline" : "solid",
          al: ["right", "center", "left"].includes(d.al) ? d.al : "center",
        },
      };
    }

    case "manhwa_card": {
      const slug = String(d.slug || "").trim();
      if (!slug) return null;
      if (!/^[\p{L}\p{N}_.-]{1,120}$/u.test(slug)) return fail("مانهوای انتخاب‌شده نامعتبر است");
      return { type: "manhwa_card", data: { slug, style: d.style === "banner" ? "banner" : "card" } };
    }

    case "video": {
      const id = String(d.id || "").trim();
      if (!id) return null;
      const provider = d.provider === "aparat" ? "aparat" : "youtube";
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return fail("شناسه‌ی ویدیو نامعتبر است");
      return { type: "video", data: { provider, id } };
    }

    case "code": {
      // کد فقط متن خام است (بدون run)؛ رندر عمومی آن را escape می‌کند.
      const code = String(d.code ?? "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_CODE_CHARS);
      if (!code.trim()) return null;
      return { type: "code", data: { code, lang: CODE_LANGS.includes(d.lang) ? d.lang : "" } };
    }

    case "table": {
      if (!Array.isArray(d.rows) || d.rows.length > MAX_TABLE_ROWS) return fail("جدول نامعتبر است (حداکثر " + MAX_TABLE_ROWS + " سطر)");
      const rows = d.rows.map((r) => {
        if (!Array.isArray(r) || r.length > MAX_TABLE_COLS) return fail("جدول نامعتبر است (حداکثر " + MAX_TABLE_COLS + " ستون)");
        return r.map((c) => cleanText(c, 400).replace(/\n+/g, " ").trim());
      });
      // سطرِ کاملاً خالی حذف می‌شود؛ تعداد ستون‌ها یکسان می‌شود
      const kept = rows.filter((r) => r.some(Boolean));
      if (!kept.length) return null;
      const cols = Math.max(...kept.map((r) => r.length));
      return { type: "table", data: { header: !!d.header, rows: kept.map((r) => Array.from({ length: cols }, (_, i) => r[i] || "")) } };
    }

    case "faq": {
      // سؤال‌های متداول؛ در صفحه‌ی عمومی به‌صورت آکاردئون و FAQPage JSON-LD (نتیجه‌ی غنی گوگل) رندر می‌شود.
      if (!Array.isArray(d.items) || d.items.length > MAX_FAQ_ITEMS) return fail("سؤال‌های متداول نامعتبر است (حداکثر " + MAX_FAQ_ITEMS + " مورد)");
      const items = d.items
        .map((it) => ({
          q: cleanText(it && it.q, 300).replace(/\n+/g, " ").trim(),
          a: cleanText(it && it.a, 2000).trim(),
        }))
        .filter((it) => it.q && it.a);
      return items.length ? { type: "faq", data: { items } } : null;
    }

    case "divider":
      return { type: "divider", data: {} };

    default:
      return fail("نوع بلوک پشتیبانی نمی‌شود");
  }
}

function normalizeBlocks(content) {
  if (!Array.isArray(content)) return fail("محتوا باید آرایه‌ای از بلوک‌ها باشد");
  if (content.length > MAX_BLOCKS) return fail(`حداکثر ${MAX_BLOCKS} بلوک مجاز است`);
  return content.map(normBlock).filter(Boolean);
}

module.exports = { SchemaError, normalizeBlocks, normRuns, safeHref, SIZES, FONTS, CODE_LANGS };

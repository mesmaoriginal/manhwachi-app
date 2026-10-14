// blog/blogRender.js
// تبدیل بلوک‌های JSON به HTML امن برای صفحه‌ی عمومی. این فایل «خالص» است (بدون دیتابیس/اکسپرس)
// تا راحت تست شود. هیچ HTML خامی از کاربر رندر نمی‌شود: همه‌چیز escape می‌شود و آدرس‌ها
// دوباره (دفاع در عمق) اعتبارسنجی می‌شوند.

const { safeHref } = require("./blockSchema");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const IMG_SRC_RE = /^(https:\/\/|\/(?!\/))[^\s<>"'`\\]*$/;
const WIDTH_CLASS = { sm: "w-sm", md: "w-md", lg: "w-lg", full: "w-full" };
const ZCLASS = { sm: "z-sm", lg: "z-lg", xl: "z-xl", "2xl": "z-2xl" };
const FCLASS = { vazir: "f-vazir", naskh: "f-naskh", kufi: "f-kufi", mono: "f-mono" };

function okHref(h) {
  try {
    return safeHref(h);
  } catch {
    return "";
  }
}

// ---------- متن غنی ----------
function runsToHtml(runs) {
  return (runs || [])
    .map((r) => {
      let h = esc(r.t).replace(/\n/g, "<br>");
      const cls = [];
      const st = [];
      if (r.z && ZCLASS[r.z]) cls.push(ZCLASS[r.z]);
      if (r.f && FCLASS[r.f]) cls.push(FCLASS[r.f]);
      if (r.u) cls.push("tu");
      if (r.s) cls.push("ts");
      if (typeof r.c === "string" && COLOR_RE.test(r.c)) st.push("color:" + r.c);
      if (typeof r.h === "string" && COLOR_RE.test(r.h)) st.push("background:" + r.h + ";border-radius:4px;padding:0 3px");
      if (cls.length || st.length) h = `<span${cls.length ? ` class="${cls.join(" ")}"` : ""}${st.length ? ` style="${st.join(";")}"` : ""}>${h}</span>`;
      if (r.b) h = `<strong>${h}</strong>`;
      if (r.i) h = `<em>${h}</em>`;
      if (r.code) h = `<code>${h}</code>`;
      if (r.a && r.a.href) {
        const href = okHref(r.a.href);
        if (href) {
          const ext = /^https?:/i.test(href);
          h = `<a href="${esc(href)}"${r.a.blank || ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${h}</a>`;
        }
      }
      return h;
    })
    .join("");
}

const runsText = (runs) => (runs || []).map((r) => r.t).join("");

// ---------- شناسه‌ی عنوان‌ها (برای لینک مستقیم و فهرست مطالب) ----------
function headingSlug(s) {
  return String(s || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/\u0640/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ---------- متن ساده (جستجو، تعداد کلمات، توضیح خودکار) ----------
function blockText(b) {
  const d = b.data || {};
  switch (b.type) {
    case "paragraph":
    case "heading":
    case "quote":
    case "callout":
      return runsText(d.runs);
    case "list":
      return (d.items || []).map(runsText).join(" ");
    case "table":
      return (d.rows || []).map((r) => r.join(" ")).join(" ");
    case "faq":
      return (d.items || []).map((i) => i.q + " " + i.a).join(" ");
    case "image":
      return d.caption || "";
    default:
      return ""; // کد، دکمه، ویدیو، ... در جستجو و شمارش کلمات نمی‌آیند
  }
}

function plainText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map(blockText)
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

// زمان مطالعه: حدود ۱۸۰ کلمه در دقیقه برای فارسی
const readingMinutes = (words) => Math.max(1, Math.round((Number(words) || 0) / 180));

// ---------- رندر بلوک‌ها ----------
// opts.manhwa(slug) → { title, cover, url } یا null
function renderBlocks(blocks, opts = {}) {
  const toc = [];
  const faq = [];
  const usedIds = new Map();
  const out = [];
  let firstImage = true;

  const uniqueId = (text) => {
    const base = headingSlug(text) || "section";
    const n = usedIds.get(base) || 0;
    usedIds.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };
  const al = (v) => (["center", "left", "justify"].includes(v) ? ` class="al-${v}"` : "");

  for (const b of Array.isArray(blocks) ? blocks : []) {
    const d = b.data || {};
    switch (b.type) {
      case "paragraph":
        out.push(`<p${al(d.al)}>${runsToHtml(d.runs)}</p>`);
        break;

      case "heading": {
        const level = [2, 3, 4].includes(Number(d.level)) ? Number(d.level) : 2;
        const text = runsText(d.runs).trim();
        const id = uniqueId(text);
        if (level <= 3) toc.push({ id, level, text });
        out.push(`<h${level} id="${esc(id)}"${al(d.al)}>${runsToHtml(d.runs)}<a class="anc" href="#${esc(id)}" aria-label="لینک به این بخش">#</a></h${level}>`);
        break;
      }

      case "list": {
        const tag = d.ordered ? "ol" : "ul";
        out.push(`<${tag}>${(d.items || []).map((r) => `<li>${runsToHtml(r)}</li>`).join("")}</${tag}>`);
        break;
      }

      case "quote":
        out.push(`<blockquote${al(d.al)}><p>${runsToHtml(d.runs)}</p>${d.cite ? `<cite>${esc(d.cite)}</cite>` : ""}</blockquote>`);
        break;

      case "callout": {
        const tone = ["info", "warn", "success", "danger"].includes(d.tone) ? d.tone : "info";
        out.push(`<aside class="callout c-${tone}" role="note">${runsToHtml(d.runs)}</aside>`);
        break;
      }

      case "image": {
        if (!IMG_SRC_RE.test(String(d.src || ""))) break;
        const w = Number(d.w) > 0 && Number(d.h) > 0 ? ` width="${Number(d.w)}" height="${Number(d.h)}"` : "";
        // اولین تصویر داخل متن ممکن است بالای صفحه باشد؛ برای LCP lazy نمی‌شود.
        const load = firstImage && !opts.hasCover ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
        firstImage = false;
        const a = ["center", "left"].includes(d.al) ? `a-${d.al}` : "a-right";
        const img = `<img src="${esc(d.src)}" alt="${esc(d.alt)}"${w}${load}>`;
        out.push(
          `<figure class="img ${WIDTH_CLASS[d.width] || "w-lg"} ${a}">${img}${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ""}</figure>`
        );
        break;
      }

      case "button": {
        const href = okHref(d.href);
        if (!href || !d.text) break;
        const ext = /^https?:/i.test(href);
        out.push(
          `<p class="btnrow al-${["right", "left"].includes(d.al) ? d.al : "center"}"><a class="btn ${d.style === "outline" ? "btn-o" : "btn-s"}" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(d.text)}</a></p>`
        );
        break;
      }

      case "manhwa_card": {
        const m = opts.manhwa ? opts.manhwa(String(d.slug || "")) : null;
        if (!m || !m.url) break; // مانهوای حذف‌شده: کارت نمایش داده نمی‌شود
        const cover = m.cover && IMG_SRC_RE.test(m.cover) ? `<img src="${esc(m.cover)}" alt="${esc(m.title)}" loading="lazy" decoding="async">` : "";
        out.push(
          `<a class="mcard ${d.style === "banner" ? "mc-banner" : ""}" href="${esc(m.url)}">${cover}<span><b>${esc(m.title)}</b>${m.subtitle ? `<small>${esc(m.subtitle)}</small>` : ""}<em>مشاهده‌ی مانهوا ←</em></span></a>`
        );
        break;
      }

      case "video": {
        const id = String(d.id || "");
        if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) break;
        const src =
          d.provider === "aparat"
            ? `https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame`
            : `https://www.youtube-nocookie.com/embed/${id}`;
        out.push(
          `<div class="video"><iframe src="${esc(src)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" title="ویدیو"></iframe></div>`
        );
        break;
      }

      case "code": {
        const lang = String(d.lang || "").replace(/[^a-z]/g, "");
        out.push(`<div class="code"><button type="button" class="copy" data-copy>کپی</button><pre dir="ltr"><code${lang ? ` class="lang-${lang}"` : ""}>${esc(d.code)}</code></pre></div>`);
        break;
      }

      case "table": {
        const rows = Array.isArray(d.rows) ? d.rows : [];
        if (!rows.length) break;
        const head = d.header ? `<thead><tr>${rows[0].map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>` : "";
        const body = (d.header ? rows.slice(1) : rows).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
        out.push(`<div class="tbl"><table>${head}<tbody>${body}</tbody></table></div>`);
        break;
      }

      case "faq": {
        const items = Array.isArray(d.items) ? d.items : [];
        if (!items.length) break;
        for (const it of items) faq.push({ q: it.q, a: it.a });
        out.push(
          `<section class="faq" aria-label="سؤال‌های متداول">${items
            .map((it) => `<details><summary>${esc(it.q)}</summary><p>${esc(it.a).replace(/\n/g, "<br>")}</p></details>`)
            .join("")}</section>`
        );
        break;
      }

      case "divider":
        out.push("<hr>");
        break;
    }
  }
  return { html: out.join("\n"), toc, faq };
}

module.exports = { esc, runsToHtml, runsText, headingSlug, plainText, countWords, readingMinutes, renderBlocks };

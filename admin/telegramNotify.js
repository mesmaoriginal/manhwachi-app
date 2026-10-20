// admin/telegramNotify.js
//
// ارسال خودکار پست «چپتر جدید» به کانال تلگرام.
// env لازم:
//   TELEGRAM_BOT_TOKEN   توکن ربات (از BotFather)
//   TELEGRAM_CHANNEL_ID  مثل @manhwachi یا -100xxxxxxxxxx (ربات باید ادمین کانال باشه)
// اختیاری:
//   TELEGRAM_API_BASE    آدرس پروکسی/رله (پیش‌فرض https://api.telegram.org)
//   SITE_URL             پیش‌فرض https://manhwachi.ir
//   MANHWAS_DIR          مسیر پوشه‌ی manhwas روی دیسک سرور (اگه ست باشه عکس از دیسک خونده می‌شه)
//
// برای تبدیل webp به jpeg پیشنهاد می‌شه:  npm i sharp

const fs = require("fs");
const path = require("path");

const SITE_URL = (process.env.SITE_URL || "https://manhwachi.ir").replace(/\/$/, "");

let sharp = null;
try { sharp = require("sharp"); } catch { /* اختیاری */ }

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function faDigits(n) {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

function hashtag(g) {
  const t = String(g).trim().replace(/[\s\-]+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
  return t ? "#" + t : "";
}

function shorten(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[،,.\s—-]+$/, "") + "…";
}

function buildCaption(m, num) {
  const title = m.title_fa || m.title_en || "";
  const L = [];

  L.push("🔥 <b>چپتر جدید منتشر شد!</b>", "");
  L.push(`📖 <b>${esc(title)}</b>`);
  if (m.title_fa && m.title_en) L.push(`<i>${esc(m.title_en)}</i>`);
  L.push("", "▬▬▬▬▬▬▬▬▬▬▬▬");
  L.push(`✨ چپتر <b>${faDigits(num)}</b> همین الان آپدیت شد`);

  const info = [];
  if (m.score) info.push(`⭐ ${faDigits(m.score)}`);
  if (m.origin) info.push(`🌏 ${esc(m.origin)}`);
  if (m.type) info.push(`📚 ${esc(m.type)}`);
  if (info.length) L.push(info.join("  •  "));

  const tags = (Array.isArray(m.genres) ? m.genres : []).map(hashtag).filter(Boolean).slice(0, 5);
  if (tags.length) L.push("", "🎭 " + tags.join(" "));
  if (m.scans_by) L.push(`✍️ ترجمه: ${esc(m.scans_by)}`);

  const tail = ["", "👇 همین حالا بخون"];
  const base = L.concat(tail).join("\n");

  if (m.description) {
    for (const max of [220, 150, 90]) {
      const block = `<blockquote expandable>${esc(shorten(m.description, max))}</blockquote>`;
      const full = L.concat(["", block], tail).join("\n");
      if (full.length <= 1000) return full;
    }
  }
  return base.slice(0, 1024);
}
function apiBase() {
  return (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
}

async function parse(res) {
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.description || `HTTP ${res.status}`);
  return json;
}

async function tg(method, body) {
  const res = await fetch(`${apiBase()}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return parse(res);
}

async function tgUpload(method, fields, fileField, buffer, filename, mime) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  form.append(fileField, new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${apiBase()}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  return parse(res);
}

// عکس کاور رو از دیسک (اگه MANHWAS_DIR ست باشه) یا از سایت می‌خونه
async function loadCover(slug, file) {
  if (process.env.MANHWAS_DIR) {
    const p = path.join(process.env.MANHWAS_DIR, slug, file);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  const url = `${SITE_URL}/manhwas/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`دانلود کاور ناموفق: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// تبدیل به JPEG (تلگرام با webp/حجم بالا مشکل داره)
async function toJpeg(buf) {
  if (!sharp) return { buf, name: "cover.webp", mime: "image/webp" };
  const out = await sharp(buf)
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#000" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { buf: out, name: "cover.jpg", mime: "image/jpeg" };
}

// هیچ‌وقت throw نمی‌کنه؛ خطا فقط تو لاگ میاد تا ثبت چپتر خراب نشه.
async function notifyNewChapter(slug, manhwa, num) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !chat_id) return;

  try {
const caption = buildCaption(manhwa, num);
    const comicUrl = `${SITE_URL}/comic/${encodeURIComponent(slug)}`;
    const reply_markup = {
      inline_keyboard: [[{ text: `📖 خواندن چپتر ${faDigits(num)}`, url: comicUrl }]],
    };

    if (manhwa.cover_image) {
      // تلاش ۱: آپلود مستقیم فایل
      try {
        const raw = await loadCover(slug, manhwa.cover_image);
        const img = await toJpeg(raw);
        await tgUpload(
          "sendPhoto",
          { chat_id, caption, parse_mode: "HTML", reply_markup },
          "photo", img.buf, img.name, img.mime
        );
        return;
      } catch (e) {
        console.warn("[telegram] آپلود کاور ناموفق:", e.message);
      }
      // تلاش ۲: ارسال با لینک
      try {
        const photo = `${SITE_URL}/manhwas/${encodeURIComponent(slug)}/${encodeURIComponent(manhwa.cover_image)}`;
        await tg("sendPhoto", { chat_id, photo, caption, parse_mode: "HTML", reply_markup });
        return;
      } catch (e) {
        console.warn("[telegram] sendPhoto با لینک ناموفق، پیام متنی می‌فرستیم:", e.message);
      }
    }

    await tg("sendMessage", {
      chat_id,
      text: caption,
      parse_mode: "HTML",
      reply_markup,
      link_preview_options: { url: comicUrl },
    });
  } catch (err) {
    console.warn("[telegram] ارسال پست ناموفق:", err.message);
  }
}

module.exports = { notifyNewChapter };
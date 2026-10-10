// admin/telegramNotify.js
//
// ارسال خودکار پست «چپتر جدید» به کانال تلگرام.
// env لازم:
//   TELEGRAM_BOT_TOKEN   توکن ربات (از BotFather)
//   TELEGRAM_CHANNEL_ID  مثل @manhwachi یا -100xxxxxxxxxx (ربات باید ادمین کانال باشه)
// اختیاری:
//   TELEGRAM_API_BASE    اگه سرور ایران مستقیم به تلگرام وصل نمی‌شه، آدرس
//                        پروکسی/رله‌ی خودت (پیش‌فرض https://api.telegram.org)
//   SITE_URL             پیش‌فرض https://manhwachi.ir

const SITE_URL = (process.env.SITE_URL || "https://manhwachi.ir").replace(/\/$/, "");

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

function buildCaption(m, num, free) {
  const title = m.title_fa || m.title_en || "";
  const lines = [
    "🔥 <b>چپتر جدید منتشر شد!</b>",
    "",
    `📖 <b>${esc(title)}</b>`,
  ];
  if (m.title_fa && m.title_en) lines.push(`<i>${esc(m.title_en)}</i>`);
  lines.push("", `✨ چپتر <b>${faDigits(num)}</b> همین الان آپدیت شد`);
  lines.push(free ? "🆓 رایگان" : "👑 ویژه (VIP)");

  const tags = (Array.isArray(m.genres) ? m.genres : []).map(hashtag).filter(Boolean).slice(0, 5);
  if (tags.length) lines.push("", "🎭 " + tags.join(" "));
  if (m.scans_by) lines.push(`✍️ ترجمه: ${esc(m.scans_by)}`);
  lines.push("", "👇 همین حالا بخون");
  return lines.join("\n").slice(0, 1024);
}

async function tg(method, body) {
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const res = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.description || `HTTP ${res.status}`);
  return json;
}

// هیچ‌وقت throw نمی‌کنه؛ خطا فقط تو لاگ میاد تا ثبت چپتر خراب نشه.
async function notifyNewChapter(slug, manhwa, num, free = true) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !chat_id) return;

  try {
    const caption = buildCaption(manhwa, num, free);
    const comicUrl = `${SITE_URL}/comic/${encodeURIComponent(slug)}`;
    const reply_markup = {
      inline_keyboard: [[{ text: `📖 خواندن چپتر ${faDigits(num)}`, url: comicUrl }]],
    };

    if (manhwa.cover_image) {
      const photo = `${SITE_URL}/manhwas/${encodeURIComponent(slug)}/${manhwa.cover_image}`;
      try {
        await tg("sendPhoto", { chat_id, photo, caption, parse_mode: "HTML", reply_markup });
        return;
      } catch (e) {
        console.warn("[telegram] sendPhoto ناموفق، به پیام متنی برمی‌گردیم:", e.message);
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

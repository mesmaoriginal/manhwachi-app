// lib/localdb/notify.js — اعلان تلگرام برای نظر جدید (اختیاری؛ فقط اگر TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID ست باشد)
// اگر هاست به api.telegram.org نمی‌رسد، TELEGRAM_API_BASE را روی آدرس رله بگذارید.
function newMessage(row) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
  const text = `💬 نظر جدید (در انتظار تایید)\nمانهوا: ${row.manhwa_slug || "-"}\nاز: ${row.name}\n\n${String(row.text || "").slice(0, 500)}`;
  const f = globalThis.__realFetch || globalThis.fetch;
  f(`${base}/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(8000) })
    .catch((e) => console.warn("[notify] تلگرام ناموفق:", e.message));
}
module.exports = { newMessage };

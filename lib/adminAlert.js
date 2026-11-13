// lib/adminAlert.js — اعلان تلگرام برای ادمین‌ها (نظر جدید، همکاری، تیکت، گزارش چپتر، درخواست مانهوا، پرداخت، برداشت تیم)
//
// env:
//   TELEGRAM_BOT_TOKEN        توکن ربات (BotFather)
//   TELEGRAM_ADMIN_CHAT_IDS   آیدی عددی چت ادمین‌ها، جداشده با کاما:  123456789,987654321
//                             (هر ادمین باید یک‌بار /start بزند به ربات؛ برای گروه هم آیدی گروه مثل -100123... کار می‌کند)
//   TELEGRAM_CHAT_ID          (قدیمی) اگر TELEGRAM_ADMIN_CHAT_IDS نباشد از این استفاده می‌شود؛ می‌تواند چندتا هم باشد
//   TELEGRAM_TEAM_CHANNEL_ID  کانال/گروه تیم برای اعلان «کار جدید» (مثل @manhwachi_team یا -100123...؛ ربات باید ادمین کانال باشد)
// اختیاری:
//   TELEGRAM_API_BASE         آدرس رله/پروکسی (پیش‌فرض https://api.telegram.org)
//   SITE_URL                  پیش‌فرض https://manhwachi.ir
//   ALERT_DISABLED            لیست نوع‌های خاموش، مثلاً: payment,report
//
// هیچ‌وقت throw نمی‌کند و کار اصلی سایت را کند نمی‌کند (صف + ارسال پس‌زمینه).

const SITE_URL = (process.env.SITE_URL || "https://manhwachi.ir").replace(/\/$/, "");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
const fmt = (n) => Number(n || 0).toLocaleString("fa-IR");

function chatIds() {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "";
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}
function disabled(kind) {
  return (process.env.ALERT_DISABLED || "").split(",").map((s) => s.trim()).filter(Boolean).includes(kind);
}

// ---- صف ارسال: پشت‌سرهم و با فاصله تا به محدودیت تلگرام نخوریم ----
const queue = [];
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { chat_id, text, url, button } = queue.shift();
    const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
    const f = globalThis.__realFetch || globalThis.fetch;
    const body = { chat_id, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true };
    if (url) body.reply_markup = { inline_keyboard: [[{ text: button || "باز کردن", url }]] };
    try {
      const res = await f(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429) { // محدودیت تلگرام: صبر کن و دوباره
        const wait = ((j.parameters && j.parameters.retry_after) || 3) * 1000;
        queue.unshift({ chat_id, text, url, button });
        await new Promise((r) => setTimeout(r, wait));
      } else if (!j.ok) console.warn(`[alert] تلگرام (${chat_id}):`, j.description || res.status);
    } catch (e) { console.warn(`[alert] تلگرام (${chat_id}):`, e.message); }
    await new Promise((r) => setTimeout(r, 120));
  }
  running = false;
}

function send(kind, text, url, button, targets) {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || disabled(kind)) return;
    for (const chat_id of targets || chatIds()) queue.push({ chat_id, text, url, button });
    if (queue.length > 200) queue.splice(0, queue.length - 200); // جلوگیری از انباشت اگر تلگرام قطع بود
    setImmediate(pump);
  } catch (e) { console.warn("[alert]", e.message); }
}

// نام کاربر از جدول profiles (اگر نبود شناسه کوتاه)
function userName(id) {
  if (!id) return "ناشناس";
  try {
    const r = require("./localdb/sqlite").get("SELECT full_name FROM profiles WHERE id = ?", [id]);
    return (r && r.full_name) || String(id).slice(0, 8);
  } catch { return String(id).slice(0, 8); }
}

const line = (label, v) => (v ? `${label}: ${esc(v)}\n` : "");

// ---- کار جدید تیم → کانال تیم (چند کار پشت‌سرهم در یک پیام جمع می‌شوند) ----
const ROLE_FA = { typist: "تایپیست", font: "تغییر دهنده فونت", translator: "مترجم", cleaner: "کلینر" };
let taskBuf = [], taskTimer = null;
function flushTasks() {
  taskTimer = null;
  const list = taskBuf; taskBuf = [];
  const ch = (process.env.TELEGRAM_TEAM_CHANNEL_ID || "").trim();
  if (!ch || !list.length) return;
  const by = {};
  for (const t of list) (by[t.role] = by[t.role] || []).push(t);
  let text = `🆕 <b>${list.length > 1 ? list.length + " کار جدید" : "کار جدید"} آزاد شد!</b>\n`;
  for (const [role, ts] of Object.entries(by)) {
    text += `\n🔹 <b>${esc(ROLE_FA[role] || role)}</b>\n`;
    for (const t of ts.slice(0, 15)) {
      text += `• ${esc(cut(t.label || t.title || "—", 60))}${t.reward_tokens ? ` — ${fmt(t.reward_tokens)} توکن` : ""}\n`;
    }
    if (ts.length > 15) text += `… و ${fmt(ts.length - 15)} مورد دیگر\n`;
  }
  text += `\n👇 هر کس زودتر بردارد، کار برای او می‌شود.`;
  send("team-task", text, `${SITE_URL}/team.html`, "ورود به پنل تیم", [ch]);
}

const alerts = {
  teamTask(r) {
    try {
      if (!process.env.TELEGRAM_TEAM_CHANNEL_ID || disabled("team-task")) return;
      taskBuf.push({ role: r.role, label: r.label, title: r.title, reward_tokens: r.reward_tokens });
      if (!taskTimer) taskTimer = setTimeout(flushTasks, 8000); // ۸ ثانیه صبر کن تا کارهای هم‌زمان یکی شوند
    } catch (e) { console.warn("[alert]", e.message); }
  },
  comment(r) {
    send("comment",
      `💬 <b>نظر جدید</b> (در انتظار تایید)\n` +
      line("مانهوا", r.manhwa_slug) + line("از", r.name) +
      `\n${esc(cut(r.text, 600))}`,
      `${SITE_URL}/admin-comments.html`, "بررسی نظرها");
  },
  application(r) {
    send("application",
      `🤝 <b>درخواست همکاری جدید</b>\n` +
      line("سمت", r.role) + line("نام", r.full_name) + line("سن", r.age) +
      line("پلتفرم", r.platform) + line("آیدی", r.social_id) +
      (r.bio ? `\n${esc(cut(r.bio, 500))}` : ""),
      `${SITE_URL}/team-admin.html`, "پنل تیم");
  },
  supportTicket(r) {
    send("ticket",
      `🎫 <b>تیکت پشتیبانی جدید</b>${r.priority ? " ⭐ (پرمیوم)" : ""}\n` +
      line("کاربر", userName(r.user_id)) + line("موضوع", r.subject) +
      `\n${esc(cut(r.message, 600))}`);
  },
  teamTicket(r) {
    send("team-ticket",
      `🧑‍💻 <b>تیکت جدید از کارمند تیم</b>\n` + line("کارمند", userName(r.user_id)) +
      `\n${esc(cut(r.message, 600))}`,
      `${SITE_URL}/team-admin.html`, "پنل تیم");
  },
  withdrawal(r) {
    send("withdraw",
      `💸 <b>درخواست برداشت تیم</b>\n` + line("کارمند", userName(r.user_id)) +
      `مبلغ: ${fmt(Number(r.tokens) * Number(r.toman_per_token))} تومان\n`,
      `${SITE_URL}/team-admin.html`, "پنل تیم");
  },
  chapterReport(r) {
    send("report",
      `🚨 <b>گزارش مشکل چپتر</b>\n` + line("مانهوا", r.slug) +
      line("چپتر", r.chapter_num) + line("صفحه", r.page) +
      `\n${esc(cut(r.message, 600))}`,
      r.slug ? `${SITE_URL}/comic/${encodeURIComponent(r.slug)}` : undefined, "صفحه مانهوا");
  },
  manhwaRequest(r) {
    send("request",
      `📚 <b>درخواست مانهوای جدید</b> (پرمیوم)\n` +
      line("کاربر", userName(r.user_id)) + line("نام", r.title) + line("لینک", r.link) +
      (r.note ? `\n${esc(cut(r.note, 400))}` : ""));
  },
  payment(r) {
    send("payment",
      `💰 <b>پرداخت موفق VIP</b>\n` + line("کاربر", userName(r.user_id)) +
      line("پلن", r.plan_key) + `مبلغ: ${fmt(r.amount)}\n` + line("کد پیگیری", r.ref_number));
  },
};

module.exports = { ...alerts, send, esc };

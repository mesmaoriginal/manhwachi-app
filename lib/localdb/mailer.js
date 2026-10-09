// lib/localdb/mailer.js — ارسال ایمیل کد تایید / بازیابی رمز با SMTP (nodemailer)
// env: SMTP_HOST, SMTP_PORT (پیش‌فرض 465), SMTP_SECURE (true/1 یا false؛ پیش‌فرض: true اگر پورت 465 باشد),
//      SMTP_USER, SMTP_PASS, EMAIL_FROM (یا SMTP_FROM) مثلاً "مانهواچی <no-reply@manhwachi.ir>"
let tp = null;
const configured = () => !!process.env.SMTP_HOST;
function transport() {
  if (tp) return tp;
  const nm = require("nodemailer");
  const port = Number(process.env.SMTP_PORT || 465);
  const sec = process.env.SMTP_SECURE;
  tp = nm.createTransport({
    host: process.env.SMTP_HOST, port, secure: sec ? ["1", "true"].includes(sec) : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  return tp;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
function render(kind, code, link) {
  const title = kind === "recovery" ? "بازیابی رمز عبور مانهواچی" : "تایید حساب مانهواچی";
  const lead = kind === "recovery" ? "برای تعیین رمز جدید این کد را وارد کن:" : "برای فعال‌سازی حساب این کد را وارد کن:";
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:20px;border:1px solid #eee;border-radius:12px"><h2 style="margin:0 0 12px">${esc(title)}</h2><p>${lead}</p><p style="font-size:32px;letter-spacing:6px;font-weight:bold;text-align:center;background:#f6f6f6;border-radius:8px;padding:12px;direction:ltr">${esc(code)}</p><p style="color:#666;font-size:13px">این کد تا یک ساعت معتبر است. اگر خودت درخواست نکرده‌ای این ایمیل را نادیده بگیر.</p>${link ? `<p style="font-size:13px">یا روی این لینک بزن: <a href="${esc(link)}">${esc(link)}</a></p>` : ""}</div>`;
  return { subject: `${code} — ${title}`, text: `${lead} ${code}\n${link || ""}`, html };
}
async function send(to, kind, code, link) {
  const m = render(kind, code, link);
  if (!configured()) { console.warn(`[mail] SMTP تنظیم نشده؛ کد ${kind} برای ${to}: ${code}`); return { dev: true }; }
  await transport().sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER, to, ...m });
  return { sent: true };
}
module.exports = { send, configured, render };

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
// قالب «تایید ثبت‌نام» (کد) — همان قالب Supabase
const confirmHtml = (code) => `<div style="font-family: Tahoma, Arial, sans-serif; text-align: center; background-color: #18181b; padding: 30px; border-radius: 12px; color: #ffffff; direction: rtl;">
  <h2 style="color: #ef4444; margin-bottom: 10px;">کد تایید حساب کاربری مانهواچی</h2>
  <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 25px;">کد زیر را در فرم سایت وارد کنید:</p>
  <div style="background-color: #27272a; border: 1px solid #3f3f46; display: inline-block; padding: 12px 28px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ef4444; font-family: monospace;">
    ${esc(code)}
  </div>
  <p style="color: #71717a; font-size: 12px; margin-top: 25px;">این کد پس از چند دقیقه منقضی می‌شود.</p>
</div>`;

// قالب «بازیابی رمز» (لینک) — همان قالب Supabase؛ {{ .ConfirmationURL }} با لینک واقعی جایگزین می‌شود
const recoveryHtml = (url, code) => `<div style="margin:0; padding:0; background-color:#0a0a0a; font-family: Tahoma, Arial, sans-serif;" dir="rtl">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#161616; border:1px solid #2a2a2a; border-radius:20px; overflow:hidden;">
        <tr><td style="height:6px; background:linear-gradient(90deg,#b91c1c,#ef4444,#b91c1c); font-size:0; line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:32px 24px 8px 24px;">
          <div style="font-size:22px; font-weight:800; color:#ffffff; font-family: Arial, sans-serif; margin-bottom:2px;">Manhwa<span style="color:#dc2626;">Chi</span></div>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 0 32px;">
          <h1 style="margin:0; font-size:18px; color:#ffffff; font-weight:700;">درخواست بازیابی رمز عبور</h1>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;">
          <p style="margin:0 0 12px 0; font-size:14px; line-height:26px; color:#cbb8b8; text-align:right;">
            سلام! 👋<br />یه درخواست برای تغییر رمز عبور حساب مانهواچی‌ت ثبت شده. اگه خودت این درخواست رو دادی، روی دکمه‌ی زیر بزن تا رمز جدیدت رو تنظیم کنی.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:20px 32px;">
          <a href="${esc(url)}" style="display:inline-block; background:linear-gradient(90deg,#dc2626,#b91c1c); color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:14px 40px; border-radius:12px; box-shadow:0 8px 24px rgba(220,38,38,0.35);">تنظیم رمز عبور جدید</a>
        </td></tr>
        <tr><td style="padding:0 32px;">
          <p style="margin:0 0 4px 0; font-size:11px; color:#8C8C8C; text-align:right;">اگه دکمه کار نکرد، این لینک رو کپی و توی مرورگرت باز کن:</p>
          <p style="margin:0; font-size:11px; word-break:break-all; direction:ltr; text-align:left; background-color:#1f1f1f; border:1px solid #2a2a2a; border-radius:8px; padding:10px 12px; color:#ef4444;">${esc(url)}</p>
        </td></tr>
        <tr><td style="padding:20px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:12px;">
            <tr><td style="padding:12px 14px;"><p style="margin:0; font-size:12px; line-height:20px; color:#fbbf24; text-align:right;">⚠️ اگه این درخواست رو نداده بودی، نگران نباش — کافیه این ایمیل رو نادیده بگیری. رمز عبور فعلیت بدون تغییر باقی می‌مونه.</p></td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 32px 0 32px;"><p style="margin:0; font-size:11px; color:#8C8C8C;">این لینک تا ۶۰ دقیقه‌ی دیگه معتبره.</p></td></tr>
        <tr><td style="padding:28px 32px 24px 32px; border-top:1px solid #2a2a2a;">
          <p style="margin:16px 0 4px 0; font-size:11px; color:#666666; text-align:center;">مرجع خواندن مانهوا و مانگا با ترجمه فارسی</p>
          <p style="margin:0; font-size:11px; color:#444444; text-align:center;">© مانهواچی — تمامی حقوق محفوظ است</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

function render(kind, code, link) {
  if (kind === "recovery") {
    return { subject: "بازیابی رمز عبور مانهواچی", text: `برای تعیین رمز جدید این لینک را باز کن (تا ۶۰ دقیقه معتبر است):\n${link || ""}`, html: recoveryHtml(link || "", code) };
  }
  return { subject: `${code} — کد تایید حساب مانهواچی`, text: `کد تایید حساب مانهواچی: ${code}`, html: confirmHtml(code) };
}
async function send(to, kind, code, link) {
  const m = render(kind, code, link);
  if (!configured()) { console.warn(`[mail] SMTP تنظیم نشده؛ کد ${kind} برای ${to}: ${code}`); return { dev: true }; }
  await transport().sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER, to, ...m });
  return { sent: true };
}
module.exports = { send, configured, render };

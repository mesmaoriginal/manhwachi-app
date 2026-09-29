// lib/emailProvider.js
// ارسال ایمیل کد تایید (فراموشی رمز عبور) از طریق SMTP.
// نیازمند:  npm i nodemailer
// متغیرهای .env:
//   SMTP_HOST, SMTP_PORT (پیش‌فرض 465), SMTP_SECURE (پیش‌فرض true برای 465),
//   SMTP_USER, SMTP_PASS, EMAIL_FROM  (مثلاً: "مانهوا <no-reply@yourdomain.com>")
// هر سرویس SMTP (هاست خودتان، Brevo، Mailgun، SES، ...) کار می‌کند.
// اگر سرورتان روی ایران است، مطمئن شوید به SMTP انتخابی دسترسی خروجی دارد.

const nodemailer = require("nodemailer");

class EmailSendError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "EmailSendError";
    this.details = details;
  }
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !process.env.EMAIL_FROM) {
    console.error("[email] SMTP_HOST / SMTP_USER / SMTP_PASS / EMAIL_FROM در .env تنظیم نشده.");
    throw new EmailSendError("سرویس ارسال ایمیل موقتاً در دسترس نیست.");
  }
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

async function sendOtpEmail(to, code) {
  const tx = getTransporter();
  try {
    await tx.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: "کد بازیابی رمز عبور",
      text: `کد بازیابی رمز عبور شما: ${code}\nاین کد ۲ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این ایمیل را نادیده بگیرید.`,
      html:
        `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.9">` +
        `<p>کد بازیابی رمز عبور شما:</p>` +
        `<p style="font-size:28px;letter-spacing:6px;font-weight:bold;direction:ltr">${code}</p>` +
        `<p>این کد ۲ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این ایمیل را نادیده بگیرید.</p></div>`,
    });
  } catch (err) {
    console.error("[email] ارسال ایمیل ناموفق:", err.message);
    throw new EmailSendError("ارسال ایمیل ناموفق بود. لطفاً بعداً دوباره تلاش کنید.", { message: err.message });
  }
}

module.exports = { sendOtpEmail, EmailSendError };

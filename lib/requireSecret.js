const crypto = require("crypto");

function requireSecret(envVarName, label, consequenceFa) {
  const fromEnv = process.env[envVarName];
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    console.error(`${label} ${envVarName} در .env تنظیم نشده. رو production این سکرت اجباریه ` + `(وگرنه: ${consequenceFa}). سرور بالا نمیاد - یک مقدار ثابت بسازید و تو .env ` + `بذارید، مثلاً: openssl rand -hex 32`);
    process.exit(1);
  }
  console.warn(`${label} ${envVarName} در .env تنظیم نشده - یک مقدار موقت و تصادفی ساخته شد (فقط چون ` + `NODE_ENV=production نیست). عارضه: ${consequenceFa} قبل از deploy حتماً این مقدار رو ` + `تو .env ثابت کنید، مثلاً با: openssl rand -hex 32`);
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  requireSecret: requireSecret
};
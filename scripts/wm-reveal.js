#!/usr/bin/env node
"use strict";
// استفاده:  node scripts/wm-reveal.js عکس-مشکوک.webp خروجی.png
// علامت‌های هم‌رنگ با زمینه را با افزایش شدید کنتراست محلی (CLAHE) برای چشم خوانا می‌کند.
const sharp = require("sharp");
const [, , inp, out] = process.argv;
if (!inp || !out) { console.error("استفاده: node scripts/wm-reveal.js <ورودی> <خروجی.png>"); process.exit(1); }
(async () => {
  await sharp(inp).greyscale().clahe({ width: 24, height: 24, maxSlope: 8 }).normalise().png().toFile(out);
  console.log("ذخیره شد:", out, "- تصویر را زوم کن و دنبال متن ریز ۸ حرفی (۰-۹ و a-f) بگرد.");
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });

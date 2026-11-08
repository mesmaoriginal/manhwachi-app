#!/usr/bin/env node
"use strict";
// استفاده:  node scripts/wm-lookup.js a1b2c3d4
// کدی که روی عکسِ کپی‌شده خوانده‌ای را به IP / کوکی مهمان / حساب کاربری وصل می‌کند.
const fs = require("fs");
const path = require("path");
const code = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[0-9a-f]{4,8}$/.test(code)) {
  console.error("استفاده: node scripts/wm-lookup.js <کد ۸ حرفی hex>");
  process.exit(1);
}
const dir = process.env.WM_DATA_DIR || path.join(__dirname, "..", "data");
let found = 0;
for (const f of ["wm-codes.jsonl.1", "wm-codes.jsonl"]) {
  let txt = "";
  try { txt = fs.readFileSync(path.join(dir, f), "utf8"); } catch (e) { continue; }
  for (const line of txt.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (String(e.code).startsWith(code)) { console.log(JSON.stringify(e)); found++; }
    } catch (e) {}
  }
}
if (!found) console.log("پیدا نشد (ممکنه فایل چرخیده یا کد مربوط به دوره‌ی خیلی قدیمی باشه).");

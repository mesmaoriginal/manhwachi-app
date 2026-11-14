const raw = String(process.env.IMG_BASE || "").trim().replace(/\/+$/, "");

const IMG_BASE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(raw) ? raw : "";

if (raw && !IMG_BASE) console.warn("[imgBase] IMG_BASE نامعتبر است (باید مثل https://img.example.ir باشد) - نادیده گرفته شد.");

const IMG_SNIPPET = IMG_BASE ? `<script>window.IMG_BASE=${JSON.stringify(IMG_BASE)};<\/script>` : "";

module.exports = {
  IMG_BASE: IMG_BASE,
  IMG_SNIPPET: IMG_SNIPPET
};
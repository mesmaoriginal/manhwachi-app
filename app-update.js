// server.js:
//   const appUpdate = require('./app-update');
//   app.use(appUpdate.requireMinAppVersion);          // قبل از بقیه‌ی روت‌های /api و /purchase
//   app.get('/api/app/update', appUpdate.updateEndpoint);
//   app.get('/api/app/latest', appUpdate.latestEndpoint);   // برای صفحه‌ی دانلود (عمومی)
//
// انتشار نسخه‌ی جدید = ویرایش app-release.json (بدون ری‌استارت سرور):
//   latestVersionCode / minVersionCode را بالا ببر → همه‌ی نسخه‌های قدیمی همان لحظه قفل می‌شوند.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RELEASE_FILE = path.join(__dirname, 'app-release.json');
const PRIVATE_KEY = (process.env.APP_UPDATE_SIGNING_KEY || '').replace(/\\n/g, '\n');
if (!PRIVATE_KEY) console.warn('[app-update] APP_UPDATE_SIGNING_KEY تنظیم نشده؛ endpoint کار نمی‌کند');

function readRelease() {
  return JSON.parse(fs.readFileSync(RELEASE_FILE, 'utf8'));
}

// ---- endpoint امضاشده ----
function updateEndpoint(req, res) {
  const nonce = String(req.query.n || '');
  if (!/^[0-9a-f]{32}$/.test(nonce) || !PRIVATE_KEY) return res.status(400).json({ error: 'bad request' });

  let rel;
  try { rel = readRelease(); } catch { return res.status(500).json({ error: 'release config' }); }

  const payload = Buffer.from(JSON.stringify({
    nonce,
    issuedAt: Date.now(),
    latestVersionCode: rel.latestVersionCode,
    minVersionCode: rel.minVersionCode,
    versionName: rel.versionName,
    downloadUrl: rel.downloadUrl,
    sha256: rel.sha256,
    changelog: rel.changelog,
  }), 'utf8').toString('base64');

  // امضای DER روی همان رشته‌ی base64 (اپ دقیقاً همین بایت‌ها را وریفای می‌کند)
  const sig = crypto.sign('sha256', Buffer.from(payload, 'utf8'), { key: PRIVATE_KEY, dsaEncoding: 'der' })
    .toString('base64');

  res.set('Cache-Control', 'no-store');
  res.json({ payload, sig });
}

// ---- endpoint عمومی برای صفحه‌ی دانلود وب (بدون امضا؛ فقط اطلاعات نمایشی) ----
// فیلدهای اختیاری app-release.json: releasedAt (مثلاً "2026-10-20")، sizeMB
function latestEndpoint(req, res) {
  let rel;
  try { rel = readRelease(); } catch { return res.status(500).json({ error: 'release config' }); }
  res.set('Cache-Control', 'no-cache');
  res.json({
    versionName: rel.versionName,
    versionCode: rel.latestVersionCode,
    downloadUrl: rel.downloadUrl,
    sha256: rel.sha256,
    changelog: rel.changelog,
    date: rel.releasedAt,
    sizeMB: rel.sizeMB,
  });
}

// ---- قفل سمت سرور: نسخه‌ی قدیمی اپ به API دسترسی ندارد ----
// فقط درخواست‌هایی که هدر X-App-Platform: android دارند چک می‌شوند (سایت/مرورگر دست نمی‌خورد).
function requireMinAppVersion(req, res, next) {
  if (req.path === '/api/app/update') return next();
  if (req.get('X-App-Platform') !== 'android') return next();

  const code = parseInt(req.get('X-App-Version-Code') || '0', 10);
  let min = 0;
  try { min = readRelease().minVersionCode; } catch { return next(); }

  if (!(code >= min)) {
    return res.status(426).set('Cache-Control', 'no-store')
      .json({ code: 'UPDATE_REQUIRED', error: 'نسخه‌ی جدید اپ را نصب کن' });
  }
  next();
}

module.exports = { updateEndpoint, latestEndpoint, requireMinAppVersion };

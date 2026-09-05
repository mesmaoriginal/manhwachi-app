// admin/dataStore.js
//
// این ماژول تنها راهیه که پنل ادمین اجازه داره data.json رو تغییر بده.
// سه تا تضمین مهم می‌ده که ویرایش دستی فایل هیچ‌وقت نداشت:
//
// ۱. صف (queue) نوشتن: اگه دو درخواست همزمان بیان، یکی‌یکی روی فایل اعمال
//    می‌شن، نه اینکه همدیگه رو overwrite کنن.
// ۲. Backup خودکار: قبل از هر تغییر، یک نسخه‌ی timestamp‌دار از فایل قبلی
//    تو data/backups/ ذخیره می‌شه (فقط ۳۰ تای آخر نگه داشته می‌شن).
// ۳. Atomic write: اول رو یک فایل موقت می‌نویسه بعد rename می‌کنه، پس اگه
//    وسط نوشتن کرش کنه، هیچ‌وقت یک data.json نصفه و خراب نمی‌مونه.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_PATH = path.join(DATA_DIR, "data.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUPS = 30;

let queue = Promise.resolve();

function withLock(fn) {
  const run = queue.then(fn, fn);
  // اگه یکی خطا داد، صف رو قفل نکنه برای درخواست بعدی
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function readData() {
  if (!fs.existsSync(DATA_PATH)) return {};
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function backupCurrentFile() {
  if (!fs.existsSync(DATA_PATH)) return;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(DATA_PATH, path.join(BACKUP_DIR, `data-${stamp}.json`));

  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("data-") && f.endsWith(".json"))
    .sort();
  while (files.length > MAX_BACKUPS) {
    fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  }
}

function writeDataToDisk(data) {
  backupCurrentFile();
  const tmpPath = DATA_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, DATA_PATH);
}

// mutatorFn یک تابع sync هست که data رو مستقیم تغییر می‌ده (in-place).
// اگه mutatorFn خطا throw کنه، هیچ چیزی روی دیسک نوشته نمی‌شه.
function updateData(mutatorFn) {
  return withLock(() => {
    const data = readData();
    const result = mutatorFn(data);
    writeDataToDisk(data);
    return result;
  });
}

module.exports = { readData, updateData, DATA_PATH, BACKUP_DIR };

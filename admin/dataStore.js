const fs = require("fs");

const path = require("path");

const {dataEvents: dataEvents, DATA_UPDATED: DATA_UPDATED} = require("../lib/dataEvents");

const DATA_DIR = path.join(__dirname, "..", "data");

const DATA_PATH = path.join(DATA_DIR, "data.json");

const BACKUP_DIR = path.join(DATA_DIR, "backups");

const MAX_BACKUPS = Math.max(1, Number(process.env.DATA_BACKUP_KEEP) || 1);

let queue = Promise.resolve();

function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => {}, () => {});
  return run;
}

function readData() {
  if (!fs.existsSync(DATA_PATH)) return {};
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function backupCurrentFile() {
  if (!fs.existsSync(DATA_PATH)) return;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, {
    recursive: true
  });
  const stamp = (new Date).toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(DATA_PATH, path.join(BACKUP_DIR, `data-${stamp}.json`));
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("data-") && f.endsWith(".json")).sort();
  while (files.length > MAX_BACKUPS) {
    fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  }
}

function writeDataToDisk(data) {
  backupCurrentFile();
  const tmpPath = DATA_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, DATA_PATH);
  dataEvents.emit(DATA_UPDATED);
}

function updateData(mutatorFn) {
  return withLock(() => {
    const data = readData();
    const result = mutatorFn(data);
    writeDataToDisk(data);
    return result;
  });
}

module.exports = {
  readData: readData,
  updateData: updateData,
  DATA_PATH: DATA_PATH,
  BACKUP_DIR: BACKUP_DIR
};
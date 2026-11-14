"use strict";

const crypto = require("crypto");

const fs = require("fs");

const path = require("path");

const DATA_DIR = process.env.WM_DATA_DIR || path.join(__dirname, "..", "data");

const FILE = path.join(DATA_DIR, "wm-codes.jsonl");

const MAX_BYTES = 10 * 1024 * 1024;

const SECRET = process.env.WM_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || crypto.randomBytes(24).toString("hex");

const seen = new Map;

const day = () => (new Date).toISOString().slice(0, 10);

function codeFor(ip, gid) {
  return crypto.createHmac("sha256", SECRET).update(`${day()}|${ip || ""}|${gid || ""}`).digest("hex").slice(0, 8);
}

function append(entry) {
  try {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
    try {
      if (fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, FILE + ".1");
    } catch (e) {}
    fs.appendFile(FILE, JSON.stringify(entry) + "\n", () => {});
  } catch (e) {}
}

function metaFrom(req) {
  const h = req && req.headers || {};
  const cut = (v, n) => v ? String(v).slice(0, n) : null;
  return {
    ua: cut(h["user-agent"], 200),
    lang: cut(h["accept-language"], 60),
    ch: cut(h["sec-ch-ua"], 120),
    xff: cut(h["x-forwarded-for"], 160),
    ref: cut(h["referer"], 160)
  };
}

function note({ip: ip, gid: gid, userId: userId, meta: meta}) {
  const code = codeFor(ip, gid);
  const cur = seen.get(code);
  if (!cur || userId && !cur.userId) {
    seen.set(code, {
      userId: userId || cur && cur.userId || null
    });
    if (seen.size > 2e4) seen.delete(seen.keys().next().value);
    append({
      t: (new Date).toISOString(),
      code: code,
      ip: ip || null,
      gid: gid || null,
      userId: userId || null,
      ...meta || {}
    });
  }
  return code;
}

function readRows() {
  const rows = [];
  for (const f of [ FILE + ".1", FILE ]) {
    let txt = "";
    try {
      txt = fs.readFileSync(f, "utf8");
    } catch (e) {
      continue;
    }
    for (const line of txt.split("\n")) {
      if (!line) continue;
      try {
        rows.push(JSON.parse(line));
      } catch (e) {}
    }
  }
  return rows;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (/^(10\.|127\.|0\.|192\.168\.|169\.254\.)/.test(ip)) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  const m2 = /^100\.(\d+)\./.exec(ip);
  if (m2 && +m2[1] >= 64 && +m2[1] <= 127) return true;
  const l = String(ip).toLowerCase();
  return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

function lookup(q) {
  q = String(q || "").trim();
  if (!q) return {
    rows: 0,
    gids: [],
    userIds: [],
    ips: [],
    codes: [],
    uas: [],
    first: null,
    last: null
  };
  const rows = readRows();
  const keys = new Set([ q ]);
  const pick = r => [ r.code, r.gid, r.userId, r.ip && !isPrivateIp(r.ip) ? r.ip : null ].filter(Boolean);
  let matched = new Set;
  for (let hop = 0; hop < 2; hop++) {
    for (const r of rows) if (pick(r).some(k => keys.has(k))) {
      matched.add(r);
      pick(r).forEach(k => keys.add(k));
    }
  }
  const list = [ ...matched ];
  const uniq = f => [ ...new Set(list.map(f).filter(Boolean)) ];
  const ts = list.map(r => r.t).filter(Boolean).sort();
  return {
    rows: list.length,
    gids: uniq(r => r.gid),
    userIds: uniq(r => r.userId),
    ips: uniq(r => r.ip && !isPrivateIp(r.ip) ? r.ip : null),
    privateIpSeen: list.some(r => r.ip && isPrivateIp(r.ip)),
    codes: uniq(r => r.code),
    uas: uniq(r => r.ua),
    langs: uniq(r => r.lang),
    first: ts[0] || null,
    last: ts[ts.length - 1] || null
  };
}

module.exports = {
  codeFor: codeFor,
  note: note,
  metaFrom: metaFrom,
  lookup: lookup,
  isPrivateIp: isPrivateIp
};
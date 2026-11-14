const fs = require("fs");

const path = require("path");

const rest = require("./rest");

const ROOT = path.resolve(process.env.AVATAR_DIR || path.join(process.cwd(), "data", "avatars"));

const MAX_BYTES = 3 * 1024 * 1024;

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

const UID_RE = /^[A-Za-z0-9-]{8,64}$/;

const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp"
};

function sniff(b) {
  if (b.length > 12 && b[0] === 255 && b[1] === 216) return "jpg";
  if (b.length > 12 && b.slice(0, 8).equals(Buffer.from([ 137, 80, 78, 71, 13, 10, 26, 10 ]))) return "png";
  if (b.length > 12 && b.slice(0, 3).toString("latin1") === "GIF") return "gif";
  if (b.length > 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

function extractFile(req) {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const ct = String(req.headers["content-type"] || "");
  const m = ct.match(/multipart\/form-data;\s*boundary=("?)([^";]+)\1/i);
  if (!m) return body;
  const delim = Buffer.from("--" + m[2]);
  let pos = body.indexOf(delim), best = null;
  while (pos !== -1) {
    const start = pos + delim.length;
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    const part = body.slice(start, next);
    const hEnd = part.indexOf("\r\n\r\n");
    if (hEnd !== -1) {
      const head = part.slice(0, hEnd).toString("latin1");
      let data = part.slice(hEnd + 4);
      if (data.slice(-2).toString() === "\r\n") data = data.slice(0, -2);
      if (/filename=/i.test(head) || sniff(data)) {
        if (!best || data.length > best.length) best = data;
      }
    }
    pos = next;
  }
  return best || Buffer.alloc(0);
}

function parseObjectPath(rel) {
  const parts = decodeURIComponent(rel).split("/").filter(Boolean);
  if (parts.length !== 2 || !UID_RE.test(parts[0]) || !NAME_RE.test(parts[1])) return null;
  return {
    uid: parts[0],
    name: parts[1]
  };
}

function mount(app, express) {
  const raw = express.raw({
    type: () => true,
    limit: MAX_BYTES + 64 * 1024
  });
  const json = express.json({
    limit: "100kb"
  });
  const send = (res, status, body) => {
    res.set("Cache-Control", "no-store");
    res.status(status).json(body);
  };
  const needUser = req => {
    const ctx = rest.authenticate({
      headers: req.headers,
      query: new URLSearchParams,
      ip: req.ip
    });
    if (ctx.role !== "authenticated" || !ctx.uid) {
      const e = new Error("Unauthorized");
      e.status = 401;
      throw e;
    }
    return ctx;
  };
  const fail = (res, e) => {
    if (e && e.status) return send(res, e.status, {
      statusCode: String(e.status),
      error: "error",
      message: e.message
    });
    console.error("[storage]", e);
    return send(res, 500, {
      statusCode: "500",
      error: "error",
      message: "Internal error"
    });
  };
  app.get(/^\/storage\/v1\/object\/(?:public\/)?avatars\/(.+)$/, (req, res) => {
    try {
      const p = parseObjectPath(req.params[0]);
      if (!p) return send(res, 404, {
        statusCode: "404",
        error: "not_found",
        message: "Object not found"
      });
      const file = path.join(ROOT, p.uid, p.name);
      if (!fs.existsSync(file)) return send(res, 404, {
        statusCode: "404",
        error: "not_found",
        message: "Object not found"
      });
      res.set({
        "Content-Type": TYPES[path.extname(p.name).slice(1).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      fail(res, e);
    }
  });
  app.all(/^\/storage\/v1\/object\/avatars\/(.+)$/, raw, (req, res) => {
    try {
      if (req.method !== "POST" && req.method !== "PUT") return send(res, 405, {
        message: "method not allowed"
      });
      const ctx = needUser(req);
      const p = parseObjectPath(req.params[0]);
      if (!p || p.uid !== ctx.uid) return send(res, 403, {
        statusCode: "403",
        error: "Unauthorized",
        message: "new row violates row-level security policy"
      });
      const data = extractFile(req);
      if (!data.length || data.length > MAX_BYTES) return send(res, 413, {
        statusCode: "413",
        error: "Payload too large",
        message: "حجم عکس نامعتبر است (حداکثر ۳ مگابایت)"
      });
      const kind = sniff(data);
      if (!kind) return send(res, 400, {
        statusCode: "400",
        error: "invalid_mime_type",
        message: "فقط عکس JPG/PNG/GIF/WEBP مجاز است"
      });
      const ext = path.extname(p.name).slice(1).toLowerCase();
      if (TYPES[ext] !== TYPES[kind]) return send(res, 400, {
        statusCode: "400",
        error: "invalid_mime_type",
        message: "پسوند فایل با نوع عکس نمی‌خواند"
      });
      const dir = path.join(ROOT, p.uid);
      fs.mkdirSync(dir, {
        recursive: true
      });
      const existing = fs.readdirSync(dir);
      if (existing.length >= 20) for (const f of existing.slice(0, existing.length - 19)) fs.unlinkSync(path.join(dir, f));
      fs.writeFileSync(path.join(dir, p.name), data);
      send(res, 200, {
        Id: p.uid + "/" + p.name,
        Key: "avatars/" + p.uid + "/" + p.name
      });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/storage/v1/object/list/avatars", json, (req, res) => {
    try {
      const ctx = needUser(req);
      const prefix = String(req.body && req.body.prefix || "").replace(/\/+$/, "");
      if (prefix !== ctx.uid) return send(res, 200, []);
      const dir = path.join(ROOT, ctx.uid);
      if (!fs.existsSync(dir)) return send(res, 200, []);
      send(res, 200, fs.readdirSync(dir).map(name => {
        const st = fs.statSync(path.join(dir, name));
        return {
          name: name,
          id: ctx.uid + "/" + name,
          updated_at: st.mtime.toISOString(),
          created_at: st.birthtime.toISOString(),
          last_accessed_at: st.atime.toISOString(),
          metadata: {
            size: st.size
          }
        };
      }));
    } catch (e) {
      fail(res, e);
    }
  });
  app.delete("/storage/v1/object/avatars", json, (req, res) => {
    try {
      const ctx = needUser(req);
      const list = Array.isArray(req.body && req.body.prefixes) ? req.body.prefixes.slice(0, 50) : [];
      const out = [];
      for (const pr of list) {
        const p = typeof pr === "string" ? parseObjectPath(pr) : null;
        if (!p || p.uid !== ctx.uid) continue;
        const f = path.join(ROOT, p.uid, p.name);
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          out.push({
            name: p.uid + "/" + p.name
          });
        }
      }
      send(res, 200, out);
    } catch (e) {
      fail(res, e);
    }
  });
}

module.exports = {
  mount: mount
};
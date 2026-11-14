const crypto = require("crypto");

const b64 = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

const mac = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("base64url");

function sign(payload, secret) {
  const head = b64({
    alg: "HS256",
    typ: "JWT"
  }), body = b64(payload);
  return `${head}.${body}.${mac(`${head}.${body}`, secret)}`;
}

function verify(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !secret) return null;
  const expected = Buffer.from(mac(`${parts[0]}.${parts[1]}`, secret)), given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let h, p;
  try {
    h = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
  if (h.alg !== "HS256") return null;
  if (typeof p.exp === "number" && p.exp * 1e3 < Date.now()) return {
    expired: true
  };
  return p;
}

module.exports = {
  sign: sign,
  verify: verify
};
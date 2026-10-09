// lib/localdb/auth.js — جایگزین GoTrue (/auth/v1) برای supabase-js و کدهای سرور
// پشتیبانی: signup، verify (کد ۶ رقمی و لینک)، token (password / refresh_token)، user (GET/PUT)، logout، recover، resend، admin/users
// رمزها bcrypt هستند (همان هش‌های سوپابیس، پس رمز کاربران قبلی کار می‌کند).
const crypto = require("crypto");
const { all, get, run, tx } = require("./sqlite");
const { HttpError } = require("./errors");
const jwt = require("./jwt");
const cfg = require("./config");
const mailer = require("./mailer");
const { nowIso } = require("./policies");

let bcrypt;
try { bcrypt = require("bcryptjs"); } catch { bcrypt = null; }
const needBcrypt = () => { if (!bcrypt) throw new Error("پکیج bcryptjs نصب نیست (npm i bcryptjs)"); return bcrypt; };
let _dummy;
const dummyHash = () => _dummy || (_dummy = needBcrypt().hashSync("x", 10)); // هم‌زمان‌سازی زمان پاسخ وقتی کاربر وجود ندارد

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const aerr = (status, error_code, msg) => new HttpError(status, error_code, msg);
const j = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e || "").trim().toLowerCase();
const normPhone = (p) => String(p || "").trim().replace(/^\+/, "");

// ---------- محدودکننده‌ی نرخ (حافظه‌ای) ----------
const hits = new Map();
function limit(key, max, windowMs, code = "over_request_rate_limit", msg = "Request rate limit reached") {
  const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); throw aerr(429, code, msg); }
  arr.push(now); hits.set(key, arr);
}
setInterval(() => { const n = Date.now(); for (const [k, a] of hits) { const f = a.filter((t) => n - t < 3600e3); if (f.length) hits.set(k, f); else hits.delete(k); } }, 600e3).unref();

// ---------- نمای کاربر / نشست ----------
function userJson(u) {
  const meta = j(u.raw_user_meta_data), app = j(u.raw_app_meta_data, { provider: "email", providers: ["email"] });
  const provider = u.email ? "email" : "phone";
  return {
    id: u.id, aud: "authenticated", role: "authenticated",
    email: u.email || "", phone: u.phone || "",
    email_confirmed_at: u.email_confirmed_at || null, phone_confirmed_at: u.phone_confirmed_at || null,
    confirmed_at: u.email_confirmed_at || u.phone_confirmed_at || null,
    last_sign_in_at: u.last_sign_in_at || null,
    app_metadata: app, user_metadata: meta,
    identities: [{ identity_id: u.id, id: u.id, user_id: u.id, identity_data: { sub: u.id, email: u.email || undefined, phone: u.phone || undefined, email_verified: !!u.email_confirmed_at, phone_verified: !!u.phone_confirmed_at }, provider, last_sign_in_at: u.last_sign_in_at || u.created_at, created_at: u.created_at, updated_at: u.updated_at || u.created_at, email: u.email || undefined }],
    created_at: u.created_at, updated_at: u.updated_at || u.created_at, is_anonymous: false,
  };
}
const userById = (id) => get("SELECT * FROM auth_users WHERE id = ?", [id]);
const userByEmail = (e) => get("SELECT * FROM auth_users WHERE lower(email) = ?", [normEmail(e)]);
const userByPhone = (p) => get("SELECT * FROM auth_users WHERE phone = ?", [normPhone(p)]);

function newRefresh(user, sessionId) {
  const rt = crypto.randomBytes(14).toString("base64url");
  run("INSERT INTO auth_refresh_tokens (token_hash, user_id, session_id, created_at, revoked) VALUES (?, ?, ?, ?, 0)", [sha(rt), user.id, sessionId, nowIso()]);
  return rt;
}
function accessFor(user, sessionId, method = "password") {
  const now = Math.floor(Date.now() / 1000), exp = now + cfg.jwtExpSeconds;
  const token = jwt.sign({
    iss: `${cfg.siteUrl}/auth/v1`, aud: "authenticated", sub: user.id, iat: now, exp,
    email: user.email || "", phone: user.phone || "", role: "authenticated", aal: "aal1",
    amr: [{ method, timestamp: now }], session_id: sessionId,
    app_metadata: j(user.raw_app_meta_data, { provider: "email", providers: ["email"] }), user_metadata: j(user.raw_user_meta_data), is_anonymous: false,
  }, cfg.jwtSecret);
  return { token, exp };
}
function sessionFor(user, method = "password", sessionId = crypto.randomUUID()) {
  const { token, exp } = accessFor(user, sessionId, method);
  return { access_token: token, token_type: "bearer", expires_in: cfg.jwtExpSeconds, expires_at: exp, refresh_token: newRefresh(user, sessionId), user: userJson(user) };
}

// ---------- ساخت/ویرایش کاربر (+ تریگرهای قبلی: handle_new_user, sync_profile_contact, check_gmail_only) ----------
function syncContact(u) {
  run("INSERT INTO profile_contacts (user_id, email, phone, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, phone = excluded.phone, updated_at = excluded.updated_at",
    [u.id, u.email || null, u.phone || null, nowIso()]);
}
function createUser({ id, email, phone, passwordHash, emailConfirmedAt = null, phoneConfirmedAt = null, userMeta = {}, appMeta, createdAt, lastSignInAt = null, skipGmailCheck = false }) {
  email = email ? normEmail(email) : null; phone = phone ? normPhone(phone) : null;
  if (!skipGmailCheck && email && !email.endsWith("@gmail.com")) throw aerr(500, "unexpected_failure", "Database error saving new user");
  const row = {
    id: id || crypto.randomUUID(), email, phone, encrypted_password: passwordHash || "",
    email_confirmed_at: emailConfirmedAt, phone_confirmed_at: phoneConfirmedAt,
    created_at: createdAt || nowIso(), updated_at: nowIso(), last_sign_in_at: lastSignInAt,
    raw_user_meta_data: JSON.stringify(userMeta || {}), raw_app_meta_data: JSON.stringify(appMeta || { provider: email ? "email" : "phone", providers: [email ? "email" : "phone"] }),
  };
  return tx(() => {
    run(`INSERT INTO auth_users (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, Object.values(row));
    run("INSERT INTO profiles (id, full_name, avatar_url, is_vip, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO NOTHING",
      [row.id, userMeta?.full_name ?? null, userMeta?.avatar_url ?? null, row.created_at, row.created_at]);
    syncContact(row);
    return row;
  });
}

// ---------- کدهای ایمیل ----------
function issueCode(user, kind, redirectTo) {
  const prev = get("SELECT created_at FROM auth_codes WHERE user_id = ? AND kind = ?", [user.id, kind]);
  if (prev && Date.now() - Date.parse(prev.created_at) < 60_000) throw aerr(429, "over_email_send_rate_limit", "For security purposes, you can only request this after 60 seconds.");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const link = crypto.randomBytes(24).toString("base64url");
  run("DELETE FROM auth_codes WHERE user_id = ? AND kind = ?", [user.id, kind]);
  run("INSERT INTO auth_codes (user_id, kind, code_hash, link_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [user.id, kind, sha(`${code}:${user.id}:${kind}`), sha(link), nowIso(), new Date(Date.now() + 3600e3).toISOString()]);
  const url = `${cfg.siteUrl}/auth/v1/verify?token=${link}&type=${kind}&redirect_to=${encodeURIComponent(redirectTo || cfg.siteUrl)}`;
  return { code, url };
}
async function mailCode(user, kind, redirectTo) {
  const { code, url } = issueCode(user, kind, redirectTo);
  try { await mailer.send(user.email, kind, code, url); }
  catch (e) { console.error("[auth] ارسال ایمیل ناموفق:", e.message); throw aerr(500, "unexpected_failure", kind === "recovery" ? "Error sending recovery email" : "Error sending confirmation email"); }
}
function consumeCode(user, kind, { code, linkToken }) {
  const row = get("SELECT * FROM auth_codes WHERE user_id = ? AND kind = ?", [user.id, kind]);
  const fail = () => aerr(403, "otp_expired", "Token has expired or is invalid");
  if (!row || Date.parse(row.expires_at) < Date.now()) throw fail();
  if (row.attempts >= 5) { run("DELETE FROM auth_codes WHERE id = ?", [row.id]); throw fail(); }
  const ok = code ? safeEq(row.code_hash, sha(`${code}:${user.id}:${kind}`)) : linkToken ? safeEq(row.link_hash, sha(linkToken)) : false;
  if (!ok) { run("UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?", [row.id]); throw fail(); }
  run("DELETE FROM auth_codes WHERE id = ?", [row.id]);
}
const safeRedirect = (r) => { try { return r && new URL(r).origin === new URL(cfg.siteUrl).origin ? r : cfg.siteUrl; } catch { return cfg.siteUrl; } };

// ---------- هندلرها ----------
function bearerUser(req) {
  const t = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  const p = jwt.verify(t, cfg.jwtSecret);
  if (!p || p.expired || !p.sub) throw aerr(401, "bad_jwt", p?.expired ? "token is expired" : "invalid JWT: unable to parse or verify signature");
  const u = userById(p.sub);
  if (!u) throw aerr(403, "user_not_found", "User from sub claim in JWT does not exist");
  return { user: u, claims: p };
}
const needService = (req) => {
  const t = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (!cfg.serviceKey || !safeEq(t, cfg.serviceKey)) throw aerr(403, "not_admin", "User not allowed");
};
const checkPassword = (p) => { if (typeof p !== "string" || p.length < 6) throw aerr(422, "weak_password", "Password should be at least 6 characters."); if (p.length > 72) throw aerr(422, "weak_password", "Password should be at most 72 characters."); };

async function signup(req) {
  const b = req.body || {};
  limit(`signup:${req.ip}`, 20, 3600e3);
  const email = normEmail(b.email);
  if (!email && !b.phone) throw aerr(422, "validation_failed", "To signup, please provide your email or phone number");
  if (!email) throw aerr(422, "phone_provider_disabled", "Phone signup is disabled");
  if (!EMAIL_RE.test(email)) throw aerr(400, "email_address_invalid", `Email address "${email}" is invalid`);
  checkPassword(b.password);
  const existing = userByEmail(email);
  const redirect = safeRedirect(b.redirect_to || req.query.get("redirect_to"));
  if (existing) {
    if (existing.email_confirmed_at) { // امنیتی: کاربر تکراری را لو نده؛ identities خالی برمی‌گردد
      const fake = userJson({ ...existing, id: crypto.randomUUID(), last_sign_in_at: null, raw_user_meta_data: JSON.stringify(b.data || {}) });
      fake.identities = []; return { status: 200, body: fake };
    }
    await mailCode(existing, "signup", redirect);
    return { status: 200, body: userJson(existing) };
  }
  const hash = await needBcrypt().hash(b.password, 10);
  const row = createUser({ email, passwordHash: hash, userMeta: b.data || {} });
  try { await mailCode(row, "signup", redirect); }
  catch (e) { tx(() => { run("DELETE FROM auth_users WHERE id = ?", [row.id]); run("DELETE FROM profiles WHERE id = ?", [row.id]); run("DELETE FROM profile_contacts WHERE user_id = ?", [row.id]); }); throw e; }
  return { status: 200, body: userJson(row) };
}
async function verifyBody(req) {
  const b = req.body || {};
  let kind = b.type === "email" ? "signup" : b.type;
  if (!["signup", "recovery"].includes(kind)) throw aerr(400, "validation_failed", "Verify requires a verification type");
  const email = normEmail(b.email);
  let user;
  if (b.token_hash) { // لینک
    const row = get("SELECT user_id FROM auth_codes WHERE link_hash = ? AND kind = ?", [sha(b.token_hash), kind]);
    user = row && userById(row.user_id);
  } else {
    if (!email || !b.token) throw aerr(400, "validation_failed", "Verify requires either a token or a token hash");
    limit(`verify:${req.ip}`, 30, 600e3);
    user = userByEmail(email);
  }
  if (!user) throw aerr(403, "otp_expired", "Token has expired or is invalid");
  consumeCode(user, kind, b.token_hash ? { linkToken: b.token_hash } : { code: String(b.token).trim() });
  return finishVerify(user, kind);
}
function finishVerify(user) {
  const now = nowIso();
  if (!user.email_confirmed_at) run("UPDATE auth_users SET email_confirmed_at = ?, updated_at = ? WHERE id = ?", [now, now, user.id]);
  run("UPDATE auth_users SET last_sign_in_at = ? WHERE id = ?", [now, user.id]);
  return sessionFor(userById(user.id), "otp");
}
function verifyLink(req) {
  const q = req.query, kind = q.get("type"), redirect = safeRedirect(q.get("redirect_to"));
  const bad = { status: 302, headers: { location: `${redirect}#error=access_denied&error_code=otp_expired&error_description=${encodeURIComponent("Email link is invalid or has expired")}` } };
  if (!["signup", "recovery"].includes(kind)) return bad;
  const row = get("SELECT user_id FROM auth_codes WHERE link_hash = ? AND kind = ?", [sha(q.get("token") || ""), kind]);
  const user = row && userById(row.user_id);
  if (!user) return bad;
  try { consumeCode(user, kind, { linkToken: q.get("token") }); } catch { return bad; }
  const s = finishVerify(user);
  return { status: 302, headers: { location: `${redirect}#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=${kind}` } };
}
async function token(req) {
  const grant = req.query.get("grant_type"), b = req.body || {};
  if (grant === "password") {
    const email = normEmail(b.email), phone = normPhone(b.phone);
    if ((!email && !phone) || typeof b.password !== "string") throw aerr(400, "validation_failed", "Invalid login credentials");
    limit(`login-ip:${req.ip}`, 60, 600e3);
    limit(`login:${req.ip}:${email || phone}`, 8, 900e3);
    const u = email ? userByEmail(email) : userByPhone(phone);
    const okPw = u && u.encrypted_password ? await needBcrypt().compare(b.password, u.encrypted_password) : (await needBcrypt().compare(b.password, dummyHash()), false);
    if (!u || !okPw) throw aerr(400, "invalid_credentials", "Invalid login credentials");
    if (u.banned_until && Date.parse(u.banned_until) > Date.now()) throw aerr(400, "user_banned", "User is banned");
    if (email && !u.email_confirmed_at) throw aerr(400, "email_not_confirmed", "Email not confirmed");
    if (phone && !u.phone_confirmed_at) throw aerr(400, "phone_not_confirmed", "Phone not confirmed");
    run("UPDATE auth_users SET last_sign_in_at = ? WHERE id = ?", [nowIso(), u.id]);
    return { status: 200, body: sessionFor(userById(u.id), "password") };
  }
  if (grant === "refresh_token") {
    limit(`refresh:${req.ip}`, 120, 600e3);
    const rt = String(b.refresh_token || "");
    const row = get("SELECT * FROM auth_refresh_tokens WHERE token_hash = ?", [sha(rt)]);
    if (!row) throw aerr(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    const user = userById(row.user_id);
    if (!user) throw aerr(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    if (row.revoked) {
      const alive = get("SELECT 1 AS x FROM auth_refresh_tokens WHERE session_id = ? AND revoked = 0 LIMIT 1", [row.session_id]); // بعد از logout هیچ توکن زنده‌ای نیست
      if (alive && row.used_at && Date.now() - Date.parse(row.used_at) < 10_000) { // پنجره‌ی استفاده‌ی مجدد ۱۰ ثانیه‌ای (چند تب)
        return { status: 200, body: sessionFor(user, "token_refresh", row.session_id) };
      }
      run("UPDATE auth_refresh_tokens SET revoked = 1 WHERE session_id = ?", [row.session_id]);
      throw aerr(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
    }
    run("UPDATE auth_refresh_tokens SET revoked = 1, used_at = ? WHERE id = ?", [nowIso(), row.id]);
    return { status: 200, body: sessionFor(user, "token_refresh", row.session_id) };
  }
  throw aerr(400, "unsupported_grant_type", "unsupported_grant_type");
}
function getUser(req) { return { status: 200, body: userJson(bearerUser(req).user) }; }
async function putUser(req) {
  const { user } = bearerUser(req), b = req.body || {};
  if (b.email && normEmail(b.email) !== user.email) throw aerr(400, "email_change_unsupported", "Email change is not supported");
  if (b.phone) throw aerr(400, "phone_change_unsupported", "Phone change is not supported");
  const sets = {}, now = nowIso();
  if (b.password !== undefined) {
    checkPassword(b.password);
    if (user.encrypted_password && await needBcrypt().compare(b.password, user.encrypted_password)) throw aerr(422, "same_password", "New password should be different from the old password.");
    sets.encrypted_password = await needBcrypt().hash(b.password, 10);
  }
  if (b.data && typeof b.data === "object") sets.raw_user_meta_data = JSON.stringify({ ...j(user.raw_user_meta_data), ...b.data });
  const keys = Object.keys(sets);
  if (keys.length) run(`UPDATE auth_users SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => sets[k]), now, user.id]);
  if (b.data?.full_name !== undefined) run("UPDATE profiles SET full_name = ?, updated_at = ? WHERE id = ?", [b.data.full_name, now, user.id]);
  return { status: 200, body: userJson(userById(user.id)) };
}
function logout(req) {
  const { user, claims } = bearerUser(req);
  const scope = req.query.get("scope") || "global";
  if (scope === "local" && claims.session_id) run("UPDATE auth_refresh_tokens SET revoked = 1 WHERE session_id = ?", [claims.session_id]);
  else if (scope === "others") run("UPDATE auth_refresh_tokens SET revoked = 1 WHERE user_id = ? AND session_id <> ?", [user.id, claims.session_id || ""]);
  else run("UPDATE auth_refresh_tokens SET revoked = 1 WHERE user_id = ?", [user.id]);
  return { status: 204 };
}
async function recover(req) {
  const b = req.body || {}, email = normEmail(b.email);
  limit(`recover:${req.ip}`, 10, 3600e3);
  if (!EMAIL_RE.test(email)) throw aerr(400, "email_address_invalid", `Email address "${email}" is invalid`);
  const u = userByEmail(email);
  if (u) { try { await mailCode(u, "recovery", safeRedirect(b.redirect_to || req.query.get("redirect_to"))); } catch (e) { if (e.status === 429) { /* بی‌صدا */ } else throw e; } }
  return { status: 200, body: {} };
}
async function resend(req) {
  const b = req.body || {}, email = normEmail(b.email);
  limit(`resend:${req.ip}`, 20, 3600e3);
  if (b.type !== "signup" || !email) throw aerr(400, "validation_failed", "Only signup resend is supported");
  const u = userByEmail(email);
  if (u && !u.email_confirmed_at) await mailCode(u, "signup", safeRedirect(b.options?.emailRedirectTo || b.redirect_to));
  return { status: 200, body: {} };
}

// ---------- ادمین (فقط کلید service_role) ----------
async function adminCreate(req) {
  const b = req.body || {};
  const email = b.email ? normEmail(b.email) : null, phone = b.phone ? normPhone(b.phone) : null;
  if (!email && !phone) throw aerr(400, "validation_failed", "Email or phone required");
  if (email && userByEmail(email)) throw aerr(422, "email_exists", "A user with this email address has already been registered");
  if (phone && userByPhone(phone)) throw aerr(422, "phone_exists", "A user with this phone number has already been registered");
  if (b.password !== undefined) checkPassword(b.password);
  const now = nowIso();
  const row = createUser({
    email, phone, passwordHash: b.password ? await needBcrypt().hash(b.password, 10) : "",
    emailConfirmedAt: email && b.email_confirm ? now : null, phoneConfirmedAt: phone && b.phone_confirm ? now : null,
    userMeta: b.user_metadata || {}, appMeta: b.app_metadata && Object.keys(b.app_metadata).length ? { provider: email ? "email" : "phone", providers: [email ? "email" : "phone"], ...b.app_metadata } : undefined,
  });
  return { status: 200, body: userJson(row) };
}
async function adminUpdate(req, id) {
  const u = userById(id); if (!u) throw aerr(404, "user_not_found", "User not found");
  const b = req.body || {}, sets = {}, now = nowIso();
  if (b.email !== undefined) { const e = b.email ? normEmail(b.email) : null; const o = e && userByEmail(e); if (o && o.id !== id) throw aerr(422, "email_exists", "A user with this email address has already been registered"); sets.email = e; }
  if (b.phone !== undefined) { const p = b.phone ? normPhone(b.phone) : null; const o = p && userByPhone(p); if (o && o.id !== id) throw aerr(422, "phone_exists", "A user with this phone number has already been registered"); sets.phone = p; }
  if (b.password !== undefined) { checkPassword(b.password); sets.encrypted_password = await needBcrypt().hash(b.password, 10); }
  if (b.email_confirm === true) sets.email_confirmed_at = u.email_confirmed_at || now;
  if (b.phone_confirm === true) sets.phone_confirmed_at = u.phone_confirmed_at || now;
  if (b.user_metadata) sets.raw_user_meta_data = JSON.stringify({ ...j(u.raw_user_meta_data), ...b.user_metadata });
  if (b.app_metadata) sets.raw_app_meta_data = JSON.stringify({ ...j(u.raw_app_meta_data), ...b.app_metadata });
  if (b.ban_duration) sets.banned_until = b.ban_duration === "none" ? null : new Date(Date.now() + (parseFloat(b.ban_duration) || 0) * 3600e3).toISOString();
  const keys = Object.keys(sets);
  tx(() => {
    if (keys.length) run(`UPDATE auth_users SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => sets[k]), now, id]);
    if (b.password !== undefined) run("UPDATE auth_refresh_tokens SET revoked = 1 WHERE user_id = ?", [id]); // رمز عوض شد => نشست‌های قبلی بسته می‌شوند
    syncContact(userById(id));
  });
  return { status: 200, body: userJson(userById(id)) };
}

async function handle(req) {
  try {
    const parts = req.path.split("/").filter(Boolean);
    const p0 = parts[0], m = req.method;
    if (p0 === "health") return { status: 200, body: { name: "local-auth", version: "1" } };
    if (p0 === "settings") return { status: 200, body: { external: { email: true, phone: false }, disable_signup: false, mailer_autoconfirm: false, phone_autoconfirm: false } };
    if (p0 === "verify" && m === "GET") return verifyLink(req);
    if (p0 === "admin") {
      needService(req);
      if (parts[1] !== "users") throw aerr(404, "not_found", "Not found");
      const id = parts[2];
      if (!id && m === "POST") return await adminCreate(req);
      if (!id && m === "GET") {
        const per = Math.min(1000, Number(req.query.get("per_page")) || 50), page = Math.max(1, Number(req.query.get("page")) || 1);
        return { status: 200, body: { users: all("SELECT * FROM auth_users ORDER BY created_at LIMIT ? OFFSET ?", [per, (page - 1) * per]).map(userJson), aud: "authenticated" } };
      }
      if (id && m === "GET") { const u = userById(id); if (!u) throw aerr(404, "user_not_found", "User not found"); return { status: 200, body: userJson(u) }; }
      if (id && m === "PUT") return await adminUpdate(req, id);
      if (id && m === "DELETE") { tx(() => { run("DELETE FROM auth_refresh_tokens WHERE user_id = ?", [id]); run("DELETE FROM auth_codes WHERE user_id = ?", [id]); run("DELETE FROM auth_users WHERE id = ?", [id]); }); return { status: 200, body: {} }; }
      throw aerr(405, "method_not_allowed", "Method not allowed");
    }
    // مسیرهای عمومی نیاز به apikey معتبر دارند (anon یا service)
    const key = req.headers["apikey"] || "", okKey = (cfg.anonKey && safeEq(key, cfg.anonKey)) || (cfg.serviceKey && safeEq(key, cfg.serviceKey));
    if (!okKey) throw aerr(401, "no_authorization", "No API key found in request");
    if (p0 === "signup" && m === "POST") return await signup(req);
    if (p0 === "token" && m === "POST") return await token(req);
    if (p0 === "verify" && m === "POST") return { status: 200, body: await verifyBody(req) };
    if (p0 === "user" && m === "GET") return getUser(req);
    if (p0 === "user" && m === "PUT") return await putUser(req);
    if (p0 === "logout" && m === "POST") return logout(req);
    if (p0 === "recover" && m === "POST") return await recover(req);
    if (p0 === "resend" && m === "POST") return await resend(req);
    throw aerr(404, "not_found", "Path not found");
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { code: e.status, error_code: e.code, msg: e.message } };
    console.error("[auth]", e);
    return { status: 500, body: { code: 500, error_code: "unexpected_failure", msg: "Internal server error" } };
  }
}
module.exports = { handle, createUser, userJson };

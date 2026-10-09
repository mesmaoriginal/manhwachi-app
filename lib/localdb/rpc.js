// lib/localdb/rpc.js — معادل تابع‌های SQL سوپابیس (POST /rest/v1/rpc/<name>)
// roles: چه نقش‌هایی اجازه‌ی صدا زدن دارند. تابع‌های مالی/ادمینی فقط service_role (کلید سرور).
const { all, get, run, tx } = require("./sqlite");
const { HttpError } = require("./errors");
const { nowIso } = require("./policies");

const ANY = ["anon", "authenticated", "service_role"], AUTHED = ["authenticated", "service_role"], SERVER = ["service_role"];
const need = (args, k) => { if (args[k] === undefined || args[k] === null) throw new HttpError(400, "PGRST202", `Missing argument ${k}`); return args[k]; };

const FUNCS = {
  approve_team_task: { roles: SERVER, fn: (a) => tx(() => {
    const id = need(a, "p_task");
    const t = get("UPDATE team_tasks SET status = 'approved', reviewed_at = ? WHERE id = ? AND status = 'submitted' RETURNING *", [nowIso(), id]);
    if (!t) return { ok: false };
    run("INSERT INTO team_ledger (user_id, task_id, tokens, kind, note, created_at) VALUES (?, ?, ?, 'reward', ?, ?)", [t.assignee, t.id, t.reward_tokens, t.title, nowIso()]);
    return { ok: true, user_id: t.assignee, tokens: t.reward_tokens };
  }) },
  find_auth_user: { roles: SERVER, fn: (a) => {
    const phone = a.p_phone ?? null, email = a.p_email ?? null;
    return all("SELECT id, phone, email, email_confirmed_at FROM auth_users WHERE (? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND lower(email) = lower(?)) LIMIT 2", [phone, phone, email, email]);
  } },
  set_vip_status: { roles: SERVER, fn: (a) => { run("UPDATE profiles SET is_vip = ?, vip_until = ?, updated_at = ? WHERE id = ?", [a.p_is_vip ? 1 : 0, a.p_vip_until ? new Date(a.p_vip_until).toISOString() : null, nowIso(), need(a, "p_user_id")]); } },
  activate_user_vip: { roles: SERVER, fn: (a) => { run("UPDATE profiles SET is_vip = 1, vip_until = ?, updated_at = ? WHERE id = ?", [new Date(Date.now() + Number(need(a, "duration_days")) * 864e5).toISOString(), nowIso(), need(a, "target_user_id")]); } },
  update_own_profile: { roles: AUTHED, fn: (a, ctx) => {
    if (!ctx.uid) throw new HttpError(401, "42501", "not authenticated");
    run("UPDATE profiles SET full_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?", [a.p_full_name ?? null, a.p_avatar_url ?? null, nowIso(), ctx.uid]);
  } },
  increment_manhwa_views: { roles: ANY, fn: (a) => { run("INSERT INTO manhwa_stats (slug, views, updated_at) VALUES (?, 1, ?) ON CONFLICT(slug) DO UPDATE SET views = views + 1", [need(a, "p_slug"), nowIso()]); } },
  manhwa_rating_summary: { roles: ANY, fn: (a) => {
    const r = get("SELECT COUNT(*) AS total, AVG(rating) AS avg, SUM(rating=1) AS c1, SUM(rating=2) AS c2, SUM(rating=3) AS c3, SUM(rating=4) AS c4, SUM(rating=5) AS c5 FROM manhwa_ratings WHERE manhwa_slug = ?", [need(a, "p_slug")]);
    return { average: r.total ? Math.round(r.avg * 100) / 100 : 0, total: r.total, c1: r.c1 || 0, c2: r.c2 || 0, c3: r.c3 || 0, c4: r.c4 || 0, c5: r.c5 || 0 };
  } },
  manhwa_rating_totals: { roles: ANY, fn: () => all("SELECT manhwa_slug AS slug, ROUND(AVG(rating), 2) AS average, COUNT(*) AS total FROM manhwa_ratings GROUP BY manhwa_slug") },
  increment_like: { roles: ANY, fn: (a) => { run("UPDATE reels SET likes_count = likes_count + 1 WHERE id = ?", [need(a, "r_id")]); } },
  decrement_like: { roles: ANY, fn: (a) => { run("UPDATE reels SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?", [need(a, "r_id")]); } },
  increment_likes: { roles: ANY, fn: (a) => { run("UPDATE reels SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = ?", [need(a, "reel_id_param")]); } },
  decrement_likes: { roles: ANY, fn: (a) => { run("UPDATE reels SET likes_count = MAX(COALESCE(likes_count, 0) - 1, 0) WHERE id = ?", [need(a, "reel_id_param")]); } },
};

async function call(name, req, ctx) {
  const f = Object.prototype.hasOwnProperty.call(FUNCS, name) ? FUNCS[name] : null;
  if (!f) throw new HttpError(404, "PGRST202", `Could not find the function public.${name} in the schema cache`, null, name.startsWith("zibal_") || name === "search_manhwas" ? "این تابع در نسخه‌ی محلی پیاده‌سازی نشده است." : null);
  if (!f.roles.includes(ctx.role)) throw new HttpError(403, "42501", `permission denied for function ${name}`);
  let args = req.body || {};
  if (req.method === "GET") args = Object.fromEntries(req.query.entries());
  const out = f.fn(args, ctx);
  if (out === undefined) return { status: 204, headers: {} };
  return { status: 200, headers: {}, body: out };
}
module.exports = { call, FUNCS };

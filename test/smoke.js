// تست دودی: داده‌ی واقعی را وارد می‌کند و مسیرهای اصلی را (همان‌طور که سایت/سرور صدا می‌زنند) امتحان می‌کند.
// اجرا:  node test/smoke.js ./export users.csv
const fs = require("fs"), path = require("path"), assert = require("assert"), cp = require("child_process"), os = require("os");
const dir = process.argv[2], csv = process.argv.slice(3);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ldb-"));
process.env.LOCALDB_FILE = path.join(tmp, "t.sqlite");
const imp = cp.spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "..", "scripts", "import-data.js"), dir, ...csv], { env: process.env, encoding: "utf8" });
console.log(imp.stdout.split("\n").slice(0, 40).join("\n")); if (imp.status) { console.error(imp.stderr); process.exit(1); }

const L = require("../lib/localdb");
const ANON = "ANONKEY", SERVICE = "SERVICEKEY";
L.init({ dbFile: process.env.LOCALDB_FILE, anonKey: ANON, serviceKey: SERVICE, jwtSecret: "x".repeat(40), siteUrl: "https://manhwachi.ir", skipJobs: true });
L.installFetch();
const B = L.LOCAL_PREFIX;
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const anon = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };
const call = async (p, o = {}) => { const r = await fetch(B + p, o); const t = await r.text(); return { s: r.status, j: t ? JSON.parse(t) : null, h: r.headers }; };
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("✓", name); }, (e) => { console.log("✗", name, "\n   ", e.message); process.exitCode = 1; });
const logs = []; const ow = console.warn; console.warn = (...a) => { logs.push(a.join(" ")); };
const codeFor = (email, kind) => { const m = [...logs].reverse().map((l) => l.match(new RegExp(`کد ${kind} برای ${email}: (\\d{6})`))).find(Boolean); return m && m[1]; };

(async () => {
  await ok("service: لیست پروفایل‌ها", async () => { const r = await call("/rest/v1/profiles?select=id", { headers: svc }); assert.equal(r.s, 200); assert.equal(r.j.length, 291); });
  await ok("فیلتر eq + select + boolean + آرایه", async () => { const r = await call("/rest/v1/team_members?select=user_id,roles,active&order=created_at.desc", { headers: svc }); assert.equal(r.s, 200); assert(Array.isArray(r.j[0].roles)); assert.equal(typeof r.j[0].active, "boolean"); });
  await ok("in.(...) و or=(...) و not و cs", async () => {
    const t = (await call("/rest/v1/team_tasks?select=*", { headers: svc })).j; assert.equal(t.length, 2);
    const ids = t.map((x) => x.id).join(",");
    assert.equal((await call(`/rest/v1/team_tasks?id=in.(${ids})&select=id`, { headers: svc })).j.length, 2);
    assert.equal((await call(`/rest/v1/team_tasks?or=(source_file.eq.zzz,result_file.eq.zzz,extra_file.eq.zzz)&select=id&limit=1`, { headers: svc })).j.length, 0);
    assert.equal((await call(`/rest/v1/team_tasks?status=in.(claimed,submitted,open,draft,approved)&select=id`, { headers: svc })).j.length, 2);
    assert.equal((await call(`/rest/v1/team_tasks?status=not.in.(zzz)&select=id`, { headers: svc })).j.length, 2);
    assert.equal((await call(`/rest/v1/team_tasks?and=(status.neq.zzz,or(title.like.*,title.is.null))&select=id`, { headers: svc })).j.length, 2);
    const role = (await call("/rest/v1/team_members?select=roles&limit=1", { headers: svc })).j[0].roles[0];
    assert((await call(`/rest/v1/team_members?roles=cs.{${role}}&select=user_id`, { headers: svc })).j.length >= 1);
  });
  await ok("فیلتر زمانی با ISO و با + رمزگذاری‌نشده", async () => {
    assert.equal((await call(`/rest/v1/team_tasks?created_at=lt.${encodeURIComponent(new Date().toISOString())}&select=id`, { headers: svc })).j.length, 2);
    assert.equal((await call(`/rest/v1/team_tasks?created_at=gt.2030-01-01T00:00:00+00:00&select=id`, { headers: svc })).j.length, 0);
  });
  await ok("count=exact و Content-Range و Range", async () => {
    const r = await call("/rest/v1/messages?select=id&limit=5", { headers: { ...svc, Prefer: "count=exact" } }); assert.equal(r.j.length, 5); assert.match(r.h.get("content-range"), /^0-4\/434$/);
    const r2 = await call("/rest/v1/messages?select=id&order=id.asc", { headers: { ...svc, Range: "10-14", Prefer: "count=exact" } }); assert.equal(r2.j.length, 5); assert.match(r2.h.get("content-range"), /^10-14\/434$/);
  });
  await ok("single object (Accept pgrst)", async () => {
    const r = await call("/rest/v1/plans?key=eq.weekly&select=*", { headers: { ...anon, Accept: "application/vnd.pgrst.object+json" } });
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.key, "weekly");
    assert.equal((await call("/rest/v1/plans?key=eq.zzz&select=*", { headers: { ...anon, Accept: "application/vnd.pgrst.object+json" } })).s, 406);
  });
  await ok("anon: فقط پیام تاییدشده دیده می‌شود", async () => {
    const all = (await call("/rest/v1/messages?select=id,approved&limit=1000", { headers: svc })).j, pub = (await call("/rest/v1/messages?select=id,approved&limit=1000", { headers: anon })).j;
    assert.equal(pub.length, all.filter((x) => x.approved).length); assert(pub.every((x) => x.approved === true));
  });
  await ok("anon: payments / team_tasks خالی؛ کلید بد ۴۰۱؛ جدول ناشناس ۴۰۴", async () => {
    const pay = await call("/rest/v1/payments?select=*", { headers: anon }); assert.equal(pay.s, 200); assert.equal(pay.j.length, 0);
    assert.equal((await call("/rest/v1/team_tasks?select=*", { headers: anon })).j.length, 0);
    assert.equal((await call("/rest/v1/profiles?select=id", { headers: { apikey: "bad" } })).s, 401);
    assert.equal((await call("/rest/v1/auth_users?select=*", { headers: svc })).s, 404);
    assert.equal((await call("/rest/v1/payments", { method: "POST", headers: anon, body: JSON.stringify({ user_id: "x", track_id: "t", amount: 1, plan_key: "weekly" }) })).s, 403);
  });
  await ok("anon نمی‌تواند RPC مالی صدا بزند", async () => {
    assert.equal((await call("/rest/v1/rpc/activate_user_vip", { method: "POST", headers: anon, body: JSON.stringify({ target_user_id: "x", duration_days: 30 }) })).s, 403);
    assert.equal((await call("/rest/v1/rpc/approve_team_task", { method: "POST", headers: anon, body: JSON.stringify({ p_task: "x" }) })).s, 403);
  });
  await ok("increment_manhwa_views + rating summary/totals", async () => {
    await call("/rest/v1/rpc/increment_manhwa_views", { method: "POST", headers: anon, body: JSON.stringify({ p_slug: "__t" }) });
    await call("/rest/v1/rpc/increment_manhwa_views", { method: "POST", headers: anon, body: JSON.stringify({ p_slug: "__t" }) });
    assert.equal((await call("/rest/v1/manhwa_stats?slug=eq.__t&select=views", { headers: anon })).j[0].views, 2);
    const s = (await call("/rest/v1/rpc/manhwa_rating_totals", { method: "POST", headers: svc, body: "{}" })).j; assert(s.length > 0 && s[0].slug);
    const sum = (await call("/rest/v1/rpc/manhwa_rating_summary", { method: "POST", headers: svc, body: JSON.stringify({ p_slug: s[0].slug }) })).j; assert(sum.total > 0);
  });
  await ok("ratings.js: upsert با on_conflict دو بار => یک ردیف", async () => {
    const uid = (await call("/rest/v1/profiles?select=id&limit=1", { headers: svc })).j[0].id;
    const body = (rating) => JSON.stringify({ user_id: uid, manhwa_slug: "__slug", rating, updated_at: new Date().toISOString() });
    const h = { ...svc, Prefer: "resolution=merge-duplicates,return=minimal" };
    assert.equal((await call("/rest/v1/manhwa_ratings?on_conflict=user_id,manhwa_slug", { method: "POST", headers: h, body: body(3) })).s, 201);
    assert.equal((await call("/rest/v1/manhwa_ratings?on_conflict=user_id,manhwa_slug", { method: "POST", headers: h, body: body(5) })).s, 201);
    const rows = (await call(`/rest/v1/manhwa_ratings?user_id=eq.${uid}&manhwa_slug=eq.__slug&select=rating`, { headers: svc })).j;
    assert.equal(rows.length, 1); assert.equal(rows[0].rating, 5);
    assert.equal((await call(`/rest/v1/manhwa_ratings?user_id=eq.${uid}&manhwa_slug=eq.__slug`, { method: "DELETE", headers: { ...svc, Prefer: "return=minimal" } })).s, 204);
  });
  await ok("profiles upsert مثل server.js و PATCH پرداخت + updated_at", async () => {
    const id = "33333333-3333-3333-3333-333333333333";
    let r = await call("/rest/v1/profiles", { method: "POST", headers: { ...svc, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([{ id, is_vip: true, vip_until: new Date().toISOString() }]) });
    assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j[0].is_vip, true);
    r = await call("/rest/v1/payments", { method: "POST", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify([{ user_id: id, plan_key: "weekly", amount: 1, status: "pending", track_id: "T-1" }]) });
    assert.equal(r.s, 201, JSON.stringify(r.j));
    r = await call("/rest/v1/payments", { method: "POST", headers: svc, body: JSON.stringify([{ user_id: id, plan_key: "weekly", amount: 1, status: "pending", track_id: "T-1" }]) });
    assert.equal(r.s, 409);
    r = await call("/rest/v1/payments?track_id=eq.T-1&status=eq.pending", { method: "PATCH", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify({ status: "paid", ref_number: "99" }) });
    assert.equal(r.j.length, 1); assert.equal(r.j[0].status, "paid"); assert.notEqual(r.j[0].updated_at, r.j[0].created_at);
  });
  await ok("approve_team_task: ledger و idempotent", async () => {
    const t = (await call("/rest/v1/team_tasks?select=*&limit=1", { headers: svc })).j[0];
    await call(`/rest/v1/team_tasks?id=eq.${t.id}`, { method: "PATCH", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify({ status: "submitted", assignee: t.assignee || "11111111-1111-1111-1111-111111111111" }) });
    const before = (await call("/rest/v1/team_ledger?select=id", { headers: svc })).j.length;
    assert.equal((await call("/rest/v1/rpc/approve_team_task", { method: "POST", headers: svc, body: JSON.stringify({ p_task: t.id }) })).j.ok, true);
    assert.equal((await call("/rest/v1/rpc/approve_team_task", { method: "POST", headers: svc, body: JSON.stringify({ p_task: t.id }) })).j.ok, false);
    assert.equal((await call("/rest/v1/team_ledger?select=id", { headers: svc })).j.length, before + 1);
  });
  await ok("PATCH بدون فیلتر ۴۰۰؛ insert با uuid و default", async () => {
    assert.equal((await call("/rest/v1/team_tasks", { method: "PATCH", headers: svc, body: JSON.stringify({ title: "x" }) })).s, 400);
    const r = await call("/rest/v1/team_tickets", { method: "POST", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify([{ user_id: "22222222-2222-2222-2222-222222222222", message: "hi" }]) });
    assert.equal(r.s, 201); assert.match(r.j[0].id, /^[0-9a-f-]{36}$/); assert.equal(r.j[0].level, "warning"); assert(r.j[0].created_at.endsWith("Z"));
    assert.equal((await call("/rest/v1/team_tickets", { method: "POST", headers: svc, body: JSON.stringify([{ user_id: "2" }]) })).s, 400); // message اجباری
    assert.equal((await call("/rest/v1/team_tickets", { method: "POST", headers: svc, body: JSON.stringify([{ nope: 1, message: "x", user_id: "u" }]) })).s, 400);
  });
  await ok("کامنت: حد ۳ نظر + شمارنده‌ی ریل", async () => {
    const reel = (await call("/rest/v1/reels?select=id,comments_count&limit=1", { headers: anon })).j[0];
    let last;
    for (let i = 0; i < 4; i++) last = await call("/rest/v1/comments", { method: "POST", headers: anon, body: JSON.stringify({ reel_id: reel.id, device_id: "dev-T", username: "t", text: "c" + i }) });
    assert.equal(last.s, 400); assert.match(last.j.message, /۳ نظر/);
    assert.equal((await call(`/rest/v1/reels?id=eq.${reel.id}&select=comments_count`, { headers: anon })).j[0].comments_count, reel.comments_count + 3);
  });
  await ok("anon نمی‌تواند پیام بگذارد؛ likes با RPC و reel_likes", async () => {
    assert.equal((await call("/rest/v1/messages", { method: "POST", headers: anon, body: JSON.stringify({ text: "x", name: "n" }) })).s, 403);
    const reel = (await call("/rest/v1/reels?select=id,likes_count&limit=1", { headers: anon })).j[0];
    await call("/rest/v1/rpc/increment_like", { method: "POST", headers: anon, body: JSON.stringify({ r_id: reel.id }) });
    assert.equal((await call(`/rest/v1/reels?id=eq.${reel.id}&select=likes_count`, { headers: anon })).j[0].likes_count, reel.likes_count + 1);
    assert.equal((await call("/rest/v1/reel_likes", { method: "POST", headers: anon, body: JSON.stringify({ reel_id: reel.id, device_id: "d1" }) })).s, 201);
    assert.equal((await call("/rest/v1/reels?id=eq." + reel.id, { method: "PATCH", headers: anon, body: JSON.stringify({ title: "hack" }) })).s, 403);
  });
  await ok("signup → ورود قبل از تایید رد → verify → login → refresh → user → logout", async () => {
    const email = "tester2@gmail.com";
    let r = await call("/auth/v1/signup", { method: "POST", headers: anon, body: JSON.stringify({ email, password: "secret12", data: { full_name: "علی" } }) });
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.identities.length, 1);
    const code = codeFor(email, "signup");
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ email, password: "secret12" }) });
    assert.equal(r.s, 400); assert.equal(r.j.error_code, "email_not_confirmed");
    r = await call("/auth/v1/verify", { method: "POST", headers: anon, body: JSON.stringify({ email, token: "000000", type: "signup" }) }); assert.equal(r.s, 403);
    r = await call("/auth/v1/verify", { method: "POST", headers: anon, body: JSON.stringify({ email, token: code, type: "signup" }) });
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert(r.j.access_token && r.j.refresh_token);
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ email, password: "wrong" }) }); assert.equal(r.j.error_code, "invalid_credentials");
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ email, password: "secret12" }) });
    assert.equal(r.s, 200); const s = r.j;
    const uh = { apikey: ANON, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" };
    assert.equal((await call("/auth/v1/user", { headers: uh })).j.email, email);
    assert.equal((await call(`/rest/v1/profiles?id=eq.${s.user.id}&select=full_name,is_vip`, { headers: uh })).j[0].full_name, "علی");
    const m = await call("/rest/v1/messages", { method: "POST", headers: { ...uh, Prefer: "return=representation" }, body: JSON.stringify({ text: "سلام", manhwa_slug: "x", approved: true, name: "علی", user_id: s.user.id }) });
    assert.equal(m.s, 201, JSON.stringify(m.j)); assert.equal(m.j[0].approved, false);
    assert.equal((await call(`/rest/v1/messages?id=eq.${m.j[0].id}&select=id`, { headers: uh })).j.length, 1);
    assert.equal((await call(`/rest/v1/messages?id=eq.${m.j[0].id}&select=id`, { headers: anon })).j.length, 0);
    assert.equal((await call("/rest/v1/messages", { method: "POST", headers: uh, body: JSON.stringify({ text: "x", name: "n", user_id: "00000000-0000-0000-0000-000000000000" }) })).s, 403);
    assert.equal((await call(`/rest/v1/messages?id=eq.${m.j[0].id}`, { method: "PATCH", headers: uh, body: JSON.stringify({ approved: true }) })).s, 204); // مثل RLS: بی‌صدا هیچ ردیفی تغییر نمی‌کند
    assert.equal((await call(`/rest/v1/messages?id=eq.${m.j[0].id}&select=approved`, { headers: svc })).j[0].approved, false); // کاربر عادی نمی‌تواند تایید کند
    // bookmarks
    const bk = { user_id: s.user.id, manhwa_slug: "s1", title_fa: "الف" };
    assert.equal((await call("/rest/v1/bookmarks", { method: "POST", headers: uh, body: JSON.stringify(bk) })).s, 201);
    assert.equal((await call("/rest/v1/bookmarks", { method: "POST", headers: uh, body: JSON.stringify({ ...bk, user_id: "x" }) })).s, 403);
    assert.equal((await call("/rest/v1/bookmarks?select=manhwa_slug", { headers: uh })).j.length, 1);
    assert.equal((await call("/rest/v1/bookmarks?manhwa_slug=eq.s1", { method: "DELETE", headers: uh })).s, 204);
    // RPC پروفایل و جلوگیری از VIP شدن
    await call("/rest/v1/rpc/update_own_profile", { method: "POST", headers: uh, body: JSON.stringify({ p_full_name: "علی۲", p_avatar_url: null }) });
    assert.equal((await call(`/rest/v1/profiles?id=eq.${s.user.id}&select=full_name`, { headers: uh })).j[0].full_name, "علی۲");
    assert.equal((await call(`/rest/v1/profiles?id=eq.${s.user.id}`, { method: "PATCH", headers: uh, body: JSON.stringify({ is_vip: true }) })).s, 204);
    assert.equal((await call(`/rest/v1/profiles?id=eq.${s.user.id}&select=is_vip`, { headers: svc })).j[0].is_vip, false);
    // refresh و logout
    r = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: anon, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    assert.equal(r.s, 200); assert.notEqual(r.j.refresh_token, s.refresh_token);
    r = await call("/auth/v1/logout", { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${r.j.access_token}` } }); assert.equal(r.s, 204);
    r = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: anon, body: JSON.stringify({ refresh_token: s.refresh_token }) }); assert.equal(r.s, 400);
  });
  await ok("ادمین: همه‌ی نظرها را می‌بیند، تایید می‌کند، پاسخ می‌دهد", async () => {
    const adminId = (await call("/rest/v1/admins?select=id&limit=1", { headers: svc })).j[0].id;
    let r = await call(`/auth/v1/admin/users/${adminId}`, { method: "PUT", headers: svc, body: JSON.stringify({ password: "adminpass1", email_confirm: true }) }); assert.equal(r.s, 200);
    const email = r.j.email || (await call(`/auth/v1/admin/users/${adminId}`, { headers: svc })).j.email;
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ email, password: "adminpass1" }) }); assert.equal(r.s, 200, JSON.stringify(r.j));
    const ah = { apikey: ANON, Authorization: `Bearer ${r.j.access_token}`, "Content-Type": "application/json" };
    const allMsgs = (await call("/rest/v1/messages?select=id,approved&limit=1000", { headers: svc })).j;
    assert.equal((await call("/rest/v1/messages?select=id&limit=1000", { headers: ah })).j.length, allMsgs.length);
    const un = allMsgs.find((x) => !x.approved);
    if (un) { r = await call(`/rest/v1/messages?id=eq.${un.id}`, { method: "PATCH", headers: { ...ah, Prefer: "return=representation" }, body: JSON.stringify({ approved: true }) }); assert.equal(r.s, 200); assert.equal(r.j[0].approved, true); assert(r.j[0].approved_at); }
    r = await call("/rest/v1/replies", { method: "POST", headers: { ...ah, Prefer: "return=representation" }, body: JSON.stringify({ message_id: allMsgs[0].id, reply_text: "ممنون", admin_id: adminId, is_admin: true }) });
    assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j[0].is_admin, true);
    assert.equal((await call(`/rest/v1/replies?id=eq.${r.j[0].id}`, { method: "DELETE", headers: ah })).s, 204);
  });
  await ok("signup غیر-gmail رد؛ ایمیل تکراریِ تاییدشده identities خالی", async () => {
    assert.equal((await call("/auth/v1/signup", { method: "POST", headers: anon, body: JSON.stringify({ email: "a@yahoo.com", password: "secret12" }) })).s, 500);
    const r = await call("/auth/v1/signup", { method: "POST", headers: anon, body: JSON.stringify({ email: "tester2@gmail.com", password: "secret12" }) });
    assert.equal(r.s, 200); assert.equal(r.j.identities.length, 0);
  });
  await ok("admin: ساخت کاربر با شماره، ورود با phone، تکراری ۴۲۲، تغییر رمز، find_auth_user", async () => {
    let r = await call("/auth/v1/admin/users", { method: "POST", headers: svc, body: JSON.stringify({ phone: "989120000001", password: "pass1234", phone_confirm: true, user_metadata: { full_name: "فون" } }) });
    assert.equal(r.s, 200, JSON.stringify(r.j)); const id = r.j.id;
    r = await call("/auth/v1/admin/users", { method: "POST", headers: svc, body: JSON.stringify({ phone: "989120000001", password: "pass1234", phone_confirm: true }) });
    assert.equal(r.s, 422); assert(/registered/.test(r.j.msg));
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ phone: "989120000001", password: "pass1234" }) }); assert.equal(r.s, 200);
    r = await call(`/auth/v1/admin/users/${id}`, { method: "PUT", headers: svc, body: JSON.stringify({ password: "newpass99", email: "phoneuser@gmail.com", email_confirm: true }) }); assert.equal(r.s, 200);
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ email: "phoneuser@gmail.com", password: "newpass99" }) }); assert.equal(r.s, 200);
    r = await call("/rest/v1/rpc/find_auth_user", { method: "POST", headers: svc, body: JSON.stringify({ p_phone: "989120000001", p_email: null }) }); assert.equal(r.j.length, 1);
    assert.equal((await call("/auth/v1/admin/users", { method: "POST", headers: anon, body: "{}" })).s, 403);
  });
  await ok("recover → verify(recovery) → PUT /user password", async () => {
    const email = "tester2@gmail.com";
    await call("/auth/v1/recover", { method: "POST", headers: anon, body: JSON.stringify({ email }) });
    const code = codeFor(email, "recovery");
    let r = await call("/auth/v1/verify", { method: "POST", headers: anon, body: JSON.stringify({ email, token: code, type: "recovery" }) }); assert.equal(r.s, 200);
    r = await call("/auth/v1/user", { method: "PUT", headers: { apikey: ANON, Authorization: `Bearer ${r.j.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: "brandnew1" }) }); assert.equal(r.s, 200);
    r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: anon, body: JSON.stringify({ email, password: "brandnew1" }) }); assert.equal(r.s, 200);
  });
  await ok("کاربران وارد‌شده: ورود با رمز قدیمی نیاز به هش واقعی دارد (فقط شمارش)", async () => { const r = await call("/auth/v1/admin/users?per_page=1000", { headers: svc }); assert(r.j.users.length >= 291); });
  console.warn = ow;
  console.log(`\n${n} تست موفق`);
})();

const express = require("express");

function isSubscriptionWork(manhwa) {
  if (!manhwa) return false;
  if (manhwa.vip_only === true || manhwa.is_vip === true) return true;
  const eps = Array.isArray(manhwa.episodes) ? manhwa.episodes : [];
  return eps.some(ep => !ep.free);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function bearerToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

function makeLimiter(windowMs, max, cap = 2e4) {
  const log = new Map;
  return function allow(key) {
    const now = Date.now();
    const arr = (log.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      log.set(key, arr);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((windowMs - (now - arr[0])) / 1e3)
      };
    }
    arr.push(now);
    log.set(key, arr);
    if (log.size > cap) log.delete(log.keys().next().value);
    return {
      allowed: true
    };
  };
}

const allowWrite = makeLimiter(10 * 60 * 1e3, 30);

const allowIpWrite = makeLimiter(10 * 60 * 1e3, 120);

const SUMMARY_TTL_MS = 30 * 1e3;

const SUMMARY_MAX = 2e3;

const summaryCache = new Map;

module.exports = function createRatingsRouter({getData: getData, getAuthContext: getAuthContext, supabaseUrl: supabaseUrl, adminHeaders: adminHeaders}) {
  const router = express.Router();
  const rest = (p, init = {}) => fetch(`${supabaseUrl}/rest/v1/${p}`, {
    signal: AbortSignal.timeout(1e4),
    ...init
  });
  function findManhwa(slug) {
    if (typeof slug !== "string" || !slug || slug.length > 200) return null;
    const data = getData();
    return hasOwn(data, slug) ? data[slug] : null;
  }
  async function getSummary(slug) {
    const cached = summaryCache.get(slug);
    if (cached && cached.exp > Date.now()) return cached.data;
    const r = await rest("rpc/manhwa_rating_summary", {
      method: "POST",
      headers: adminHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        p_slug: slug
      })
    });
    if (!r.ok) throw new Error(`rating summary ${r.status}`);
    const s = await r.json();
    const data = {
      average: Number(s.average) || 0,
      count: Number(s.total) || 0,
      distribution: [ s.c1, s.c2, s.c3, s.c4, s.c5 ].map(n => Number(n) || 0)
    };
    summaryCache.set(slug, {
      data: data,
      exp: Date.now() + SUMMARY_TTL_MS
    });
    while (summaryCache.size > SUMMARY_MAX) summaryCache.delete(summaryCache.keys().next().value);
    return data;
  }
  async function getMyRating(userId, slug) {
    const r = await rest(`manhwa_ratings?user_id=eq.${encodeURIComponent(userId)}&manhwa_slug=eq.${encodeURIComponent(slug)}&select=rating&limit=1`, {
      headers: adminHeaders()
    });
    if (!r.ok) throw new Error(`my rating ${r.status}`);
    const rows = await r.json();
    return rows && rows[0] ? Number(rows[0].rating) : null;
  }
  async function requireUser(req, res) {
    const ipRl = allowIpWrite(req.ip || "unknown");
    if (!ipRl.allowed) {
      res.setHeader("Retry-After", String(ipRl.retryAfterSeconds));
      res.status(429).json({
        error: "درخواست‌های زیاد، کمی بعد تلاش کنید",
        code: "RATE_LIMITED"
      });
      return null;
    }
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({
        error: "برای امتیاز دادن باید وارد حساب شوید",
        code: "AUTH_REQUIRED"
      });
      return null;
    }
    let ctx;
    try {
      ctx = await getAuthContext(token);
    } catch (err) {
      console.error("[ratings] auth check failed:", err.message);
      res.status(503).json({
        error: "سرویس موقتاً در دسترس نیست، کمی بعد دوباره تلاش کنید",
        code: "UNAVAILABLE"
      });
      return null;
    }
    if (!ctx) {
      res.status(401).json({
        error: "نشست شما نامعتبر است، دوباره وارد شوید",
        code: "AUTH_REQUIRED"
      });
      return null;
    }
    return ctx;
  }
  router.get("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      const manhwa = findManhwa(slug);
      if (!manhwa) return res.status(404).json({
        error: "مانهوا پیدا نشد"
      });
      const requiresVip = isSubscriptionWork(manhwa);
      const summary = await getSummary(slug);
      const out = {
        ...summary,
        requiresVip: requiresVip,
        myRating: null,
        canRate: false,
        reason: "AUTH_REQUIRED"
      };
      const token = bearerToken(req);
      res.setHeader("Vary", "Authorization");
      if (token) {
        res.setHeader("Cache-Control", "private, no-store");
        let ctx = null;
        let authDown = false;
        try {
          ctx = await getAuthContext(token);
        } catch (err) {
          authDown = true;
          console.error("[ratings] auth check failed:", err.message);
        }
        if (authDown) {
          out.reason = "UNAVAILABLE";
        } else if (ctx) {
          out.myRating = await getMyRating(ctx.user.id, slug);
          out.canRate = !requiresVip || ctx.isVip;
          out.reason = out.canRate ? null : "VIP_REQUIRED";
        }
      } else {
        res.setHeader("Cache-Control", "public, max-age=15");
      }
      return res.json(out);
    } catch (err) {
      console.error("[ratings] GET failed:", err);
      return res.status(500).json({
        error: "خطای داخلی سرور"
      });
    }
  });
  router.post("/", async (req, res) => {
    try {
      const {slug: slug, rating: rawRating} = req.body || {};
      const rating = typeof rawRating === "number" ? rawRating : typeof rawRating === "string" && /^[1-5]$/.test(rawRating.trim()) ? Number(rawRating) : NaN;
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({
          error: "امتیاز باید عددی بین ۱ تا ۵ باشد"
        });
      }
      const manhwa = findManhwa(slug);
      if (!manhwa) return res.status(404).json({
        error: "مانهوا پیدا نشد"
      });
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      if (isSubscriptionWork(manhwa) && !ctx.isVip) {
        return res.status(403).json({
          error: "امتیاز دادن به این مانهوا مخصوص کاربران دارای اشتراک است",
          code: "VIP_REQUIRED"
        });
      }
      const rl = allowWrite(ctx.user.id);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfterSeconds));
        return res.status(429).json({
          error: "تعداد دفعات امتیازدهی شما زیاد بوده، کمی بعد دوباره تلاش کنید",
          code: "RATE_LIMITED",
          retryAfterSeconds: rl.retryAfterSeconds
        });
      }
      const r = await rest("manhwa_ratings?on_conflict=user_id,manhwa_slug", {
        method: "POST",
        headers: adminHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        }),
        body: JSON.stringify({
          user_id: ctx.user.id,
          manhwa_slug: slug,
          rating: rating,
          updated_at: (new Date).toISOString()
        })
      });
      if (!r.ok) {
        console.error("[ratings] upsert failed:", r.status, await r.text().catch(() => ""));
        return res.status(502).json({
          error: "ثبت امتیاز ناموفق بود، دوباره تلاش کنید"
        });
      }
      summaryCache.delete(slug);
      const summary = await getSummary(slug).catch(() => null);
      return res.json({
        ok: true,
        ...summary || {
          stale: true
        },
        myRating: rating
      });
    } catch (err) {
      console.error("[ratings] POST failed:", err);
      return res.status(500).json({
        error: "خطای داخلی سرور"
      });
    }
  });
  router.delete("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      if (!findManhwa(slug)) return res.status(404).json({
        error: "مانهوا پیدا نشد"
      });
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const rl = allowWrite(ctx.user.id);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfterSeconds));
        return res.status(429).json({
          error: "درخواست‌های زیاد، کمی بعد تلاش کنید",
          code: "RATE_LIMITED"
        });
      }
      const r = await rest(`manhwa_ratings?user_id=eq.${encodeURIComponent(ctx.user.id)}&manhwa_slug=eq.${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: adminHeaders({
          Prefer: "return=minimal"
        })
      });
      if (!r.ok) {
        console.error("[ratings] delete failed:", r.status);
        return res.status(502).json({
          error: "حذف امتیاز ناموفق بود"
        });
      }
      summaryCache.delete(slug);
      const summary = await getSummary(slug).catch(() => null);
      return res.json({
        ok: true,
        ...summary || {
          stale: true
        },
        myRating: null
      });
    } catch (err) {
      console.error("[ratings] DELETE failed:", err);
      return res.status(500).json({
        error: "خطای داخلی سرور"
      });
    }
  });
  return router;
};

module.exports.isSubscriptionWork = isSubscriptionWork;
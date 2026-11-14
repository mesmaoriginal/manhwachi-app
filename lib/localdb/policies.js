const {HttpError: HttpError} = require("./errors");

const sqlite = require("./sqlite");

const notify = require("./notify");

const nowIso = () => (new Date).toISOString();

const deny = m => new HttpError(403, "42501", m || "new row violates row-level security policy");

const bad = m => new HttpError(400, "23514", m);

const own = col => c => c.uid ? {
  sql: `"${col}" = ?`,
  params: [ c.uid ]
} : false;

const member = c => !!(c.uid && sqlite.get("SELECT 1 AS x FROM team_members WHERE user_id = ? AND active = 1", [ c.uid ]));

const str = (v, max, name) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw bad(`${name} نامعتبر است`);
  return v;
};

const optStr = (v, max, name) => v == null || v === "" ? null : str(v, max, name);

const hits = new Map;

function limitWrite(ctx, table) {
  const max = table === "reel_likes" ? 120 : 30, key = `${ctx.ip}:${table}`, now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < 6e5);
  if (arr.length >= max) {
    hits.set(key, arr);
    throw new HttpError(429, "429", "تعداد درخواست‌ها زیاد است، کمی بعد تلاش کنید");
  }
  arr.push(now);
  hits.set(key, arr);
}

setInterval(() => {
  const n = Date.now();
  for (const [k, a] of hits) {
    const f = a.filter(t => n - t < 6e5);
    f.length ? hits.set(k, f) : hits.delete(k);
  }
}, 3e5).unref();

const isAdmin = c => !!(c.uid && sqlite.get("SELECT 1 AS x FROM admins WHERE id = ?", [ c.uid ]));

const adminOnly = c => isAdmin(c);

const policies = {
  reels: {
    select: true
  },
  plans: {
    select: true
  },
  ads: {
    select: true
  },
  manhwa_stats: {
    select: true
  },
  profiles: {
    select: true,
    selectRequires: "id",
    selectMaxIn: 100,
    selectCols: [ "id", "full_name", "avatar_url", "is_vip", "vip_until", "vip_tier" ]
  },
  admins: {
    select: own("id"),
    update: own("id"),
    updateCols: [ "display_name", "role_tag" ]
  },
  reel_likes: {
    select: true,
    insert: (c, r) => ({
      reel_id: r.reel_id ?? null,
      device_id: str(r.device_id, 100, "device_id")
    })
  },
  comments: {
    select: () => ({
      sql: "approved = 1",
      params: []
    }),
    insert: (c, r) => {
      const reel = str(r.reel_id, 64, "reel_id"), dev = str(r.device_id, 100, "device_id");
      const n = sqlite.get("SELECT COUNT(*) AS n FROM comments WHERE reel_id = ? AND device_id = ?", [ reel, dev ]).n;
      if (n >= 3) throw new HttpError(400, "P0001", "شما فقط مجاز به ثبت ۳ نظر در این پست هستید!");
      return {
        reel_id: reel,
        device_id: dev,
        username: str(r.username, 60, "username"),
        text: str(r.text, 1e3, "text")
      };
    }
  },
  messages: {
    select: c => isAdmin(c) ? true : c.uid ? {
      sql: "(approved = 1 OR user_id = ?)",
      params: [ c.uid ]
    } : {
      sql: "approved = 1",
      params: []
    },
    insert: (c, r) => {
      if (!c.uid) throw deny();
      if (isAdmin(c)) return r;
      if (r.user_id !== c.uid) throw deny();
      return {
        text: str(r.text, 2e3, "text"),
        manhwa_slug: optStr(r.manhwa_slug, 200, "manhwa_slug"),
        name: str(r.name, 80, "name"),
        parent_message_id: r.parent_message_id ?? null,
        user_id: c.uid,
        approved: false,
        approved_at: null
      };
    },
    update: adminOnly,
    delete: adminOnly,
    updateCols: [ "text", "approved", "approved_at", "name", "manhwa_slug", "parent_message_id" ]
  },
  replies: {
    select: true,
    update: adminOnly,
    delete: adminOnly,
    insert: (c, r) => {
      if (!isAdmin(c)) throw deny();
      const a = sqlite.get("SELECT display_name, role_tag FROM admins WHERE id = ?", [ c.uid ]);
      return {
        message_id: r.message_id,
        reply_text: str(r.reply_text, 2e3, "reply_text"),
        admin_id: c.uid,
        admin_name: a?.display_name || "ادمین",
        admin_role: a?.role_tag || "ادمین",
        is_admin: true
      };
    },
    updateCols: [ "reply_text" ]
  },
  bookmarks: {
    select: own("user_id"),
    delete: own("user_id"),
    insert: (c, r) => {
      if (!c.uid || r.user_id !== c.uid) throw deny();
      return r;
    }
  },
  profile_contacts: {
    select: own("user_id")
  },
  payments: {
    select: own("user_id")
  },
  manhwa_ratings: {
    select: own("user_id")
  },
  chapter_reports: {
    insert: (c, r) => ({
      slug: str(r.slug, 200, "slug"),
      chapter_num: r.chapter_num ?? null,
      page: optStr(r.page, 100, "page"),
      message: str(r.message, 2e3, "message")
    })
  },
  applications: {
    insert: (c, r) => ({
      role: str(r.role, 100, "role"),
      full_name: str(r.full_name, 120, "full_name"),
      age: optStr(r.age, 20, "age"),
      platform: str(r.platform, 100, "platform"),
      social_id: str(r.social_id, 200, "social_id"),
      bio: optStr(r.bio, 2e3, "bio")
    })
  },
  team_members: {
    select: own("user_id")
  },
  team_tasks: {
    select: c => member(c) ? {
      sql: "assignee = ?",
      params: [ c.uid ]
    } : false
  },
  team_ledger: {
    select: own("user_id")
  },
  team_withdrawals: {
    select: own("user_id")
  },
  team_tickets: {
    select: own("user_id")
  },
  team_support: {
    select: own("user_id")
  },
  support_tickets: {
    select: own("user_id")
  },
  manhwa_requests: {
    select: own("user_id")
  }
};

const hooks = {
  comments: {
    afterInsert: rows => {
      for (const r of rows) sqlite.run("UPDATE reels SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = ?", [ r.reel_id ]);
    },
    afterDelete: rows => {
      for (const r of rows) sqlite.run("UPDATE reels SET comments_count = MAX(COALESCE(comments_count, 0) - 1, 0) WHERE id = ?", [ r.reel_id ]);
    }
  },
  messages: {
    afterInsert: rows => {
      for (const r of rows) notify.newMessage(r);
    }
  }
};

function beforeUpdate(table, patch) {
  if (table === "messages" && patch.approved === true && patch.approved_at === undefined) patch.approved_at = nowIso();
}

module.exports = {
  policies: policies,
  hooks: hooks,
  beforeUpdate: beforeUpdate,
  limitWrite: limitWrite,
  nowIso: nowIso
};
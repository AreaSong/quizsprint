import { getDb, withTx } from "./db.mjs";

const DEFAULT_SITE_CONFIG = {
  siteName: "QuizSprint",
  subtitle: "Question Bank",
  announcement: "",
  allowGuestBrowse: true,
  footerNote: ""
};

export const getSiteConfig = (dataDir) => {
  const db = getDb(dataDir);
  const row = db.prepare("SELECT value_json FROM kv_store WHERE key = 'site_config'").get();
  if (!row) return { ...DEFAULT_SITE_CONFIG };
  try {
    const parsed = JSON.parse(row.value_json || "{}");
    return {
      siteName: String(parsed.siteName || DEFAULT_SITE_CONFIG.siteName).trim() || DEFAULT_SITE_CONFIG.siteName,
      subtitle: String(parsed.subtitle ?? DEFAULT_SITE_CONFIG.subtitle).trim(),
      announcement: String(parsed.announcement || "").trim(),
      allowGuestBrowse: parsed.allowGuestBrowse !== false,
      footerNote: String(parsed.footerNote || "").trim()
    };
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
};

export const saveSiteConfig = (dataDir, patch = {}) => {
  const cur = getSiteConfig(dataDir);
  const next = {
    siteName: String(patch.siteName ?? cur.siteName).trim().slice(0, 40) || DEFAULT_SITE_CONFIG.siteName,
    subtitle: String(patch.subtitle ?? cur.subtitle).trim().slice(0, 60),
    announcement: String(patch.announcement ?? cur.announcement).trim().slice(0, 300),
    allowGuestBrowse: patch.allowGuestBrowse !== undefined ? Boolean(patch.allowGuestBrowse) : cur.allowGuestBrowse,
    footerNote: String(patch.footerNote ?? cur.footerNote).trim().slice(0, 200)
  };
  const db = getDb(dataDir);
  db.prepare(`
    INSERT INTO kv_store (key, value_json) VALUES ('site_config', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(JSON.stringify(next));
  return next;
};

export const needsInitialSetup = (dataDir) => {
  if (process.env.DISABLE_SETUP_WIZARD === "1") return false;
  const db = getDb(dataDir);
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").get();
  return Number(row?.cnt || 0) === 0;
};

/** 首次空库初始化：创建首个管理员账号并设置站点标题 */
export const completeInitialSetup = (dataDir, userStore, { username, password, nickname = "管理员", siteName = "" } = {}) => {
  if (!needsInitialSetup(dataDir)) {
    return { error: "系统已完成初始化，请直接登录管理员账号", status: 403 };
  }
  const res = userStore.register({ username, password, nickname: String(nickname || "管理员").trim() || "管理员", role: "admin" });
  if (res.error) return { error: res.error, status: 400 };
  const siteConfig = siteName ? saveSiteConfig(dataDir, { siteName }) : getSiteConfig(dataDir);
  return { user: res.user, siteConfig };
};

export const exportUserProgressBundle = (userStore, user) => {
  const prog = userStore.loadProgress(user.id);
  return {
    format: "quizsprint-progress-v1",
    exportedAt: new Date().toISOString(),
    username: user.username,
    banks: prog.banks || {},
    dailyStats: prog.dailyStats || {}
  };
};

export const importUserProgressBundle = (dataDir, userStore, user, payload) => {
  if (!payload || typeof payload !== "object" || typeof payload.banks !== "object") {
    return { error: "无效的学习进度备份格式" };
  }
  const entries = Object.entries(payload.banks).filter(([bid, val]) => bid && val && typeof val === "object");
  for (const [bankId, bankData] of entries) {
    userStore.saveBankProgress(user.id, bankId, bankData, null);
  }
  if (payload.dailyStats && typeof payload.dailyStats === "object") {
    const db = getDb(dataDir);
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO user_daily_stats (user_id, stat_date, answered, correct, seconds)
      VALUES (?, ?, ?, ?, ?)
    `);
    withTx(db, () => {
      for (const [dateStr, st] of Object.entries(payload.dailyStats)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !st || typeof st !== "object") continue;
        const ans = Math.max(0, Math.trunc(Number(st.answered) || 0));
        const cor = Math.min(ans, Math.max(0, Math.trunc(Number(st.correct) || 0)));
        const sec = Math.max(0, Math.trunc(Number(st.seconds) || 0));
        stmt.run(user.id, dateStr, ans, cor, sec);
      }
    });
  }
  return { ok: true, importedBanks: entries.length, progress: userStore.loadProgress(user.id) };
};

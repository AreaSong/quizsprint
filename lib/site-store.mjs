import crypto from "node:crypto";
import { getDb, withTx } from "./db.mjs";

const DEFAULT_SITE_CONFIG = {
  siteName: "QuizSprint",
  subtitle: "Question Bank",
  announcement: "",
  allowGuestBrowse: true,
  footerNote: "",
  examNotices: []
};

const normalizeExamNotices = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 20)
    .map((item) => ({
      title: String(item?.title || "").trim().slice(0, 60),
      timeText: String(item?.timeText || "").trim().slice(0, 60),
      duration: String(item?.duration || "").trim().slice(0, 40),
      note: String(item?.note || "").trim().slice(0, 160)
    }))
    .filter((item) => item.title || item.timeText);
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
      footerNote: String(parsed.footerNote || "").trim(),
      examNotices: normalizeExamNotices(parsed.examNotices)
    };
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
};

export const saveSiteConfig = (dataDir, patch = {}) => {
  const p = patch && typeof patch === "object" ? patch : {};
  const cur = getSiteConfig(dataDir);
  const next = {
    siteName: String(p.siteName ?? cur.siteName).trim().slice(0, 40) || DEFAULT_SITE_CONFIG.siteName,
    subtitle: String(p.subtitle ?? cur.subtitle).trim().slice(0, 60),
    announcement: String(p.announcement ?? cur.announcement).trim().slice(0, 300),
    allowGuestBrowse: p.allowGuestBrowse !== undefined ? Boolean(p.allowGuestBrowse) : cur.allowGuestBrowse,
    footerNote: String(p.footerNote ?? cur.footerNote).trim().slice(0, 200),
    examNotices: p.examNotices !== undefined ? normalizeExamNotices(p.examNotices) : cur.examNotices
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

export const listContentUpdates = (dataDir, limit = 30) => {
  const db = getDb(dataDir);
  const row = db.prepare("SELECT value_json FROM kv_store WHERE key = 'content_updates'").get();
  if (!row) return [];
  try {
    const arr = JSON.parse(row.value_json || "[]");
    return Array.isArray(arr) ? arr.slice(0, Math.max(1, Math.min(80, Number(limit) || 30))) : [];
  } catch {
    return [];
  }
};

const saveContentUpdates = (db, items) => {
  db.prepare(`
    INSERT INTO kv_store (key, value_json) VALUES ('content_updates', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(JSON.stringify(items.slice(0, 80)));
};

/** 追加一条题库/题目/考试更新动态（保留最近 80 条，倒序展示） */
export const appendContentUpdate = (dataDir, item = {}) => {
  const p = item && typeof item === "object" ? item : {};
  const title = String(p.title || "").trim().slice(0, 120);
  if (!title) return { error: "更新内容标题不能为空" };
  const now = new Date().toISOString();
  const entry = {
    id: `cu_${crypto.randomUUID().slice(0, 8)}`,
    date: now.slice(0, 10),
    category: String(p.category || "更新").trim().slice(0, 12) || "更新",
    title,
    detail: String(p.detail || "").trim().slice(0, 240),
    createdAt: now
  };
  const next = [entry, ...listContentUpdates(dataDir, 80)].slice(0, 80);
  saveContentUpdates(getDb(dataDir), next);
  return { ok: true, entry, updates: next };
};

export const deleteContentUpdate = (dataDir, id) => {
  const target = String(id || "").trim();
  const cur = listContentUpdates(dataDir, 80);
  const next = cur.filter((x) => x.id !== target);
  if (next.length === cur.length) return { error: "记录不存在" };
  saveContentUpdates(getDb(dataDir), next);
  return { ok: true, updates: next };
};

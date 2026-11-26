import crypto from "node:crypto";
import { getDb, withTx } from "./db.mjs";
import { sanitizeId } from "./fs-utils.mjs";

const ALLOWED_REG_MODES = new Set(["open", "invite", "closed"]);

const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), salt, 64).toString("hex");

export const createUserStore = (dataDir) => {
  const db = getDb(dataDir);

  const register = ({ username, password, nickname = "", role = "student" }) => {
    const cleanName = String(username || "").trim();
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(cleanName)) {
      return { error: "用户名需为 2-24 位中英文、数字或下划线" };
    }
    if (String(password || "").length < 4) {
      return { error: "密码至少 4 位" };
    }
    const exists = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(cleanName);
    if (exists) return { error: "用户名已存在" };

    const salt = crypto.randomBytes(16).toString("hex");
    const safeRole = role === "admin" ? "admin" : "student";
    const user = {
      id: `u_${crypto.randomUUID().slice(0, 8)}`,
      username: cleanName,
      nickname: String(nickname || cleanName).trim(),
      role: safeRole,
      tokenVersion: 1
    };
    db.prepare(`
      INSERT INTO users (id, username, nickname, role, salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, user.username, user.nickname, safeRole, salt, hashPassword(password, salt), new Date().toISOString());
    return { user };
  };

  const authenticate = ({ username, password }) => {
    const cleanName = String(username || "").trim();
    const row = db.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)").get(cleanName);
    if (!row) return { error: "账号或密码错误" };
    const expected = Buffer.from(row.password_hash, "hex");
    const actual = Buffer.from(hashPassword(password || "", row.salt), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { error: "账号或密码错误" };
    }
    if (row.disabled) return { error: "该账号已被管理员冻结，请联系管理员解封" };
    return {
      user: {
        id: row.id,
        username: row.username,
        nickname: row.nickname,
        role: row.role || "student",
        tokenVersion: Number(row.token_version || 1)
      }
    };
  };

  const loadProgress = (userId) => {
    const progRows = db.prepare("SELECT bank_id, data_json FROM user_progress WHERE user_id = ?").all(userId);
    const banks = {};
    for (const r of progRows) banks[r.bank_id] = JSON.parse(r.data_json || "{}");
    const statRows = db.prepare("SELECT stat_date, answered, correct, seconds FROM user_daily_stats WHERE user_id = ?").all(userId);
    const dailyStats = {};
    for (const s of statRows) {
      dailyStats[s.stat_date] = { answered: s.answered, correct: s.correct, seconds: s.seconds };
    }
    return { banks, dailyStats };
  };

  const getUserById = (userId) => {
    const row = db.prepare("SELECT id, username, nickname, role, disabled, token_version FROM users WHERE id = ?").get(String(userId || ""));
    if (!row || row.disabled) return null;
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      userRole: row.role || "student",
      disabled: false,
      tokenVersion: Number(row.token_version || 1)
    };
  };

  const saveBankProgress = (userId, bankId, bankData, dailyDelta = null) => {
    if (!getUserById(userId)) return { banks: {}, dailyStats: {} };
    const safeBankId = sanitizeId(bankId);
    const now = new Date().toISOString();
    const ans = dailyDelta ? Math.max(0, Math.trunc(Number(dailyDelta.answered) || 0)) : 0;
    const cor = Math.min(ans, Math.max(0, Math.trunc(Number(dailyDelta?.correct) || 0)));
    const sec = dailyDelta ? Math.max(0, Math.trunc(Number(dailyDelta.seconds) || 0)) : 0;
    withTx(db, () => {
      db.prepare(`
        INSERT INTO user_progress (user_id, bank_id, data_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, bank_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
      `).run(userId, safeBankId, JSON.stringify(bankData || {}), now);

      if (ans > 0 || sec > 0) {
        const today = now.slice(0, 10);
        db.prepare(`
          INSERT INTO user_daily_stats (user_id, stat_date, answered, correct, seconds)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, stat_date) DO UPDATE SET
            answered = answered + excluded.answered,
            correct = correct + excluded.correct,
            seconds = seconds + excluded.seconds
        `).run(userId, today, ans, cor, sec);
      }

      if (dailyDelta?.questionId && ans > 0) {
        const wrongInc = cor > 0 ? 0 : 1;
        db.prepare(`
          INSERT INTO question_wrong_stats (bank_id, question_id, wrong_count, attempt_count, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(bank_id, question_id) DO UPDATE SET
            wrong_count = wrong_count + excluded.wrong_count,
            attempt_count = attempt_count + 1,
            updated_at = excluded.updated_at
        `).run(safeBankId, String(dailyDelta.questionId), wrongInc, now);
      }
    });
    return loadProgress(userId);
  };

  const getFallbackWrongQuestions = (limit) => {
    const progRows = db.prepare("SELECT bank_id, data_json FROM user_progress").all();
    const counts = new Map();
    for (const row of progRows) {
      let data = {};
      try { data = JSON.parse(row.data_json || "{}"); } catch { continue; }
      for (const qid of Array.isArray(data.wrongIds) ? data.wrongIds : []) {
        const key = `${row.bank_id}\0${qid}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    if (!counts.size) return [];
    const rows = db.prepare(`
      SELECT q.id AS question_id, q.bank_id, q.title, q.type, q.chapter, b.name AS bank_name
      FROM questions q
      JOIN banks b ON b.id = q.bank_id
      WHERE b.password = ''
    `).all();
    return rows
      .map((r) => {
        const wc = counts.get(`${r.bank_id}\0${r.question_id}`) || 0;
        return {
          questionId: r.question_id,
          bankId: r.bank_id,
          bankName: r.bank_name,
          title: r.title,
          type: r.type,
          chapter: r.chapter || "",
          wrongCount: wc,
          attemptCount: wc,
          wrongRate: 100
        };
      })
      .filter((item) => item.wrongCount > 0)
      .sort((a, b) => b.wrongCount - a.wrongCount)
      .slice(0, limit);
  };

  const getHotWrongQuestions = (limit = 20) => {
    const rows = db.prepare(`
      SELECT s.bank_id, s.question_id, s.wrong_count, s.attempt_count,
             q.title, q.type, q.chapter, b.name AS bank_name
      FROM question_wrong_stats s
      JOIN questions q ON q.id = s.question_id AND q.bank_id = s.bank_id
      JOIN banks b ON b.id = s.bank_id
      WHERE b.password = '' AND s.wrong_count > 0
      ORDER BY s.wrong_count DESC, s.updated_at DESC
      LIMIT ?
    `).all(Number(limit));
    if (rows.length) {
      return rows.map((r) => {
        const attempts = Math.max(1, Number(r.attempt_count || 0));
        const wrongCount = Number(r.wrong_count || 0);
        return {
          questionId: r.question_id,
          bankId: r.bank_id,
          bankName: r.bank_name,
          title: r.title,
          type: r.type,
          chapter: r.chapter || "",
          wrongCount,
          attemptCount: attempts,
          wrongRate: Math.min(100, Math.round((wrongCount / attempts) * 100))
        };
      });
    }
    if (db.prepare("SELECT 1 FROM kv_store WHERE key = 'wrong_stats_manual_reset'").get()) return [];
    return getFallbackWrongQuestions(limit);
  };

  const getStatsAndLeaderboard = (userId = "") => {
    const leaderRows = db.prepare(`
      SELECT u.id, u.nickname, u.username,
             COALESCE(SUM(s.answered), 0) AS total_answered,
             COALESCE(SUM(s.correct), 0) AS total_correct
      FROM users u
      LEFT JOIN user_daily_stats s ON s.user_id = u.id
      GROUP BY u.id
      ORDER BY total_answered DESC
      LIMIT 20
    `).all();

    const leaderboard = leaderRows.map((r) => {
      const totalAnswered = Number(r.total_answered || 0);
      const totalCorrect = Number(r.total_correct || 0);
      return {
        id: r.id,
        nickname: r.nickname || r.username,
        totalAnswered,
        totalCorrect,
        rate: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0
      };
    });

    const myStats = userId ? loadProgress(userId).dailyStats : {};
    const days = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const stat = myStats[d] || { answered: 0, correct: 0, seconds: 0 };
      days.push({ date: d, ...stat });
    }
    return { days, leaderboard, hotWrongQuestions: getHotWrongQuestions(20) };
  };

  const getApiKey = () => {
    if (process.env.API_KEY) return process.env.API_KEY;
    const row = db.prepare("SELECT value_json FROM kv_store WHERE key = 'api_key'").get();
    if (row) return JSON.parse(row.value_json);
    const created = `ak_${crypto.randomBytes(18).toString("hex")}`;
    db.prepare("INSERT OR IGNORE INTO kv_store (key, value_json) VALUES ('api_key', ?)").run(JSON.stringify(created));
    return created;
  };

  const rotateApiKey = () => {
    if (process.env.API_KEY) return { error: "当前已通过环境变量 API_KEY 固定密钥，无法在线重置" };
    const next = `ak_${crypto.randomBytes(18).toString("hex")}`;
    db.prepare(`
      INSERT INTO kv_store (key, value_json) VALUES ('api_key', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(next));
    return next;
  };

  const changePassword = (userId, { oldPassword, newPassword }) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    const expected = Buffer.from(row.password_hash, "hex");
    const actual = Buffer.from(hashPassword(oldPassword || "", row.salt), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { error: "原密码错误" };
    }
    if (String(newPassword || "").length < 4) return { error: "新密码至少 4 位" };
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("UPDATE users SET salt = ?, password_hash = ?, token_version = token_version + 1 WHERE id = ?")
      .run(salt, hashPassword(newPassword, salt), row.id);
    return { ok: true, user: getUserById(row.id) };
  };

  const listUsers = () =>
    db.prepare("SELECT id, username, nickname, role, disabled, created_at FROM users ORDER BY created_at DESC")
      .all()
      .map((r) => ({ id: r.id, username: r.username, nickname: r.nickname, role: r.role || "student", disabled: Boolean(r.disabled), createdAt: r.created_at }));

  const adminResetPassword = (userId, newPassword) => {
    if (String(newPassword || "").length < 4) return { error: "新密码至少 4 位" };
    const salt = crypto.randomBytes(16).toString("hex");
    const res = db.prepare("UPDATE users SET salt = ?, password_hash = ?, token_version = token_version + 1 WHERE id = ?")
      .run(salt, hashPassword(newPassword, salt), String(userId || ""));
    if (!res.changes) return { error: "账号不存在" };
    return { ok: true };
  };

  const adminUpdateRole = (userId, role) => {
    const safeRole = role === "admin" ? "admin" : (role === "student" ? "student" : "");
    if (!safeRole) return { error: "不支持的角色类型" };
    const row = db.prepare("SELECT id, role, disabled FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    if (row.role === "admin" && safeRole !== "admin" && !row.disabled) {
      const adminCnt = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND disabled = 0").get().cnt;
      if (adminCnt <= 1) return { error: "系统至少需保留 1 个可用管理员账号" };
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(safeRole, row.id);
    return { ok: true, role: safeRole };
  };

  const adminSetDisabled = (userId, disabled, actorUserId = "") => {
    const row = db.prepare("SELECT id, role, disabled FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    const nextDisabled = disabled ? 1 : 0;
    if (nextDisabled && actorUserId && row.id === actorUserId) return { error: "不能冻结当前正在登录的自己" };
    if (nextDisabled && row.role === "admin" && !row.disabled) {
      const adminCnt = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND disabled = 0").get().cnt;
      if (adminCnt <= 1) return { error: "系统至少需保留 1 个可用管理员账号" };
    }
    if (nextDisabled) {
      db.prepare("UPDATE users SET disabled = 1, token_version = token_version + 1 WHERE id = ?").run(row.id);
    } else {
      db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(row.id);
    }
    return { ok: true, disabled: Boolean(nextDisabled) };
  };

  const adminDeleteUser = (userId, actorUserId = "") => {
    const row = db.prepare("SELECT id, role, disabled FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    if (actorUserId && row.id === actorUserId) return { error: "不能删除当前正在登录的自己" };
    if (row.role === "admin" && !row.disabled) {
      const adminCnt = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND disabled = 0").get().cnt;
      if (adminCnt <= 1) return { error: "系统至少需保留 1 个可用管理员账号" };
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(row.id);
    return { ok: true };
  };

  const getRegistrationPolicy = () => {
    const row = db.prepare("SELECT value_json FROM kv_store WHERE key = 'registration_policy'").get();
    if (row) {
      try {
        const parsed = JSON.parse(row.value_json || "{}");
        const mode = ALLOWED_REG_MODES.has(parsed.mode) ? parsed.mode : "open";
        return { mode, inviteCode: String(parsed.inviteCode || "").trim() };
      } catch {
        return { mode: "open", inviteCode: "" };
      }
    }
    const envMode = String(process.env.REGISTRATION_MODE || "").trim().toLowerCase();
    return {
      mode: ALLOWED_REG_MODES.has(envMode) ? envMode : "open",
      inviteCode: String(process.env.REGISTRATION_INVITE_CODE || "").trim()
    };
  };

  const setRegistrationPolicy = ({ mode, inviteCode } = {}) => {
    const nextMode = String(mode || "").trim().toLowerCase();
    if (!ALLOWED_REG_MODES.has(nextMode)) return { error: "不支持的注册模式" };
    const nextCode = String(inviteCode ?? "").trim();
    if (nextMode === "invite" && !nextCode) return { error: "邀请码模式下邀请码不能为空" };
    const saved = { mode: nextMode, inviteCode: nextCode };
    db.prepare(`
      INSERT INTO kv_store (key, value_json) VALUES ('registration_policy', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(saved));
    return saved;
  };

  const verifyRegistrationPolicy = (inviteCode = "") => {
    const policy = getRegistrationPolicy();
    if (policy.mode === "closed") {
      return { error: "当前已关闭自主注册，请联系管理员开通账号" };
    }
    if (policy.mode === "invite") {
      const expected = Buffer.from(policy.inviteCode || "", "utf8");
      const actual = Buffer.from(String(inviteCode || "").trim(), "utf8");
      if (!expected.length || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return { error: "邀请码无效，请向管理员获取正确邀请码" };
      }
    }
    return { ok: true };
  };

  const updateProfile = (userId, { nickname } = {}) => {
    const cleanNick = String(nickname || "").trim();
    if (!cleanNick || cleanNick.length > 24) return { error: "昵称需为 1-24 个字符" };
    const row = db.prepare("SELECT id, username, role, token_version FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(cleanNick, row.id);
    return { user: { id: row.id, username: row.username, nickname: cleanNick, role: row.role || "student", tokenVersion: Number(row.token_version || 1) } };
  };

  const adminUpdateUser = (userId, { nickname, username } = {}) => {
    const row = db.prepare("SELECT id, username, nickname, role, token_version FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    const nextNick = nickname !== undefined ? String(nickname || "").trim() : row.nickname;
    if (!nextNick || nextNick.length > 24) return { error: "昵称需为 1-24 个字符" };
    let nextName = row.username;
    if (username !== undefined) {
      const cleanName = String(username || "").trim();
      if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(cleanName)) return { error: "用户名需为 2-24 位中英文、数字或下划线" };
      const dup = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?").get(cleanName, row.id);
      if (dup) return { error: "用户名已存在" };
      nextName = cleanName;
    }
    db.prepare("UPDATE users SET username = ?, nickname = ? WHERE id = ?").run(nextName, nextNick, row.id);
    return { user: { id: row.id, username: nextName, nickname: nextNick, role: row.role || "student", tokenVersion: Number(row.token_version || 1) } };
  };

  const adminClearUserProgress = (userId) => {
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(String(userId || ""));
    if (!row) return { error: "账号不存在" };
    withTx(db, () => {
      db.prepare("DELETE FROM user_progress WHERE user_id = ?").run(row.id);
      db.prepare("DELETE FROM user_daily_stats WHERE user_id = ?").run(row.id);
    });
    return { ok: true };
  };

  const deleteWrongStats = ({ bankId = "", questionId = "" } = {}) => {
    const cleanBank = bankId ? sanitizeId(bankId) : "";
    const cleanQid = String(questionId || "").trim();
    let res;
    if (cleanBank && cleanQid) {
      res = db.prepare("DELETE FROM question_wrong_stats WHERE bank_id = ? AND question_id = ?").run(cleanBank, cleanQid);
    } else if (cleanBank) {
      res = db.prepare("DELETE FROM question_wrong_stats WHERE bank_id = ?").run(cleanBank);
    } else if (cleanQid) {
      res = db.prepare("DELETE FROM question_wrong_stats WHERE question_id = ?").run(cleanQid);
    } else {
      res = db.prepare("DELETE FROM question_wrong_stats").run();
    }
    if ((!cleanBank && !cleanQid) || !db.prepare("SELECT 1 FROM question_wrong_stats LIMIT 1").get()) {
      db.prepare(`
        INSERT INTO kv_store (key, value_json) VALUES ('wrong_stats_manual_reset', 'true')
        ON CONFLICT(key) DO UPDATE SET value_json = 'true'
      `).run();
    }
    return { ok: true, removed: Number(res.changes || 0) };
  };

  return {
    register,
    authenticate,
    getUserById,
    loadProgress,
    saveBankProgress,
    getStatsAndLeaderboard,
    getApiKey,
    rotateApiKey,
    changePassword,
    updateProfile,
    listUsers,
    adminResetPassword,
    adminUpdateUser,
    adminUpdateRole,
    adminSetDisabled,
    adminClearUserProgress,
    adminDeleteUser,
    deleteWrongStats,
    getRegistrationPolicy,
    setRegistrationPolicy,
    verifyRegistrationPolicy
  };
};

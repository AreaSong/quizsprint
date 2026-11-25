import crypto from "node:crypto";
import { getDb, withTx } from "./db.mjs";
import { sanitizeId } from "./fs-utils.mjs";

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
      role: safeRole
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
    return { user: { id: row.id, username: row.username, nickname: row.nickname, role: row.role || "student" } };
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

  const saveBankProgress = (userId, bankId, bankData, dailyDelta = null) => {
    const safeBankId = sanitizeId(bankId);
    const now = new Date().toISOString();
    withTx(db, () => {
      db.prepare(`
        INSERT INTO user_progress (user_id, bank_id, data_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, bank_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
      `).run(userId, safeBankId, JSON.stringify(bankData || {}), now);

      if (dailyDelta && (dailyDelta.answered || dailyDelta.seconds)) {
        const today = now.slice(0, 10);
        db.prepare(`
          INSERT INTO user_daily_stats (user_id, stat_date, answered, correct, seconds)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, stat_date) DO UPDATE SET
            answered = answered + excluded.answered,
            correct = correct + excluded.correct,
            seconds = seconds + excluded.seconds
        `).run(userId, today, Number(dailyDelta.answered || 0), Number(dailyDelta.correct || 0), Number(dailyDelta.seconds || 0));
      }
    });
    return loadProgress(userId);
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
    return { days, leaderboard };
  };

  const getAiConfig = () => {
    const row = db.prepare("SELECT value_json FROM kv_store WHERE key = 'ai_config'").get();
    if (row) return JSON.parse(row.value_json);
    return {
      baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.AI_API_KEY || "",
      model: process.env.AI_MODEL || "gpt-4o-mini"
    };
  };

  const saveAiConfig = (cfg) => {
    const next = {
      baseUrl: String(cfg.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
      apiKey: String(cfg.apiKey || "").trim(),
      model: String(cfg.model || "gpt-4o-mini").trim()
    };
    db.prepare(`
      INSERT INTO kv_store (key, value_json) VALUES ('ai_config', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(next));
    return next;
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
    const next = `ak_${crypto.randomBytes(18).toString("hex")}`;
    db.prepare(`
      INSERT INTO kv_store (key, value_json) VALUES ('api_key', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(next));
    return next;
  };

  return {
    register,
    authenticate,
    loadProgress,
    saveBankProgress,
    getStatsAndLeaderboard,
    getAiConfig,
    saveAiConfig,
    getApiKey,
    rotateApiKey
  };
};

import crypto from "node:crypto";
import { withTx } from "./db.mjs";

const NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/;
const PREFIX_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{0,16}$/;
const PASS_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

const genRandomPassword = (len = 6) => {
  const bytes = crypto.randomBytes(len);
  return [...bytes].map((b) => PASS_CHARS[b % PASS_CHARS.length]).join("");
};

const formatSeqNum = (num, padWidth) =>
  (padWidth > 0 ? String(num).padStart(padWidth, "0") : String(num));

const validateBatchInput = (payload = {}) => {
  const p = payload && typeof payload === "object" ? payload : {};
  const prefix = String(p.prefix ?? "").trim();
  if (!PREFIX_RE.test(prefix)) return { error: "用户名前缀仅支持 0-16 位中英文、数字或下划线" };
  const startStr = String(p.startNum ?? "").trim();
  const endStr = String(p.endNum ?? "").trim();
  if (!/^\d{1,8}$/.test(startStr) || !/^\d{1,8}$/.test(endStr)) {
    return { error: "起始编号与结束编号须为非负整数" };
  }
  const start = Number(startStr);
  const end = Number(endStr);
  if (start > end) return { error: "起始编号不能大于结束编号" };
  if (end - start + 1 > 300) return { error: "单次最多批量生成 300 个账号" };

  const padWidth = startStr.length > 1 && startStr.startsWith("0") ? startStr.length : 0;
  const firstUser = `${prefix}${formatSeqNum(start, padWidth)}`;
  const lastUser = `${prefix}${formatSeqNum(end, padWidth)}`;
  if (!NAME_RE.test(firstUser) || !NAME_RE.test(lastUser)) {
    return { error: "生成的用户名需为 2-24 位中英文、数字或下划线" };
  }

  const passwordMode = ["fixed", "random", "same"].includes(p.passwordMode) ? p.passwordMode : "fixed";
  const fixedPassword = String(p.fixedPassword ?? "");
  if (passwordMode === "fixed" && fixedPassword.length < 4) {
    return { error: "统一初始密码至少 4 位" };
  }
  if (passwordMode === "same" && (firstUser.length < 4 || lastUser.length < 4)) {
    return { error: "密码与用户名相同时，用户名需至少 4 位；如 100-199 请选择统一密码或随机密码" };
  }

  return {
    prefix,
    nicknamePrefix: String(p.nicknamePrefix ?? "").trim().slice(0, 16),
    start,
    end,
    padWidth,
    passwordMode,
    fixedPassword,
    role: p.role === "admin" ? "admin" : "student"
  };
};

/** 连续编号批量创建用户账号（事务内执行，自动跳过重名账号） */
export const batchCreateUsers = (db, hashPassword, payload = {}) => {
  const parsed = validateBatchInput(payload);
  if (parsed.error) return { error: parsed.error };
  const { prefix, nicknamePrefix, start, end, padWidth, passwordMode, fixedPassword, role } = parsed;
  const now = new Date().toISOString();
  const accounts = [];
  const skipped = [];

  withTx(db, () => {
    const existing = new Set(
      db.prepare("SELECT LOWER(username) AS uname FROM users").all().map((r) => r.uname)
    );
    const stmt = db.prepare(`
      INSERT INTO users (id, username, nickname, role, salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = start; i <= end; i += 1) {
      const seq = formatSeqNum(i, padWidth);
      const username = `${prefix}${seq}`;
      if (existing.has(username.toLowerCase())) {
        skipped.push(username);
        continue;
      }
      const nickname = (nicknamePrefix ? `${nicknamePrefix}${seq}` : username).slice(0, 24);
      const password = passwordMode === "random"
        ? genRandomPassword(6)
        : (passwordMode === "same" ? username : fixedPassword);
      const salt = crypto.randomBytes(16).toString("hex");
      const id = `u_${crypto.randomUUID().slice(0, 8)}`;
      stmt.run(id, username, nickname, role, salt, hashPassword(password, salt), now);
      existing.add(username.toLowerCase());
      accounts.push({ id, username, nickname, password, role });
    }
  });

  return { ok: true, createdCount: accounts.length, skippedCount: skipped.length, accounts, skipped };
};

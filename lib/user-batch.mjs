import crypto from "node:crypto";
import { withTx } from "./db.mjs";

const NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/;
const PREFIX_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{0,16}$/;
const SEQ_RE = /^(.*?)(\d+)$/;
const PASS_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

const genRandomPassword = (len = 6) => {
  const bytes = crypto.randomBytes(len);
  return [...bytes].map((b) => PASS_CHARS[b % PASS_CHARS.length]).join("");
};

const formatSeqNum = (num, padWidth) =>
  (padWidth > 0 ? String(num).padStart(padWidth, "0") : String(num));

const parseSeqRange = (prefix, startRaw, endRaw) => {
  const sMatch = String(startRaw ?? "").trim().match(SEQ_RE);
  const eMatch = String(endRaw ?? "").trim().match(SEQ_RE);
  if (!sMatch || !eMatch) {
    return { error: "起止学号/编号必须以连续数字结尾（如 20240715B0101 或 100）" };
  }
  const [, startHead, startDigits] = sMatch;
  const [, endHead, endDigits] = eMatch;
  if (startHead !== endHead) {
    return { error: "起止学号/编号的前缀部分不一致，请保持前面字符相同、仅末尾数字递增" };
  }
  const start = BigInt(startDigits);
  const end = BigInt(endDigits);
  if (start > end) return { error: "起始学号/编号不能大于结束学号/编号" };
  if (end - start + 1n > 300n) return { error: "单次最多批量生成 300 个账号" };

  const padWidth = startDigits.length > 1 && startDigits.startsWith("0") ? startDigits.length : 0;
  const effectivePrefix = `${prefix}${startHead}`;
  const firstUser = `${effectivePrefix}${formatSeqNum(start, padWidth)}`;
  const lastUser = `${effectivePrefix}${formatSeqNum(end, padWidth)}`;
  if (!NAME_RE.test(firstUser) || !NAME_RE.test(lastUser)) {
    return { error: "生成的用户名需为 2-24 位中英文、数字或下划线" };
  }
  return { effectivePrefix, start, end, padWidth, firstUser, lastUser };
};

const validateBatchInput = (payload = {}) => {
  const p = payload && typeof payload === "object" ? payload : {};
  const prefix = String(p.prefix ?? "").trim();
  if (!PREFIX_RE.test(prefix)) return { error: "用户名前缀仅支持 0-16 位中英文、数字或下划线" };
  const range = parseSeqRange(prefix, p.startNum, p.endNum);
  if (range.error) return { error: range.error };

  const passwordMode = ["fixed", "random", "same"].includes(p.passwordMode) ? p.passwordMode : "fixed";
  const fixedPassword = String(p.fixedPassword ?? "");
  if (passwordMode === "fixed" && fixedPassword.length < 4) {
    return { error: "统一初始密码至少 4 位" };
  }
  if (passwordMode === "same" && (range.firstUser.length < 4 || range.lastUser.length < 4)) {
    return { error: "密码与用户名相同时，用户名需至少 4 位；如 100-199 请选择统一密码或随机密码" };
  }

  return {
    ...range,
    nicknamePrefix: String(p.nicknamePrefix ?? "").trim().slice(0, 16),
    passwordMode,
    fixedPassword,
    role: p.role === "admin" ? "admin" : "student",
    mustChangePassword: p.mustChangePassword !== false
  };
};

/** 连续编号/学号批量创建用户账号（事务内执行，自动跳过重名账号） */
export const batchCreateUsers = (db, hashPassword, payload = {}) => {
  const parsed = validateBatchInput(payload);
  if (parsed.error) return { error: parsed.error };
  const { effectivePrefix, nicknamePrefix, start, end, padWidth, passwordMode, fixedPassword, role, mustChangePassword } = parsed;
  const now = new Date().toISOString();
  const accounts = [];
  const skipped = [];

  withTx(db, () => {
    const existing = new Set(
      db.prepare("SELECT LOWER(username) AS uname FROM users").all().map((r) => r.uname)
    );
    const stmt = db.prepare(`
      INSERT INTO users (id, username, nickname, role, salt, password_hash, must_change_password, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = start; i <= end; i += 1n) {
      const seq = formatSeqNum(i, padWidth);
      const username = `${effectivePrefix}${seq}`;
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
      stmt.run(id, username, nickname, role, salt, hashPassword(password, salt), mustChangePassword ? 1 : 0, now);
      existing.add(username.toLowerCase());
      accounts.push({ id, username, nickname, password, role });
    }
  });

  return { ok: true, createdCount: accounts.length, skippedCount: skipped.length, accounts, skipped };
};

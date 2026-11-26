import crypto from "node:crypto";
import { getDb } from "./db.mjs";

const MAX_AUDIT_ROWS = 1000;

/** 写入高危/系统操作审计日志并保持库表体积有界 */
export const recordAuditLog = (dataDir, { actor = "system", actorRole = "admin", action, target = "", detail = "", ip = "" }) => {
  if (!action) return;
  try {
    const db = getDb(dataDir);
    db.prepare(`
      INSERT INTO audit_logs (id, actor, actor_role, action, target, detail, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `aud_${crypto.randomUUID().slice(0, 8)}`,
      String(actor || "system").slice(0, 64),
      String(actorRole || "admin").slice(0, 24),
      String(action).slice(0, 64),
      String(target || "").slice(0, 120),
      String(detail || "").slice(0, 240),
      String(ip || "").slice(0, 64),
      new Date().toISOString()
    );
    db.prepare(`
      DELETE FROM audit_logs WHERE id NOT IN (
        SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT ?
      )
    `).run(MAX_AUDIT_ROWS);
  } catch { /* 审计失败不阻断主流程 */ }
};

export const listAuditLogs = (dataDir, limit = 60) => {
  const db = getDb(dataDir);
  const safeLimit = Math.min(200, Math.max(1, Number(limit || 60)));
  return db.prepare(`
    SELECT id, actor, actor_role AS actorRole, action, target, detail, ip, created_at AS createdAt
    FROM audit_logs ORDER BY created_at DESC LIMIT ?
  `).all(safeLimit);
};

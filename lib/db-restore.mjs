import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackupBuffer, getDatabaseStats, getDb, withTx } from "./db.mjs";

const MAX_RESTORE_BYTES = 11 * 1024 * 1024;
const RESTORE_TABLES = [
  "subjects",
  "banks",
  "questions",
  "users",
  "user_progress",
  "user_daily_stats",
  "exams",
  "exam_submissions",
  "question_wrong_stats"
];

const decodeSqliteBuffer = (base64Data) => {
  const clean = String(base64Data || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!clean) return { error: "请先选择需要恢复的数据库备份文件" };
  const buf = Buffer.from(clean, "base64");
  if (buf.length < 4096 || buf.length > MAX_RESTORE_BYTES) {
    return { error: "备份文件大小异常（需为 4KB ~ 11MB 的 .db 文件）" };
  }
  if (buf.subarray(0, 16).toString("utf8") !== "SQLite format 3\0") {
    return { error: "不是有效的 SQLite 数据库备份文件" };
  }
  return { buf };
};

const validateBackupFile = (tmpPath) => {
  let probe = null;
  try {
    probe = new DatabaseSync(tmpPath);
    const check = probe.prepare("PRAGMA integrity_check;").get();
    const okText = String(Object.values(check || {})[0] || "").toLowerCase();
    if (okText !== "ok") return false;
    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('banks', 'questions')").all();
    return tables.length === 2;
  } catch {
    return false;
  } finally {
    try { probe?.close(); } catch { /* ignore */ }
  }
};

/** 原子校验上传的 SQLite .db 备份并在保留恢复前快照后热覆盖业务表 */
export const restoreDatabaseFromBase64 = (dataDir, base64Data, uploadsDir = "") => {
  const decoded = decodeSqliteBuffer(base64Data);
  if (decoded.error) return decoded;
  const resolved = path.resolve(dataDir);
  const tmpPath = path.join(os.tmpdir(), `quizsprint-restore-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`);
  fs.writeFileSync(tmpPath, decoded.buf);
  if (!validateBackupFile(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { error: "备份文件损坏或缺少题库核心表" };
  }

  fs.writeFileSync(path.join(resolved, "question-bank.pre-restore.db"), createBackupBuffer(dataDir));
  const db = getDb(dataDir);
  try {
    db.prepare("ATTACH DATABASE ? AS restore_src").run(tmpPath);
    db.exec("PRAGMA foreign_keys = OFF;");
    withTx(db, () => {
      const srcTblRows = db.prepare("SELECT name FROM restore_src.sqlite_master WHERE type = 'table'").all();
      const srcTables = new Set(srcTblRows.map((r) => r.name));
      for (const tbl of RESTORE_TABLES) {
        db.exec(`DELETE FROM main.${tbl}`);
        if (!srcTables.has(tbl)) continue;
        const mainCols = new Set(db.prepare(`PRAGMA main.table_info(${tbl})`).all().map((c) => c.name));
        const common = db.prepare(`PRAGMA restore_src.table_info(${tbl})`).all().map((c) => c.name).filter((c) => mainCols.has(c));
        if (!common.length) continue;
        const colSql = common.map((c) => `"${c}"`).join(", ");
        db.exec(`INSERT INTO main.${tbl} (${colSql}) SELECT ${colSql} FROM restore_src.${tbl}`);
      }
    });
  } finally {
    try { db.exec("PRAGMA foreign_keys = ON;"); } catch { /* ignore */ }
    try { db.exec("DETACH DATABASE restore_src;"); } catch { /* ignore */ }
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* ignore */ }
  return { ok: true, stats: getDatabaseStats(dataDir, uploadsDir) };
};

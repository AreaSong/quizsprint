import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";
import { createBackupBuffer, getDatabaseStats, getDb, withTx } from "./db.mjs";
import { APP_VERSION, DB_SCHEMA_VERSION } from "./version.mjs";

const MAX_RESTORE_BYTES = 15 * 1024 * 1024;
const SAFE_UPLOAD_NAME = /^[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif|svg)$/i;
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

/** 打包 SQLite 原子快照与 uploads/ 图片为单个 gzip 压缩包 (.qsbak) */
export const createFullBackupBundleBuffer = (dataDir, uploadsDir = "") => {
  const dbBase64 = createBackupBuffer(dataDir).toString("base64");
  const uploads = [];
  if (uploadsDir && fs.existsSync(uploadsDir)) {
    for (const name of fs.readdirSync(uploadsDir)) {
      if (!SAFE_UPLOAD_NAME.test(name)) continue;
      const full = path.join(uploadsDir, name);
      if (fs.statSync(full).isFile()) {
        uploads.push({ name, base64: fs.readFileSync(full).toString("base64") });
      }
    }
  }
  const bundle = {
    format: "quizsprint-backup-v1",
    appVersion: APP_VERSION,
    schemaVersion: DB_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    dbBase64,
    uploads
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 6 });
};

const decodeRestorePayload = (base64Data) => {
  const clean = String(base64Data || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!clean) return { error: "请先选择需要恢复的备份文件（.qsbak 或 .db）" };
  const raw = Buffer.from(clean, "base64");
  if (raw.length < 128 || raw.length > MAX_RESTORE_BYTES) {
    return { error: "备份文件大小异常（最大支持 15MB 的 .qsbak 或 .db 文件）" };
  }
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      const jsonText = zlib.gunzipSync(raw, { maxOutputLength: 48 * 1024 * 1024 }).toString("utf8");
      const bundle = JSON.parse(jsonText);
      if (bundle?.format !== "quizsprint-backup-v1" || !bundle?.dbBase64) {
        return { error: "全量备份包格式无效" };
      }
      const sqliteBuf = Buffer.from(String(bundle.dbBase64), "base64");
      if (sqliteBuf.subarray(0, 16).toString("utf8") !== "SQLite format 3\0") {
        return { error: "全量备份包内的数据库已损坏" };
      }
      const uploads = Array.isArray(bundle.uploads) ? bundle.uploads : [];
      return { buf: sqliteBuf, uploads };
    } catch {
      return { error: "全量备份包解压或解析失败" };
    }
  }
  if (raw.length < 4096 || raw.subarray(0, 16).toString("utf8") !== "SQLite format 3\0") {
    return { error: "不是有效的 .qsbak 全量备份或 SQLite .db 数据库文件" };
  }
  return { buf: raw, uploads: null };
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

const restoreUploadsFromBundle = (uploadsDir, uploads) => {
  if (!uploadsDir || !Array.isArray(uploads)) return 0;
  fs.mkdirSync(uploadsDir, { recursive: true });
  let restored = 0;
  for (const item of uploads) {
    const safeName = path.basename(String(item?.name || ""));
    if (!SAFE_UPLOAD_NAME.test(safeName) || !item?.base64) continue;
    fs.writeFileSync(path.join(uploadsDir, safeName), Buffer.from(String(item.base64), "base64"));
    restored += 1;
  }
  return restored;
};

/** 原子校验上传的 .db 或 .qsbak 备份并在保留恢复前快照后热覆盖业务表与图片 */
export const restoreDatabaseFromBase64 = (dataDir, base64Data, uploadsDir = "") => {
  const decoded = decodeRestorePayload(base64Data);
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
      db.exec("DELETE FROM main.kv_store WHERE key IN ('registration_policy', 'wrong_stats_manual_reset', 'site_config')");
      if (srcTables.has("kv_store")) {
        db.exec("INSERT INTO main.kv_store (key, value_json) SELECT key, value_json FROM restore_src.kv_store WHERE key IN ('registration_policy', 'wrong_stats_manual_reset', 'site_config')");
      }
    });
  } finally {
    try { db.exec("PRAGMA foreign_keys = ON;"); } catch { /* ignore */ }
    try { db.exec("DETACH DATABASE restore_src;"); } catch { /* ignore */ }
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
  const restoredUploads = restoreUploadsFromBundle(uploadsDir, decoded.uploads);
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* ignore */ }
  return { ok: true, restoredUploads, stats: getDatabaseStats(dataDir, uploadsDir) };
};

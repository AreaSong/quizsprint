import fs from "node:fs";
import path from "node:path";
import { createBackupBuffer, getDb } from "./db.mjs";
import { createFullBackupBundleBuffer } from "./db-restore.mjs";

const BACKUP_CONFIG_KEY = "auto_backup_config";
const BACKUP_NAME_RE = /^auto-[a-zA-Z0-9_-]+\.(qsbak|db)$/;
const FORBIDDEN_SYS_DIRS = ["/bin", "/sbin", "/usr", "/etc", "/lib", "/lib64", "/boot", "/dev", "/proc", "/sys", "/run", "/System"];
const DEFAULT_BACKUP_CONFIG = {
  enabled: true,
  intervalHours: 24,
  keepCount: 7,
  backupDir: "",
  format: "full"
};
const schedulers = new Map();

const clampNum = (val, min, max, fallback) => {
  const n = Number(val);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const isForbiddenPath = (resolved) => {
  const norm = path.resolve(resolved);
  if (norm === path.parse(norm).root) return true;
  return FORBIDDEN_SYS_DIRS.some((dir) => norm === dir || norm.startsWith(`${dir}${path.sep}`));
};

export const resolveBackupDir = (dataDir, backupDir = "") => {
  const base = path.resolve(dataDir);
  const custom = String(backupDir || "").trim();
  return custom ? path.resolve(base, custom) : path.join(base, "backups");
};

const normalizeBackupConfig = (raw = {}) => ({
  enabled: raw.enabled !== false,
  intervalHours: clampNum(raw.intervalHours, 1, 720, DEFAULT_BACKUP_CONFIG.intervalHours),
  keepCount: Math.trunc(clampNum(raw.keepCount, 1, 90, DEFAULT_BACKUP_CONFIG.keepCount)),
  backupDir: String(raw.backupDir ?? "").trim(),
  format: raw.format === "db" ? "db" : "full"
});

/** 读取自动备份配置与实际生效的服务器存储目录 */
export const getAutoBackupConfig = (dataDir) => {
  const db = getDb(dataDir);
  const row = db.prepare("SELECT value_json FROM kv_store WHERE key = ?").get(BACKUP_CONFIG_KEY);
  let parsed = {};
  if (row) {
    try { parsed = JSON.parse(row.value_json || "{}"); } catch { parsed = {}; }
  }
  const config = normalizeBackupConfig(parsed);
  return { config, resolvedDir: resolveBackupDir(dataDir, config.backupDir) };
};

/** 校验并持久化自动备份策略与服务器存储目录 */
export const saveAutoBackupConfig = (dataDir, input = {}) => {
  const cleanDir = String(input.backupDir ?? "").trim();
  if (cleanDir.includes("\0") || cleanDir.length > 260) {
    return { error: "备份存储路径格式无效" };
  }
  const resolvedDir = resolveBackupDir(dataDir, cleanDir);
  if (isForbiddenPath(resolvedDir)) {
    return { error: `禁止将备份写入系统关键目录：${resolvedDir}` };
  }
  try {
    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.accessSync(resolvedDir, fs.constants.W_OK);
  } catch (err) {
    return { error: `备份路径不可写（${resolvedDir}）：${err instanceof Error ? err.message : "权限不足"}` };
  }
  const cur = getAutoBackupConfig(dataDir).config;
  const config = normalizeBackupConfig({
    enabled: input.enabled ?? cur.enabled,
    intervalHours: input.intervalHours ?? cur.intervalHours,
    keepCount: input.keepCount ?? cur.keepCount,
    backupDir: cleanDir,
    format: input.format ?? cur.format
  });
  getDb(dataDir).prepare(`
    INSERT INTO kv_store (key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(BACKUP_CONFIG_KEY, JSON.stringify(config));
  return { config, resolvedDir };
};

/** 列举本地自动滚动备份（按修改时间倒序） */
export const listAutoBackups = (dataDir, customDir = "") => {
  const dir = customDir || getAutoBackupConfig(dataDir).resolvedDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => BACKUP_NAME_RE.test(name))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(({ mtimeMs, ...rest }) => rest);
};

export const getAutoBackupFile = (dataDir, filename) => {
  const name = path.basename(String(filename || ""));
  if (!BACKUP_NAME_RE.test(name)) return null;
  const full = path.join(getAutoBackupConfig(dataDir).resolvedDir, name);
  return fs.existsSync(full) && fs.statSync(full).isFile() ? { name, full } : null;
};

/** 删除指定名称的自动备份文件 */
export const deleteAutoBackupFile = (dataDir, filename) => {
  const found = getAutoBackupFile(dataDir, filename);
  if (!found) return { error: "备份文件不存在" };
  fs.unlinkSync(found.full);
  return { ok: true, name: found.name, backups: listAutoBackups(dataDir) };
};

/** 生成自动备份快照并按保留份数滚动裁剪 */
export const runAutoBackup = (dataDir, uploadsDir = "", opts = {}) => {
  const { config, resolvedDir } = getAutoBackupConfig(dataDir);
  const force = Boolean(opts.force);
  if (!force && !config.enabled) {
    return { skipped: true, reason: "disabled", name: "", backups: listAutoBackups(dataDir, resolvedDir) };
  }
  const keepCount = Math.max(1, Math.min(90, Number(opts.keep || config.keepCount || 7)));
  const format = opts.format || config.format;
  const intervalMs = config.intervalHours * 3600 * 1000;
  fs.mkdirSync(resolvedDir, { recursive: true });

  const existing = listAutoBackups(dataDir, resolvedDir);
  if (!force && existing.length && (Date.now() - Date.parse(existing[0].createdAt)) < Math.max(0, intervalMs - 15000)) {
    return { skipped: true, name: existing[0].name, backups: existing };
  }

  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.toISOString().slice(11, 23).replace(/[:.]/g, "")}`;
  const ext = format === "db" ? "db" : "qsbak";
  const filename = `auto-${stamp}.${ext}`;
  const buf = ext === "db" ? createBackupBuffer(dataDir) : createFullBackupBundleBuffer(dataDir, uploadsDir);
  fs.writeFileSync(path.join(resolvedDir, filename), buf);

  for (const old of listAutoBackups(dataDir, resolvedDir).slice(keepCount)) {
    try { fs.unlinkSync(path.join(resolvedDir, old.name)); } catch { /* ignore */ }
  }
  return { skipped: false, name: filename, sizeBytes: buf.length, format: ext, resolvedDir, backups: listAutoBackups(dataDir, resolvedDir) };
};

const stopScheduler = (key) => {
  const prev = schedulers.get(key);
  if (!prev) return;
  clearTimeout(prev.initTimer);
  clearInterval(prev.loopTimer);
  schedulers.delete(key);
};

/** 按当前配置启动或热重载自动备份定时器 */
export const reloadAutoBackupScheduler = (dataDir, uploadsDir = "") => {
  const key = path.resolve(dataDir);
  stopScheduler(key);
  if (process.env.NODE_ENV === "test" || process.env.AUTO_BACKUP_DISABLED === "1") {
    return () => {};
  }
  const { config } = getAutoBackupConfig(dataDir);
  if (!config.enabled) return () => {};
  const tickMs = Math.max(60000, Math.min(config.intervalHours * 3600 * 1000, 3600 * 1000));
  const initTimer = setTimeout(() => {
    try { runAutoBackup(dataDir, uploadsDir, { force: false }); } catch { /* ignore */ }
  }, 15000);
  initTimer.unref?.();
  const loopTimer = setInterval(() => {
    try { runAutoBackup(dataDir, uploadsDir, { force: false }); } catch { /* ignore */ }
  }, tickMs);
  loopTimer.unref?.();
  schedulers.set(key, { initTimer, loopTimer });
  return () => stopScheduler(key);
};

export const startAutoBackupScheduler = reloadAutoBackupScheduler;

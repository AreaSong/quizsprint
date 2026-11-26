import fs from "node:fs";
import path from "node:path";
import { createFullBackupBundleBuffer } from "./db-restore.mjs";

const BACKUP_NAME_RE = /^auto-[a-zA-Z0-9_-]+\.qsbak$/;

const getBackupsDir = (dataDir) => path.join(path.resolve(dataDir), "backups");

/** 列举本地自动滚动备份（按修改时间倒序） */
export const listAutoBackups = (dataDir) => {
  const dir = getBackupsDir(dataDir);
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
  const full = path.join(getBackupsDir(dataDir), name);
  return fs.existsSync(full) && fs.statSync(full).isFile() ? { name, full } : null;
};

/** 生成含图片的全量自动备份并按保留份数滚动裁剪 */
export const runAutoBackup = (dataDir, uploadsDir = "", { force = false, keep = 7 } = {}) => {
  const dir = getBackupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const existing = listAutoBackups(dataDir);
  if (!force && existing.some((b) => b.name.startsWith(`auto-${day}`))) {
    return { skipped: true, name: existing[0]?.name || "", backups: existing };
  }
  const stamp = force ? `${day}-${now.toISOString().slice(11, 23).replace(/[:.]/g, "")}` : day;
  const filename = `auto-${stamp}.qsbak`;
  const buf = createFullBackupBundleBuffer(dataDir, uploadsDir);
  fs.writeFileSync(path.join(dir, filename), buf);

  const maxKeep = Math.max(1, Math.min(30, Number(keep || 7)));
  const allAfter = listAutoBackups(dataDir);
  for (const old of allAfter.slice(maxKeep)) {
    try { fs.unlinkSync(path.join(dir, old.name)); } catch { /* ignore */ }
  }
  return { skipped: false, name: filename, sizeBytes: buf.length, backups: listAutoBackups(dataDir) };
};

/** 启动后台每日滚动备份调度器，返回清理句柄 */
export const startAutoBackupScheduler = (dataDir, uploadsDir = "") => {
  if (process.env.NODE_ENV === "test" || process.env.AUTO_BACKUP_DISABLED === "1") {
    return () => {};
  }
  const initTimer = setTimeout(() => {
    try { runAutoBackup(dataDir, uploadsDir, { force: false, keep: 7 }); } catch { /* ignore */ }
  }, 15000);
  initTimer.unref?.();
  const loopTimer = setInterval(() => {
    try { runAutoBackup(dataDir, uploadsDir, { force: false, keep: 7 }); } catch { /* ignore */ }
  }, 6 * 60 * 60 * 1000);
  loopTimer.unref?.();
  return () => { clearTimeout(initTimer); clearInterval(loopTimer); };
};

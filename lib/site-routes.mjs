import fs from "node:fs";
import { listAuditLogs } from "./audit.mjs";
import { isAdminRequest, buildUserCookie, createUserToken, getUserFromRequest } from "./auth.mjs";
import {
  deleteAutoBackupFile,
  getAutoBackupConfig,
  getAutoBackupFile,
  listAutoBackups,
  reloadAutoBackupScheduler,
  runAutoBackup,
  saveAutoBackupConfig
} from "./auto-backup.mjs";
import { createFullBackupBundleBuffer } from "./db-restore.mjs";
import { clearLoginLogs, listLoginLogs, recordLoginEvent } from "./login-log.mjs";
import {
  appendContentUpdate,
  completeInitialSetup,
  deleteContentUpdate,
  exportUserProgressBundle,
  getSiteConfig,
  getUserSeenUpdateIds,
  importUserProgressBundle,
  listContentUpdates,
  markUserSeenUpdates,
  needsInitialSetup,
  saveSiteConfig
} from "./site-store.mjs";
import { APP_VERSION, readChangelogPreview } from "./version.mjs";

const sendAttachment = (res, filename, buf, contentType = "application/octet-stream") => {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
  });
  res.end(buf);
};

const handleUserProgressTransfer = async (req, res, pathname, ctx) => {
  const { userStore, readBody, sendJson } = ctx;
  const method = req.method || "GET";
  if (method === "GET" && pathname === "/api/user/progress/export") {
    const user = getUserFromRequest(req, userStore);
    if (!user) return sendJson(res, 401, { code: 401, msg: "请先登录账号" }), true;
    const bundle = exportUserProgressBundle(userStore, user);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    sendAttachment(res, `quizsprint-progress-${user.username}-${day}.json`, `${JSON.stringify(bundle, null, 2)}\n`, "application/json; charset=utf-8");
    return true;
  }
  if (method === "POST" && pathname === "/api/user/progress/import") {
    const user = getUserFromRequest(req, userStore);
    if (!user) return sendJson(res, 401, { code: 401, msg: "请先登录账号" }), true;
    const out = importUserProgressBundle(ctx.dataDir, userStore, user, await readBody(req));
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  return false;
};

const handleBackupBundleRoutes = async (req, res, pathname, ctx) => {
  const { uploadsDir, readBody, sendJson, requireAdmin } = ctx;
  const method = req.method || "GET";
  if (method === "GET" && pathname === "/api/admin/backup/full") {
    if (!requireAdmin(req, res)) return true;
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    sendAttachment(res, `quizsprint-full-${day}.qsbak`, createFullBackupBundleBuffer(ctx.dataDir, uploadsDir));
    return true;
  }
  if (method === "GET" && pathname === "/api/admin/backups") {
    if (!requireAdmin(req, res)) return true;
    const { config, resolvedDir } = getAutoBackupConfig(ctx.dataDir);
    return sendJson(res, 200, { code: 200, config, resolvedDir, backups: listAutoBackups(ctx.dataDir, resolvedDir) }), true;
  }
  if (method === "PUT" && pathname === "/api/admin/backups/config") {
    if (!requireAdmin(req, res)) return true;
    const out = saveAutoBackupConfig(ctx.dataDir, await readBody(req));
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    reloadAutoBackupScheduler(ctx.dataDir, uploadsDir);
    ctx.audit?.("backup.config", out.resolvedDir, `${out.config.enabled ? `每 ${out.config.intervalHours}h` : "已停用"} · 保留 ${out.config.keepCount} 份`);
    return sendJson(res, 200, { code: 200, ...out, backups: listAutoBackups(ctx.dataDir, out.resolvedDir) }), true;
  }
  if (method === "POST" && pathname === "/api/admin/backups/run") {
    if (!requireAdmin(req, res)) return true;
    const out = runAutoBackup(ctx.dataDir, uploadsDir, { force: true });
    ctx.audit?.("backup.auto_run", out.name, `${out.sizeBytes} 字节 -> ${out.resolvedDir}`);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  const bakMatch = pathname.match(/^\/api\/admin\/backups\/([^/]+)$/);
  if (bakMatch && method === "GET") {
    if (!requireAdmin(req, res)) return true;
    const found = getAutoBackupFile(ctx.dataDir, decodeURIComponent(bakMatch[1]));
    if (!found) return sendJson(res, 404, { code: 404, msg: "备份文件不存在" }), true;
    sendAttachment(res, found.name, fs.readFileSync(found.full));
    return true;
  }
  if (bakMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const out = deleteAutoBackupFile(ctx.dataDir, decodeURIComponent(bakMatch[1]));
    if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
    ctx.audit?.("backup.delete", out.name);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  return false;
};

/** 处理版本透出、首次安装向导、站点设置、审计日志与完整灾备路由 */
export const handleSiteRoutes = async (req, res, url, ctx) => {
  const method = req.method || "GET";
  const pathname = url.pathname;
  const { userStore, readBody, sendJson, requireAdmin } = ctx;

  if (method === "GET" && pathname === "/api/site/info") {
    const rawSiteConfig = getSiteConfig(ctx.dataDir);
    const curUser = getUserFromRequest(req, userStore);
    const hasAccess = rawSiteConfig.allowGuestBrowse !== false
      || Boolean(curUser)
      || isAdminRequest(req, userStore.getApiKey(), userStore);
    const siteConfig = hasAccess ? rawSiteConfig : { ...rawSiteConfig, examNotices: [] };
    return sendJson(res, 200, {
      code: 200,
      version: APP_VERSION,
      needsSetup: needsInitialSetup(ctx.dataDir),
      siteConfig,
      contentUpdates: hasAccess ? listContentUpdates(ctx.dataDir, 30) : [],
      seenUpdateIds: curUser ? getUserSeenUpdateIds(ctx.dataDir, curUser.id) : [],
      changelog: readChangelogPreview(ctx.repoDir)
    }), true;
  }
  if (method === "POST" && pathname === "/api/user/updates/read") {
    const curUser = getUserFromRequest(req, userStore);
    if (!curUser) return sendJson(res, 401, { code: 401, msg: "请先登录账号" }), true;
    const body = await readBody(req);
    const seenUpdateIds = markUserSeenUpdates(ctx.dataDir, curUser.id, body?.ids);
    return sendJson(res, 200, { code: 200, seenUpdateIds }), true;
  }
  if (method === "POST" && pathname === "/api/admin/content-updates") {
    if (!requireAdmin(req, res)) return true;
    const out = appendContentUpdate(ctx.dataDir, await readBody(req));
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    ctx.audit?.("content_update.add", out.entry.category, out.entry.title);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  const cuDelMatch = pathname.match(/^\/api\/admin\/content-updates\/([^/]+)$/);
  if (cuDelMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const out = deleteContentUpdate(ctx.dataDir, decodeURIComponent(cuDelMatch[1]));
    if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
    ctx.audit?.("content_update.delete", decodeURIComponent(cuDelMatch[1]));
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  if (method === "POST" && pathname === "/api/setup") {
    const body = await readBody(req);
    const out = completeInitialSetup(ctx.dataDir, userStore, body);
    if (out.error) return sendJson(res, out.status || 400, { code: out.status || 400, msg: out.error }), true;
    recordLoginEvent(ctx.dataDir, req, { userId: out.user.id, username: out.user.username, nickname: out.user.nickname, role: out.user.role, status: "success", reason: "首装向导创建管理员" });
    ctx.audit?.("system.setup", out.user.username, `初始化站点：${out.siteConfig.siteName}`);
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    return sendJson(res, 200, { code: 200, user: out.user, siteConfig: out.siteConfig }, {
      "Set-Cookie": buildUserCookie(createUserToken(out.user), isHttps)
    }), true;
  }
  if (method === "PUT" && pathname === "/api/admin/site") {
    if (!requireAdmin(req, res)) return true;
    const siteConfig = saveSiteConfig(ctx.dataDir, await readBody(req));
    ctx.audit?.("site.update", siteConfig.siteName, siteConfig.allowGuestBrowse ? "允许访客" : "仅登录浏览");
    return sendJson(res, 200, { code: 200, siteConfig }), true;
  }
  if (method === "GET" && pathname === "/api/admin/audit-logs") {
    if (!requireAdmin(req, res)) return true;
    const limit = Number(url.searchParams.get("limit") || 60);
    return sendJson(res, 200, { code: 200, logs: listAuditLogs(ctx.dataDir, limit) }), true;
  }
  if (method === "GET" && pathname === "/api/admin/login-logs") {
    if (!requireAdmin(req, res)) return true;
    const logs = listLoginLogs(ctx.dataDir, {
      limit: Number(url.searchParams.get("limit") || 120),
      keyword: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || ""
    });
    return sendJson(res, 200, { code: 200, logs }), true;
  }
  if (method === "DELETE" && pathname === "/api/admin/login-logs") {
    if (!requireAdmin(req, res)) return true;
    const out = clearLoginLogs(ctx.dataDir);
    ctx.audit?.("login_logs.clear", "ALL", `清理 ${out.removed} 条登录记录`);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  if (await handleUserProgressTransfer(req, res, pathname, ctx)) return true;
  return handleBackupBundleRoutes(req, res, pathname, ctx);
};

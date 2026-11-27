import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordAuditLog } from "./lib/audit.mjs";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  getAdminPassword,
  getUserFromRequest,
  isAdminRequest,
  isUsingGeneratedPassword,
  verifyPassword
} from "./lib/auth.mjs";
import { startAutoBackupScheduler } from "./lib/auto-backup.mjs";
import { closeAllDbs } from "./lib/db.mjs";
import { createExamStore } from "./lib/exam-store.mjs";
import { handleExtraRoutes } from "./lib/extra-routes.mjs";
import {
  applySecurityHeaders,
  attachRequestLogger,
  createRateLimiter,
  getClientIp,
  isRateLimitedEndpoint,
  registerGracefulShutdown,
  resolveCorsHeaders
} from "./lib/http-guard.mjs";
import { handleLegacyRoutes } from "./lib/legacy-routes.mjs";
import { recordLoginEvent } from "./lib/login-log.mjs";
import { appendContentUpdate, getSiteConfig } from "./lib/site-store.mjs";
import { createStore } from "./lib/store.mjs";
import { startUpdateProbeScheduler } from "./lib/system-updater.mjs";
import { createUserStore } from "./lib/user-store.mjs";
import { APP_VERSION } from "./lib/version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const rateLimiter = createRateLimiter();

const store = createStore(DATA_DIR);
const userStore = createUserStore(DATA_DIR);
const examStore = createExamStore(DATA_DIR);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

const TEMPLATE = {
  说明: "type：0单选 1多选 2填空 3判断 4简答 5不定项 6实操 7排序拖动 8拖拽配对。options 仅客观选择/判断题填写；answers 填正确答案正文。",
  questions: [
    {
      title: "绿色植物在光照下释放氧气，主要是因为",
      type: "0",
      options: ["呼吸作用", "光合作用", "蒸腾作用", "渗透作用"],
      answers: ["光合作用"],
      analysis: "光合作用吸收二氧化碳并释放氧气。",
      chapter: "基础生物",
      difficulty: "简单"
    }
  ]
};

const sendJson = (res, status, payload, extraHeaders = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, applySecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(res._qsCors || {}),
    ...extraHeaders
  }));
  res.end(body);
};

const sendDownload = (res, filename, payload) => {
  const safeName = encodeURIComponent(filename);
  res.writeHead(200, applySecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`
  }));
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
};

const serveSafeFile = (baseDir, relPath, res) => {
  const absBase = path.resolve(baseDir);
  const resolved = path.resolve(absBase, relPath);
  if (!resolved.startsWith(absBase + path.sep) && resolved !== absBase) {
    return sendJson(res, 403, { code: 403, msg: "禁止访问" }), true;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return false;
  const realBase = fs.realpathSync(absBase);
  const realFile = fs.realpathSync(resolved);
  if (!realFile.startsWith(realBase + path.sep) && realFile !== realBase) {
    return sendJson(res, 403, { code: 403, msg: "禁止访问" }), true;
  }
  const ext = path.extname(realFile).toLowerCase();
  const isCodeAsset = [".html", ".css", ".js", ".mjs"].includes(ext);
  const isUpload = absBase === path.resolve(UPLOADS_DIR);
  res.writeHead(200, applySecurityHeaders({
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": isCodeAsset ? "no-store, no-cache, must-revalidate" : "public, max-age=300",
    ...(isCodeAsset ? { "CDN-Cache-Control": "no-store" } : {}),
    ...(isUpload ? { "Content-Security-Policy": "default-src 'none'; sandbox" } : {})
  }));
  if (ext === ".html" && absBase === path.resolve(PUBLIC_DIR)) {
    const html = fs.readFileSync(realFile, "utf8")
      .replace(/(href="\/css\/[^"]+\.css)(")/g, `$1?v=${APP_VERSION}$2`)
      .replace(/(src="\/js\/app\.js)(")/g, `$1?v=${APP_VERSION}$2`);
    res.end(html);
    return true;
  }
  const stream = fs.createReadStream(realFile);
  stream.on("error", () => { if (!res.writableEnded) res.destroy(); });
  stream.pipe(res);
  return true;
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error("请求体过大（超过 24MB）"), { statusCode: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return resolve({});
    try {
      resolve(JSON.parse(text));
    } catch {
      reject(Object.assign(new Error("JSON 格式无效"), { statusCode: 400 }));
    }
  });
  req.on("error", reject);
});

const requireAdmin = (req, res) => {
  if (isAdminRequest(req, userStore.getApiKey(), userStore)) return true;
  sendJson(res, 401, { code: 401, msg: "需要管理员登录或有效 X-API-Key" });
  return false;
};

const requireGuestAllowed = (req, res) => {
  if (getSiteConfig(DATA_DIR).allowGuestBrowse !== false) return true;
  if (getUserFromRequest(req, userStore) || isAdminRequest(req, userStore.getApiKey(), userStore)) return true;
  sendJson(res, 401, { code: 401, msg: "站点已关闭访客浏览，请先登录账号" });
  return false;
};

const FORCE_PWD_ALLOW = new Set(["/api/site/info", "/api/user/me", "/api/user/login", "/api/user/register", "/api/user/password", "/api/user/logout"]);

const handleApi = async (req, res, url) => {
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (method === "GET" && pathname === "/health") {
    const banks = store.listBanks();
    const questionCount = banks.reduce((sum, b) => sum + (b.questionCount || 0), 0);
    return sendJson(res, 200, {
      ok: true,
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      count: questionCount,
      bankCount: banks.length,
      questionCount
    });
  }
  if (method === "GET" && pathname === "/api/auth/me") {
    const admin = isAdminRequest(req, userStore.getApiKey(), userStore);
    return sendJson(res, 200, {
      code: 200,
      admin,
      usingGeneratedPassword: admin ? isUsingGeneratedPassword() : false
    });
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    if (!verifyPassword(body.password)) {
      recordLoginEvent(DATA_DIR, req, { username: "admin", nickname: "管理口令", role: "admin", status: "failed", reason: "管理密码错误" });
      return sendJson(res, 401, { code: 401, msg: "管理密码错误" });
    }
    recordLoginEvent(DATA_DIR, req, { username: "admin", nickname: "管理口令", role: "admin", status: "success" });
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    return sendJson(
      res,
      200,
      { code: 200, admin: true, msg: "登录成功" },
      { "Set-Cookie": buildSessionCookie(createSessionToken(), isHttps) }
    );
  }
  if (method === "POST" && pathname === "/api/auth/logout") {
    return sendJson(res, 200, { code: 200, admin: false }, { "Set-Cookie": buildClearSessionCookie() });
  }
  if (method === "GET" && pathname === "/api/template.json") {
    return sendDownload(res, "quizsprint-question-template.json", TEMPLATE);
  }
  const curUser = getUserFromRequest(req, userStore);
  if (curUser?.mustChangePassword && !FORCE_PWD_ALLOW.has(pathname)) {
    return sendJson(res, 403, { code: 403, mustChangePassword: true, msg: "首次登录请先修改初始密码" });
  }
  if (method === "GET" && pathname === "/api/search") {
    if (!requireGuestAllowed(req, res)) return;
    const items = store.searchQuestions({
      query: url.searchParams.get("q") || "",
      bankId: url.searchParams.get("bankId") || "",
      type: url.searchParams.get("type") || ""
    });
    return sendJson(res, 200, { code: 200, items, total: items.length });
  }

  const audit = (action, target = "", detail = "") => {
    const u = getUserFromRequest(req, userStore);
    recordAuditLog(DATA_DIR, {
      actor: u ? `${u.nickname || u.username} (${u.username})` : "管理员",
      actorRole: u?.userRole || "admin",
      action,
      target,
      detail,
      ip: getClientIp(req)
    });
  };

  const handledExtra = await handleExtraRoutes(req, res, url, {
    store,
    userStore,
    examStore,
    uploadsDir: UPLOADS_DIR,
    dataDir: DATA_DIR,
    repoDir: __dirname,
    readBody,
    sendJson,
    requireAdmin,
    requireGuestAllowed,
    audit,
    onRequestRestart: () => {
      setTimeout(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500);
      }, 400);
    }
  });
  if (handledExtra) return;

  if (method === "GET" && pathname === "/api/banks") {
    if (!requireGuestAllowed(req, res)) return;
    const banks = store.listBanks().map(({ password, ...rest }) => ({
      ...rest,
      locked: Boolean(password)
    }));
    return sendJson(res, 200, { code: 200, banks });
  }
  if (method === "POST" && pathname === "/api/banks") {
    if (!requireAdmin(req, res)) return;
    const out = store.createBank(await readBody(req));
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error });
    appendContentUpdate(DATA_DIR, { category: "题库", title: `新建题库「${out.bank.name}」` });
    return sendJson(res, 200, { code: 200, bank: out.bank });
  }

  const bankMatch = pathname.match(/^\/api\/banks\/([^/]+)$/);
  if (bankMatch) {
    const bankId = decodeURIComponent(bankMatch[1]);
    if (method === "GET") {
      if (!requireGuestAllowed(req, res)) return;
      const bank = store.getBank(bankId);
      if (!bank) return sendJson(res, 404, { code: 404, msg: "题库不存在" });
      const { password, ...safeBank } = bank;
      return sendJson(res, 200, { code: 200, bank: { ...safeBank, locked: Boolean(password) } });
    }
    if (method === "PUT") {
      if (!requireAdmin(req, res)) return;
      const out = store.updateBank(bankId, await readBody(req));
      if (out.error) return sendJson(res, 404, { code: 404, msg: out.error });
      return sendJson(res, 200, { code: 200, bank: out.bank });
    }
    if (method === "DELETE") {
      if (!requireAdmin(req, res)) return;
      const out = store.deleteBank(bankId);
      if (out.error) return sendJson(res, 404, { code: 404, msg: out.error });
      audit("bank.delete", bankId);
      return sendJson(res, 200, { code: 200, ok: true });
    }
  }

  const bankSubMatch = pathname.match(/^\/api\/banks\/([^/]+)\/(questions|import|export)$/);
  if (bankSubMatch) {
    if (bankSubMatch[2] === "questions" && method === "GET" && !requireGuestAllowed(req, res)) return;
    const bank = store.getBank(decodeURIComponent(bankSubMatch[1]));
    if (!bank) return sendJson(res, 404, { code: 404, msg: "题库不存在" });
    const action = bankSubMatch[2];
    const bankPwd = url.searchParams.get("pwd") || req.headers["x-bank-password"] || "";
    if (method === "GET" && bank.password && bankPwd !== bank.password && !isAdminRequest(req, userStore.getApiKey(), userStore)) {
      return sendJson(res, 403, { code: 403, locked: true, msg: "该题库已加密，请输入访问密码" });
    }
    if (action === "export" && method === "GET") {
      if (!getUserFromRequest(req, userStore) && !isAdminRequest(req, userStore.getApiKey(), userStore)) {
        return sendJson(res, 401, { code: 401, msg: "请先登录账号后再导出题库" });
      }
      return sendDownload(res, `${bank.name}.json`, { bank: bank.name, questions: store.loadBankQuestions(bank.id) });
    }
    if (action === "questions" && method === "GET") {
      const { password, ...safeBank } = bank;
      let list = store.loadBankQuestions(bank.id);
      const qFilter = (url.searchParams.get("q") || "").trim().toLowerCase();
      const typeFilter = url.searchParams.get("type") || "";
      const chapFilter = url.searchParams.get("chapter") || "";
      if (typeFilter !== "") list = list.filter((item) => String(item.type) === typeFilter);
      if (chapFilter !== "") list = list.filter((item) => item.chapter === chapFilter);
      if (qFilter) {
        list = list.filter((item) => `${item.title} ${(item.options || []).join(" ")} ${(item.answers || []).join(" ")}`.toLowerCase().includes(qFilter));
      }
      const total = list.length;
      const page = Number(url.searchParams.get("page") || 0);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      if (page > 0 && pageSize > 0) {
        const start = (page - 1) * pageSize;
        list = list.slice(start, start + pageSize);
      }
      return sendJson(res, 200, { code: 200, bank: safeBank, total, questions: list });
    }
    if (action === "questions" && method === "POST") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const result = store.upsertQuestion(bank.id, body);
      if (result.status === 200 && result.created) {
        appendContentUpdate(DATA_DIR, { category: "题目", title: `题库「${bank.name}」新增 1 道题`, detail: String(body?.title || "").slice(0, 48) });
      }
      return sendJson(res, result.status, { code: result.status, ...result });
    }
    if (action === "import" && method === "POST") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const items = Array.isArray(body) ? body : (Array.isArray(body.questions) ? body.questions : []);
      if (!items.length) return sendJson(res, 400, { code: 400, msg: "没有可导入的题目" });
      const result = store.importQuestions(bank.id, items, Boolean(body.skipIfExists));
      if (result.status === 200 && (result.created > 0 || result.updated > 0)) {
        appendContentUpdate(DATA_DIR, { category: "导题", title: `题库「${bank.name}」新增 ${result.created} 题${result.updated ? ` / 更新 ${result.updated} 题` : ""}` });
      }
      return sendJson(res, result.status, {
        code: result.status,
        ...result,
        msg: `导入完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`
      });
    }
  }

  const batchMatch = pathname.match(/^\/api\/banks\/([^/]+)\/questions\/batch$/);
  if (batchMatch && method === "POST") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const result = store.batchUpdateOrDelete(decodeURIComponent(batchMatch[1]), body);
    if (result.status === 200 && body?.action === "delete") {
      audit("question.batch_delete", decodeURIComponent(batchMatch[1]), `删除 ${result.affected} 题`);
    }
    return sendJson(res, result.status, { code: result.status, ...result });
  }

  const qItemMatch = pathname.match(/^\/api\/banks\/([^/]+)\/questions\/([^/]+)$/);
  if (qItemMatch) {
    const bankId = decodeURIComponent(qItemMatch[1]);
    const qId = decodeURIComponent(qItemMatch[2]);
    if (method === "GET") {
      if (!requireGuestAllowed(req, res)) return;
      const bank = store.getBank(bankId);
      if (!bank) return sendJson(res, 404, { code: 404, msg: "题库不存在" });
      const bankPwd = url.searchParams.get("pwd") || req.headers["x-bank-password"] || "";
      if (bank.password && bankPwd !== bank.password && !isAdminRequest(req, userStore.getApiKey(), userStore)) {
        return sendJson(res, 403, { code: 403, locked: true, msg: "该题库已加密" });
      }
      const question = store.loadBankQuestions(bank.id).find((q) => q.id === qId);
      if (!question) return sendJson(res, 404, { code: 404, msg: "试题不存在" });
      return sendJson(res, 200, { code: 200, question });
    }
    if (!requireAdmin(req, res)) return;
    if (method === "PUT" || method === "PATCH") {
      const body = await readBody(req);
      if (method === "PATCH") {
        const cur = store.loadBankQuestions(bankId).find((q) => q.id === qId);
        if (!cur) return sendJson(res, 404, { code: 404, msg: "试题不存在" });
        const result = store.updateQuestion(bankId, qId, { ...cur, ...body });
        return sendJson(res, result.status, { code: result.status, ...result });
      }
      const result = store.updateQuestion(bankId, qId, body);
      return sendJson(res, result.status, { code: result.status, ...result });
    }
    if (method === "DELETE") {
      const result = store.deleteQuestion(bankId, qId);
      return sendJson(res, result.status, { code: result.status, ...result });
    }
  }

  sendJson(res, 404, { code: 404, msg: "接口不存在" });
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    res._qsCors = resolveCorsHeaders(req, url.pathname);
    attachRequestLogger(req, res, url.pathname);
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }
    if (isRateLimitedEndpoint(req.method || "GET", url.pathname)) {
      const rl = rateLimiter.check(`${getClientIp(req)}:${url.pathname}`);
      if (!rl.allowed) {
        sendJson(res, 429, { code: 429, msg: `请求过于频繁，请 ${rl.retryAfterSec} 秒后重试` }, { "Retry-After": String(rl.retryAfterSec) });
        return;
      }
    }
    const handledLegacy = await handleLegacyRoutes(req, res, url, {
      store,
      userStore,
      readBody,
      sendJson,
      sendDownload,
      requireGuestAllowed,
      template: TEMPLATE
    });
    if (handledLegacy) return;
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      await handleApi(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      if (!requireGuestAllowed(req, res)) return;
      if (serveSafeFile(UPLOADS_DIR, url.pathname.slice(9), res)) return;
    }
    if (req.method === "GET") {
      const rel = url.pathname === "/" || url.pathname === "/admin" ? "index.html" : url.pathname.replace(/^\/+/, "");
      if (serveSafeFile(PUBLIC_DIR, rel, res)) return;
      serveSafeFile(PUBLIC_DIR, "index.html", res);
      return;
    }
    sendJson(res, 404, { code: 404, msg: "资源不存在" });
  } catch (error) {
    const status = Number(error?.statusCode);
    const isClient = status >= 400 && status < 500;
    if (!isClient) console.error("[server]", error);
    if (!res.headersSent) {
      sendJson(res, isClient ? status : 500, { code: isClient ? status : 500, msg: isClient ? error.message : "服务内部错误" });
    }
  }
});

const stopAutoBackup = startAutoBackupScheduler(DATA_DIR, UPLOADS_DIR);
const stopUpdateProbe = startUpdateProbeScheduler(__dirname);
registerGracefulShutdown(server, () => {
  stopAutoBackup();
  stopUpdateProbe();
  closeAllDbs();
});

server.listen(PORT, HOST, () => {
  console.log(`QuizSprint v${APP_VERSION} 已启动：http://${HOST}:${PORT}`);
  console.log(`数据目录：${DATA_DIR}`);
  if (isUsingGeneratedPassword()) {
    console.log(`未设置 ADMIN_PASSWORD，本次随机管理密码为：${getAdminPassword()}`);
  } else {
    console.log("已启用环境变量 ADMIN_PASSWORD 管理鉴权");
  }
});

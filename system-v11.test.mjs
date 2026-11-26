import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listAuditLogs, recordAuditLog } from "./lib/audit.mjs";
import { buildUserCookie, createUserToken, getUserFromRequest, isAdminRequest } from "./lib/auth.mjs";
import { listAutoBackups, runAutoBackup } from "./lib/auto-backup.mjs";
import { createFullBackupBundleBuffer, restoreDatabaseFromBase64 } from "./lib/db-restore.mjs";
import { closeAllDbs, getDatabaseStats, getDb } from "./lib/db.mjs";
import { createExamStore } from "./lib/exam-store.mjs";
import { handleExtraRoutes } from "./lib/extra-routes.mjs";
import { createRateLimiter } from "./lib/http-guard.mjs";
import { classifyIpLocal, parseUserAgent } from "./lib/login-log.mjs";
import { getSiteConfig } from "./lib/site-store.mjs";
import { createStore } from "./lib/store.mjs";
import { createUserStore } from "./lib/user-store.mjs";
import { APP_VERSION, DB_SCHEMA_VERSION } from "./lib/version.mjs";

const makeCaller = ({ store, userStore, examStore, dataDir, uploadsDir }) =>
  async (method, urlPath, body = {}, opts = {}) => {
    let result = null;
    const headers = { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers || {}) };
    const req = { method, headers, socket: { remoteAddress: "127.0.0.1" } };
    const sendJson = (_r, status, payload, extraHeaders = {}) => { result = { status, payload, headers: extraHeaders }; };
    await handleExtraRoutes(req, {}, new URL(`http://127.0.0.1:8787${urlPath}`), {
      store,
      userStore,
      examStore,
      dataDir,
      uploadsDir,
      repoDir: process.cwd(),
      readBody: async () => body,
      sendJson,
      audit: (action, target = "", detail = "") => recordAuditLog(dataDir, { actor: "test", action, target, detail, ip: "127.0.0.1" }),
      requireGuestAllowed: () => {
        if (getSiteConfig(dataDir).allowGuestBrowse !== false) return true;
        if (getUserFromRequest(req, userStore) || (opts.admin === true && isAdminRequest(req, userStore.getApiKey(), userStore))) return true;
        sendJson({}, 401, { code: 401, msg: "站点已关闭访客浏览，请先登录账号" });
        return false;
      },
      requireAdmin: () => {
        if (opts.admin !== false) return true;
        result = { status: 401, payload: { code: 401, msg: "需要管理员权限" }, headers: {} };
        return false;
      }
    });
    return result;
  };

test("v1.1 版本与 Schema 版本、滑动窗口限流、首装向导、站点配置与审计日志正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-v11-sys-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    const db = getDb(tmpDir);
    assert.equal(Number(db.prepare("PRAGMA user_version;").get().user_version), DB_SCHEMA_VERSION);
    assert.equal(getDatabaseStats(tmpDir, uploadsDir).schemaVersion, DB_SCHEMA_VERSION);

    const limiter = createRateLimiter({ max: 2, windowMs: 60000 });
    assert.equal(limiter.check("1.2.3.4:/api/user/login").allowed, true);
    assert.equal(limiter.check("1.2.3.4:/api/user/login").allowed, true);
    const blocked = limiter.check("1.2.3.4:/api/user/login");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec >= 1);

    const info0 = await call("GET", "/api/site/info");
    assert.equal(info0.status, 200);
    assert.equal(info0.payload.version, APP_VERSION);
    assert.equal(info0.payload.needsSetup, true);

    const setupOk = await call("POST", "/api/setup", { username: "rootadmin", password: "secret123", siteName: "我的云端题库" });
    assert.equal(setupOk.status, 200);
    assert.equal(setupOk.payload.user.role, "admin");
    assert.ok(String(setupOk.headers["Set-Cookie"] || "").includes("as_qb_user="));

    const setupTwice = await call("POST", "/api/setup", { username: "other", password: "secret123" });
    assert.equal(setupTwice.status, 403);

    const info1 = await call("GET", "/api/site/info");
    assert.equal(info1.payload.needsSetup, false);
    assert.equal(info1.payload.siteConfig.siteName, "我的云端题库");

    const siteUpd = await call("PUT", "/api/admin/site", { announcement: "系统维护公告", allowGuestBrowse: false });
    assert.equal(siteUpd.status, 200);
    assert.equal(siteUpd.payload.siteConfig.announcement, "系统维护公告");
    assert.equal(siteUpd.payload.siteConfig.allowGuestBrowse, false);

    const logsRes = await call("GET", "/api/admin/audit-logs");
    assert.equal(logsRes.status, 200);
    assert.ok(logsRes.payload.logs.some((l) => l.action === "system.setup"));
    assert.ok(logsRes.payload.logs.some((l) => l.action === "site.update"));
    assert.ok(listAuditLogs(tmpDir, 10).length >= 2);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("v1.1 含图片全量备份 (.qsbak) 还原、自动滚动备份与学员进度导出导入正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-v11-bak-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    const { bank } = store.createBank({ name: "含图全量备份库" });
    fs.writeFileSync(path.join(uploadsDir, "diagram-1.png"), "PNGDATA_12345");
    store.importQuestions(bank.id, [{ id: "img-q1", title: "看图题", type: "0", options: ["A", "B"], answers: ["A"], images: ["/uploads/diagram-1.png"] }]);

    const fullBundle = createFullBackupBundleBuffer(tmpDir, uploadsDir);
    assert.equal(fullBundle[0], 0x1f);
    assert.equal(fullBundle[1], 0x8b);

    runAutoBackup(tmpDir, uploadsDir, { force: true, keep: 2 });
    await new Promise((r) => setTimeout(r, 5));
    runAutoBackup(tmpDir, uploadsDir, { force: true, keep: 2 });
    await new Promise((r) => setTimeout(r, 5));
    const third = runAutoBackup(tmpDir, uploadsDir, { force: true, keep: 2 });
    assert.equal(third.backups.length, 2);
    assert.equal(listAutoBackups(tmpDir).length, 2);

    store.deleteBank(bank.id);
    fs.unlinkSync(path.join(uploadsDir, "diagram-1.png"));
    assert.equal(fs.existsSync(path.join(uploadsDir, "diagram-1.png")), false);

    const restoreOut = restoreDatabaseFromBase64(tmpDir, fullBundle.toString("base64"), uploadsDir);
    assert.equal(restoreOut.ok, true);
    assert.equal(restoreOut.restoredUploads, 1);
    assert.equal(fs.existsSync(path.join(uploadsDir, "diagram-1.png")), true);
    assert.equal(store.listBanks().some((b) => b.name === "含图全量备份库"), true);

    const { user } = userStore.register({ username: "stu1", password: "123456", nickname: "学员1" });
    const stuCookie = buildUserCookie(createUserToken(user), false).split(";")[0];
    userStore.saveBankProgress(user.id, bank.id, { notes: { "img-q1": "重要笔记" }, wrongIds: ["img-q1"] }, { answered: 2, correct: 1, questionId: "img-q1" });
    const exported = { format: "quizsprint-progress-v1", ...userStore.loadProgress(user.id) };

    userStore.adminClearUserProgress(user.id);
    assert.deepEqual(userStore.loadProgress(user.id), { banks: {}, dailyStats: {} });

    const impRes = await call("POST", "/api/user/progress/import", exported, { cookie: stuCookie, admin: false });
    assert.equal(impRes.status, 200);
    assert.equal(impRes.payload.progress.banks[bank.id].notes["img-q1"], "重要笔记");
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("v1.1 登录轨迹追踪：成功/失败记录、反代IP与内网识别、设备解析、列表关联与日志清理正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-v11-loginlog-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    assert.equal(classifyIpLocal("127.0.0.1"), "本机回环");
    assert.equal(classifyIpLocal("192.168.10.22"), "局域网 / 内网");
    assert.equal(parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0"), "macOS · Chrome");

    const { user } = userStore.register({ username: "trackuser", password: "123456", nickname: "追踪同学" });
    await call("POST", "/api/user/login", { username: "trackuser", password: "wrong" }, {
      headers: { "x-forwarded-for": "192.168.1.66", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Edg/120.0" }
    });
    await call("POST", "/api/user/login", { username: "trackuser", password: "123456" }, {
      headers: { "x-forwarded-for": "10.0.0.18", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1" }
    });

    const usersRes = await call("GET", "/api/admin/users");
    const uEntry = usersRes.payload.users.find((u) => u.id === user.id);
    assert.equal(uEntry.lastLogin.ip, "10.0.0.18");
    assert.equal(uEntry.lastLogin.location, "局域网 / 内网");
    assert.equal(uEntry.lastLogin.device, "iOS · Safari");

    const unauthLogs = await call("GET", "/api/admin/login-logs", {}, { admin: false });
    assert.equal(unauthLogs.status, 401);

    const failLogs = await call("GET", "/api/admin/login-logs?status=failed&q=192.168");
    assert.equal(failLogs.payload.logs.length, 1);
    assert.equal(failLogs.payload.logs[0].device, "Windows · Edge");

    const clr = await call("DELETE", "/api/admin/login-logs");
    assert.equal(clr.status, 200);
    assert.equal(clr.payload.removed, 2);
    assert.equal((await call("GET", "/api/admin/login-logs")).payload.logs.length, 0);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("v1.1 访客门禁拦截、账号冻结/解封与改密/重置密码即时吊销会话正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-v11-sec-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    const { user } = userStore.register({ username: "secstu", password: "pass1234", nickname: "安全学员" });
    const loginRes = await call("POST", "/api/user/login", { username: "secstu", password: "pass1234" });
    assert.equal(loginRes.status, 200);
    const cookie1 = String(loginRes.headers["Set-Cookie"] || "").split(";")[0];

    await call("PUT", "/api/admin/site", { allowGuestBrowse: false });
    assert.equal((await call("GET", "/api/stats", {}, { admin: false })).status, 401);
    assert.equal((await call("GET", "/api/exams", {}, { admin: false })).status, 401);
    assert.equal((await call("GET", "/api/subjects", {}, { admin: false })).status, 401);
    assert.equal((await call("GET", "/api/stats", {}, { cookie: cookie1, admin: false })).status, 200);

    const chPwd = await call("POST", "/api/user/password", { oldPassword: "pass1234", newPassword: "pass5678" }, { cookie: cookie1, admin: false });
    assert.equal(chPwd.status, 200);
    const cookie2 = String(chPwd.headers["Set-Cookie"] || "").split(";")[0];
    assert.ok(cookie2.includes("as_qb_user="));
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: cookie1, admin: false })).payload.user, null);
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: cookie2, admin: false })).payload.user.id, user.id);

    const profRes = await call("PUT", "/api/user/profile", { nickname: "改名后" }, { cookie: cookie2, admin: false });
    assert.equal(profRes.status, 200);
    const cookie3 = String(profRes.headers["Set-Cookie"] || "").split(";")[0];
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: cookie3, admin: false })).payload.user.nickname, "改名后");

    await call("POST", `/api/admin/users/${user.id}/password`, { newPassword: "pass9999" });
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: cookie2, admin: false })).payload.user, null);
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: cookie3, admin: false })).payload.user, null);

    const loginRes2 = await call("POST", "/api/user/login", { username: "secstu", password: "pass9999" });
    const cookie4 = String(loginRes2.headers["Set-Cookie"] || "").split(";")[0];
    const freezeRes = await call("PUT", `/api/admin/users/${user.id}/status`, { disabled: true });
    assert.equal(freezeRes.status, 200);
    assert.equal(freezeRes.payload.disabled, true);
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: cookie4, admin: false })).payload.user, null);

    const frozenLogin = await call("POST", "/api/user/login", { username: "secstu", password: "pass9999" });
    assert.equal(frozenLogin.status, 401);
    assert.ok(frozenLogin.payload.msg.includes("冻结"));

    await call("PUT", `/api/admin/users/${user.id}/status`, { disabled: false });
    assert.equal((await call("POST", "/api/user/login", { username: "secstu", password: "pass9999" })).status, 200);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

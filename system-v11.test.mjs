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

test("v1.1 可配置定时备份策略、自定义服务器路径、格式切换与快照删除正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-v11-bakcfg-"));
  const customDir = path.join(tmpDir, "custom-backups");
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    const defRes = await call("GET", "/api/admin/backups");
    assert.equal(defRes.status, 200);
    assert.equal(defRes.payload.config.enabled, true);
    assert.equal(defRes.payload.config.intervalHours, 24);
    assert.equal(defRes.payload.config.keepCount, 7);

    const badPath = await call("PUT", "/api/admin/backups/config", { backupDir: "/etc/qs-test" });
    assert.equal(badPath.status, 400);

    const saveOk = await call("PUT", "/api/admin/backups/config", {
      enabled: true,
      intervalHours: 6,
      keepCount: 2,
      format: "db",
      backupDir: customDir
    });
    assert.equal(saveOk.status, 200);
    assert.equal(saveOk.payload.config.intervalHours, 6);
    assert.equal(saveOk.payload.config.keepCount, 2);
    assert.equal(saveOk.payload.config.format, "db");
    assert.equal(saveOk.payload.resolvedDir, path.resolve(customDir));

    const r1 = await call("POST", "/api/admin/backups/run");
    assert.equal(r1.status, 200);
    assert.ok(r1.payload.name.endsWith(".db"));
    assert.equal(fs.existsSync(path.join(customDir, r1.payload.name)), true);

    await new Promise((r) => setTimeout(r, 5));
    await call("POST", "/api/admin/backups/run");
    await new Promise((r) => setTimeout(r, 5));
    const r3 = await call("POST", "/api/admin/backups/run");
    assert.equal(r3.payload.backups.length, 2);

    const delRes = await call("DELETE", `/api/admin/backups/${encodeURIComponent(r3.payload.name)}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.payload.backups.length, 1);

    await call("PUT", "/api/admin/backups/config", { enabled: false, backupDir: customDir });
    const skipRes = runAutoBackup(tmpDir, uploadsDir, { force: false });
    assert.equal(skipRes.skipped, true);
    assert.equal(skipRes.reason, "disabled");

    let restartFired = false;
    await handleExtraRoutes(
      { method: "POST", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
      {},
      new URL("http://127.0.0.1:8787/api/admin/system/update"),
      {
        store,
        userStore,
        examStore,
        dataDir: tmpDir,
        uploadsDir,
        repoDir: tmpDir,
        readBody: async () => ({ autoRestart: true }),
        sendJson: (_r, status, payload) => {
          assert.equal(status, 409);
          assert.ok(payload.msg);
        },
        requireAdmin: () => true,
        onRequestRestart: () => { restartFired = true; }
      }
    );
    assert.equal(restartFired, false);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("v1.1 连续编号批量创建用户账号与考试时间通知信息看板正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-v11-batch-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    const r1 = await call("POST", "/api/admin/users/batch", {
      startNum: "100",
      endNum: "104",
      nicknamePrefix: "学员",
      passwordMode: "fixed",
      fixedPassword: "pass123"
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.payload.createdCount, 5);
    assert.equal(r1.payload.accounts[0].username, "100");
    assert.equal(r1.payload.accounts[0].nickname, "学员100");
    assert.equal((await call("POST", "/api/user/login", { username: "100", password: "pass123" })).status, 200);
    assert.equal((await call("POST", "/api/user/login", { username: "104", password: "pass123" })).status, 200);

    const r2 = await call("POST", "/api/admin/users/batch", {
      startNum: "102",
      endNum: "106",
      passwordMode: "fixed",
      fixedPassword: "pass123"
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.payload.skippedCount, 3);
    assert.equal(r2.payload.createdCount, 2);

    const r3 = await call("POST", "/api/admin/users/batch", {
      prefix: "stu",
      startNum: "001",
      endNum: "003",
      passwordMode: "random"
    });
    assert.equal(r3.status, 200);
    assert.deepEqual(r3.payload.accounts.map((a) => a.username), ["stu001", "stu002", "stu003"]);
    assert.equal(r3.payload.accounts[0].password.length, 6);
    assert.equal((await call("POST", "/api/user/login", { username: "stu001", password: r3.payload.accounts[0].password })).status, 200);

    assert.equal((await call("POST", "/api/admin/users/batch", { startNum: "100", endNum: "400", fixedPassword: "pass123" })).status, 400);
    assert.equal((await call("POST", "/api/admin/users/batch", { startNum: "200", endNum: "100", fixedPassword: "pass123" })).status, 400);
    assert.equal((await call("POST", "/api/admin/users/batch", { startNum: "100", endNum: "105", passwordMode: "same" })).status, 400);
    assert.equal((await call("POST", "/api/admin/users/batch", { startNum: "20240715A0101", endNum: "20240715B0105", fixedPassword: "pass123" })).status, 400);

    const r4 = await call("POST", "/api/admin/users/batch", {
      startNum: "20240715B0101",
      endNum: "20240715B0103",
      passwordMode: "same"
    });
    assert.equal(r4.status, 200);
    assert.deepEqual(r4.payload.accounts.map((a) => a.username), ["20240715B0101", "20240715B0102", "20240715B0103"]);
    const firstLogin = await call("POST", "/api/user/login", { username: "20240715B0101", password: "20240715B0101" });
    assert.equal(firstLogin.status, 200);
    assert.equal(firstLogin.payload.user.mustChangePassword, true);
    const firstCookie = String(firstLogin.headers["Set-Cookie"] || "").split(";")[0];
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: firstCookie })).payload.user.mustChangePassword, true);
    assert.equal((await call("POST", "/api/user/password", { oldPassword: "20240715B0101", newPassword: "20240715B0101" }, { cookie: firstCookie })).status, 400);
    const changed = await call("POST", "/api/user/password", { oldPassword: "20240715B0101", newPassword: "newpass123" }, { cookie: firstCookie });
    assert.equal(changed.status, 200);
    const newCookie = String(changed.headers["Set-Cookie"] || "").split(";")[0];
    assert.equal((await call("GET", "/api/user/me", {}, { cookie: newCookie })).payload.user.mustChangePassword, false);

    const singleAdminCreate = await call("POST", "/api/admin/users", { username: "20240715B0199", password: "init123" });
    assert.equal(singleAdminCreate.status, 200);
    assert.equal(singleAdminCreate.payload.user.mustChangePassword, true);

    const r5 = await call("POST", "/api/admin/users/batch", {
      startNum: "202407150101",
      endNum: "202407150102",
      passwordMode: "fixed",
      fixedPassword: "pass123"
    });
    assert.equal(r5.status, 200);
    assert.deepEqual(r5.payload.accounts.map((a) => a.username), ["202407150101", "202407150102"]);

    const siteRes = await call("PUT", "/api/admin/site", {
      examNotices: [
        { title: "高等数学期末考试", timeText: "2026-12-20 14:00", duration: "90 分钟", note: "提前 15 分钟候考" },
        { title: "", timeText: "", duration: "", note: "空行应被过滤" }
      ]
    });
    assert.equal(siteRes.status, 200);
    assert.equal(siteRes.payload.siteConfig.examNotices.length, 1);
    assert.equal(siteRes.payload.siteConfig.examNotices[0].title, "高等数学期末考试");

    const infoRes = await call("GET", "/api/site/info");
    assert.equal(infoRes.payload.siteConfig.examNotices[0].duration, "90 分钟");

    const auditRes = await call("GET", "/api/admin/audit-logs");
    assert.ok(auditRes.payload.logs.some((l) => l.action === "user.batch_create"));
    assert.ok(auditRes.payload.logs.some((l) => l.action === "site.update"));
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

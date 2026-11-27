import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { resolveSafeAiUrl } from "./lib/ai.mjs";
import { buildUserCookie, createUserToken, getUserFromRequest, isAdminRequest } from "./lib/auth.mjs";
import { saveAutoBackupConfig } from "./lib/auto-backup.mjs";
import { createFullBackupBundleBuffer, restoreDatabaseFromBase64 } from "./lib/db-restore.mjs";
import { closeAllDbs } from "./lib/db.mjs";
import { createExamStore } from "./lib/exam-store.mjs";
import { handleExtraRoutes } from "./lib/extra-routes.mjs";
import { getClientIp, isRateLimitedEndpoint } from "./lib/http-guard.mjs";
import { handleLegacyRoutes } from "./lib/legacy-routes.mjs";
import { appendContentUpdate, getSiteConfig } from "./lib/site-store.mjs";
import { createStore } from "./lib/store.mjs";
import { createUserStore } from "./lib/user-store.mjs";

const makeRouteCaller = ({ store, userStore, examStore, dataDir, uploadsDir }) =>
  async (method, urlPath, body = {}, opts = {}) => {
    let result = null;
    const headers = { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers || {}) };
    const req = { method, headers, socket: { remoteAddress: opts.remoteAddress || "127.0.0.1" } };
    const sendJson = (_r, status, payload, extraHeaders = {}) => { result = { status, payload, headers: extraHeaders }; };
    const sendDownload = (_r, filename, payload) => { result = { status: 200, filename, payload, headers: {} }; };
    const ctx = {
      store,
      userStore,
      examStore,
      dataDir,
      uploadsDir,
      repoDir: process.cwd(),
      template: {},
      readBody: async () => body,
      sendJson,
      sendDownload,
      requireGuestAllowed: () => {
        if (getSiteConfig(dataDir).allowGuestBrowse !== false) return true;
        if (getUserFromRequest(req, userStore) || (opts.admin === true && isAdminRequest(req, userStore.getApiKey(), userStore))) return true;
        sendJson({}, 401, { code: 401, msg: "站点已关闭访客浏览，请先登录账号" });
        return false;
      },
      requireAdmin: () => {
        if (opts.admin === true || isAdminRequest(req, userStore.getApiKey(), userStore)) return true;
        sendJson({}, 401, { code: 401, msg: "需要管理员权限" });
        return false;
      }
    };
    const u = new URL(`http://127.0.0.1:8787${urlPath}`);
    if (await handleLegacyRoutes(req, {}, u, ctx)) return result;
    await handleExtraRoutes(req, {}, u, ctx);
    return result;
  };

test("安全加固：公网 CHANGELOG 与 /api/site/info 不再泄露数据库内部细节且受访客门禁约束", async () => {
  const changelog = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  for (const banned of ["must_change_password", "audit_logs", "token_version", "PRAGMA user_version", "SQLite"]) {
    assert.equal(changelog.includes(banned), false, `CHANGELOG.md 不应包含 ${banned}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-sec-site-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeRouteCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    appendContentUpdate(tmpDir, { category: "题库", title: "保密测试题库更新" });
    await call("PUT", "/api/admin/site", {
      allowGuestBrowse: false,
      examNotices: [{ title: "内网保密考试", timeText: "2026-12-30 09:00", duration: "60 分钟" }]
    }, { admin: true });

    const anonInfo = await call("GET", "/api/site/info", {}, { admin: false });
    assert.equal(anonInfo.status, 200);
    assert.equal("schemaVersion" in anonInfo.payload, false);
    assert.deepEqual(anonInfo.payload.contentUpdates, []);
    assert.deepEqual(anonInfo.payload.siteConfig.examNotices, []);

    const { user } = userStore.register({ username: "authedstu", password: "pass1234" });
    const stuCookie = buildUserCookie(createUserToken(user), false).split(";")[0];
    const stuInfo = await call("GET", "/api/site/info", {}, { cookie: stuCookie, admin: false });
    assert.equal(stuInfo.payload.contentUpdates.length, 1);
    assert.equal(stuInfo.payload.siteConfig.examNotices.length, 1);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("安全加固：SSRF IPv4/IPv6 映射校验与 X-Forwarded-For 反代边界及 /probe 限流正常", async () => {
  for (const blocked of [
    "http://127.0.0.1:8080/v1",
    "http://169.254.169.254/latest",
    "http://[::ffff:127.0.0.1]/v1",
    "http://[::ffff:169.254.169.254]/v1",
    "http://localhost:11434/v1",
    "http://10.0.0.12/v1",
    "file:///etc/passwd"
  ]) {
    await assert.rejects(() => resolveSafeAiUrl(blocked, "/models", false));
  }
  await assert.rejects(() => resolveSafeAiUrl("http://169.254.169.254/latest", "/models", true));
  await assert.rejects(() => resolveSafeAiUrl("http://[::ffff:169.254.169.254]/v1", "/models", true));

  const spoofedDirect = getClientIp({
    socket: { remoteAddress: "203.0.113.9" },
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }
  });
  assert.equal(spoofedDirect, "203.0.113.9");

  const localProxyRightmost = getClientIp({
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "x-forwarded-for": "9.9.9.9, 198.51.100.22" }
  });
  assert.equal(localProxyRightmost, "198.51.100.22");

  const cfEdge = getClientIp({
    socket: { remoteAddress: "::ffff:127.0.0.1" },
    headers: { "cf-connecting-ip": "198.51.100.77", "x-forwarded-for": "9.9.9.9" }
  });
  assert.equal(cfEdge, "198.51.100.77");
  assert.equal(isRateLimitedEndpoint("POST", "/probe"), true);
});

test("安全加固：旧版油猴路由严格执行访客门禁、会话吊销与 /probe 批量上限", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-sec-legacy-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const call = makeRouteCaller({ store, userStore, examStore, dataDir: tmpDir, uploadsDir });

    const { bank } = store.createBank({ id: "default", name: "默认库" });
    store.importQuestions(bank.id, [{ title: "测试题干一", type: "0", options: ["A", "B"], answers: ["A"] }]);
    await call("PUT", "/api/admin/site", { allowGuestBrowse: false }, { admin: true });

    assert.equal((await call("GET", "/questions", {}, { admin: false })).status, 401);
    assert.equal((await call("POST", "/search", { question: "测试题干一" }, { admin: false })).status, 401);
    assert.equal((await call("POST", "/probe", { question: "测试题干一" }, { admin: false })).status, 401);

    const { user } = userStore.register({ username: "revokeduser", password: "pass1234" });
    const oldCookie = buildUserCookie(createUserToken(user), false).split(";")[0];
    assert.equal((await call("GET", "/export", {}, { cookie: oldCookie, admin: false })).status, 200);

    userStore.adminSetDisabled(user.id, true);
    assert.equal((await call("GET", "/export", {}, { cookie: oldCookie, admin: false, remoteAddress: "203.0.113.10" })).status, 401);

    const tooMany = Array.from({ length: 51 }, (_, i) => ({ question: `题目 ${i}` }));
    const probeOver = await call("POST", "/probe", { questions: tooMany }, { headers: { "x-api-key": userStore.getApiKey() } });
    assert.equal(probeOver.status, 400);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("安全加固：禁止备份写入 public/源码目录，且全量还原自动跳过 .svg 潜在脚本附件", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-sec-bak-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    createStore(tmpDir);
    const pubPath = path.join(process.cwd(), "public");
    assert.ok(saveAutoBackupConfig(tmpDir, { backupDir: pubPath }).error);
    assert.ok(saveAutoBackupConfig(tmpDir, { backupDir: path.join(process.cwd(), "lib") }).error);

    fs.writeFileSync(path.join(uploadsDir, "ok.png"), "PNGDATA");
    const validBundle = JSON.parse(zlib.gunzipSync(createFullBackupBundleBuffer(tmpDir, uploadsDir)).toString("utf8"));
    validBundle.uploads.push({ name: "evil.svg", base64: Buffer.from("<svg onload=alert(1)></svg>").toString("base64") });
    const patchedGz = zlib.gzipSync(Buffer.from(JSON.stringify(validBundle), "utf8"));

    fs.unlinkSync(path.join(uploadsDir, "ok.png"));
    const restored = restoreDatabaseFromBase64(tmpDir, patchedGz.toString("base64"), uploadsDir);
    assert.equal(restored.ok, true);
    assert.equal(fs.existsSync(path.join(uploadsDir, "ok.png")), true);
    assert.equal(fs.existsSync(path.join(uploadsDir, "evil.svg")), false);
  } finally {
    closeAllDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

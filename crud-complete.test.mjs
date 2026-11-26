import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildUserCookie, createUserToken } from "./lib/auth.mjs";
import { createBackupBuffer } from "./lib/db.mjs";
import { createExamStore } from "./lib/exam-store.mjs";
import { handleExtraRoutes } from "./lib/extra-routes.mjs";
import { createStore } from "./lib/store.mjs";
import { createUserStore } from "./lib/user-store.mjs";

const makeRouteCaller = ({ store, userStore, examStore, dataDir }) =>
  async (method, urlPath, body = {}, opts = {}) => {
    let result = null;
    const headers = { ...(opts.cookie ? { cookie: opts.cookie } : {}) };
    await handleExtraRoutes({ method, headers }, {}, new URL(`http://127.0.0.1:8787${urlPath}`), {
      store,
      userStore,
      examStore,
      dataDir,
      uploadsDir: dataDir,
      readBody: async () => body,
      sendJson: (_r, status, payload, extraHeaders = {}) => { result = { status, payload, headers: extraHeaders }; },
      requireAdmin: () => {
        if (opts.admin !== false) return true;
        result = { status: 401, payload: { code: 401, msg: "需要管理员权限" }, headers: {} };
        return false;
      }
    });
    return result;
  };

test("题库密码清空、批量改难度、用户昵称更新与进度清理正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-crud-user-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const callRoute = makeRouteCaller({ store, userStore, examStore, dataDir: tmpDir });

    const { bank } = store.createBank({ name: "加密恢复测试库", password: "secret" });
    assert.equal(Boolean(store.getBank(bank.id).password), true);
    store.updateBank(bank.id, { password: "" });
    assert.equal(store.getBank(bank.id).password, "");

    store.importQuestions(bank.id, [{ id: "q1", title: "测试题1", type: "0", options: ["A", "B"], answers: ["A"] }]);
    const bRes = store.batchUpdateOrDelete(bank.id, { ids: ["q1"], action: "update", difficulty: "困难" });
    assert.equal(bRes.affected, 1);
    assert.equal(store.loadBankQuestions(bank.id)[0].difficulty, "困难");

    const { user } = userStore.register({ username: "alice", password: "123456", nickname: "爱丽丝" });
    const cookie = buildUserCookie(createUserToken(user), false).split(";")[0];

    const profRes = await callRoute("PUT", "/api/user/profile", { nickname: "新昵称Alice" }, { cookie });
    assert.equal(profRes.status, 200);
    assert.equal(profRes.payload.user.nickname, "新昵称Alice");
    const newCookie = String(profRes.headers["Set-Cookie"] || "").split(";")[0];
    assert.ok(newCookie.includes("as_qb_user="));

    const meRes = await callRoute("GET", "/api/user/me", {}, { cookie: newCookie });
    assert.equal(meRes.payload.user.nickname, "新昵称Alice");

    const admNick = await callRoute("PUT", `/api/admin/users/${user.id}/profile`, { nickname: "管理员改名" });
    assert.equal(admNick.status, 200);
    assert.equal(admNick.payload.user.nickname, "管理员改名");

    userStore.saveBankProgress(user.id, bank.id, { records: { q1: { selected: ["A"], correct: true } } }, { answered: 1, correct: 1, questionId: "q1" });
    assert.equal(Object.keys(userStore.loadProgress(user.id).banks).length, 1);
    const clrRes = await callRoute("DELETE", `/api/admin/users/${user.id}/progress`);
    assert.equal(clrRes.status, 200);
    assert.deepEqual(userStore.loadProgress(user.id), { banks: {}, dailyStats: {} });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("考试复制、单条/批量删除交卷与全班高频错题统计清理正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-crud-exam-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const callRoute = makeRouteCaller({ store, userStore, examStore, dataDir: tmpDir });

    const { bank } = store.createBank({ name: "考试CRUD库" });
    store.importQuestions(bank.id, [
      { id: "q1", title: "1+1=?", type: "0", options: ["1", "2"], answers: ["2"] },
      { id: "q2", title: "2+2=?", type: "0", options: ["3", "4"], answers: ["4"] }
    ]);
    const pool = store.loadBankQuestions(bank.id);
    const { exam } = examStore.createExam({
      title: "限考测验", bankId: bank.id, durationMinutes: 15, maxAttempts: 1, selectedQuestionIds: ["q1", "q2"]
    }, pool);

    const { user } = userStore.register({ username: "bob", password: "123456", nickname: "Bob" });
    const bobCookie = buildUserCookie(createUserToken(user), false).split(";")[0];

    const sub1 = await callRoute("POST", `/api/exams/${exam.id}/submit`, { studentName: "Bob", answers: { q1: ["2"], q2: ["4"] } }, { cookie: bobCookie });
    assert.equal(sub1.status, 200);
    const subBlocked = await callRoute("POST", `/api/exams/${exam.id}/submit`, { studentName: "Bob", answers: {} }, { cookie: bobCookie });
    assert.equal(subBlocked.status, 400);

    const delSub = await callRoute("DELETE", `/api/exams/${exam.id}/submissions/${sub1.payload.submission.id}`);
    assert.equal(delSub.status, 200);
    const subRetry = await callRoute("POST", `/api/exams/${exam.id}/submit`, { studentName: "Bob", answers: { q1: ["2"] } }, { cookie: bobCookie });
    assert.equal(subRetry.status, 200);

    const dupRes = await callRoute("POST", `/api/exams/${exam.id}/duplicate`);
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.payload.exam.title, "限考测验（副本）");
    assert.equal(examStore.getSubmissions(dupRes.payload.exam.id).length, 0);

    const clrRes = await callRoute("DELETE", `/api/exams/${exam.id}/submissions`);
    assert.equal(clrRes.status, 200);
    assert.equal(clrRes.payload.removed, 1);

    userStore.saveBankProgress(user.id, bank.id, { wrongIds: ["q1", "q2"] }, { answered: 1, correct: 0, questionId: "q1" });
    userStore.saveBankProgress(user.id, bank.id, { wrongIds: ["q1", "q2"] }, { answered: 1, correct: 0, questionId: "q2" });
    assert.equal(userStore.getStatsAndLeaderboard().hotWrongQuestions.length, 2);
    await callRoute("DELETE", `/api/admin/wrong-stats?bankId=${bank.id}&questionId=q1`);
    assert.equal(userStore.getStatsAndLeaderboard().hotWrongQuestions.length, 1);
    await callRoute("DELETE", "/api/admin/wrong-stats");
    assert.equal(userStore.getStatsAndLeaderboard().hotWrongQuestions.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SQLite 备份导出与热恢复校验、回滚及快照保留正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-crud-restore-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const callRoute = makeRouteCaller({ store, userStore, examStore, dataDir: tmpDir });

    const baseCount = store.listBanks().length;
    const { bank } = store.createBank({ name: "备份原始题库" });
    store.importQuestions(bank.id, [{ id: "q-orig", title: "原始题", type: "0", options: ["对", "错"], answers: ["对"] }]);
    const backupBuf = createBackupBuffer(tmpDir);

    store.createBank({ name: "误操作新增题库" });
    assert.equal(store.listBanks().length, baseCount + 2);

    const badRes = await callRoute("POST", "/api/admin/db/restore", { base64: Buffer.from("invalid-data").toString("base64") });
    assert.equal(badRes.status, 400);

    const okRes = await callRoute("POST", "/api/admin/db/restore", { base64: backupBuf.toString("base64") });
    assert.equal(okRes.status, 200);
    assert.equal(store.listBanks().length, baseCount + 1);
    assert.equal(store.listBanks().some((b) => b.name === "备份原始题库"), true);
    assert.equal(store.listBanks().some((b) => b.name === "误操作新增题库"), false);
    assert.equal(fs.existsSync(path.join(tmpDir, "question-bank.pre-restore.db")), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildExcelTemplateBuffer, parseExcelBase64 } from "./lib/doc-import.mjs";
import { createUserToken, isAdminRequest } from "./lib/auth.mjs";
import { createBackupBuffer, getDatabaseStats, getDb, maintainDatabase } from "./lib/db.mjs";
import { createExamStore, scoreQuestionAnswer } from "./lib/exam-store.mjs";
import { handleExtraRoutes } from "./lib/extra-routes.mjs";
import { handleLegacyRoutes } from "./lib/legacy-routes.mjs";
import { createStore } from "./lib/store.mjs";
import { checkRemoteUpdate, getSystemStatus, pullRemoteUpdate } from "./lib/system-updater.mjs";
import { createUserStore } from "./lib/user-store.mjs";
import { CLEAN_TOOLS, parseExamTextDetailed } from "./public/exam-parse.js";
import { buildInteractionHtml, isAnswerCorrect, isMultiChoice } from "./public/js/views/practice-templates.js";

test("parseExamTextDetailed 支持括号答案、选项内标正确答案与解析提取", () => {
  const raw = `单选题
1.绿色植物释放氧气主要是因为（B）
A. 呼吸作用
B. 光合作用
C. 蒸腾作用
解析：光合作用产生氧气。

多选题
2.下列属于可再生能源的是
A. 煤炭
B. 太阳能（正确答案）
C. 风能（正确答案）
`;
  const { questions, errors } = parseExamTextDetailed(raw, { chapter: "第一章" });
  assert.equal(errors.length, 0);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0].answers, ["光合作用"]);
  assert.equal(questions[0].analysis, "光合作用产生氧气。");
  assert.equal(questions[0].chapter, "第一章");
  assert.deepEqual(questions[1].answers, ["太阳能", "风能"]);
});

test("parseExamTextDetailed 能捕获无答案题目报错", () => {
  const raw = `1.这是一道没有答案的题
A. 选项一
B. 选项二`;
  const { questions, errors } = parseExamTextDetailed(raw);
  assert.equal(questions.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "试题没有答案");

  const indef = parseExamTextDetailed("不定项选择题\n1.测试不定项（AC）\nA. 一\nB. 二\nC. 三");
  assert.equal(indef.questions[0].type, "5");
});

test("CLEAN_TOOLS 支持文末答案回填、1-5 ABCDE 转换与横排选项", () => {
  const dirty = "1.中国的首都是___\nA.上海 B.北京\n参考答案：\n1.B";
  const cleaned = CLEAN_TOOLS.autoFormat(dirty);
  assert.ok(cleaned.includes("（）"));
  assert.ok(cleaned.includes("\nB.北京"));
  assert.ok(cleaned.includes("答案:B"));
  assert.equal(CLEAN_TOOLS.expandCompactAnswers("1-3 ABC"), "1.A 2.B 3.C");
});

test("Excel 模板生成与解析正常", () => {
  const buf = buildExcelTemplateBuffer();
  const parsed = parseExcelBase64(buf.toString("base64"));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions[0].chapter, "生物基础");
});

test("多选漏选与填空按空计分逻辑正确", () => {
  const multiQ = { type: "1", answers: ["太阳能", "风能"] };
  assert.equal(scoreQuestionAnswer(multiQ, ["太阳能"], { multiPartialScore: true }).ratio, 0.5);
  assert.equal(scoreQuestionAnswer(multiQ, ["太阳能", "煤炭"], { multiPartialScore: true }).ratio, 0);

  const fillQ = { type: "2", answers: ["北京", "上海"] };
  assert.equal(scoreQuestionAnswer(fillQ, ["北京", "深圳"], { fillPartialScore: true }).ratio, 0.5);
});

test("store、userStore 与 examStore 核心流程正常", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "as-qb-test-"));
  try {
    fs.writeFileSync(
      path.join(tmpDir, "questions.json"),
      JSON.stringify([{ title: "旧题", type: "0", options: ["A1", "B1"], answers: ["A1"] }]),
      "utf8"
    );
    const store = createStore(tmpDir);
    const { bank } = store.createBank({ name: "计算机基础", folder: "专业课" });
    store.importQuestions(bank.id, [
      { id: "q1", title: "HTTP 默认端口", type: "2", options: [], answers: ["80"] }
    ]);
    const found = store.searchQuestions({ query: "80", bankId: bank.id });
    assert.equal(found.length, 1);

    const userStore = createUserStore(tmpDir);
    const reg = userStore.register({ username: "student1", password: "pass1234", nickname: "小李" });
    assert.ok(reg.user.id);
    userStore.saveBankProgress(reg.user.id, bank.id, { records: { q1: { correct: true } } }, { answered: 1, correct: 1 });
    const stats = userStore.getStatsAndLeaderboard(reg.user.id);
    assert.equal(stats.leaderboard[0].nickname, "小李");

    const examStore = createExamStore(tmpDir);
    const { exam } = examStore.createExam({ title: "期中测试", bankId: bank.id, questionCount: 1 }, store.loadBankQuestions(bank.id));
    const { submission } = examStore.submitExam(exam.id, { studentName: "张三", answers: { [exam.questionIds[0]]: ["80"] } });
    assert.equal(submission.score, 100);
    assert.equal(submission.passed, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("X-API-Key 与 Bearer API Key 鉴权正常", () => {
  const key = "ak_test_secret_123";
  assert.equal(isAdminRequest({ headers: { "x-api-key": key } }, key), true);
  assert.equal(isAdminRequest({ headers: { authorization: `Bearer ${key}` } }, key), true);
  assert.equal(isAdminRequest({ headers: { "x-api-key": "wrong" } }, key), false);
});

test("不定项选择与简答题前端模板及计分逻辑正常", () => {
  const indefQ = { id: "q5", type: "5", options: ["选项A", "选项B", "选项C"], answers: ["选项A", "选项C"] };
  assert.equal(isMultiChoice(indefQ), true);
  assert.equal(isAnswerCorrect(indefQ, ["选项C", "选项A"]), true);
  assert.equal(scoreQuestionAnswer(indefQ, ["选项A"], { multiPartialScore: true }).ratio, 0.5);

  const html = buildInteractionHtml({
    q: indefQ,
    opts: indefQ.options,
    record: null,
    multiDraft: new Set(["选项A"]),
    showAnswerNow: false,
    examSession: null
  });
  assert.ok(html.includes("确认不定项答案"));

  const essayHtml = buildInteractionHtml({
    q: { id: "q4", type: "4", options: [], answers: ["核心要点"] },
    opts: [],
    record: null,
    multiDraft: new Set(),
    showAnswerNow: false,
    examSession: null
  });
  assert.ok(essayHtml.includes("essay-input"));

  const reciteEssayHtml = buildInteractionHtml({
    q: { id: "q4", type: "4", options: [], answers: ["#### 核心要点"] },
    opts: [],
    record: null,
    multiDraft: new Set(),
    showAnswerNow: true,
    examSession: null
  });
  assert.equal(reciteEssayHtml, "");

  const selfEssayHtml = buildInteractionHtml({
    q: { id: "q4", type: "4", options: [], answers: ["#### 核心要点"] },
    opts: [],
    record: { selected: ["我的思路"] },
    multiDraft: new Set(),
    showAnswerNow: true,
    examSession: null
  });
  assert.ok(selfEssayHtml.includes("我的思路"));
});

test("油猴兼容接口：本机归档、模糊搜题、探测与公网写保护正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-legacy-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const callLegacy = async (method, pathname, body = {}, remoteAddress = "127.0.0.1", headers = {}) => {
      let captured = null;
      const req = { method, headers, socket: { remoteAddress } };
      const res = {};
      const url = new URL(`http://127.0.0.1:8787${pathname}`);
      await handleLegacyRoutes(req, res, url, {
        store,
        userStore,
        readBody: async () => body,
        sendJson: (_res, status, payload) => { captured = { status, payload }; },
        sendDownload: (_res, filename, payload) => { captured = { status: 200, filename, payload }; },
        template: { questions: [] }
      });
      return captured;
    };

    // 公网未授权写入应拦截
    const blocked = await callLegacy("POST", "/questions", { title: "测试题", answers: ["对"] }, "203.0.113.10");
    assert.equal(blocked.status, 401);

    // 本机油猴免密自动归档到 default 题库
    const saved = await callLegacy("POST", "/questions", {
      title: "1. 绿色植物在光照下释放氧气主要是因为？",
      type: "单选题",
      options: ["呼吸作用", "光合作用"],
      answers: ["B"],
      skipIfExists: true
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.created, true);
    assert.deepEqual(saved.payload.data.answer, ["光合作用"]);

    // 模糊搜题命中（忽略序号与标点微差）
    const searched = await callLegacy("POST", "/search", {
      question: "绿色植物在光照下释放氧气，主要是因为",
      type: "单选题"
    });
    assert.equal(searched.payload.code, 200);
    assert.deepEqual(searched.payload.data.answer, ["光合作用"]);

    // 加密题库不应被公开油猴搜题泄露
    const { bank: secretBank } = store.createBank({ name: "机密库", password: "secret" });
    store.upsertQuestion(secretBank.id, { title: "内部绝密考题不可泄露", type: "2", answers: ["机密答案"] });
    const secretHit = await callLegacy("POST", "/search", { question: "内部绝密考题不可泄露" });
    assert.equal(secretHit.payload.code, 10003);

    // 批量 probe 探测
    const probed = await callLegacy("POST", "/probe", {
      questions: [{ title: "绿色植物在光照下释放氧气主要是因为" }, { title: "完全不存在的题目xyz" }]
    });
    assert.equal(probed.payload.hitCount, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("加密题库 Excel 导出需登录且校验访问密码", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-export-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const { bank } = store.createBank({ name: "加密真题", password: "8888" });
    store.upsertQuestion(bank.id, { title: "真题1", type: "2", answers: ["答案1"] });
    const { user } = userStore.register({ username: "stu_a", password: "1234" });
    const cookie = `as_qb_user=${encodeURIComponent(createUserToken(user))}`;

    const callExcel = async (headers = {}, query = "") => {
      let result = null;
      const req = { method: "GET", headers };
      const res = {
        writeHead: (status, h) => { result = { status, headers: h }; },
        end: (buf) => { if (result) result.buf = buf; }
      };
      const url = new URL(`http://127.0.0.1:8787/api/banks/${bank.id}/export.xlsx${query}`);
      await handleExtraRoutes(req, res, url, {
        store,
        userStore,
        examStore,
        uploadsDir: tmpDir,
        readBody: async () => ({}),
        sendJson: (_r, status, payload) => { result = { status, payload }; },
        requireAdmin: () => false
      });
      return result;
    };

    const guestRes = await callExcel({});
    assert.equal(guestRes.status, 401);

    const lockedRes = await callExcel({ cookie });
    assert.equal(lockedRes.status, 403);
    assert.equal(lockedRes.payload.locked, true);

    const okRes = await callExcel({ cookie, "x-bank-password": "8888" });
    assert.equal(okRes.status, 200);
    assert.ok(Buffer.isBuffer(okRes.buf) && okRes.buf.length > 100);

    // 校验考试接口脱敏 accessCode 与未登录拦截考卷拉取
    const { exam } = examStore.createExam({ title: "防作弊考", bankId: bank.id, accessCode: "9527" }, store.loadBankQuestions(bank.id));
    let listOut = null;
    await handleExtraRoutes({ method: "GET", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/exams"), {
      store, userStore, examStore, uploadsDir: tmpDir, readBody: async () => ({}),
      sendJson: (_r, status, payload) => { listOut = { status, payload }; }, requireAdmin: () => false
    });
    assert.equal(listOut.payload.exams[0].accessCode, undefined);
    assert.equal(listOut.payload.exams[0].hasAccessCode, true);

    let detailGuest = null;
    await handleExtraRoutes({ method: "GET", headers: {} }, {}, new URL(`http://127.0.0.1:8787/api/exams/${exam.id}?code=9527`), {
      store, userStore, examStore, uploadsDir: tmpDir, readBody: async () => ({}),
      sendJson: (_r, status, payload) => { detailGuest = { status, payload }; }, requireAdmin: () => false
    });
    assert.equal(detailGuest.status, 401);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("精细化组卷、时间窗/限考次数、隐藏答案、简答题人工阅卷与高频错题正常", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-adv-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);

    const { bank: pubBank } = store.createBank({ name: "公开模拟库" });
    store.importQuestions(pubBank.id, [
      { id: "s1", title: "单选1", type: "0", options: ["A", "B"], answers: ["A"], chapter: "第一章" },
      { id: "e1", title: "简答1", type: "4", options: [], answers: ["核心要点"], chapter: "第二章" }
    ]);
    const { bank: secBank } = store.createBank({ name: "私有密库", password: "123" });
    store.importQuestions(secBank.id, [
      { id: "p1", title: "加密错题不可泄露", type: "0", options: ["X", "Y"], answers: ["X"] }
    ]);

    const { user } = userStore.register({ username: "stu_hot", password: "1234", nickname: "测试同学" });
    userStore.saveBankProgress(user.id, pubBank.id, { records: { s1: { correct: false } }, wrongIds: ["s1"] }, {
      answered: 1, correct: 0, questionId: "s1"
    });
    userStore.saveBankProgress(user.id, secBank.id, { records: { p1: { correct: false } }, wrongIds: ["p1"] }, {
      answered: 1, correct: 0, questionId: "p1"
    });

    const { hotWrongQuestions } = userStore.getStatsAndLeaderboard(user.id);
    assert.equal(hotWrongQuestions.length, 1);
    assert.equal(hotWrongQuestions[0].questionId, "s1");

    // 按题型抽题配分 + 限考 1 次 + 隐藏答案
    const { exam } = examStore.createExam({
      title: "精细组卷测试",
      bankId: pubBank.id,
      typeConfig: { "0": { count: 1, score: 4 }, "4": { count: 1, score: 10 } },
      maxAttempts: 1,
      showAnswerAfterSubmit: false
    }, store.loadBankQuestions(pubBank.id));
    assert.equal(exam.totalScore, 14);
    assert.equal(exam.passScore, 8);

    const subRes = examStore.submitExam(exam.id, {
      userId: user.id,
      studentName: "测试同学",
      answers: { s1: ["A"], e1: ["随便写"] }
    });
    assert.equal(subRes.submission.score, 4);
    assert.equal(subRes.submission.manualGraded, false);
    assert.equal(subRes.submission.details[0].answerHidden, true);
    assert.deepEqual(subRes.submission.details[0].expected, []);

    // 限考 1 次拦截第 2 次提交
    const secondTry = examStore.submitExam(exam.id, {
      userId: user.id,
      studentName: "测试同学",
      answers: { s1: ["A"], e1: ["核心要点"] }
    });
    assert.ok(secondTry.error.includes("最多允许参加 1 次"));

    // 管理员人工阅卷简答题给 8 分 -> 总分 4 + 8 = 12 >= 8 及格
    const graded = examStore.gradeSubmission(exam.id, subRes.submission.id, { e1: 8 });
    assert.equal(graded.submission.score, 12);
    assert.equal(graded.submission.passed, true);
    assert.equal(graded.submission.manualGraded, true);

    // 未来时间窗拦截
    const futureExam = examStore.createExam({
      title: "未开考",
      bankId: pubBank.id,
      selectedQuestionIds: ["s1"],
      startTime: new Date(Date.now() + 3600 * 1000).toISOString()
    }, store.loadBankQuestions(pubBank.id)).exam;
    assert.ok(examStore.checkExamEligibility(futureExam, user.id).error.includes("尚未开始"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("system-updater 支持状态读取、检查远端更新、ff-only 拉取及脏工作区拦截", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-git-"));
  const remoteDir = path.join(baseDir, "remote.git");
  const workDir = path.join(baseDir, "work");
  const seedDir = path.join(baseDir, "seed");
  const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "pipe" }).toString("utf8");
  try {
    run("git", ["init", "--bare", remoteDir], baseDir);
    run("git", ["clone", remoteDir, seedDir], baseDir);
    run("git", ["config", "user.email", "test@example.com"], seedDir);
    run("git", ["config", "user.name", "Tester"], seedDir);
    fs.writeFileSync(path.join(seedDir, "README.md"), "v1\n");
    run("git", ["add", "."], seedDir);
    run("git", ["commit", "-m", "init v1"], seedDir);
    run("git", ["push", "-u", "origin", "HEAD"], seedDir);

    run("git", ["clone", remoteDir, workDir], baseDir);

    // 在 seed 仓库推送第二个提交
    fs.writeFileSync(path.join(seedDir, "README.md"), "v2\n");
    run("git", ["commit", "-am", "patch v2"], seedDir);
    run("git", ["push"], seedDir);

    const statusBefore = await getSystemStatus(workDir);
    assert.equal(statusBefore.isGitRepo, true);
    assert.equal(statusBefore.dirty, false);

    const check = await checkRemoteUpdate(workDir);
    assert.equal(check.behindCount, 1);
    assert.equal(check.commits[0].message, "patch v2");

    // 制造未提交脏修改时应拒绝拉取
    fs.writeFileSync(path.join(workDir, "README.md"), "local dirty\n");
    const dirtyRes = await pullRemoteUpdate(workDir);
    assert.ok(dirtyRes.error.includes("未提交"));

    // 清理工作区后应正常 ff-only 拉取成功
    run("git", ["checkout", "--", "README.md"], workDir);
    const pullRes = await pullRemoteUpdate(workDir);
    assert.equal(pullRes.ok, true);
    assert.equal(pullRes.updated, true);
    assert.equal(fs.readFileSync(path.join(workDir, "README.md"), "utf8").trim(), "v2");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("学员改密码、我的成绩单、管理员账号管理、数据库备份与 PM2 路径配置正常", async () => {
  const ecoMod = await import("node:module");
  const require = ecoMod.createRequire(import.meta.url);
  const eco = require("./deploy/ecosystem.config.cjs");
  assert.equal(fs.existsSync(path.resolve(eco.apps[0].cwd, eco.apps[0].script)), true);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-polish-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);

    const { user: adm } = userStore.register({ username: "rootadm", password: "adm123", role: "admin" });
    const { user: stu } = userStore.register({ username: "stu_x", password: "1234", nickname: "小王" });

    assert.ok(userStore.changePassword(stu.id, { oldPassword: "wrong", newPassword: "9999" }).error);
    assert.equal(userStore.changePassword(stu.id, { oldPassword: "1234", newPassword: "5678" }).ok, true);
    assert.equal(userStore.authenticate({ username: "stu_x", password: "5678" }).user.id, stu.id);

    // 至少保留一个管理员防降级/防删除
    assert.ok(userStore.adminUpdateRole(adm.id, "student").error);
    assert.ok(userStore.adminDeleteUser(adm.id, stu.id).error);
    assert.ok(userStore.adminDeleteUser(adm.id, adm.id).error);
    assert.equal(userStore.adminResetPassword(stu.id, "abcd").ok, true);
    assert.equal(userStore.listUsers().length, 2);

    // 校验 POST /api/admin/users 新建账号路由
    let createdAdm = null;
    await handleExtraRoutes({ method: "POST", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/admin/users"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({ username: "sub_admin", password: "pw1234", nickname: "助教", role: "admin" }),
      sendJson: (_r, status, payload) => { createdAdm = { status, payload }; },
      requireAdmin: () => true
    });
    assert.equal(createdAdm.status, 200);
    assert.equal(createdAdm.payload.user.role, "admin");
    assert.equal(userStore.listUsers().length, 3);

    const { bank } = store.createBank({ name: "成绩查询库" });
    store.importQuestions(bank.id, [{ id: "q1", title: "测试题1", type: "2", answers: ["答案1"] }]);
    const { exam } = examStore.createExam({
      title: "期末考",
      bankId: bank.id,
      selectedQuestionIds: ["q1"],
      showAnswerAfterSubmit: false
    }, store.loadBankQuestions(bank.id));
    examStore.submitExam(exam.id, { userId: stu.id, studentName: "小王", answers: { q1: ["答案1"] } });
    const mySubs = examStore.getUserSubmissions(stu.id);
    assert.equal(mySubs.length, 1);
    assert.equal(mySubs[0].examTitle, "期末考");
    assert.equal(mySubs[0].details[0].answerHidden, true);

    // 校验 /api/admin/backup.db 权限拦截与有效 SQLite 文件头
    let guestBackup = null;
    await handleExtraRoutes({ method: "GET", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/admin/backup.db"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({}), sendJson: (_r, status, payload) => { guestBackup = { status, payload }; },
      requireAdmin: (_r, res) => { guestBackup = { status: 401 }; return false; }
    });
    assert.equal(guestBackup.status, 401);

    let okBackup = null;
    await handleExtraRoutes({ method: "GET", headers: {} }, {
      writeHead: (status, h) => { okBackup = { status, h }; },
      end: (buf) => { okBackup.buf = buf; }
    }, new URL("http://127.0.0.1:8787/api/admin/backup.db"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({}), sendJson: () => {}, requireAdmin: () => true
    });
    assert.equal(okBackup.status, 200);
    assert.ok(okBackup.buf.subarray(0, 15).toString("utf8").startsWith("SQLite format 3"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("数据库 WAL 模式、高频索引、删库删题级联清理、原子备份与一键维护正常", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-db-opt-"));
  const uploadsDir = path.join(tmpDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const db = getDb(tmpDir);

    const stats = getDatabaseStats(tmpDir, uploadsDir);
    assert.equal(stats.journalMode, "WAL");

    const idxNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    for (const expectedIdx of ["idx_questions_bank_type_chap", "idx_subs_user", "idx_subs_exam_user", "idx_wrong_stats_rank"]) {
      assert.ok(idxNames.includes(expectedIdx), `缺少索引 ${expectedIdx}`);
    }

    const { bank: b1 } = store.createBank({ name: "题库A" });
    const { bank: b2 } = store.createBank({ name: "题库B" });
    fs.writeFileSync(path.join(uploadsDir, "keep.png"), "img1");
    fs.writeFileSync(path.join(uploadsDir, "orphan.png"), "img2");

    store.importQuestions(b1.id, [
      { id: "qa1", title: "保留图题", type: "0", options: ["A", "B"], answers: ["A"], images: ["/uploads/keep.png"] },
      { id: "qa2", title: "待删错题", type: "0", options: ["A", "B"], answers: ["A"] }
    ]);
    store.importQuestions(b2.id, [{ id: "qb1", title: "库B题", type: "0", options: ["A", "B"], answers: ["A"] }]);

    const { user } = userStore.register({ username: "db_stu", password: "1234" });
    userStore.saveBankProgress(user.id, b1.id, { wrongIds: ["qa2"] }, { answered: 1, correct: 0, questionId: "qa2" });
    userStore.saveBankProgress(user.id, b2.id, { wrongIds: ["qb1"] }, { answered: 1, correct: 0, questionId: "qb1" });

    // 删除单题 qa2 时自动级联清理 question_wrong_stats
    store.deleteQuestion(b1.id, "qa2");
    assert.equal(db.prepare("SELECT COUNT(*) AS cnt FROM question_wrong_stats WHERE question_id = 'qa2'").get().cnt, 0);

    // 删除题库 b2 时自动级联清理 user_progress 与 question_wrong_stats
    store.deleteBank(b2.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS cnt FROM user_progress WHERE bank_id = ?").get(b2.id).cnt, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS cnt FROM question_wrong_stats WHERE bank_id = ?").get(b2.id).cnt, 0);

    // 人为制造孤立记录测试一键维护 + 孤立图片回收
    db.prepare("INSERT INTO user_progress (user_id, bank_id, data_json, updated_at) VALUES (?, 'ghost_bank', '{}', ?)").run(user.id, new Date().toISOString());
    db.prepare("INSERT INTO question_wrong_stats (bank_id, question_id, wrong_count, attempt_count, updated_at) VALUES ('ghost_bank', 'ghost_q', 3, 3, ?)").run(new Date().toISOString());

    const mRes = maintainDatabase(tmpDir, uploadsDir);
    assert.equal(mRes.removedProgress, 1);
    assert.equal(mRes.removedWrongStats, 1);
    assert.equal(mRes.removedImages, 1);
    assert.equal(fs.existsSync(path.join(uploadsDir, "keep.png")), true);
    assert.equal(fs.existsSync(path.join(uploadsDir, "orphan.png")), false);

    const bakBuf = createBackupBuffer(tmpDir);
    assert.ok(bakBuf.subarray(0, 15).toString("utf8").startsWith("SQLite format 3"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("公网注册门禁与已发布考试轻量编辑正常且不泄露敏感口令", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qh-gate-edit-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);

    // 1. 注册门禁策略测试：open / invite / closed
    assert.equal(userStore.getRegistrationPolicy().mode, "open");
    assert.ok(userStore.setRegistrationPolicy({ mode: "invite", inviteCode: "" }).error);

    let setRes = null;
    await handleExtraRoutes({ method: "PUT", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/admin/registration"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({ mode: "invite", inviteCode: "CLASS2026" }),
      sendJson: (_r, status, payload) => { setRes = { status, payload }; },
      requireAdmin: () => true
    });
    assert.equal(setRes.status, 200);
    assert.equal(setRes.payload.mode, "invite");

    // /api/user/me 仅暴露 registrationMode，绝不泄露 inviteCode
    let meRes = null;
    await handleExtraRoutes({ method: "GET", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/user/me"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({}), sendJson: (_r, status, payload) => { meRes = { status, payload }; },
      requireAdmin: () => false
    });
    assert.equal(meRes.payload.registrationMode, "invite");
    assert.equal(meRes.payload.inviteCode, undefined);

    // 公开注册错误邀请码拦截，正确邀请码放行
    let badReg = null;
    await handleExtraRoutes({ method: "POST", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/user/register"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({ username: "gate_u1", password: "pw1234", inviteCode: "WRONG" }),
      sendJson: (_r, status, payload) => { badReg = { status, payload }; },
      requireAdmin: () => false
    });
    assert.equal(badReg.status, 403);

    let okReg = null;
    await handleExtraRoutes({ method: "POST", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/user/register"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({ username: "gate_u1", password: "pw1234", inviteCode: "CLASS2026" }),
      sendJson: (_r, status, payload) => { okReg = { status, payload }; },
      requireAdmin: () => false
    });
    assert.equal(okReg.status, 200);

    // closed 模式下公开注册被拦截，但管理员手动创建账号不受限制
    userStore.setRegistrationPolicy({ mode: "closed" });
    let closedReg = null;
    await handleExtraRoutes({ method: "POST", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/user/register"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({ username: "gate_u2", password: "pw1234" }),
      sendJson: (_r, status, payload) => { closedReg = { status, payload }; },
      requireAdmin: () => false
    });
    assert.equal(closedReg.status, 403);
    assert.ok(userStore.register({ username: "adm_added", password: "pw1234" }).user);

    // 2. 已发布考试轻量编辑测试
    const { bank } = store.createBank({ name: "微调测试库" });
    store.importQuestions(bank.id, [{ id: "q1", title: "测试题1", type: "0", options: ["A", "B"], answers: ["A"] }]);
    const { exam } = examStore.createExam({
      title: "初版考试",
      bankId: bank.id,
      durationMinutes: 20,
      accessCode: "OLD123",
      selectedQuestionIds: ["q1"],
      questionScores: { q1: 10 }
    }, store.loadBankQuestions(bank.id));
    examStore.submitExam(exam.id, { userId: okReg.payload.user.id, studentName: "王同学", answers: { q1: ["A"] } });

    let editRes = null;
    await handleExtraRoutes({ method: "PUT", headers: {} }, {}, new URL(`http://127.0.0.1:8787/api/exams/${exam.id}`), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({
        title: "修订版考试",
        durationMinutes: 45,
        accessCode: "NEW456",
        maxAttempts: 2,
        showAnswerAfterSubmit: false
      }),
      sendJson: (_r, status, payload) => { editRes = { status, payload }; },
      requireAdmin: () => true
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.payload.exam.title, "修订版考试");
    assert.equal(editRes.payload.exam.durationMinutes, 45);
    assert.equal(editRes.payload.exam.totalScore, 10);
    assert.equal(editRes.payload.exam.questionsSnapshot.length, 1);
    assert.equal(examStore.getSubmissions(exam.id).length, 1);

    // 非管理员 GET /api/exams 必须剥离 accessCode
    let guestList = null;
    await handleExtraRoutes({ method: "GET", headers: {} }, {}, new URL("http://127.0.0.1:8787/api/exams"), {
      store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
      readBody: async () => ({}), sendJson: (_r, status, payload) => { guestList = { status, payload }; },
      requireAdmin: () => false
    });
    assert.equal(guestList.payload.exams[0].hasAccessCode, true);
    assert.equal(guestList.payload.exams[0].accessCode, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("学期科目管理：创建/改名同步/删除安全解绑及题库性质字段正常", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-subject-test-"));
  try {
    const store = createStore(tmpDir);
    const userStore = createUserStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const callRoute = async (method, urlPath, body = {}) => {
      let result = null;
      await handleExtraRoutes({ method, headers: {} }, {}, new URL(`http://127.0.0.1:8787${urlPath}`), {
        store, userStore, examStore, dataDir: tmpDir, uploadsDir: tmpDir,
        readBody: async () => body,
        sendJson: (_r, status, payload) => { result = { status, payload }; },
        requireAdmin: () => true
      });
      return result;
    };

    const createdSub = await callRoute("POST", "/api/subjects", {
      name: "操作系统", term: "2026 春", examDate: "2026-06-20", description: "核心专业课"
    });
    assert.equal(createdSub.status, 200);
    const subId = createdSub.payload.subject.id;

    const { bank } = store.createBank({ name: "PV 实操题库", subjectId: subId, category: "practice" });
    store.importQuestions(bank.id, [{ title: "信号量 PV 操作", type: "4", answers: ["P(s) V(s)"] }]);
    assert.equal(bank.subjectId, subId);
    assert.equal(bank.category, "practice");
    assert.equal(bank.subjectName, "操作系统");
    assert.equal(bank.term, "2026 春");

    const updatedSub = await callRoute("PUT", `/api/subjects/${subId}`, { name: "操作系统原理", term: "2026 春" });
    assert.equal(updatedSub.status, 200);
    assert.equal(store.getBank(bank.id).subjectName, "操作系统原理");
    assert.equal(store.getBank(bank.id).folder, "操作系统原理");

    const listRes = await callRoute("GET", "/api/subjects");
    assert.equal(listRes.payload.subjects.length, 1);
    assert.equal(listRes.payload.subjects[0].bankCount, 1);
    assert.equal(listRes.payload.subjects[0].questionCount, 1);

    const delRes = await callRoute("DELETE", `/api/subjects/${subId}`);
    assert.equal(delRes.status, 200);
    const afterBank = store.getBank(bank.id);
    assert.ok(afterBank);
    assert.equal(afterBank.subjectId, "");
    assert.equal(afterBank.questionCount, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("实操题答案图分离持久化、排序/配对拖动判分与考试主观题人工核分标记正常", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-drag-test-"));
  try {
    const store = createStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const { bank } = store.createBank({ name: "实践与拖动测试库", category: "practice" });
    store.importQuestions(bank.id, [
      { id: "q-prac", type: "6", title: "画出流程图", answers: ["开始 -> 结束"], answerImages: ["/uploads/flow.svg"] },
      { id: "q-order", type: "7", title: "步骤排序", answers: ["第一步", "第二步", "第三步"] },
      { id: "q-match", type: "8", title: "控件配对", answers: ["txt => TextBox", "btn => Button"] }
    ]);

    const loaded = store.loadBankQuestions(bank.id);
    assert.deepEqual(loaded[0].answerImages, ["/uploads/flow.svg"]);
    assert.equal(isAnswerCorrect(loaded[1], ["第一步", "第二步", "第三步"]), true);
    assert.equal(isAnswerCorrect(loaded[1], ["第二步", "第一步", "第三步"]), false);
    assert.equal(isAnswerCorrect(loaded[2], ["btn => Button", "txt => TextBox"]), true);

    assert.deepEqual(scoreQuestionAnswer(loaded[1], ["第一步", "第二步", "错"]), { correct: false, ratio: 2 / 3 });
    assert.deepEqual(scoreQuestionAnswer(loaded[2], ["txt => TextBox"]), { correct: false, ratio: 0.5 });

    const { exam } = examStore.createExam({
      title: "实践拖动测试卷", bankId: bank.id, durationMinutes: 20,
      selectedQuestionIds: ["q-prac", "q-order", "q-match"],
      questionScores: { "q-prac": 10, "q-order": 6, "q-match": 4 }
    }, loaded);
    const subRes = examStore.submitExam(exam.id, {
      studentName: "测试同学",
      answers: { "q-prac": ["我的步骤"], "q-order": ["第一步", "第二步", "第三步"], "q-match": ["txt => TextBox", "btn => Button"] }
    });
    assert.equal(subRes.submission.manualGraded, false);
    assert.equal(subRes.submission.details[0].needManual, true);
    assert.equal(subRes.submission.score, 10);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

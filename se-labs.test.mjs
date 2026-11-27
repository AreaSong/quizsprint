import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createExamStore, scoreQuestionAnswer } from "./lib/exam-store.mjs";
import { createStore } from "./lib/store.mjs";
import {
  buildSolutionPayload,
  describeLabSpec,
  gradeInteractiveLab,
  parseLabSpec
} from "./public/js/labs/lab-grader.js";
import {
  generateRandomPertGraph,
  gradePertAttempt,
  PERT_PRESETS,
  solvePertNetwork
} from "./public/js/labs/pert-core.js";
import {
  BLACKBOX_CASES,
  canMergeDecisionCols,
  DECISION_CASES,
  DFD_CHALLENGES,
  evaluateBlackboxInputs,
  evaluateWhiteboxCases,
  mergeDecisionCols,
  validateDfdGraph,
  WHITEBOX_SPEC
} from "./public/js/labs/se-lab-core.js";

globalThis.document = globalThis.document || { createElement: () => ({}) };
const { renderRichMarkdown, stripInlineImages } = await import("./public/js/markdown.js");

test("PERT 教材图 9.2 求解结果与教材完全一致且批改准确", () => {
  const sol = solvePertNetwork(PERT_PRESETS.fig92);
  assert.equal(sol.totalDuration, 15);
  assert.deepEqual(sol.criticalNodes, ["1", "2", "3", "4", "7", "10", "11"]);
  assert.deepEqual(sol.criticalEdges, ["e1_2", "e2_3", "e3_4", "e4_7", "e7_10", "e10_11"]);

  const expectedNodes = {
    1: [0, 0], 2: [2, 2], 3: [6, 6], 4: [9, 9], 5: [7, 12], 6: [7, 12],
    7: [12, 12], 8: [9, 13], 9: [8, 13], 10: [14, 14], 11: [15, 15]
  };
  for (const [id, [e, l]] of Object.entries(expectedNodes)) {
    assert.equal(sol.nodeMap[id].earliest, e, `节点 ${id} 最早时刻应为 ${e}`);
    assert.equal(sol.nodeMap[id].latest, l, `节点 ${id} 最迟时刻应为 ${l}`);
  }
  assert.equal(sol.edgeMap.e4_8.tf, 4, "虚活动 4→8 机动时间应为 4");
  assert.equal(sol.edgeMap.e3_5.tf, 5);
  assert.equal(sol.edgeMap.e8_10.tf, 4);

  const attempt = {
    nodes: Object.fromEntries(Object.entries(expectedNodes).map(([id, [earliest, latest]]) => [id, { earliest, latest }])),
    edges: Object.fromEntries(Object.entries(sol.edgeMap).map(([id, e]) => [id, { tf: e.tf }])),
    criticalEdges: sol.criticalEdges
  };
  const perfect = gradePertAttempt(sol, attempt);
  assert.equal(perfect.allCorrect, true);
  assert.equal(perfect.score, perfect.total);

  attempt.nodes["8"].earliest = 10;
  const partial = gradePertAttempt(sol, attempt);
  assert.equal(partial.allCorrect, false);
  assert.equal(partial.nodeResults["8"].eOk, false);
});

test("PERT 随机出题生成合法无环网络图并可求解", () => {
  const randGraph = generateRandomPertGraph();
  const sol = solvePertNetwork(randGraph);
  assert.equal(randGraph.nodes.length, 7);
  assert.equal(randGraph.edges.length, 8);
  assert.ok(sol.totalDuration >= 6);
  assert.ok(sol.criticalEdges.length >= 3);
});

test("DFD 校验能检出直连与黑洞/奇迹加工违规，判定表可化简合并", () => {
  const errCheck = validateDfdGraph(DFD_CHALLENGES[0].nodes, DFD_CHALLENGES[0].edges);
  assert.equal(errCheck.valid, false);
  assert.equal(errCheck.issues.length, 3);

  const okCheck = validateDfdGraph(
    [
      { id: "s1", type: "entity", label: "用户" },
      { id: "p1", type: "process", label: "1.处理" },
      { id: "d1", type: "store", label: "数据表" }
    ],
    [
      { id: "e1", from: "s1", to: "p1", label: "请求" },
      { id: "e2", from: "p1", to: "d1", label: "记录" }
    ]
  );
  assert.equal(okCheck.valid, true);

  const cols = DECISION_CASES[0].columns;
  assert.equal(canMergeDecisionCols(cols[0], cols[2]).ok, true);
  const merged = mergeDecisionCols(cols[0], cols[2]);
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.merged.conds, ["T", "-", "T"]);
  assert.equal(canMergeDecisionCols(cols[0], cols[1]).ok, false);
});

test("黑盒边界值统计与白盒经典陷阱（条件100%≠判定100%）正确", () => {
  const bbPartial = evaluateBlackboxInputs(BLACKBOX_CASES[0], [0, 50, 100]);
  assert.equal(bbPartial.eqClasses[0].hit, false);
  assert.equal(bbPartial.hitBoundaries.length, 2);

  const bbFull = evaluateBlackboxInputs(BLACKBOX_CASES[0], [-1, 0, 1, 50, 99, 100, 101]);
  assert.equal(bbFull.eqPct, 100);
  assert.equal(bbFull.boundaryPct, 100);

  const trapRes = evaluateWhiteboxCases(WHITEBOX_SPEC.trapCases);
  assert.equal(trapRes.metrics.condition, 100);
  assert.ok(trapRes.metrics.decision < 100, "经典反例满足条件覆盖 100% 但不满足判定覆盖 100%");

  const fullRes = evaluateWhiteboxCases(WHITEBOX_SPEC.fullCases);
  assert.equal(fullRes.metrics.statement, 100);
  assert.equal(fullRes.metrics.decision, 100);
  assert.equal(fullRes.metrics.condition, 100);
  assert.equal(fullRes.metrics.combo, 100);
  assert.equal(fullRes.metrics.path, 100);
});

test("Markdown ::lab 白名单语法仅渲染受信任实验按钮并拦截非法名", () => {
  const okHtml = renderRichMarkdown("复习：\n::lab[pert|打开工程网络图实验台]");
  assert.match(okHtml, /class="btn soft-active tiny js-open-se-lab" data-lab="pert"/);
  const badHtml = renderRichMarkdown("::lab[evil|危险按钮]");
  assert.doesNotMatch(badHtml, /js-open-se-lab/);
  assert.equal(stripInlineImages("请点击 ::lab[dfd|DFD实验] 练习"), "请点击 [实验] 练习");
});

test("type=9 交互实验题五大引擎统一判分、防作弊等价校验与标准解生成", () => {
  const specs = [
    { kind: "pert", preset: "fig92" },
    { kind: "dfd", mode: "challenge", challengeId: "dfd_err_1" },
    { kind: "dfd", mode: "build" },
    { kind: "decision", caseId: "shipping" },
    { kind: "blackbox", caseId: "score_0_100" },
    { kind: "whitebox", target: "trap" },
    { kind: "whitebox", target: "full" }
  ];
  for (const spec of specs) {
    const solPayload = buildSolutionPayload(spec);
    const pass = gradeInteractiveLab(spec, [JSON.stringify(solPayload)]);
    assert.equal(pass.correct, true, `${spec.kind} 标准解应判满分: ${pass.summary}`);
    assert.equal(pass.ratio, 1);
  }

  // 判定表防作弊：仅删掉几列但未覆盖全部原始真值时必须判错
  const cheatDec = gradeInteractiveLab(
    { kind: "decision", caseId: "score" },
    { columns: [DECISION_CASES[1].columns[0]] }
  );
  assert.equal(cheatDec.correct, false);
  assert.equal(cheatDec.ratio, 0);

  // 判定表含重复/重叠列时不得判满分
  const solDec = buildSolutionPayload({ kind: "decision", caseId: "score" });
  const dupDec = gradeInteractiveLab(
    { kind: "decision", caseId: "score" },
    { columns: [...solDec.columns, { ...solDec.columns[0], id: "DUP" }] }
  );
  assert.equal(dupDec.correct, false);
  assert.equal(dupDec.ratio, 0.5);

  // DFD 排错含误选时不能满分
  const dfdBad = gradeInteractiveLab(
    { kind: "dfd", challengeId: "dfd_err_1" },
    { mode: "challenge", foundIds: ["e2", "e4", "p2", "e1"] }
  );
  assert.equal(dfdBad.correct, false);

  // parseLabSpec & describeLabSpec 兼容 Question 对象
  const qSample = { type: "9", options: [JSON.stringify({ kind: "pert", preset: "fig92" })] };
  assert.equal(parseLabSpec(qSample)?.preset, "fig92");
  assert.match(describeLabSpec(qSample), /PERT\/CPM/);
});

test("store 与 exam-store 对 type=9 保留实验规格并支持考场脱敏与自动判分", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-type9-"));
  try {
    const store = createStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const { bank } = store.createBank({ name: "交互实验测试库", category: "practice" });
    const specJson = JSON.stringify({ kind: "blackbox", caseId: "pwd_6_12" });
    const res = store.upsertQuestion(bank.id, {
      title: "请为密码长度 [6, 12] 设计边界值测试用例",
      type: "9",
      options: [specJson],
      answers: ["覆盖 5, 6, 7, 9, 11, 12, 13"]
    });
    assert.equal(res.status, 200);

    const loaded = store.loadBankQuestions(bank.id);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].type, "9");
    assert.deepEqual(loaded[0].options, [specJson]);

    // 考场脱敏应保留 options（实验配置）并剥离 answers
    const sanitized = examStore.sanitizeQuestionsForExam(loaded);
    assert.equal("answers" in sanitized[0], false);
    assert.deepEqual(sanitized[0].options, [specJson]);

    // scoreQuestionAnswer & submitExam 自动判分
    const fullSol = buildSolutionPayload({ kind: "blackbox", caseId: "pwd_6_12" });
    assert.deepEqual(scoreQuestionAnswer(loaded[0], [JSON.stringify(fullSol)]), { correct: true, ratio: 1 });

    const { exam } = examStore.createExam({ title: "实验机考", bankId: bank.id, bankName: bank.name, selectedQuestionIds: [loaded[0].id], questionScores: { [loaded[0].id]: 20 } }, loaded);
    const subOk = examStore.submitExam(exam.id, { studentName: "张三", answers: { [loaded[0].id]: [JSON.stringify(fullSol)] } });
    assert.equal(subOk.submission.manualGraded, true);
    assert.equal(subOk.submission.score, 20);
    assert.equal(subOk.submission.correctCount, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

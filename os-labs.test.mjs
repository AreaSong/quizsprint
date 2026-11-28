import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createExamStore } from "./lib/exam-store.mjs";
import { createStore } from "./lib/store.mjs";
import { buildSolutionPayload, describeLabSpec, gradeInteractiveLab } from "./public/js/labs/lab-grader.js";
import {
  gradeBankerAttempt,
  OS_BANKER_CASES,
  OS_DISK_CASES,
  OS_PAGING_CASES,
  OS_SCHED_CASES,
  solveBankerCase,
  solveOsDisk,
  solveOsPaging,
  solveOsScheduling
} from "./public/js/labs/os-lab-core.js";
import { OS_MEM_CASES, solveOsMem } from "./public/js/labs/os-mem-core.js";

globalThis.document = globalThis.document || { createElement: () => ({}) };
const { renderRichMarkdown } = await import("./public/js/markdown.js");

test("OS 调度与银行家算法：甘特图、周转时间、多安全序列兼容与请求试探正确", () => {
  const rrSol = solveOsScheduling(OS_SCHED_CASES[3]);
  assert.equal(rrSol.rows.find((r) => r.id === "P1").finish, 14);
  assert.equal(rrSol.rows.find((r) => r.id === "P2").finish, 11);
  assert.equal(rrSol.rows.find((r) => r.id === "P3").finish, 13);
  assert.equal(rrSol.rows.find((r) => r.id === "P4").finish, 10);

  const bkSol = solveBankerCase(OS_BANKER_CASES[0]);
  assert.equal(bkSol.safe, true);
  assert.deepEqual(bkSol.needRows.P0, [7, 4, 3]);

  // 多个不同合法安全序列均应判满分
  const altGrade = gradeBankerAttempt(OS_BANKER_CASES[0], {
    need: bkSol.needRows,
    safe: true,
    sequence: ["P1", "P3", "P4", "P2", "P0"]
  });
  assert.equal(altGrade.allCorrect, true);

  const reqSol = solveBankerCase(OS_BANKER_CASES[1]);
  assert.equal(reqSol.safe, true);
  assert.deepEqual(reqSol.postAvail, [2, 3, 0]);
});

test("OS 页面置换、磁盘调度与存储变换/动态分区/位示图求解与纲要一致", () => {
  const fifo = solveOsPaging(OS_PAGING_CASES[0]);
  assert.equal(fifo.faultCount, 9);
  const lru = solveOsPaging(OS_PAGING_CASES[1]);
  assert.equal(lru.faultCount, 9);

  const sstf = solveOsDisk(OS_DISK_CASES[0]);
  assert.deepEqual(sstf.sequence, [65, 67, 37, 14, 98, 122, 124, 183]);
  assert.equal(sstf.totalSeek, 236);

  const cscan = solveOsDisk(OS_DISK_CASES[2]);
  assert.deepEqual(cscan.sequence, [65, 67, 98, 122, 124, 183, 14, 37]);

  const pageSol = solveOsMem(OS_MEM_CASES[0]);
  assert.equal(pageSol.physAddr, 5572);
  assert.equal(pageSol.eatNs, 250);

  const segSol = solveOsMem(OS_MEM_CASES[1]);
  assert.equal(segSol.physAddr, 8292);

  const bmSol = solveOsMem(OS_MEM_CASES[4]);
  assert.equal(bmSol.row, 3);
  assert.equal(bmSol.col, 3);
  assert.equal(bmSol.nextVal, 0);

  const bmZero = solveOsMem({ mode: "bitmap", op: "recycle", rows: 2, cols: 4, baseIndex: 0, occupied: [0, 5], targetBlock: 5 });
  assert.equal(bmZero.row, 1);
  assert.equal(bmZero.col, 1);
  assert.equal(bmZero.nextVal, 0);
});

test("OS 交互题型（type=9）全引擎统一判分、Markdown 白名单与考场自动批改", () => {
  const osSpecs = [
    { kind: "os_sched", caseId: "sched_hrrn_4" },
    { kind: "os_banker", caseId: "banker_req_p1" },
    { kind: "os_paging", caseId: "paging_lru_3" },
    { kind: "os_disk", caseId: "disk_scan_100" },
    { kind: "os_mem", caseId: "mem_page_tlb" },
    { kind: "os_mem", caseId: "mem_alloc_bf" },
    { kind: "os_mem", caseId: "mem_bitmap_recycle" }
  ];
  for (const spec of osSpecs) {
    const sol = buildSolutionPayload(spec);
    const res = gradeInteractiveLab(spec, [JSON.stringify(sol)]);
    assert.equal(res.correct, true, `${spec.kind}:${spec.caseId} 应判满分: ${res.summary}`);
    assert.equal(res.ratio, 1);
    assert.equal(res.detail?.allCorrect, true);
    assert.ok(describeLabSpec({ type: "9", options: [JSON.stringify(spec)] }).includes("OS"));
  }

  assert.match(renderRichMarkdown("::lab[os_banker|打开银行家算法实验台]"), /data-lab="os_banker"/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-os9-"));
  try {
    const store = createStore(tmpDir);
    const examStore = createExamStore(tmpDir);
    const { bank } = store.createBank({ name: "OS应用题实验库", category: "practice" });
    const spec = { kind: "os_disk", caseId: "disk_sstf_53" };
    store.upsertQuestion(bank.id, {
      title: "请使用 SSTF 完成磁盘寻道轨迹并算总寻道长度",
      type: "9",
      options: [JSON.stringify(spec)],
      answers: ["总寻道长度 236"]
    });
    const qs = store.loadBankQuestions(bank.id);
    const sol = buildSolutionPayload(spec);
    const { exam } = examStore.createExam({
      title: "OS期末机考", bankId: bank.id, bankName: bank.name,
      selectedQuestionIds: [qs[0].id], questionScores: { [qs[0].id]: 10 }
    }, qs);
    const sub = examStore.submitExam(exam.id, {
      studentName: "李四",
      answers: { [qs[0].id]: [JSON.stringify(sol)] }
    });
    assert.equal(sub.submission.manualGraded, true);
    assert.equal(sub.submission.score, 10);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

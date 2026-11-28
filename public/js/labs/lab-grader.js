/** 交互实验题（type=9）零 DOM 统一解析、参考解生成与自动判分引擎（前后端共用） */
import {
  gradeBankerAttempt,
  gradeOsDisk,
  gradeOsPaging,
  gradeOsScheduling,
  OS_BANKER_CASES,
  OS_DISK_CASES,
  OS_PAGING_CASES,
  OS_SCHED_CASES,
  solveBankerCase,
  solveOsDisk,
  solveOsPaging,
  solveOsScheduling
} from "./os-lab-core.js";
import { gradeOsMem, OS_MEM_CASES, solveOsMem } from "./os-mem-core.js";
import { gradePertAttempt, PERT_PRESETS, solvePertNetwork } from "./pert-core.js";
import {
  BLACKBOX_CASES,
  canMergeDecisionCols,
  DECISION_CASES,
  DFD_CHALLENGES,
  evaluateBlackboxInputs,
  evaluateWhiteboxCases,
  isDecisionTableMinimal,
  mergeDecisionCols,
  validateDfdGraph,
  WHITEBOX_SPEC
} from "./se-lab-core.js";

export const LAB_KIND_META = {
  pert: { name: "工程网络图 PERT/CPM", hint: "填写事件最早/最迟时刻 E/L、活动机动时间 TF 并勾选关键路径" },
  dfd: { name: "数据流图 DFD", hint: "点击图中违规节点/数据流排错，或在画布中自由构建合规 DFD" },
  decision: { name: "判定表化简", hint: "合并互补规则列并消除多余条件，将判定表化简至最简形式" },
  blackbox: { name: "黑盒等价类/边界值", hint: "输入足以覆盖全部有效/无效等价类及 6 个边界点的测试数值" },
  whitebox: { name: "白盒逻辑覆盖", hint: "编写满足目标覆盖要求的测试用例并观察控制流路径" },
  os_sched: { name: "OS 进程调度", hint: "计算完成时间、周转时间与带权周转时间，核对调度甘特图" },
  os_banker: { name: "OS 银行家算法", hint: "计算 Need 矩阵、判定安全状态并构造有效安全序列" },
  os_paging: { name: "OS 页面置换", hint: "逐拍填入物理块内页号、勾选缺页标记并统计缺页次数与缺页率" },
  os_disk: { name: "OS 磁盘调度", hint: "排出磁头移动轨迹序列并计算总寻道长度与平均寻道长度" },
  os_mem: { name: "OS 地址变换/分区/位示图", hint: "完成分页分段地址计算、动态分区分配或磁盘位示图换算" }
};

export const parseLabSpec = (qOrRaw) => {
  if (!qOrRaw) return null;
  let candidate = qOrRaw;
  if (typeof qOrRaw === "object" && !Array.isArray(qOrRaw) && "type" in qOrRaw && !("kind" in qOrRaw)) {
    candidate = qOrRaw.options?.[0];
  }
  if (Array.isArray(candidate)) candidate = candidate[0];
  let obj = candidate;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    try { obj = JSON.parse(trimmed); } catch { return null; }
  }
  if (!obj || typeof obj !== "object" || !LAB_KIND_META[obj.kind]) return null;
  return obj;
};

export const resolvePertGraph = (spec) => {
  if (spec?.graph?.nodes?.length && spec?.graph?.edges?.length) return spec.graph;
  return PERT_PRESETS[spec?.preset] || PERT_PRESETS.fig92;
};

export const resolveDfdChallenge = (spec) => {
  if (spec?.challenge?.nodes?.length) return spec.challenge;
  return DFD_CHALLENGES.find((c) => c.id === spec?.challengeId) || DFD_CHALLENGES[0];
};

export const resolveDecisionCase = (spec) => {
  if (spec?.caseDef?.conditions?.length && spec?.caseDef?.columns?.length) return spec.caseDef;
  return DECISION_CASES.find((c) => c.id === spec?.caseId) || DECISION_CASES[0];
};

export const resolveBlackboxCase = (spec) => {
  if (spec?.caseDef && Number.isFinite(Number(spec.caseDef.min)) && Number.isFinite(Number(spec.caseDef.max))) {
    return spec.caseDef;
  }
  return BLACKBOX_CASES.find((c) => c.id === spec?.caseId) || BLACKBOX_CASES[0];
};

const pickCase = (list, spec, key = "id") => spec?.caseDef || list.find((c) => c[key] === spec?.caseId) || list[0];

export const describeLabSpec = (q) => {
  const spec = parseLabSpec(q);
  if (!spec) return "未配置实验规格";
  const meta = LAB_KIND_META[spec.kind];
  if (spec.kind === "pert") return `${meta.name} · ${resolvePertGraph(spec).name || "自定义图"}`;
  if (spec.kind === "dfd") {
    return spec.mode === "build"
      ? `${meta.name} · 自由构建合规 DFD`
      : `${meta.name} · ${resolveDfdChallenge(spec).name || "排错挑战"}`;
  }
  if (spec.kind === "decision") return `${meta.name} · ${resolveDecisionCase(spec).name || "判定表"}`;
  if (spec.kind === "blackbox") return `${meta.name} · ${resolveBlackboxCase(spec).name || "边界值分析"}`;
  if (spec.kind === "whitebox") {
    const modeLabel = spec.target === "trap" ? "经典陷阱反例（条件100% ≠ 判定100%）" : "6 项逻辑覆盖 100%";
    return `${meta.name} · ${modeLabel}`;
  }
  if (spec.kind === "os_sched") return `${meta.name} · ${pickCase(OS_SCHED_CASES, spec).name || ""}`;
  if (spec.kind === "os_banker") return `${meta.name} · ${pickCase(OS_BANKER_CASES, spec).name || ""}`;
  if (spec.kind === "os_paging") return `${meta.name} · ${pickCase(OS_PAGING_CASES, spec).name || ""}`;
  if (spec.kind === "os_disk") return `${meta.name} · ${pickCase(OS_DISK_CASES, spec).name || ""}`;
  if (spec.kind === "os_mem") return `${meta.name} · ${pickCase(OS_MEM_CASES, spec).name || ""}`;
  return meta.name;
};

const matchConds = (rawConds, ruleConds) => (
  Array.isArray(ruleConds)
  && ruleConds.length === rawConds.length
  && ruleConds.every((v, i) => v === "-" || v === rawConds[i])
);

const sameActs = (a = [], b = []) => a.length === b.length && a.every((v, i) => Boolean(v) === Boolean(b[i]));

export const verifyDecisionEquivalence = (origCols = [], userCols = []) => {
  if (!origCols.length || !userCols.length) return false;
  const matchedOrig = origCols.every((orig) => {
    const hits = userCols.filter((u) => matchConds(orig.conds, u.conds));
    return hits.length >= 1 && hits.every((h) => sameActs(orig.acts, h.acts));
  });
  if (!matchedOrig) return false;
  return userCols.every((u) => {
    const covered = origCols.filter((orig) => matchConds(orig.conds, u.conds));
    return covered.length >= 1 && covered.every((orig) => sameActs(orig.acts, u.acts));
  });
};

export const buildSolutionPayload = (spec) => {
  if (!spec) return {};
  if (spec.kind === "pert") {
    const sol = solvePertNetwork(resolvePertGraph(spec));
    return {
      nodes: Object.fromEntries(Object.entries(sol.nodeMap).map(([id, n]) => [id, { earliest: String(n.earliest), latest: String(n.latest) }])),
      edges: Object.fromEntries(Object.entries(sol.edgeMap).map(([id, e]) => [id, { tf: String(e.tf) }])),
      criticalEdges: [...sol.criticalEdges]
    };
  }
  if (spec.kind === "dfd") {
    if (spec.mode === "build") {
      return {
        mode: "build",
        nodes: [
          { id: "c_s1", type: "entity", label: "用户", x: 95, y: 155 },
          { id: "c_p1", type: "process", label: "1.业务处理", x: 335, y: 155 },
          { id: "c_d1", type: "store", label: "数据台账", x: 575, y: 155 }
        ],
        edges: [
          { id: "ce1", from: "c_s1", to: "c_p1", label: "请求数据" },
          { id: "ce2", from: "c_p1", to: "c_d1", label: "写入记录" }
        ]
      };
    }
    const ch = resolveDfdChallenge(spec);
    return { mode: "challenge", foundIds: Object.keys(ch.faults || {}) };
  }
  if (spec.kind === "decision") {
    const caseDef = resolveDecisionCase(spec);
    let cols = structuredClone(caseDef.columns);
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < cols.length && !merged; i += 1) {
        for (let j = i + 1; j < cols.length; j += 1) {
          const res = canMergeDecisionCols(cols[i], cols[j]);
          if (res.ok) {
            const m = mergeDecisionCols(cols[i], cols[j]);
            cols = cols.filter((_, idx) => idx !== i && idx !== j);
            cols.splice(i, 0, m.merged);
            merged = true;
            break;
          }
        }
      }
    }
    return { columns: cols };
  }
  if (spec.kind === "blackbox") {
    const c = resolveBlackboxCase(spec);
    const mid = Math.round((c.min + c.max) / 2);
    const vals = [c.min - 1, c.min, c.min + 1, mid, c.max - 1, c.max, c.max + 1];
    return { values: vals.map(String), inputStr: vals.join(", ") };
  }
  if (spec.kind === "whitebox") {
    return { cases: structuredClone(spec.target === "trap" ? WHITEBOX_SPEC.trapCases : WHITEBOX_SPEC.fullCases) };
  }
  if (spec.kind === "os_sched") {
    const sol = solveOsScheduling(pickCase(OS_SCHED_CASES, spec));
    return {
      rows: Object.fromEntries(sol.rows.map((r) => [r.id, { finish: String(r.finish), turnaround: String(r.turnaround), weighted: String(r.weighted) }])),
      avgTurnaround: String(sol.avgTurnaround), avgWeighted: String(sol.avgWeighted)
    };
  }
  if (spec.kind === "os_banker") {
    const sol = solveBankerCase(pickCase(OS_BANKER_CASES, spec));
    return { need: Object.fromEntries(Object.entries(sol.needRows).map(([k, arr]) => [k, arr.map(String)])), safe: sol.safe, sequence: [...sol.safeSeq] };
  }
  if (spec.kind === "os_paging") {
    const sol = solveOsPaging(pickCase(OS_PAGING_CASES, spec));
    return { frames: sol.steps.map((s) => s.frames.map((v) => (v == null ? "" : String(v)))), faults: sol.steps.map((s) => s.fault), faultCount: String(sol.faultCount), faultRate: String(sol.faultRate) };
  }
  if (spec.kind === "os_disk") {
    const sol = solveOsDisk(pickCase(OS_DISK_CASES, spec));
    return { seqStr: sol.sequence.join(", "), sequence: [...sol.sequence], totalSeek: String(sol.totalSeek), avgSeek: String(sol.avgSeek) };
  }
  if (spec.kind === "os_mem") {
    const c = pickCase(OS_MEM_CASES, spec);
    const sol = solveOsMem(c);
    if (c.mode === "addr" && c.addrType === "page") return { pageNo: sol.pageNo, offset: sol.offset, frameNo: sol.frameNo, physAddr: sol.physAddr, eatNs: sol.eatNs };
    if (c.mode === "addr") return { baseAddr: sol.baseAddr, physAddr: sol.physAddr };
    if (c.mode === "alloc") return { assignments: Object.fromEntries(sol.assignments.map((a) => [a.jobId, { partId: a.partId, allocBase: String(a.allocBase) }])) };
    return { row: sol.row, col: sol.col, blockNo: sol.blockNo, nextVal: sol.nextVal };
  }
  return {};
};

const parseAttemptPayload = (raw) => {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first === "object" && first !== null) return first;
  if (typeof first !== "string" || !first.trim()) return null;
  try { return JSON.parse(first); } catch { return null; }
};

export const gradeInteractiveLab = (specOrQ, payloadOrRaw) => {
  const spec = parseLabSpec(specOrQ);
  const payload = parseAttemptPayload(payloadOrRaw);
  if (!spec || !payload) return { correct: false, ratio: 0, score: 0, total: 1, summary: "尚未作答或配置无效", detail: null };

  if (spec.kind === "pert") {
    const sol = solvePertNetwork(resolvePertGraph(spec));
    const g = gradePertAttempt(sol, payload);
    const ratio = g.total ? g.score / g.total : 0;
    return {
      correct: g.allCorrect,
      ratio,
      score: g.score,
      total: g.total,
      summary: g.allCorrect ? `全部正确 (${g.score}/${g.total} 项，总工期 ${sol.totalDuration})` : `答对 ${g.score}/${g.total} 项`,
      detail: g
    };
  }

  if (spec.kind === "dfd") {
    if (spec.mode === "build") {
      const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
      const edges = Array.isArray(payload.edges) ? payload.edges : [];
      const check = validateDfdGraph(nodes, edges);
      const enough = nodes.length >= 3 && edges.length >= 2;
      const correct = check.valid && enough;
      return {
        correct,
        ratio: correct ? 1 : (enough ? 0.4 : 0),
        score: correct ? 1 : 0,
        total: 1,
        summary: correct ? "DFD 结构合法，符合加工守恒与连接规范" : (check.issues[0]?.msg || "至少需要 3 个节点与 2 条规范连线"),
        detail: check
      };
    }
    const ch = resolveDfdChallenge(spec);
    const faultKeys = Object.keys(ch.faults || {});
    const found = [...new Set(Array.isArray(payload.foundIds) ? payload.foundIds : [])];
    const matched = found.filter((id) => Boolean(ch.faults?.[id])).length;
    const falsePos = found.filter((id) => !ch.faults?.[id]).length;
    const total = faultKeys.length || 1;
    const correct = matched === total && falsePos === 0;
    const ratio = Math.max(0, (matched - falsePos * 0.5) / total);
    return {
      correct,
      ratio: Math.min(1, ratio),
      score: matched,
      total,
      summary: correct ? `已精准找出全部 ${total} 处错误` : `找出 ${matched}/${total} 处错误${falsePos ? `（含 ${falsePos} 处误选）` : ""}`,
      detail: { matched, falsePos, total, faultKeys }
    };
  }

  if (spec.kind === "decision") {
    const caseDef = resolveDecisionCase(spec);
    const cols = Array.isArray(payload.columns) ? payload.columns : [];
    const equiv = verifyDecisionEquivalence(caseDef.columns, cols);
    const noDupOverlap = cols.length > 0
      && new Set(cols.map((c) => (c.conds || []).join(","))).size === cols.length
      && caseDef.columns.every((orig) => cols.filter((u) => matchConds(orig.conds, u.conds)).length === 1);
    const minimal = isDecisionTableMinimal(cols) && noDupOverlap;
    const correct = equiv && minimal;
    const ratio = correct ? 1 : (equiv ? 0.5 : 0);
    return {
      correct,
      ratio,
      score: correct ? 2 : (equiv ? 1 : 0),
      total: 2,
      summary: correct ? `化简成功，共 ${cols.length} 列且语义等价` : (equiv ? "逻辑等价但存在重复/重叠或未最简列" : "判定表规则与原真值表逻辑不等价"),
      detail: { equiv, minimal, colCount: cols.length }
    };
  }

  if (spec.kind === "blackbox") {
    const caseDef = resolveBlackboxCase(spec);
    const vals = Array.isArray(payload.values) ? payload.values : String(payload.inputStr || "").split(/[\s,，;；]+/).filter(Boolean);
    const rep = evaluateBlackboxInputs(caseDef, vals);
    const eqHit = rep.eqClasses.filter((c) => c.hit).length;
    const score = eqHit + rep.hitBoundaries.length;
    const total = rep.eqClasses.length + rep.boundaryTargets.length;
    const correct = rep.eqPct === 100 && rep.boundaryPct === 100;
    return {
      correct,
      ratio: total ? score / total : 0,
      score,
      total,
      summary: correct ? `等价类 100% 且 6 个边界点全部命中` : `等价类 ${rep.eqPct}%，边界点 ${rep.hitBoundaries.length}/6`,
      detail: rep
    };
  }

  if (spec.kind === "whitebox") {
    const cases = Array.isArray(payload.cases) ? payload.cases : [];
    const res = evaluateWhiteboxCases(cases);
    const m = res.metrics;
    const target = spec.target || "full";
    let correct = false;
    let ratio = 0;
    let summary = "";
    if (target === "trap") {
      correct = m.condition === 100 && m.decision < 100;
      ratio = correct ? 1 : (m.condition / 100) * 0.5;
      summary = correct ? `成功构造反例：条件 ${m.condition}% 且判定 ${m.decision}%` : `当前条件 ${m.condition}%、判定 ${m.decision}%（需条件 100% 且判定 < 100%）`;
    } else if (m[target] !== undefined) {
      correct = m[target] === 100;
      ratio = m[target] / 100;
      summary = `${target} 覆盖率 ${m[target]}%`;
    } else {
      const vals = Object.values(m);
      correct = vals.every((v) => v === 100);
      ratio = vals.reduce((s, v) => s + v, 0) / (vals.length * 100);
      summary = correct ? "全部 6 项逻辑覆盖均达 100%" : `综合逻辑覆盖率 ${Math.round(ratio * 100)}%`;
    }
    return { correct, ratio, score: Math.round(ratio * 100), total: 100, summary, detail: res };
  }

  if (spec.kind.startsWith("os_")) {
    const runners = {
      os_sched: () => gradeOsScheduling(pickCase(OS_SCHED_CASES, spec), payload),
      os_banker: () => gradeBankerAttempt(pickCase(OS_BANKER_CASES, spec), payload),
      os_paging: () => gradeOsPaging(pickCase(OS_PAGING_CASES, spec), payload),
      os_disk: () => gradeOsDisk(pickCase(OS_DISK_CASES, spec), payload),
      os_mem: () => gradeOsMem(pickCase(OS_MEM_CASES, spec), payload)
    };
    const g = runners[spec.kind]?.();
    if (g) {
      return {
        correct: Boolean(g.allCorrect), ratio: Number(g.ratio || 0), score: g.score, total: g.total,
        summary: g.allCorrect ? `全部正确 (${g.score}/${g.total} 项)` : `答对 ${g.score}/${g.total} 项（红框为错漏项）`,
        detail: g
      };
    }
  }

  return { correct: false, ratio: 0, score: 0, total: 1, summary: "不支持的实验类型", detail: null };
};

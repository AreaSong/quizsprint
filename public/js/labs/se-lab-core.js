/** 软件工程其他四大核心实验（DFD / 判定表 / 黑盒边界值 / 白盒逻辑覆盖）纯逻辑引擎 */

export const DFD_CHALLENGES = [
  {
    id: "dfd_err_1",
    name: "排错挑战 1 · 在线选课系统（3 处错误）",
    desc: "点击图中不符合 DFD 规范的节点或连线（提示：检查黑洞加工、外部实体直连与数据存储直连）。",
    nodes: [
      { id: "s1", type: "entity", label: "学生", x: 80, y: 95 },
      { id: "s2", type: "entity", label: "教务处", x: 80, y: 245 },
      { id: "p1", type: "process", label: "1.核验选课", x: 300, y: 100 },
      { id: "p2", type: "process", label: "2.登记学分", x: 300, y: 245 },
      { id: "d1", type: "store", label: "课程表", x: 540, y: 100 },
      { id: "d2", type: "store", label: "成绩库", x: 540, y: 245 }
    ],
    edges: [
      { id: "e1", from: "s1", to: "p1", label: "选课请求" },
      { id: "e2", from: "s1", to: "s2", label: "培养方案" },
      { id: "e3", from: "p1", to: "d1", label: "写入选课" },
      { id: "e4", from: "d1", to: "d2", label: "同步课号" },
      { id: "e5", from: "p2", to: "d2", label: "录入成绩" }
    ],
    faults: {
      e2: "违规：两个外部实体（学生→教务处）之间不能直接用数据流相连",
      e4: "违规：两个数据存储（课程表→成绩库）之间不能直接相连，必须经过加工",
      p2: "违规：加工「2.登记学分」只有输出流没有输入流，属于无源“奇迹加工”"
    }
  },
  {
    id: "dfd_err_2",
    name: "排错挑战 2 · 图书借阅系统（3 处错误）",
    desc: "找出图中存在“黑洞加工”、缺少命名的数据流及实体直连数据存储。",
    nodes: [
      { id: "s1", type: "entity", label: "读者", x: 80, y: 165 },
      { id: "p1", type: "process", label: "1.借书登记", x: 290, y: 95 },
      { id: "p2", type: "process", label: "2.日志归档", x: 290, y: 240 },
      { id: "d1", type: "store", label: "借阅台账", x: 530, y: 165 }
    ],
    edges: [
      { id: "e1", from: "s1", to: "p1", label: "借阅证" },
      { id: "e2", from: "p1", to: "d1", label: "" },
      { id: "e3", from: "s1", to: "p2", label: "操作记录" },
      { id: "e4", from: "s1", to: "d1", label: "查询指令" }
    ],
    faults: {
      e2: "违规：数据流必须有明确名词命名（不能为空名）",
      p2: "违规：加工「2.日志归档」只有输入没有输出，属于“黑洞加工”",
      e4: "违规：外部实体（读者）与数据存储（借阅台账）不能直接相连，必须经过加工"
    }
  }
];

/** 校验用户搭建的数据流图是否符合 DFD 基本规则 */
export const validateDfdGraph = (nodes = [], edges = []) => {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const issues = [];
  const inCnt = new Map(nodes.map((n) => [n.id, 0]));
  const outCnt = new Map(nodes.map((n) => [n.id, 0]));

  for (const e of edges) {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) continue;
    outCnt.set(a.id, (outCnt.get(a.id) || 0) + 1);
    inCnt.set(b.id, (inCnt.get(b.id) || 0) + 1);
    if (a.id === b.id) issues.push({ targetId: e.id, msg: `连线 ${a.label}→${b.label} 不能自环` });
    else if (a.type !== "process" && b.type !== "process") {
      issues.push({ targetId: e.id, msg: `${a.label} 与 ${b.label} 之间不能直接连数据流，必须经过“加工”` });
    }
    if (!String(e.label || "").trim()) issues.push({ targetId: e.id, msg: `连线 ${a.label}→${b.label} 缺少数据流名称` });
  }

  for (const n of nodes) {
    if (n.type !== "process") continue;
    const ins = inCnt.get(n.id) || 0;
    const outs = outCnt.get(n.id) || 0;
    if (ins === 0 && outs === 0) issues.push({ targetId: n.id, msg: `加工「${n.label}」未连接任何输入/输出流` });
    else if (ins === 0) issues.push({ targetId: n.id, msg: `加工「${n.label}」只有输出无输入（奇迹）` });
    else if (outs === 0) issues.push({ targetId: n.id, msg: `加工「${n.label}」只有输入无输出（黑洞）` });
  }
  return { valid: issues.length === 0, issues };
};

export const DECISION_CASES = [
  {
    id: "shipping",
    name: "电商运费优惠判定表（8 列 → 化简为 3 列）",
    conditions: ["订单满 99 元", "VIP 会员", "偏远地区"],
    actions: ["免基础运费", "加收偏远附加费"],
    columns: [
      { id: "R1", conds: ["T", "T", "T"], acts: [true, true] },
      { id: "R2", conds: ["T", "T", "F"], acts: [true, false] },
      { id: "R3", conds: ["T", "F", "T"], acts: [true, true] },
      { id: "R4", conds: ["T", "F", "F"], acts: [true, false] },
      { id: "R5", conds: ["F", "T", "T"], acts: [true, true] },
      { id: "R6", conds: ["F", "T", "F"], acts: [true, false] },
      { id: "R7", conds: ["F", "F", "T"], acts: [false, true] },
      { id: "R8", conds: ["F", "F", "F"], acts: [false, false] }
    ]
  },
  {
    id: "score",
    name: "实验成绩评定判定表（4 列 → 化简为 3 列）",
    conditions: ["出勤达标", "报告及格"],
    actions: ["允许参加期末考", "记入平时优秀"],
    columns: [
      { id: "R1", conds: ["T", "T"], acts: [true, true] },
      { id: "R2", conds: ["T", "F"], acts: [true, false] },
      { id: "R3", conds: ["F", "T"], acts: [false, false] },
      { id: "R4", conds: ["F", "F"], acts: [false, false] }
    ]
  }
];

/** 判断判定表中两列是否满足化简合并条件（动作完全相同且仅 1 个条件取值相反） */
export const canMergeDecisionCols = (colA, colB) => {
  if (!colA || !colB || colA.id === colB.id) return { ok: false, reason: "请选择两条不同的规则列" };
  const actsSame = colA.acts.length === colB.acts.length && colA.acts.every((v, i) => Boolean(v) === Boolean(colB.acts[i]));
  if (!actsSame) return { ok: false, reason: "两列对应动作项不完全相同，不能合并" };
  let diffIdx = -1;
  for (let i = 0; i < colA.conds.length; i += 1) {
    if (colA.conds[i] === colB.conds[i]) continue;
    const pair = [colA.conds[i], colB.conds[i]].sort().join("");
    if (pair !== "FT" || diffIdx !== -1) return { ok: false, reason: "必须恰好只有 1 个条件取值互补（T 与 F），其余条件完全一致" };
    diffIdx = i;
  }
  if (diffIdx === -1) return { ok: false, reason: "两列条件完全相同，请直接去重" };
  return { ok: true, diffIdx };
};

export const mergeDecisionCols = (colA, colB) => {
  const check = canMergeDecisionCols(colA, colB);
  if (!check.ok) return check;
  const conds = colA.conds.map((v, i) => (i === check.diffIdx ? "-" : v));
  return { ok: true, merged: { id: `${colA.id}+${colB.id}`, conds, acts: [...colA.acts] } };
};

export const isDecisionTableMinimal = (cols) => {
  for (let i = 0; i < cols.length; i += 1) {
    for (let j = i + 1; j < cols.length; j += 1) {
      if (canMergeDecisionCols(cols[i], cols[j]).ok) return false;
    }
  }
  return true;
};

export const BLACKBOX_CASES = [
  {
    id: "score_0_100",
    name: "考试成绩输入 [0, 100] 整数",
    min: 0,
    max: 100,
    unit: "分",
    hint: "有效类 [0, 100]；无效类 (<0) 与 (>100)；边界点建议包含 -1, 0, 1, 99, 100, 101"
  },
  {
    id: "pwd_6_12",
    name: "密码长度范围 [6, 12] 位",
    min: 6,
    max: 12,
    unit: "位",
    hint: "有效类 [6, 12]；无效类 (<6) 与 (>12)；边界点建议包含 5, 6, 7, 11, 12, 13"
  }
];

/** 统计黑盒输入的有效/无效等价类与边界点覆盖率 */
export const evaluateBlackboxInputs = (caseDef, rawValues = []) => {
  const { min, max } = caseDef;
  const parsed = rawValues.map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n));
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  const validVals = unique.filter((n) => n >= min && n <= max);
  const lowInvalid = unique.filter((n) => n < min);
  const highInvalid = unique.filter((n) => n > max);
  const boundaryTargets = [min - 1, min, min + 1, max - 1, max, max + 1];
  const hitSet = new Set(unique);
  const hitBoundaries = boundaryTargets.filter((b) => hitSet.has(b));
  const missingBoundaries = boundaryTargets.filter((b) => !hitSet.has(b));
  const eqClasses = [
    { label: `无效类 (< ${min})`, hit: lowInvalid.length > 0 },
    { label: `有效类 [${min}, ${max}]`, hit: validVals.length > 0 },
    { label: `无效类 (> ${max})`, hit: highInvalid.length > 0 }
  ];
  return {
    values: unique,
    eqClasses,
    eqPct: Math.round((eqClasses.filter((c) => c.hit).length / eqClasses.length) * 100),
    boundaryTargets,
    hitBoundaries,
    missingBoundaries,
    boundaryPct: Math.round((hitBoundaries.length / boundaryTargets.length) * 100)
  };
};

export const WHITEBOX_SPEC = {
  code: [
    "void calc(int A, int B, int &X) {",
    "  if (A > 1 && B == 0)   // 判定1：条件 c1(A>1), c2(B==0)",
    "    X = X / A;           // 语句块 S1",
    "  if (A == 2 || X > 1)   // 判定2：条件 c3(A==2), c4(X>1)",
    "    X = X + 1;           // 语句块 S2",
    "}"
  ].join("\n"),
  trapCases: [
    { A: 2, B: 1, X: 2 },
    { A: 1, B: 0, X: 1 }
  ],
  fullCases: [
    { A: 2, B: 0, X: 4 },
    { A: 3, B: 0, X: 1 },
    { A: 2, B: 1, X: 1 },
    { A: 1, B: 0, X: 2 },
    { A: 1, B: 1, X: 0 }
  ]
};

/** 模拟执行白盒经典双分支代码并计算 6 种逻辑覆盖率 */
export const evaluateWhiteboxCases = (cases = []) => {
  const stmts = new Set();
  const dec1 = new Set();
  const dec2 = new Set();
  const conds = { c1T: false, c1F: false, c2T: false, c2F: false, c3T: false, c3F: false, c4T: false, c4F: false };
  const combos1 = new Set();
  const combos2 = new Set();
  const paths = new Set();
  const traces = [];

  for (const item of cases) {
    const A = Number(item.A);
    const B = Number(item.B);
    let X = Number(item.X);
    if (!Number.isFinite(A) || !Number.isFinite(B) || !Number.isFinite(X)) continue;
    const c1 = A > 1;
    const c2 = B === 0;
    conds[c1 ? "c1T" : "c1F"] = true;
    conds[c2 ? "c2T" : "c2F"] = true;
    combos1.add(`${c1 ? "T" : "F"}${c2 ? "T" : "F"}`);
    const d1 = c1 && c2;
    dec1.add(d1 ? "T" : "F");
    if (d1) { stmts.add("S1"); X = X / A; }

    const c3 = A === 2;
    const c4 = X > 1;
    conds[c3 ? "c3T" : "c3F"] = true;
    conds[c4 ? "c4T" : "c4F"] = true;
    combos2.add(`${c3 ? "T" : "F"}${c4 ? "T" : "F"}`);
    const d2 = c3 || c4;
    dec2.add(d2 ? "T" : "F");
    if (d2) { stmts.add("S2"); X = X + 1; }

    const pathKey = `${d1 ? "T" : "F"}-${d2 ? "T" : "F"}`;
    paths.add(pathKey);
    traces.push({ A, B, initX: Number(item.X), outX: X, d1, d2, pathKey });
  }

  const condHit = Object.values(conds).filter(Boolean).length;
  const decHit = dec1.size + dec2.size;
  const metrics = {
    statement: Math.round((stmts.size / 2) * 100),
    decision: Math.round((decHit / 4) * 100),
    condition: Math.round((condHit / 8) * 100),
    decisionCondition: Math.round(((decHit + condHit) / 12) * 100),
    combo: Math.round(((combos1.size + combos2.size) / 8) * 100),
    path: Math.round((paths.size / 4) * 100)
  };
  return { traces, metrics, hitPaths: [...paths], hitStmts: [...stmts] };
};

/** 工程网络图（PERT / CPM）纯算法引擎与预置题库（零 DOM 依赖） */

export const PERT_PRESETS = {
  fig92: {
    id: "fig92",
    name: "教材图 9.2 · 工程网络图（含虚活动）",
    desc: "《实用软件工程（第4版）》图 9.2 原图（11 个事件节点、13 条活动含虚活动 4→8，总工期 15）",
    nodes: [
      { id: "1", x: 70, y: 185 },
      { id: "2", x: 170, y: 185 },
      { id: "3", x: 270, y: 185 },
      { id: "4", x: 390, y: 95 },
      { id: "5", x: 390, y: 185 },
      { id: "6", x: 390, y: 275 },
      { id: "7", x: 515, y: 95 },
      { id: "8", x: 515, y: 185 },
      { id: "9", x: 515, y: 275 },
      { id: "10", x: 645, y: 185 },
      { id: "11", x: 760, y: 185 }
    ],
    edges: [
      { id: "e1_2", from: "1", to: "2", duration: 2 },
      { id: "e2_3", from: "2", to: "3", duration: 4 },
      { id: "e3_4", from: "3", to: "4", duration: 3 },
      { id: "e3_5", from: "3", to: "5", duration: 1 },
      { id: "e3_6", from: "3", to: "6", duration: 1 },
      { id: "e4_7", from: "4", to: "7", duration: 3 },
      { id: "e4_8", from: "4", to: "8", duration: 0, dummy: true },
      { id: "e5_8", from: "5", to: "8", duration: 1 },
      { id: "e6_9", from: "6", to: "9", duration: 1 },
      { id: "e7_10", from: "7", to: "10", duration: 2 },
      { id: "e8_10", from: "8", to: "10", duration: 1 },
      { id: "e9_10", from: "9", to: "10", duration: 1 },
      { id: "e10_11", from: "10", to: "11", duration: 1 }
    ]
  },
  simple6: {
    id: "simple6",
    name: "入门演练 · 6 节点基础网络图",
    desc: "适合初学正向算最早时刻 E(j)、逆向算最迟时刻 L(i) 与活动机动时间",
    nodes: [
      { id: "1", x: 90, y: 180 },
      { id: "2", x: 245, y: 100 },
      { id: "3", x: 245, y: 260 },
      { id: "4", x: 430, y: 100 },
      { id: "5", x: 430, y: 260 },
      { id: "6", x: 600, y: 180 }
    ],
    edges: [
      { id: "e1_2", from: "1", to: "2", duration: 3 },
      { id: "e1_3", from: "1", to: "3", duration: 5 },
      { id: "e2_4", from: "2", to: "4", duration: 4 },
      { id: "e2_5", from: "2", to: "5", duration: 2 },
      { id: "e3_5", from: "3", to: "5", duration: 6 },
      { id: "e4_6", from: "4", to: "6", duration: 3 },
      { id: "e5_6", from: "5", to: "6", duration: 4 }
    ]
  },
  dual8: {
    id: "dual8",
    name: "进阶挑战 · 8 节点双关键路径图",
    desc: "包含两条并列关键路径与虚活动约束，注意多条路径同时机动时间为 0",
    nodes: [
      { id: "1", x: 80, y: 185 },
      { id: "2", x: 220, y: 95 },
      { id: "3", x: 220, y: 275 },
      { id: "4", x: 380, y: 95 },
      { id: "5", x: 380, y: 185 },
      { id: "6", x: 380, y: 275 },
      { id: "7", x: 550, y: 185 },
      { id: "8", x: 700, y: 185 }
    ],
    edges: [
      { id: "e1_2", from: "1", to: "2", duration: 4 },
      { id: "e1_3", from: "1", to: "3", duration: 3 },
      { id: "e2_4", from: "2", to: "4", duration: 5 },
      { id: "e2_5", from: "2", to: "5", duration: 2 },
      { id: "e3_5", from: "3", to: "5", duration: 3 },
      { id: "e3_6", from: "3", to: "6", duration: 6 },
      { id: "e4_7", from: "4", to: "7", duration: 4 },
      { id: "e5_7", from: "5", to: "7", duration: 4 },
      { id: "e6_7", from: "6", to: "7", duration: 4 },
      { id: "e7_8", from: "7", to: "8", duration: 2 }
    ]
  }
};

const buildAdjMaps = (nodes, edges) => {
  const inEdges = new Map();
  const outEdges = new Map();
  const inDeg = new Map();
  for (const n of nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of edges) {
    outEdges.get(e.from)?.push(e);
    inEdges.get(e.to)?.push(e);
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  }
  return { inEdges, outEdges, inDeg };
};

const topoSortNodes = (nodes, outEdges, inDeg) => {
  const deg = new Map(inDeg);
  const queue = nodes.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const u = queue.shift();
    order.push(u);
    for (const e of outEdges.get(u) || []) {
      const next = deg.get(e.to) - 1;
      deg.set(e.to, next);
      if (next === 0) queue.push(e.to);
    }
  }
  if (order.length !== nodes.length) throw new Error("工程网络图存在有向环，无法拓扑求解");
  return order;
};

/** 求解 PERT / CPM 网络：计算最早/最迟时刻、机动时间、关键路径及推导公式 */
export const solvePertNetwork = (graph) => {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const { inEdges, outEdges, inDeg } = buildAdjMaps(nodes, edges);
  const order = topoSortNodes(nodes, outEdges, inDeg);
  const E = new Map();
  const L = new Map();
  const nodeDerivations = {};

  for (const id of order) {
    const ins = inEdges.get(id) || [];
    if (!ins.length) {
      E.set(id, 0);
      nodeDerivations[id] = { early: `E(${id}) = 0（起点事件）` };
    } else {
      const cands = ins.map((e) => ({ val: E.get(e.from) + Number(e.duration || 0), expr: `E(${e.from})+${e.duration}=${E.get(e.from) + Number(e.duration || 0)}` }));
      const maxVal = Math.max(...cands.map((c) => c.val));
      E.set(id, maxVal);
      nodeDerivations[id] = { early: `E(${id}) = max(${cands.map((c) => c.expr).join(", ")}) = ${maxVal}` };
    }
  }

  const endId = order[order.length - 1];
  const totalDuration = E.get(endId) ?? 0;
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const outs = outEdges.get(id) || [];
    if (!outs.length) {
      L.set(id, totalDuration);
      nodeDerivations[id].late = `L(${id}) = E(${id}) = ${totalDuration}（终点事件）`;
    } else {
      const cands = outs.map((e) => ({ val: L.get(e.to) - Number(e.duration || 0), expr: `L(${e.to})-${e.duration}=${L.get(e.to) - Number(e.duration || 0)}` }));
      const minVal = Math.min(...cands.map((c) => c.val));
      L.set(id, minVal);
      nodeDerivations[id].late = `L(${id}) = min(${cands.map((c) => c.expr).join(", ")}) = ${minVal}`;
    }
  }

  const nodeMap = {};
  const criticalNodes = [];
  for (const n of nodes) {
    const earliest = E.get(n.id);
    const latest = L.get(n.id);
    const critical = earliest === latest;
    nodeMap[n.id] = { id: n.id, earliest, latest, critical };
    if (critical) criticalNodes.push(n.id);
  }

  const edgeMap = {};
  const edgeDerivations = {};
  const criticalEdges = [];
  for (const e of edges) {
    const dur = Number(e.duration || 0);
    const tf = L.get(e.to) - E.get(e.from) - dur;
    const critical = tf === 0 && nodeMap[e.from].critical && nodeMap[e.to].critical;
    edgeMap[e.id] = { ...e, duration: dur, tf, critical };
    edgeDerivations[e.id] = `TF(${e.from}→${e.to}) = L(${e.to}) - E(${e.from}) - D = ${L.get(e.to)} - ${E.get(e.from)} - ${dur} = ${tf}`;
    if (critical) criticalEdges.push(e.id);
  }

  return { totalDuration, nodeMap, edgeMap, criticalNodes, criticalEdges, nodeDerivations, edgeDerivations };
};

/** 批改用户提交的节点最早/最迟时刻、边机动时间与关键路径 */
export const gradePertAttempt = (solution, attempt = {}) => {
  const nIn = attempt.nodes || {};
  const eIn = attempt.edges || {};
  const critIn = new Set(attempt.criticalEdges || []);
  const nodeResults = {};
  const edgeResults = {};
  let score = 0;
  let total = 0;

  for (const [id, n] of Object.entries(solution.nodeMap)) {
    const u = nIn[id] || {};
    const eOk = Number(u.earliest) === n.earliest && u.earliest !== "" && u.earliest != null;
    const lOk = Number(u.latest) === n.latest && u.latest !== "" && u.latest != null;
    nodeResults[id] = { eOk, lOk, expectedE: n.earliest, expectedL: n.latest };
    total += 2;
    if (eOk) score += 1;
    if (lOk) score += 1;
  }

  for (const [id, e] of Object.entries(solution.edgeMap)) {
    const u = eIn[id] || {};
    const tfOk = Number(u.tf) === e.tf && u.tf !== "" && u.tf != null;
    const critOk = critIn.has(id) === e.critical;
    edgeResults[id] = { tfOk, critOk, expectedTf: e.tf, expectedCrit: e.critical };
    total += 2;
    if (tfOk) score += 1;
    if (critOk) score += 1;
  }

  return { score, total, allCorrect: score === total, nodeResults, edgeResults };
};

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** 随机生成一道 7 节点（含 1 条虚活动）的工程网络图练习题 */
export const generateRandomPertGraph = () => {
  const nodes = [
    { id: "1", x: 80, y: 185 },
    { id: "2", x: 215, y: 185 },
    { id: "3", x: 370, y: 95 },
    { id: "4", x: 370, y: 275 },
    { id: "5", x: 545, y: 95 },
    { id: "6", x: 545, y: 275 },
    { id: "7", x: 700, y: 185 }
  ];
  const edges = [
    { id: "e1_2", from: "1", to: "2", duration: randInt(2, 5) },
    { id: "e2_3", from: "2", to: "3", duration: randInt(2, 6) },
    { id: "e2_4", from: "2", to: "4", duration: randInt(2, 6) },
    { id: "e3_5", from: "3", to: "5", duration: randInt(2, 6) },
    { id: "e3_6", from: "3", to: "6", duration: 0, dummy: true },
    { id: "e4_6", from: "4", to: "6", duration: randInt(2, 5) },
    { id: "e5_7", from: "5", to: "7", duration: randInt(2, 5) },
    { id: "e6_7", from: "6", to: "7", duration: randInt(2, 5) }
  ];
  return {
    id: `rand_${Date.now()}`,
    name: "随机练习 · 7 节点工程网络图",
    desc: "每次生成随机工期并含虚活动 3→6，可用于反复练手",
    nodes,
    edges
  };
};

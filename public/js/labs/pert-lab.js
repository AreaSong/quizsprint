import { escapeHtml } from "../api.js";
import { generateRandomPertGraph, gradePertAttempt, PERT_PRESETS, solvePertNetwork } from "./pert-core.js";

const buildLegendSvg = () => `
  <g transform="translate(18, 12)">
    <text x="58" y="14" font-size="11" fill="var(--muted)">事件号</text>
    <line x1="78" y1="18" x2="96" y2="38" stroke="var(--muted)" stroke-width="1"/>
    <text x="168" y="14" font-size="11" fill="var(--muted)">最早时刻 E</text>
    <line x1="165" y1="18" x2="128" y2="38" stroke="var(--muted)" stroke-width="1"/>
    <text x="168" y="72" font-size="11" fill="var(--muted)">最迟时刻 L</text>
    <line x1="165" y1="68" x2="128" y2="56" stroke="var(--muted)" stroke-width="1"/>
    <text x="6" y="38" font-size="11" fill="var(--muted)">持续时间</text>
    <line x1="4" y1="45" x2="72" y2="45" stroke="var(--ink)" stroke-width="1.5" marker-end="url(#pert-arr)"/>
    <text x="4" y="61" font-size="11" fill="var(--muted)">(机动时间)</text>
    <g transform="translate(106, 45)">
      <circle r="24" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.6"/>
      <line x1="0" y1="-24" x2="0" y2="24" stroke="var(--ink)" stroke-width="1.2"/>
      <line x1="0" y1="0" x2="24" y2="0" stroke="var(--ink)" stroke-width="1.2"/>
    </g>
  </g>
`;

const buildEdgesSvg = (graph, sol, state) => {
  const nMap = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges.map((e) => {
    const a = nMap.get(e.from);
    const b = nMap.get(e.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const r = 26;
    const x1 = a.x + (dx / len) * r;
    const y1 = a.y + (dy / len) * r;
    const x2 = b.x - (dx / len) * (r + 5);
    const y2 = b.y - (dy / len) * (r + 5);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const nx = (-dy / len) * 14;
    const ny = (dx / len) * 14;
    const isQuiz = state.mode === "quiz";
    const isSel = state.selectedType === "edge" && state.selectedId === e.id;
    const eSol = sol.edgeMap[e.id];
    const uEdge = state.userEdges[e.id] || {};
    const uCrit = state.userCrit.has(e.id);
    const critOn = isQuiz ? uCrit : eSol.critical;
    const grade = state.grade?.edgeResults?.[e.id];
    const tfText = isQuiz ? (uEdge.tf === "" || uEdge.tf == null ? "?" : uEdge.tf) : eSol.tf;
    const strokeCls = grade
      ? (grade.tfOk && grade.critOk ? "is-ok" : "is-bad")
      : (critOn ? "is-crit" : "");
    return `
      <g class="pert-edge ${strokeCls} ${isSel ? "is-sel" : ""}" data-pert-edge="${e.id}">
        <line class="pert-edge-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="pert-edge-line ${e.dummy ? "is-dummy" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${critOn ? "pert-arr-crit" : "pert-arr"})" />
        <text class="pert-dur" x="${mx + nx}" y="${my + ny - 4}" text-anchor="middle">${e.duration}</text>
        <text class="pert-tf ${grade && !grade.tfOk ? "is-bad-txt" : ""}" x="${mx - nx}" y="${my - ny + 10}" text-anchor="middle">(${escapeHtml(String(tfText))})</text>
      </g>
    `;
  }).join("");
};

const buildNodesSvg = (graph, sol, state) => graph.nodes.map((n) => {
  const nSol = sol.nodeMap[n.id];
  const isQuiz = state.mode === "quiz";
  const isSel = state.selectedType === "node" && state.selectedId === n.id;
  const uNode = state.userNodes[n.id] || {};
  const grade = state.grade?.nodeResults?.[n.id];
  const eVal = isQuiz ? (uNode.earliest === "" || uNode.earliest == null ? "?" : uNode.earliest) : nSol.earliest;
  const lVal = isQuiz ? (uNode.latest === "" || uNode.latest == null ? "?" : uNode.latest) : nSol.latest;
  const cls = [
    "pert-node",
    isSel ? "is-sel" : "",
    !isQuiz && nSol.critical ? "is-crit" : "",
    grade ? (grade.eOk && grade.lOk ? "is-ok" : "is-bad") : ""
  ].filter(Boolean).join(" ");
  return `
    <g class="${cls}" transform="translate(${n.x}, ${n.y})" data-pert-node="${n.id}">
      <circle r="25" />
      <line x1="0" y1="-25" x2="0" y2="25" />
      <line x1="0" y1="0" x2="25" y2="0" />
      <text class="pert-nid" x="-11" y="5" text-anchor="middle">${n.id}</text>
      <text class="pert-val ${grade && !grade.eOk ? "is-bad-txt" : ""}" x="12" y="-6" text-anchor="middle">${escapeHtml(String(eVal))}</text>
      <text class="pert-val ${grade && !grade.lOk ? "is-bad-txt" : ""}" x="12" y="15" text-anchor="middle">${escapeHtml(String(lVal))}</text>
    </g>
  `;
}).join("");

const buildInspectorHtml = (graph, sol, state) => {
  if (state.selectedType === "node") {
    const id = state.selectedId;
    const u = state.userNodes[id] || {};
    const deriv = sol.nodeDerivations[id];
    const gr = state.grade?.nodeResults?.[id];
    return `
      <div class="lab-inspector-row">
        <strong>事件节点 ${id}</strong>
        ${state.mode === "quiz" ? `
          <label>最早时刻 E(${id}) <input type="number" class="lab-num-in" id="pert-in-e" value="${escapeHtml(u.earliest ?? "")}" placeholder="?"></label>
          <label>最迟时刻 L(${id}) <input type="number" class="lab-num-in" id="pert-in-l" value="${escapeHtml(u.latest ?? "")}" placeholder="?"></label>
        ` : `<span class="badge ok">E(${id})=${sol.nodeMap[id].earliest} · L(${id})=${sol.nodeMap[id].latest}</span>`}
        ${(state.showDeriv || state.mode === "sandbox") ? `<span class="muted-text">${escapeHtml(deriv.early)}；${escapeHtml(deriv.late)}</span>` : ""}
        ${gr ? `<span class="badge ${gr.eOk && gr.lOk ? "ok" : "bad"}">${gr.eOk && gr.lOk ? "节点全对" : `参考：E=${gr.expectedE}, L=${gr.expectedL}`}</span>` : ""}
      </div>
    `;
  }
  const e = graph.edges.find((x) => x.id === state.selectedId) || graph.edges[0];
  const u = state.userEdges[e.id] || {};
  const gr = state.grade?.edgeResults?.[e.id];
  const isCrit = state.userCrit.has(e.id);
  return `
    <div class="lab-inspector-row">
      <strong>活动 ${e.from} → ${e.to}${e.dummy ? "（虚活动）" : ""}</strong>
      ${state.mode === "quiz" ? `
        <label>机动时间 TF <input type="number" class="lab-num-in" id="pert-in-tf" value="${escapeHtml(u.tf ?? "")}" placeholder="?"></label>
        <button type="button" id="pert-toggle-crit" class="btn tiny ${isCrit ? "soft-active" : "ghost"}">${isCrit ? "✓ 已标为关键活动" : "标为关键活动"}</button>
      ` : `
        <label>持续时间 D <input type="number" min="0" max="99" class="lab-num-in" id="pert-in-dur" value="${e.duration}" ${e.dummy ? "disabled" : ""}></label>
        <span class="badge ${sol.edgeMap[e.id].critical ? "warn" : ""}">TF=${sol.edgeMap[e.id].tf}${sol.edgeMap[e.id].critical ? " · 关键活动" : ""}</span>
      `}
      ${(state.showDeriv || state.mode === "sandbox") ? `<span class="muted-text">${escapeHtml(sol.edgeDerivations[e.id])}</span>` : ""}
      ${gr ? `<span class="badge ${gr.tfOk && gr.critOk ? "ok" : "bad"}">${gr.tfOk && gr.critOk ? "活动全对" : `参考：TF=${gr.expectedTf}${gr.expectedCrit ? " · 关键活动" : ""}`}</span>` : ""}
    </div>
  `;
};

/** 挂载工程网络图（PERT / CPM）交互实验台 */
export const mountPertLab = (root) => {
  let graph = structuredClone(PERT_PRESETS.fig92);
  const state = {
    presetId: "fig92",
    mode: "quiz",
    selectedType: "node",
    selectedId: "1",
    userNodes: { 1: { earliest: "0", latest: "" } },
    userEdges: {},
    userCrit: new Set(),
    grade: null,
    showDeriv: false
  };

  const resetInputs = () => {
    state.userNodes = {};
    state.userEdges = {};
    state.userCrit = new Set();
    state.grade = null;
    state.showDeriv = false;
  };

  const render = () => {
    const sol = solvePertNetwork(graph);
    const critNodes = sol.criticalNodes.join(" → ");
    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          <select id="pert-preset-sel" class="lab-select">
            <option value="fig92" ${state.presetId === "fig92" ? "selected" : ""}>教材图 9.2 原图（11节点）</option>
            <option value="simple6" ${state.presetId === "simple6" ? "selected" : ""}>入门 6 节点图</option>
            <option value="dual8" ${state.presetId === "dual8" ? "selected" : ""}>双关键路径 8 节点图</option>
            ${state.presetId === "random" ? '<option value="random" selected>随机 7 节点练习图</option>' : ""}
          </select>
          <button type="button" id="pert-rand-btn" class="btn ghost tiny">随机出新图</button>
          <div class="view-seg">
            <button type="button" class="view-seg-btn ${state.mode === "quiz" ? "active" : ""}" data-pert-mode="quiz">手动填数批改</button>
            <button type="button" class="view-seg-btn ${state.mode === "sandbox" ? "active" : ""}" data-pert-mode="sandbox">沙盒改工期</button>
          </div>
        </div>
        <div class="row-gap">
          ${state.mode === "quiz" ? `
            <button type="button" id="pert-grade-btn" class="btn primary tiny">自动批改</button>
            <button type="button" id="pert-deriv-btn" class="btn ghost tiny">${state.showDeriv ? "隐藏推导" : "逐步推导"}</button>
            <button type="button" id="pert-fill-btn" class="btn ghost tiny">填入参考答案</button>
            <button type="button" id="pert-clear-btn" class="btn ghost tiny">清空重做</button>
          ` : `<span class="badge ok">当前总工期：${sol.totalDuration}</span><span class="badge warn">关键事件：${escapeHtml(critNodes)}</span>`}
        </div>
      </div>
      <p class="muted-text" style="margin:4px 0 8px;font-size:0.7813rem;">${escapeHtml(graph.desc)} · 点击任意圆圈节点或连线即可填写/修改。</p>
      <div class="lab-svg-wrap">
        <svg class="pert-svg" viewBox="0 0 830 340" role="img" aria-label="工程网络图">
          <defs>
            <marker id="pert-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--ink)"/></marker>
            <marker id="pert-arr-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--bad)"/></marker>
          </defs>
          ${buildLegendSvg()}
          ${buildEdgesSvg(graph, sol, state)}
          ${buildNodesSvg(graph, sol, state)}
        </svg>
      </div>
      <div class="lab-inspector">${buildInspectorHtml(graph, sol, state)}</div>
      ${state.grade ? `<div class="lab-feedback ${state.grade.allCorrect ? "ok" : "warn"}">批改结果：<strong>${state.grade.score} / ${state.grade.total}</strong> 项正确${state.grade.allCorrect ? "（全部正确！总工期 = " + sol.totalDuration + "）" : "（红字节点/连线为错漏项，点击可看参考公式）"}</div>` : ""}
    `;
    bindEvents(sol);
  };

  const bindEvents = (sol) => {
    root.querySelector("#pert-preset-sel")?.addEventListener("change", (e) => {
      const id = e.target.value;
      if (PERT_PRESETS[id]) { state.presetId = id; graph = structuredClone(PERT_PRESETS[id]); state.selectedType = "node"; state.selectedId = "1"; resetInputs(); render(); }
    });
    root.querySelector("#pert-rand-btn")?.addEventListener("click", () => {
      state.presetId = "random"; graph = generateRandomPertGraph(); state.selectedType = "node"; state.selectedId = "1"; resetInputs(); render();
    });
    root.querySelectorAll("[data-pert-mode]").forEach((b) => b.addEventListener("click", () => { state.mode = b.dataset.pertMode; render(); }));
    root.querySelectorAll("[data-pert-node]").forEach((g) => g.addEventListener("click", () => { state.selectedType = "node"; state.selectedId = g.dataset.pertNode; render(); }));
    root.querySelectorAll("[data-pert-edge]").forEach((g) => g.addEventListener("click", () => { state.selectedType = "edge"; state.selectedId = g.dataset.pertEdge; render(); }));
    root.querySelector("#pert-in-e")?.addEventListener("input", (e) => { state.userNodes[state.selectedId] = { ...(state.userNodes[state.selectedId] || {}), earliest: e.target.value }; state.grade = null; });
    root.querySelector("#pert-in-l")?.addEventListener("input", (e) => { state.userNodes[state.selectedId] = { ...(state.userNodes[state.selectedId] || {}), latest: e.target.value }; state.grade = null; });
    root.querySelector("#pert-in-tf")?.addEventListener("input", (e) => { state.userEdges[state.selectedId] = { tf: e.target.value }; state.grade = null; });
    root.querySelector("#pert-toggle-crit")?.addEventListener("click", () => {
      if (state.userCrit.has(state.selectedId)) state.userCrit.delete(state.selectedId); else state.userCrit.add(state.selectedId);
      state.grade = null; render();
    });
    root.querySelector("#pert-in-dur")?.addEventListener("change", (e) => {
      const edge = graph.edges.find((x) => x.id === state.selectedId);
      if (edge && !edge.dummy) { edge.duration = Math.max(0, Math.min(99, Math.trunc(Number(e.target.value) || 0))); render(); }
    });
    root.querySelector("#pert-grade-btn")?.addEventListener("click", () => { state.grade = gradePertAttempt(sol, { nodes: state.userNodes, edges: state.userEdges, criticalEdges: [...state.userCrit] }); render(); });
    root.querySelector("#pert-deriv-btn")?.addEventListener("click", () => { state.showDeriv = !state.showDeriv; render(); });
    root.querySelector("#pert-clear-btn")?.addEventListener("click", () => { resetInputs(); render(); });
    root.querySelector("#pert-fill-btn")?.addEventListener("click", () => {
      for (const [id, n] of Object.entries(sol.nodeMap)) state.userNodes[id] = { earliest: String(n.earliest), latest: String(n.latest) };
      for (const [id, e] of Object.entries(sol.edgeMap)) state.userEdges[id] = { tf: String(e.tf) };
      state.userCrit = new Set(sol.criticalEdges);
      state.grade = gradePertAttempt(sol, { nodes: state.userNodes, edges: state.userEdges, criticalEdges: [...state.userCrit] });
      render();
    });
  };

  render();
};

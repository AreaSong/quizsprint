import { escapeHtml } from "../api.js";
import { resolvePertGraph } from "./lab-grader.js";
import { generateRandomPertGraph, gradePertAttempt, PERT_PRESETS, solvePertNetwork } from "./pert-core.js";

const buildLegendSvg = () => `
  <g transform="translate(16, 12)">
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
    const critOn = isQuiz ? state.userCrit.has(e.id) : eSol.critical;
    const grade = state.grade?.edgeResults?.[e.id];
    const tfText = isQuiz ? (uEdge.tf === "" || uEdge.tf == null ? "?" : uEdge.tf) : eSol.tf;
    const strokeCls = grade ? (grade.tfOk && grade.critOk ? "is-ok" : "is-bad") : (critOn ? "is-crit" : "");
    return `
      <g class="pert-edge ${strokeCls} ${isSel ? "is-sel" : ""}" data-pert-edge="${e.id}">
        <line class="pert-edge-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="pert-edge-line ${e.dummy ? "is-dummy" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${critOn ? "pert-arr-crit" : "pert-arr"})" />
        <text class="pert-dur" x="${mx + nx}" y="${my + ny - 4}" text-anchor="middle">${e.duration}</text>
        <text class="pert-tf ${grade && !grade.tfOk ? "is-bad-txt" : ""}" data-svg-tf="${e.id}" x="${mx - nx}" y="${my - ny + 10}" text-anchor="middle">(${escapeHtml(String(tfText))})</text>
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
  const cls = ["pert-node", isSel ? "is-sel" : "", !isQuiz && nSol.critical ? "is-crit" : "", grade ? (grade.eOk && grade.lOk ? "is-ok" : "is-bad") : ""].filter(Boolean).join(" ");
  return `
    <g class="${cls}" transform="translate(${n.x}, ${n.y})" data-pert-node="${n.id}">
      <circle r="25" />
      <line x1="0" y1="-25" x2="0" y2="25" />
      <line x1="0" y1="0" x2="25" y2="0" />
      <text class="pert-nid" x="-11" y="5" text-anchor="middle">${n.id}</text>
      <text class="pert-val ${grade && !grade.eOk ? "is-bad-txt" : ""}" data-svg-e="${n.id}" x="12" y="-6" text-anchor="middle">${escapeHtml(String(eVal))}</text>
      <text class="pert-val ${grade && !grade.lOk ? "is-bad-txt" : ""}" data-svg-l="${n.id}" x="12" y="15" text-anchor="middle">${escapeHtml(String(lVal))}</text>
    </g>
  `;
}).join("");

const buildQuickTablesHtml = (graph, sol, state, readOnly = false) => {
  const isQuiz = state.mode === "quiz";
  const disAttr = readOnly ? "disabled" : "";
  const nodeRows = graph.nodes.map((n) => {
    const u = state.userNodes[n.id] || {};
    const gr = state.grade?.nodeResults?.[n.id];
    const eCls = gr ? (gr.eOk ? "is-ok" : "is-bad") : "";
    const lCls = gr ? (gr.lOk ? "is-ok" : "is-bad") : "";
    const sel = state.selectedType === "node" && state.selectedId === n.id ? "is-sel" : "";
    return `
      <tr class="${sel}" data-pert-node="${n.id}">
        <td><strong>${n.id}</strong></td>
        <td>${isQuiz ? `<input type="number" class="pert-mini-in ${eCls}" data-q-node="${n.id}" data-field="earliest" value="${escapeHtml(u.earliest ?? "")}" placeholder="?" ${disAttr}>` : sol.nodeMap[n.id].earliest}</td>
        <td>${isQuiz ? `<input type="number" class="pert-mini-in ${lCls}" data-q-node="${n.id}" data-field="latest" value="${escapeHtml(u.latest ?? "")}" placeholder="?" ${disAttr}>` : sol.nodeMap[n.id].latest}</td>
      </tr>
    `;
  }).join("");

  const edgeRows = graph.edges.map((e) => {
    const u = state.userEdges[e.id] || {};
    const gr = state.grade?.edgeResults?.[e.id];
    const tfCls = gr ? (gr.tfOk ? "is-ok" : "is-bad") : "";
    const sel = state.selectedType === "edge" && state.selectedId === e.id ? "is-sel" : "";
    const eSol = sol.edgeMap[e.id];
    return `
      <tr class="${sel}" data-pert-edge="${e.id}">
        <td>${e.from}→${e.to}${e.dummy ? "<span class=\"muted-text\">(虚)</span>" : ""}</td>
        <td>${isQuiz ? e.duration : `<input type="number" min="0" max="99" class="pert-mini-in" data-s-dur="${e.id}" value="${e.duration}" ${e.dummy ? "disabled" : ""}>`}</td>
        <td>${isQuiz ? `<input type="number" class="pert-mini-in ${tfCls}" data-q-edge="${e.id}" value="${escapeHtml(u.tf ?? "")}" placeholder="?" ${disAttr}>` : eSol.tf}</td>
        <td>${isQuiz ? `<input type="checkbox" data-q-crit="${e.id}" ${state.userCrit.has(e.id) ? "checked" : ""} ${disAttr}>` : (eSol.critical ? "✓" : "·")}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="pert-tables-grid">
      <div class="pert-grid-box">
        <div class="pert-grid-title">事件节点速填表（支持 Tab 连续填写 E / L）</div>
        <table class="pert-grid-table"><thead><tr><th>事件</th><th>最早 E</th><th>最迟 L</th></tr></thead><tbody>${nodeRows}</tbody></table>
      </div>
      <div class="pert-grid-box">
        <div class="pert-grid-title">${isQuiz ? "活动速填表（机动时间 TF 与关键路径勾选）" : "活动沙盒表（直接修改工期 D 实时推演）"}</div>
        <table class="pert-grid-table"><thead><tr><th>活动</th><th>工期 D</th><th>机动 TF</th><th>关键</th></tr></thead><tbody>${edgeRows}</tbody></table>
      </div>
    </div>
  `;
};

const buildDerivBanner = (graph, sol, state) => {
  if (!state.showDeriv && state.mode === "quiz") return "";
  if (state.selectedType === "node") {
    const d = sol.nodeDerivations[state.selectedId];
    return `<div class="lab-inspector"><div class="lab-inspector-row"><strong>节点 ${state.selectedId} 推导：</strong><span class="muted-text">${escapeHtml(d.early)}；${escapeHtml(d.late)}</span></div></div>`;
  }
  const e = graph.edges.find((x) => x.id === state.selectedId) || graph.edges[0];
  return `<div class="lab-inspector"><div class="lab-inspector-row"><strong>活动 ${e.from}→${e.to} 推导：</strong><span class="muted-text">${escapeHtml(sol.edgeDerivations[e.id])}</span></div></div>`;
};

/** 挂载工程网络图（PERT / CPM）交互实验台 */
export const mountPertLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const initGraph = embedded && opts.spec ? resolvePertGraph(opts.spec) : PERT_PRESETS.fig92;
  let graph = structuredClone(initGraph);
  const initP = opts.initialPayload || {};
  const state = {
    presetId: opts.spec?.preset || "fig92",
    mode: "quiz",
    selectedType: "node",
    selectedId: "1",
    userNodes: structuredClone(initP.nodes || (embedded ? {} : { 1: { earliest: "0", latest: "" } })),
    userEdges: structuredClone(initP.edges || {}),
    userCrit: new Set(Array.isArray(initP.criticalEdges) ? initP.criticalEdges : []),
    grade: opts.gradeResult?.detail || null,
    showDeriv: false
  };

  const getPayload = () => ({
    nodes: structuredClone(state.userNodes),
    edges: structuredClone(state.userEdges),
    criticalEdges: [...state.userCrit]
  });
  const notify = () => opts.onChange?.(getPayload());
  const resetInputs = () => { state.userNodes = {}; state.userEdges = {}; state.userCrit = new Set(); state.grade = null; state.showDeriv = false; };

  const render = () => {
    const sol = solvePertNetwork(graph);
    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          ${embedded ? `<span class="muted-text" style="font-size:0.7813rem;">填写事件 E/L、活动机动 TF 并勾选关键路径（支持 Tab 连续输入）</span>` : `
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
          `}
        </div>
        <div class="row-gap">
          ${state.mode === "quiz" ? `
            ${embedded ? "" : '<button type="button" id="pert-grade-btn" class="btn primary tiny">自动批改</button>'}
            ${(!embedded || readOnly) ? `<button type="button" id="pert-deriv-btn" class="btn ghost tiny">${state.showDeriv ? "隐藏推导" : "逐步推导"}</button>` : ""}
            ${embedded ? "" : '<button type="button" id="pert-fill-btn" class="btn ghost tiny">填入参考答案</button>'}
            ${readOnly ? "" : '<button type="button" id="pert-clear-btn" class="btn ghost tiny">清空重做</button>'}
          ` : `<span class="badge ok">当前总工期：${sol.totalDuration}</span><span class="badge warn">关键事件：${escapeHtml(sol.criticalNodes.join(" → "))}</span>`}
        </div>
      </div>
      <p class="muted-text" style="margin:4px 0 6px;font-size:0.7813rem;">${escapeHtml(graph.desc || "")} · 点击图上节点/边会定位到下方对应格子，也可直接在速填表里用 Tab 连续填写。</p>
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
      ${buildDerivBanner(graph, sol, state)}
      ${state.grade ? `<div class="lab-feedback ${state.grade.allCorrect ? "ok" : "warn"}">批改结果：<strong>${state.grade.score} / ${state.grade.total}</strong> 项正确${state.grade.allCorrect ? `（全部正确！总工期 = ${sol.totalDuration}）` : "（红框格为错漏项，点击节点并开启「逐步推导」可查看公式）"}</div>` : ""}
      ${buildQuickTablesHtml(graph, sol, state, readOnly)}
    `;
    bindEvents(sol);
  };

  const bindEvents = (sol) => {
    root.querySelector("#pert-preset-sel")?.addEventListener("change", (e) => {
      if (PERT_PRESETS[e.target.value]) { state.presetId = e.target.value; graph = structuredClone(PERT_PRESETS[e.target.value]); state.selectedType = "node"; state.selectedId = "1"; resetInputs(); render(); }
    });
    root.querySelector("#pert-rand-btn")?.addEventListener("click", () => { state.presetId = "random"; graph = generateRandomPertGraph(); state.selectedType = "node"; state.selectedId = "1"; resetInputs(); render(); });
    root.querySelectorAll("[data-pert-mode]").forEach((b) => b.addEventListener("click", () => { state.mode = b.dataset.pertMode; render(); }));
    root.querySelectorAll("g[data-pert-node]").forEach((g) => g.addEventListener("click", () => {
      state.selectedType = "node"; state.selectedId = g.dataset.pertNode; render();
      if (!readOnly) root.querySelector(`[data-q-node="${state.selectedId}"][data-field="earliest"]`)?.focus();
    }));
    root.querySelectorAll("g[data-pert-edge]").forEach((g) => g.addEventListener("click", () => {
      state.selectedType = "edge"; state.selectedId = g.dataset.pertEdge; render();
      if (!readOnly) (root.querySelector(`[data-q-edge="${state.selectedId}"]`) || root.querySelector(`[data-s-dur="${state.selectedId}"]`))?.focus();
    }));
    if (!readOnly) {
      root.querySelectorAll("[data-q-node]").forEach((inp) => inp.addEventListener("input", () => {
        const id = inp.dataset.qNode;
        state.userNodes[id] = { ...(state.userNodes[id] || {}), [inp.dataset.field]: inp.value };
        state.grade = null;
        const svgTxt = root.querySelector(`[data-svg-${inp.dataset.field === "earliest" ? "e" : "l"}="${id}"]`);
        if (svgTxt) svgTxt.textContent = inp.value === "" ? "?" : inp.value;
        notify();
      }));
      root.querySelectorAll("[data-q-edge]").forEach((inp) => inp.addEventListener("input", () => {
        const id = inp.dataset.qEdge;
        state.userEdges[id] = { tf: inp.value };
        state.grade = null;
        const svgTxt = root.querySelector(`[data-svg-tf="${id}"]`);
        if (svgTxt) svgTxt.textContent = `(${inp.value === "" ? "?" : inp.value})`;
        notify();
      }));
      root.querySelectorAll("[data-q-crit]").forEach((chk) => chk.addEventListener("change", () => {
        if (chk.checked) state.userCrit.add(chk.dataset.qCrit); else state.userCrit.delete(chk.dataset.qCrit);
        state.grade = null; notify(); render();
      }));
      root.querySelectorAll("[data-s-dur]").forEach((inp) => inp.addEventListener("change", () => {
        const edge = graph.edges.find((x) => x.id === inp.dataset.sDur);
        if (edge && !edge.dummy) { edge.duration = Math.max(0, Math.min(99, Math.trunc(Number(inp.value) || 0))); render(); }
      }));
      root.querySelector("#pert-clear-btn")?.addEventListener("click", () => { resetInputs(); notify(); render(); });
    }
    root.querySelector("#pert-grade-btn")?.addEventListener("click", () => { state.grade = gradePertAttempt(sol, getPayload()); render(); });
    root.querySelector("#pert-deriv-btn")?.addEventListener("click", () => { state.showDeriv = !state.showDeriv; render(); });
    root.querySelector("#pert-fill-btn")?.addEventListener("click", () => {
      for (const [id, n] of Object.entries(sol.nodeMap)) state.userNodes[id] = { earliest: String(n.earliest), latest: String(n.latest) };
      for (const [id, e] of Object.entries(sol.edgeMap)) state.userEdges[id] = { tf: String(e.tf) };
      state.userCrit = new Set(sol.criticalEdges);
      state.grade = gradePertAttempt(sol, getPayload());
      notify();
      render();
    });
  };

  render();
  return { getPayload };
};

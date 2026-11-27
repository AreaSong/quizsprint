import { escapeHtml } from "../api.js";
import { canMergeDecisionCols, DECISION_CASES, DFD_CHALLENGES, isDecisionTableMinimal, mergeDecisionCols, validateDfdGraph } from "./se-lab-core.js";

const buildDfdNodeSvg = (n, opts = {}) => {
  const cls = [
    "dfd-node",
    opts.picked ? "is-picked" : "",
    opts.foundFault ? "is-fault" : "",
    opts.selected ? "is-sel" : ""
  ].filter(Boolean).join(" ");
  let shape = `<rect x="-52" y="-20" width="104" height="40" rx="4" />`;
  if (n.type === "process") shape = `<rect x="-54" y="-22" width="108" height="44" rx="18" />`;
  if (n.type === "store") shape = `<path d="M-54,-18 L54,-18 M-54,18 L54,18 M-54,-18 L-54,18" />`;
  return `
    <g class="${cls}" transform="translate(${n.x}, ${n.y})" data-dfd-node="${escapeHtml(n.id)}">
      ${shape}
      <text x="0" y="5" text-anchor="middle">${escapeHtml(n.label)}</text>
    </g>
  `;
};

const buildDfdEdgeSvg = (e, nMap, opts = {}) => {
  const a = nMap.get(e.from);
  const b = nMap.get(e.to);
  if (!a || !b) return "";
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const x1 = a.x + (dx / len) * 56;
  const y1 = a.y + (dy / len) * 24;
  const x2 = b.x - (dx / len) * 58;
  const y2 = b.y - (dy / len) * 26;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 8;
  const cls = ["dfd-edge", opts.foundFault ? "is-fault" : "", opts.picked ? "is-picked" : ""].filter(Boolean).join(" ");
  return `
    <g class="${cls}" data-dfd-edge="${escapeHtml(e.id)}">
      <line class="pert-edge-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
      <line class="dfd-edge-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#dfd-arr)" />
      <text x="${mx}" y="${my}" text-anchor="middle">${escapeHtml(e.label || "(未命名)")}</text>
    </g>
  `;
};

/** 挂载数据流图（DFD）排错与自由搭建实验台 */
export const mountDfdLab = (root) => {
  const state = {
    mode: "challenge",
    challengeId: DFD_CHALLENGES[0].id,
    foundIds: new Set(),
    lastMsg: "",
    customNodes: [
      { id: "c_s1", type: "entity", label: "用户", x: 90, y: 155 },
      { id: "c_p1", type: "process", label: "1.登录校验", x: 310, y: 155 },
      { id: "c_d1", type: "store", label: "用户表", x: 540, y: 155 }
    ],
    customEdges: [{ id: "ce1", from: "c_s1", to: "c_p1", label: "账号密码" }],
    connectFrom: "",
    nextSeq: 2
  };

  const render = () => {
    const ch = DFD_CHALLENGES.find((x) => x.id === state.challengeId) || DFD_CHALLENGES[0];
    const nodes = state.mode === "challenge" ? ch.nodes : state.customNodes;
    const edges = state.mode === "challenge" ? ch.edges : state.customEdges;
    const nMap = new Map(nodes.map((n) => [n.id, n]));
    const check = state.mode === "build" ? validateDfdGraph(nodes, edges) : null;
    const faultCount = Object.keys(ch.faults).length;

    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          <div class="view-seg">
            <button type="button" class="view-seg-btn ${state.mode === "challenge" ? "active" : ""}" data-dfd-mode="challenge">图面排错挑战</button>
            <button type="button" class="view-seg-btn ${state.mode === "build" ? "active" : ""}" data-dfd-mode="build">自由搭建体检</button>
          </div>
          ${state.mode === "challenge" ? `
            <select id="dfd-ch-sel" class="lab-select">
              ${DFD_CHALLENGES.map((c) => `<option value="${c.id}" ${c.id === state.challengeId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>
            <span class="badge ${state.foundIds.size === faultCount ? "ok" : "warn"}">已找出 ${state.foundIds.size} / ${faultCount} 处错误</span>
          ` : `
            <button type="button" class="btn ghost tiny" data-add-node="entity">+ 外部实体</button>
            <button type="button" class="btn ghost tiny" data-add-node="process">+ 加工</button>
            <button type="button" class="btn ghost tiny" data-add-node="store">+ 数据存储</button>
            <button type="button" id="dfd-clear-edges" class="btn ghost tiny">清空连线</button>
          `}
        </div>
      </div>
      <p class="muted-text" style="margin:4px 0 8px;font-size:0.7813rem;">
        ${state.mode === "challenge" ? escapeHtml(ch.desc) : "先点选一个起点节点，再点选终点节点即可添加数据流连线；下方实时校验 DFD 规范性。"}
      </p>
      <div class="lab-svg-wrap">
        <svg class="dfd-svg" viewBox="0 0 650 310" role="img" aria-label="数据流图实验画布">
          <defs><marker id="dfd-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--ink)"/></marker></defs>
          ${edges.map((e) => buildDfdEdgeSvg(e, nMap, { foundFault: state.mode === "challenge" && state.foundIds.has(e.id) })).join("")}
          ${nodes.map((n) => buildDfdNodeSvg(n, { foundFault: state.mode === "challenge" && state.foundIds.has(n.id), selected: state.connectFrom === n.id })).join("")}
        </svg>
      </div>
      ${state.mode === "challenge"
        ? `<div class="lab-feedback ${state.lastMsg.startsWith("违规") ? "ok" : "warn"}">${escapeHtml(state.lastMsg || "点击图中可疑的加工框或数据流箭头进行排错。")}</div>`
        : `<div class="lab-feedback ${check.valid ? "ok" : "warn"}">${check.valid ? "✓ 当前数据流图符合加工守恒、边界连接与命名规范！" : check.issues.map((i) => escapeHtml(i.msg)).join("；")}</div>`}
    `;
    bindEvents(ch);
  };

  const bindEvents = (ch) => {
    root.querySelectorAll("[data-dfd-mode]").forEach((b) => b.addEventListener("click", () => { state.mode = b.dataset.dfdMode; state.lastMsg = ""; state.connectFrom = ""; render(); }));
    root.querySelector("#dfd-ch-sel")?.addEventListener("change", (e) => { state.challengeId = e.target.value; state.foundIds = new Set(); state.lastMsg = ""; render(); });
    root.querySelectorAll("[data-dfd-node], [data-dfd-edge]").forEach((el) => el.addEventListener("click", () => {
      const id = el.dataset.dfdNode || el.dataset.dfdEdge;
      if (state.mode === "challenge") {
        if (ch.faults[id]) { state.foundIds.add(id); state.lastMsg = ch.faults[id]; }
        else { state.lastMsg = "该元素符合 DFD 规范，请继续查找其他违规之处。"; }
        render();
        return;
      }
      if (el.dataset.dfdEdge) { state.customEdges = state.customEdges.filter((x) => x.id !== id); render(); return; }
      if (!state.connectFrom) { state.connectFrom = id; render(); return; }
      if (state.connectFrom !== id) {
        state.customEdges.push({ id: `ce_${Date.now()}`, from: state.connectFrom, to: id, label: `数据流${state.customEdges.length + 1}` });
      }
      state.connectFrom = "";
      render();
    }));
    root.querySelectorAll("[data-add-node]").forEach((b) => b.addEventListener("click", () => {
      const type = b.dataset.addNode;
      const idx = state.nextSeq++;
      const x = type === "entity" ? 95 : (type === "process" ? 310 : 535);
      const y = 75 + ((idx % 3) * 85);
      const label = type === "entity" ? `实体${idx}` : (type === "process" ? `${idx}.处理` : `存储${idx}`);
      state.customNodes.push({ id: `cn_${idx}`, type, label, x, y });
      render();
    }));
    root.querySelector("#dfd-clear-edges")?.addEventListener("click", () => { state.customEdges = []; state.connectFrom = ""; render(); });
  };

  render();
};

const renderDecisionTreeHtml = (caseDef, cols) => {
  if (!cols.length) return "";
  return `
    <div class="dtree-wrap">
      <div style="font-size:0.8125rem;font-weight:700;margin-bottom:8px;">实时对照 · 判定树结构（共 ${cols.length} 条分支）</div>
      <div class="dtree-list">
        ${cols.map((col) => {
          const condPath = col.conds.map((v, i) => v === "-" ? null : `${caseDef.conditions[i]}=${v}`).filter(Boolean).join(" → ");
          const actText = col.acts.map((ok, i) => ok ? caseDef.actions[i] : null).filter(Boolean).join("、") || "无操作";
          return `<div class="dtree-branch"><span class="badge">${escapeHtml(col.id)}</span><span>${escapeHtml(condPath || "任意条件")}</span><span class="muted-text">⇒</span><strong style="color:var(--ok);">${escapeHtml(actText)}</strong></div>`;
        }).join("")}
      </div>
    </div>
  `;
};

/** 挂载判定表化简与判定树对照实验台 */
export const mountDecisionLab = (root) => {
  let caseDef = DECISION_CASES[0];
  let cols = structuredClone(caseDef.columns);
  let selectedIds = new Set();
  let feedback = "勾选两条「动作相同且仅有 1 个条件为 T/F 互补」的规则列，点击「合并化简」。";

  const render = () => {
    const minimal = isDecisionTableMinimal(cols);
    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          <select id="dec-case-sel" class="lab-select">
            ${DECISION_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
          <span class="badge ${minimal ? "ok" : "warn"}">${minimal ? `已最简（${cols.length} 列）` : `当前 ${cols.length} 列，还可继续化简`}</span>
        </div>
        <div class="row-gap">
          <button type="button" id="dec-merge-btn" class="btn primary tiny" ${selectedIds.size !== 2 ? "disabled" : ""}>合并选中两列</button>
          <button type="button" id="dec-reset-btn" class="btn ghost tiny">重置初始表</button>
        </div>
      </div>
      <div class="table-wrap" style="margin-top:8px;">
        <table class="md-table dec-table">
          <thead>
            <tr>
              <th>规则列</th>
              ${cols.map((c) => `<th><label class="dec-col-chk"><input type="checkbox" data-dec-col="${escapeHtml(c.id)}" ${selectedIds.has(c.id) ? "checked" : ""}><span>${escapeHtml(c.id)}</span></label></th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${caseDef.conditions.map((condName, ri) => `
              <tr>
                <td><strong>${escapeHtml(condName)}</strong></td>
                ${cols.map((c) => `<td style="text-align:center;"><span class="badge ${c.conds[ri] === "-" ? "ok" : ""}">${escapeHtml(c.conds[ri])}</span></td>`).join("")}
              </tr>
            `).join("")}
            ${caseDef.actions.map((actName, ai) => `
              <tr>
                <td>${escapeHtml(actName)}</td>
                ${cols.map((c) => `<td style="text-align:center;">${c.acts[ai] ? "✓" : "·"}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="lab-feedback ${minimal ? "ok" : "warn"}" style="margin-top:10px;">${escapeHtml(feedback)}</div>
      ${renderDecisionTreeHtml(caseDef, cols)}
    `;
    bindEvents();
  };

  const bindEvents = () => {
    root.querySelector("#dec-case-sel")?.addEventListener("change", (e) => {
      caseDef = DECISION_CASES.find((c) => c.id === e.target.value) || DECISION_CASES[0];
      cols = structuredClone(caseDef.columns);
      selectedIds = new Set();
      feedback = "已切换判定表，请尝试合并可化简规则列。";
      render();
    });
    root.querySelectorAll("[data-dec-col]").forEach((chk) => chk.addEventListener("change", () => {
      const id = chk.dataset.decCol;
      if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
      render();
    }));
    root.querySelector("#dec-merge-btn")?.addEventListener("click", () => {
      const [idA, idB] = [...selectedIds];
      const colA = cols.find((c) => c.id === idA);
      const colB = cols.find((c) => c.id === idB);
      const res = mergeDecisionCols(colA, colB);
      if (!res.ok) { feedback = `不能合并：${res.reason}`; render(); return; }
      const idxA = cols.indexOf(colA);
      cols = cols.filter((c) => c.id !== idA && c.id !== idB);
      cols.splice(idxA, 0, res.merged);
      selectedIds.clear();
      feedback = isDecisionTableMinimal(cols) ? "✓ 合并成功，已达到最简判定表！" : `合并成功（生成 ${res.merged.id}），可继续寻找下一对互补列。`;
      render();
    });
    root.querySelector("#dec-reset-btn")?.addEventListener("click", () => {
      cols = structuredClone(caseDef.columns);
      selectedIds.clear();
      feedback = "已重置为完整 2^n 初始判定表。";
      render();
    });
  };

  render();
};

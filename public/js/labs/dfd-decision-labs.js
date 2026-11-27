import { escapeHtml } from "../api.js";
import { resolveDecisionCase, resolveDfdChallenge } from "./lab-grader.js";
import { canMergeDecisionCols, DECISION_CASES, DFD_CHALLENGES, isDecisionTableMinimal, mergeDecisionCols, validateDfdGraph } from "./se-lab-core.js";

const buildDfdNodeSvg = (n, opts = {}) => {
  const cls = ["dfd-node", opts.draggable ? "is-draggable" : "", opts.foundFault ? "is-fault" : "", opts.selected ? "is-sel" : ""].filter(Boolean).join(" ");
  let shape = `<rect x="-54" y="-20" width="108" height="40" rx="4" />`;
  if (n.type === "process") shape = `<rect x="-56" y="-22" width="112" height="44" rx="18" />`;
  if (n.type === "store") shape = `<path d="M-54,-18 L54,-18 M-54,18 L54,18 M-54,-18 L-54,18" />`;
  return `<g class="${cls}" transform="translate(${n.x}, ${n.y})" data-dfd-node="${escapeHtml(n.id)}">${shape}<text x="0" y="5" text-anchor="middle">${escapeHtml(n.label)}</text></g>`;
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
  const cls = ["dfd-edge", opts.foundFault ? "is-fault" : "", opts.selected ? "is-sel" : ""].filter(Boolean).join(" ");
  return `
    <g class="${cls}" data-dfd-edge="${escapeHtml(e.id)}">
      <line class="pert-edge-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
      <line class="dfd-edge-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#dfd-arr)" />
      <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle">${escapeHtml(e.label || "(未命名)")}</text>
    </g>
  `;
};

const buildDfdInspectorHtml = (state, nodes, edges) => {
  if (state.mode !== "build") return "";
  const selNode = nodes.find((n) => n.id === state.selNodeId);
  const selEdge = edges.find((e) => e.id === state.selEdgeId);
  if (selNode) {
    return `
      <div class="lab-inspector"><div class="lab-inspector-row">
        <strong>已选节点：</strong>
        <input id="dfd-rename-node" class="lab-txt-in" type="text" value="${escapeHtml(selNode.label)}" placeholder="输入节点名称...">
        <input id="dfd-flow-name" class="lab-txt-in" type="text" value="${escapeHtml(state.pendingFlowName)}" placeholder="连线数据流名称...">
        <button type="button" id="dfd-connect-btn" class="btn tiny ${state.connectMode ? "soft-active" : "ghost"}">${state.connectMode ? "请点击画布目标节点..." : "从此处连线 →"}</button>
        <button type="button" id="dfd-del-node" class="btn ghost-danger tiny">删除节点</button>
      </div></div>
    `;
  }
  if (selEdge) {
    return `
      <div class="lab-inspector"><div class="lab-inspector-row">
        <strong>已选数据流：</strong>
        <input id="dfd-rename-edge" class="lab-txt-in" type="text" value="${escapeHtml(selEdge.label)}" placeholder="输入数据流名称...">
        <button type="button" id="dfd-del-edge" class="btn ghost-danger tiny">删除连线</button>
      </div></div>
    `;
  }
  return `<div class="lab-inspector"><div class="lab-inspector-row muted-text">提示：拖拽画布上的方框/圆角加工可自由排版；点击节点或连线可重命名、连线或删除。</div></div>`;
};

const clientToSvgPoint = (svg, clientX, clientY) => {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 100, y: 100 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: Math.max(64, Math.min(616, Math.round(p.x))), y: Math.max(30, Math.min(280, Math.round(p.y))) };
};

const describeDfdTarget = (id, nodes, edges) => {
  const n = nodes.find((x) => x.id === id);
  if (n) return n.label || id;
  const e = edges.find((x) => x.id === id);
  if (!e) return id;
  const a = nodes.find((x) => x.id === e.from)?.label || e.from;
  const b = nodes.find((x) => x.id === e.to)?.label || e.to;
  return `${a}→${b}${e.label ? `(${e.label})` : ""}`;
};

/** 挂载数据流图（DFD）排错与自由搭建实验台 */
export const mountDfdLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  const sideRoot = studioSide || root;
  const spec = opts.spec || {};
  const initP = opts.initialPayload || {};
  const fixedChallenge = embedded && spec.mode !== "build" ? resolveDfdChallenge(spec) : null;
  const state = {
    mode: embedded ? (spec.mode === "build" ? "build" : "challenge") : "challenge",
    challengeId: fixedChallenge?.id || DFD_CHALLENGES[0].id,
    foundIds: new Set(Array.isArray(initP.foundIds) ? initP.foundIds : []),
    lastMsg: "",
    customNodes: Array.isArray(initP.nodes) && initP.nodes.length ? structuredClone(initP.nodes) : [
      { id: "c_s1", type: "entity", label: "用户", x: 95, y: 155 },
      { id: "c_p1", type: "process", label: "1.登录校验", x: 335, y: 155 },
      { id: "c_d1", type: "store", label: "用户表", x: 575, y: 155 }
    ],
    customEdges: Array.isArray(initP.edges) ? structuredClone(initP.edges) : [{ id: "ce1", from: "c_s1", to: "c_p1", label: "账号密码" }],
    selNodeId: "",
    selEdgeId: "",
    connectMode: false,
    newNodeType: "process",
    newNodeName: "",
    pendingFlowName: "处理结果",
    nextSeq: 2
  };
  const getPayload = () => ({ mode: state.mode, foundIds: [...state.foundIds], nodes: structuredClone(state.customNodes), edges: structuredClone(state.customEdges) });
  const notify = () => opts.onChange?.(getPayload());

  const render = () => {
    const ch = fixedChallenge || DFD_CHALLENGES.find((x) => x.id === state.challengeId) || DFD_CHALLENGES[0];
    const isBuild = state.mode === "build";
    const nodes = isBuild ? state.customNodes : ch.nodes;
    const edges = isBuild ? state.customEdges : ch.edges;
    const nMap = new Map(nodes.map((n) => [n.id, n]));
    const check = isBuild ? validateDfdGraph(nodes, edges) : null;
    const faultCount = Object.keys(ch.faults || {}).length;
    const markChipsHtml = !isBuild ? `
      <div class="dfd-mark-list">
        ${[...state.foundIds].map((id) => `
          <span class="dfd-mark-chip">
            <span>${escapeHtml(describeDfdTarget(id, nodes, edges))}</span>
            ${readOnly ? "" : `<button type="button" class="btn ghost tiny js-dfd-unmark" data-unmark="${escapeHtml(id)}" style="padding:0 4px;">×</button>`}
          </span>
        `).join("") || '<span class="muted-text" style="font-size:0.7813rem;">尚未标记任何元素，请在左侧画布点击可疑节点或箭头。</span>'}
      </div>
    ` : "";
    const statusHtml = !isBuild
      ? `${studioSide ? `<div class="row-gap" style="justify-content:space-between;"><strong>已标违规项</strong><span class="badge ${state.foundIds.size === faultCount ? "ok" : "warn"}">${state.foundIds.size} / ${faultCount} 处</span></div>${markChipsHtml}` : ""}
         <div class="lab-feedback ${state.lastMsg.startsWith("违规") ? "ok" : "warn"}">${escapeHtml(state.lastMsg || (embedded ? "点击图中可疑的加工框或数据流箭头标记违规处（再次点击可取消）。" : "点击图中可疑的加工框或数据流箭头进行排错。"))}</div>`
      : `${readOnly ? "" : buildDfdInspectorHtml(state, nodes, edges)}
         <div class="lab-feedback ${check.valid ? "ok" : "warn"}">${check.valid ? "✓ 当前数据流图符合加工守恒、边界连接与命名规范！" : check.issues.map((i) => escapeHtml(i.msg)).join("；")}</div>`;
    const toolbarHtml = (!embedded || isBuild) ? `
      <div class="lab-toolbar">
        <div class="row-gap">
          ${embedded ? "" : `
            <div class="view-seg">
              <button type="button" class="view-seg-btn ${!isBuild ? "active" : ""}" data-dfd-mode="challenge">图面排错挑战</button>
              <button type="button" class="view-seg-btn ${isBuild ? "active" : ""}" data-dfd-mode="build">自由搭建与拖拽</button>
            </div>
          `}
          ${!isBuild ? `
            <select id="dfd-ch-sel" class="lab-select">${DFD_CHALLENGES.map((c) => `<option value="${c.id}" ${c.id === state.challengeId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
            <span class="badge ${state.foundIds.size === faultCount ? "ok" : "warn"}">已找出 ${state.foundIds.size} / ${faultCount} 处错误</span>
          ` : (readOnly ? "" : `
            <select id="dfd-new-type" class="lab-select">
              <option value="entity" ${state.newNodeType === "entity" ? "selected" : ""}>外部实体</option>
              <option value="process" ${state.newNodeType === "process" ? "selected" : ""}>加工</option>
              <option value="store" ${state.newNodeType === "store" ? "selected" : ""}>数据存储</option>
            </select>
            <input id="dfd-new-name" class="lab-txt-in" type="text" value="${escapeHtml(state.newNodeName)}" placeholder="输入名称后添加...">
            <button type="button" id="dfd-add-btn" class="btn primary tiny">+ 添加节点</button>
            <button type="button" id="dfd-clear-edges" class="btn ghost tiny">清空连线</button>
          `)}
        </div>
      </div>
    ` : "";

    root.innerHTML = `
      ${toolbarHtml}
      ${studioSide ? "" : `<p class="muted-text" style="margin:4px 0 6px;font-size:0.7813rem;">${isBuild ? "支持拖拽任意节点位置、输入节点/数据流名称并连线；下方实时进行 DFD 规范体检。" : escapeHtml(ch.desc)}</p>`}
      <div class="lab-svg-wrap is-canvas">
        <svg class="dfd-svg" viewBox="0 0 680 310" role="img" aria-label="数据流图实验画布">
          <defs><marker id="dfd-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--ink)"/></marker></defs>
          ${edges.map((e) => buildDfdEdgeSvg(e, nMap, { foundFault: !isBuild && state.foundIds.has(e.id), selected: isBuild && !readOnly && state.selEdgeId === e.id })).join("")}
          ${nodes.map((n) => buildDfdNodeSvg(n, { draggable: isBuild && !readOnly, foundFault: !isBuild && state.foundIds.has(n.id), selected: isBuild && !readOnly && state.selNodeId === n.id })).join("")}
        </svg>
      </div>
      ${studioSide ? "" : statusHtml}
    `;
    if (studioSide) studioSide.innerHTML = statusHtml;
    bindDfdEvents(ch, isBuild, nodes, edges);
  };

  const toggleChallengePick = (ch, id, nodes, edges) => {
    if (readOnly) return;
    if (embedded) {
      const label = describeDfdTarget(id, nodes, edges);
      if (state.foundIds.has(id)) { state.foundIds.delete(id); state.lastMsg = `已取消标记「${label}」。`; }
      else { state.foundIds.add(id); state.lastMsg = `已标记「${label}」为疑似违规点（再次点击可取消）。`; }
      notify(); return render();
    }
    state.lastMsg = ch.faults[id] || "该元素符合 DFD 规范，请继续查找其他违规之处。";
    if (ch.faults[id]) state.foundIds.add(id);
    render();
  };

  const bindDfdEvents = (ch, isBuild, nodes, edges) => {
    root.querySelectorAll("[data-dfd-mode]").forEach((b) => b.addEventListener("click", () => { state.mode = b.dataset.dfdMode; state.lastMsg = ""; state.connectMode = false; state.selNodeId = ""; state.selEdgeId = ""; render(); }));
    root.querySelector("#dfd-ch-sel")?.addEventListener("change", (e) => { state.challengeId = e.target.value; state.foundIds = new Set(); state.lastMsg = ""; render(); });
    sideRoot.querySelectorAll(".js-dfd-unmark").forEach((b) => b.addEventListener("click", () => {
      state.foundIds.delete(b.dataset.unmark); state.lastMsg = "已取消标记。"; notify(); render();
    }));
    if (!readOnly && isBuild) {
      root.querySelector("#dfd-new-type")?.addEventListener("change", (e) => { state.newNodeType = e.target.value; });
      root.querySelector("#dfd-new-name")?.addEventListener("input", (e) => { state.newNodeName = e.target.value; });
      root.querySelector("#dfd-add-btn")?.addEventListener("click", () => {
        const idx = state.nextSeq++; const t = state.newNodeType;
        const label = state.newNodeName.trim() || (t === "entity" ? `实体${idx}` : (t === "process" ? `${idx}.处理` : `存储${idx}`));
        const x = t === "entity" ? 95 : (t === "process" ? 335 : 575); const y = 65 + ((idx % 3) * 90); const id = `cn_${idx}`;
        state.customNodes.push({ id, type: t, label, x, y }); state.newNodeName = ""; state.selNodeId = id; state.selEdgeId = ""; notify(); render();
      });
      root.querySelector("#dfd-clear-edges")?.addEventListener("click", () => { state.customEdges = []; state.connectMode = false; state.selEdgeId = ""; notify(); render(); });
      sideRoot.querySelector("#dfd-rename-node")?.addEventListener("input", (e) => {
        const n = state.customNodes.find((x) => x.id === state.selNodeId);
        if (n) { n.label = e.target.value; const t = root.querySelector(`g[data-dfd-node="${n.id}"] text`); if (t) t.textContent = e.target.value; notify(); }
      });
      sideRoot.querySelector("#dfd-flow-name")?.addEventListener("input", (e) => { state.pendingFlowName = e.target.value; });
      sideRoot.querySelector("#dfd-connect-btn")?.addEventListener("click", () => { state.connectMode = !state.connectMode; render(); });
      sideRoot.querySelector("#dfd-del-node")?.addEventListener("click", () => {
        state.customNodes = state.customNodes.filter((n) => n.id !== state.selNodeId);
        state.customEdges = state.customEdges.filter((e) => e.from !== state.selNodeId && e.to !== state.selNodeId);
        state.selNodeId = ""; state.connectMode = false; notify(); render();
      });
      sideRoot.querySelector("#dfd-rename-edge")?.addEventListener("input", (e) => {
        const edge = state.customEdges.find((x) => x.id === state.selEdgeId);
        if (edge) { edge.label = e.target.value; notify(); render(); sideRoot.querySelector("#dfd-rename-edge")?.focus(); }
      });
      sideRoot.querySelector("#dfd-del-edge")?.addEventListener("click", () => { state.customEdges = state.customEdges.filter((x) => x.id !== state.selEdgeId); state.selEdgeId = ""; notify(); render(); });
    }

    const svg = root.querySelector(".dfd-svg");
    let dragInfo = null;
    root.querySelectorAll("g[data-dfd-node]").forEach((g) => g.addEventListener("pointerdown", (e) => {
      const id = g.dataset.dfdNode;
      if (!isBuild) return toggleChallengePick(ch, id, nodes, edges);
      if (readOnly) return;
      if (state.connectMode && state.selNodeId && state.selNodeId !== id) {
        state.customEdges.push({ id: `ce_${Date.now()}`, from: state.selNodeId, to: id, label: state.pendingFlowName.trim() || `数据流${state.customEdges.length + 1}` });
        state.connectMode = false; state.selNodeId = id; notify(); return render();
      }
      dragInfo = { id, startX: e.clientX, startY: e.clientY, moved: false };
      g.setPointerCapture?.(e.pointerId);
    }));
    svg?.addEventListener("pointermove", (e) => {
      if (!dragInfo) return;
      if (Math.hypot(e.clientX - dragInfo.startX, e.clientY - dragInfo.startY) > 5) dragInfo.moved = true;
      if (!dragInfo.moved) return;
      const p = clientToSvgPoint(svg, e.clientX, e.clientY);
      const n = state.customNodes.find((x) => x.id === dragInfo.id);
      if (n) { n.x = p.x; n.y = p.y; const g = svg.querySelector(`g[data-dfd-node="${n.id}"]`); if (g) g.setAttribute("transform", `translate(${n.x}, ${n.y})`); }
    });
    svg?.addEventListener("pointerup", () => {
      if (!dragInfo) return;
      const { id, moved } = dragInfo; dragInfo = null;
      if (!moved) { state.selNodeId = id; state.selEdgeId = ""; } else { notify(); }
      render();
    });
    root.querySelectorAll("g[data-dfd-edge]").forEach((el) => el.addEventListener("click", () => {
      const id = el.dataset.dfdEdge;
      if (!isBuild) return toggleChallengePick(ch, id, nodes, edges);
      if (readOnly) return;
      state.selEdgeId = id; state.selNodeId = ""; state.connectMode = false; render();
    }));
  };

  render();
  return { getPayload };
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
export const mountDecisionLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  let caseDef = embedded && opts.spec ? resolveDecisionCase(opts.spec) : DECISION_CASES[0];
  const initCols = opts.initialPayload?.columns;
  let cols = Array.isArray(initCols) && initCols.length ? structuredClone(initCols) : structuredClone(caseDef.columns);
  let selectedIds = new Set();
  let feedback = "点击条件格可切换 T / F / -，点击动作格可切换 ✓ / ·；勾选两列点击「合并选中两列」即可练习化简。";
  const getPayload = () => ({ columns: structuredClone(cols) });
  const notify = () => opts.onChange?.(getPayload());

  const render = () => {
    const minimal = isDecisionTableMinimal(cols);
    const disAttr = readOnly ? "disabled" : "";
    const sideHtml = `
      <div class="lab-feedback ${minimal ? "ok" : "warn"}" style="margin-top:0;">${escapeHtml(feedback)}</div>
      ${renderDecisionTreeHtml(caseDef, cols)}
    `;
    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          ${embedded ? "" : `
            <select id="dec-case-sel" class="lab-select">
              ${DECISION_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>
          `}
          <span class="badge ${minimal ? "ok" : "warn"}">${minimal ? `已最简（${cols.length} 列）` : `当前 ${cols.length} 列，还可继续化简`}</span>
        </div>
        ${readOnly ? "" : `
          <div class="row-gap">
            <button type="button" id="dec-add-col" class="btn ghost tiny">+ 添加规则列</button>
            <button type="button" id="dec-merge-btn" class="btn primary tiny" ${selectedIds.size !== 2 ? "disabled" : ""}>合并选中两列</button>
            <button type="button" id="dec-reset-btn" class="btn ghost tiny">重置初始表</button>
          </div>
        `}
      </div>
      <div class="table-wrap" style="margin-top:8px;">
        <table class="md-table dec-table">
          <thead>
            <tr>
              <th>规则列</th>
              ${cols.map((c) => `<th><label class="dec-col-chk"><input type="checkbox" data-dec-col="${escapeHtml(c.id)}" ${selectedIds.has(c.id) ? "checked" : ""} ${disAttr}><span>${escapeHtml(c.id)}</span></label></th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${caseDef.conditions.map((condName, ri) => `
              <tr>
                <td><strong>${escapeHtml(condName)}</strong></td>
                ${cols.map((c, ci) => `<td style="text-align:center;"><button type="button" class="dec-cell-btn ${c.conds[ri] === "-" ? "is-dash" : ""}" data-dec-cond="${ci}:${ri}" ${disAttr}>${escapeHtml(c.conds[ri])}</button></td>`).join("")}
              </tr>
            `).join("")}
            ${caseDef.actions.map((actName, ai) => `
              <tr>
                <td>${escapeHtml(actName)}</td>
                ${cols.map((c, ci) => `<td style="text-align:center;"><button type="button" class="dec-cell-btn" data-dec-act="${ci}:${ai}" ${disAttr}>${c.acts[ai] ? "✓" : "·"}</button></td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${studioSide ? "" : `<div style="margin-top:10px;">${sideHtml}</div>`}
    `;
    if (studioSide) studioSide.innerHTML = sideHtml;
    bindDecisionEvents();
  };

  const bindDecisionEvents = () => {
    root.querySelector("#dec-case-sel")?.addEventListener("change", (e) => {
      caseDef = DECISION_CASES.find((c) => c.id === e.target.value) || DECISION_CASES[0];
      cols = structuredClone(caseDef.columns); selectedIds = new Set(); feedback = "已切换判定表，请尝试编辑单元格或合并化简。"; notify(); render();
    });
    if (readOnly) return;
    root.querySelectorAll("[data-dec-col]").forEach((chk) => chk.addEventListener("change", () => {
      if (chk.checked) selectedIds.add(chk.dataset.decCol); else selectedIds.delete(chk.dataset.decCol);
      render();
    }));
    root.querySelectorAll("[data-dec-cond]").forEach((btn) => btn.addEventListener("click", () => {
      const [ci, ri] = btn.dataset.decCond.split(":").map(Number);
      const next = { T: "F", F: "-", "-": "T" };
      cols[ci].conds[ri] = next[cols[ci].conds[ri]] || "T";
      notify(); render();
    }));
    root.querySelectorAll("[data-dec-act]").forEach((btn) => btn.addEventListener("click", () => {
      const [ci, ai] = btn.dataset.decAct.split(":").map(Number);
      cols[ci].acts[ai] = !cols[ci].acts[ai];
      notify(); render();
    }));
    root.querySelector("#dec-add-col")?.addEventListener("click", () => {
      cols.push({ id: `R${cols.length + 1}`, conds: caseDef.conditions.map(() => "T"), acts: caseDef.actions.map(() => false) });
      notify(); render();
    });
    root.querySelector("#dec-merge-btn")?.addEventListener("click", () => {
      const [idA, idB] = [...selectedIds];
      const colA = cols.find((c) => c.id === idA);
      const colB = cols.find((c) => c.id === idB);
      const res = mergeDecisionCols(colA, colB);
      if (!res.ok) { feedback = `不能合并：${res.reason}`; return render(); }
      const idxA = cols.indexOf(colA);
      cols = cols.filter((c) => c.id !== idA && c.id !== idB);
      cols.splice(idxA, 0, res.merged);
      selectedIds.clear();
      feedback = isDecisionTableMinimal(cols) ? "✓ 合并成功，已达到最简判定表！" : `合并成功（生成 ${res.merged.id}），可继续寻找下一对互补列。`;
      notify(); render();
    });
    root.querySelector("#dec-reset-btn")?.addEventListener("click", () => {
      cols = structuredClone(caseDef.columns); selectedIds.clear(); feedback = "已重置为完整 2^n 初始判定表。"; notify(); render();
    });
  };

  render();
  return { getPayload };
};

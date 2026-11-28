import { escapeHtml } from "../api.js";
import { gradeOsMem, OS_MEM_CASES, solveOsMem } from "./os-mem-core.js";

export const resolveOsMemCase = (spec) => (
  spec?.caseDef?.mode ? spec.caseDef : (OS_MEM_CASES.find((c) => c.id === spec?.caseId) || OS_MEM_CASES[0])
);

const PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed"];

const renderAddrFlowSvg = (caseDef) => {
  const isSeg = caseDef.addrType === "seg";
  const parts = isSeg
    ? [`段号 S = ${caseDef.logicSeg}`, `段内偏移 W = ${caseDef.logicOffset}`, "查段表得基址 Base", "物理地址 = Base + W"]
    : [`逻辑地址 ${caseDef.logicAddr}`, `÷ ${caseDef.pageSizeBytes}B 得页号 P、偏移 W`, "查页表得块号 f", "物理地址 = f × 页大小 + W"];
  const boxes = parts.map((txt, i) => `
    <g transform="translate(${16 + i * 165}, 18)">
      <rect width="144" height="44" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5" />
      <text x="72" y="26" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${escapeHtml(txt)}</text>
      ${i < 3 ? '<path d="M146,22 L162,22" stroke="var(--accent)" stroke-width="1.8" marker-end="url(#mem-arr)" />' : ""}
    </g>
  `).join("");
  return `
    <div class="lab-svg-wrap is-canvas" style="margin-bottom:8px;">
      <svg class="pert-svg" viewBox="0 0 680 80" role="img" aria-label="地址变换流程图">
        <defs><marker id="mem-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--accent)" /></marker></defs>
        ${boxes}
      </svg>
    </div>
  `;
};

const renderAllocBarSvg = (caseDef, assignments = {}) => {
  const parts = caseDef.partitions || [];
  const totalK = Math.max(1, parts.reduce((m, p) => Math.max(m, Number(p.base) + Number(p.size)), 1));
  const w = 680;
  const mapX = (k) => 24 + (k / totalK) * (w - 48);
  const usedByPart = Object.fromEntries(parts.map((p) => [p.id, []]));
  (caseDef.jobs || []).forEach((j, idx) => {
    const a = assignments[j.id];
    if (a?.partId && usedByPart[a.partId]) usedByPart[a.partId].push({ id: j.id, size: j.size, col: PALETTE[idx % PALETTE.length] });
  });
  const rects = parts.map((p) => {
    const x = mapX(p.base);
    const pw = Math.max(24, mapX(p.base + p.size) - x);
    let cursor = x;
    const jobRects = (usedByPart[p.id] || []).map((jb) => {
      const jw = Math.max(12, Math.min(x + pw - cursor, (jb.size / p.size) * pw));
      const out = `<rect x="${cursor}" y="22" width="${jw}" height="38" fill="${jb.col}" opacity="0.82" stroke="var(--surface)" /><text x="${cursor + jw / 2}" y="45" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${escapeHtml(jb.id)}</text>`;
      cursor += jw;
      return out;
    }).join("");
    return `<g><rect x="${x}" y="22" width="${pw}" height="38" rx="4" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.5" />${jobRects}<text x="${x + pw / 2}" y="15" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${escapeHtml(p.id)} (${p.size}K)</text><text x="${x}" y="74" font-size="10" fill="var(--muted)">${p.base}K</text></g>`;
  }).join("");
  return `<div class="lab-svg-wrap is-canvas" style="margin-bottom:8px;"><svg class="pert-svg" viewBox="0 0 ${w} 86" role="img" aria-label="内存空闲分区分布图">${rects}</svg></div>`;
};

const renderMemVisual = (caseDef, sol, state) => {
  if (caseDef.mode === "addr") {
    const tbl = caseDef.addrType === "seg"
      ? `<div class="pert-grid-box"><div class="pert-grid-title">段表（逻辑地址：段号 S=${caseDef.logicSeg}，段内偏移 W=${caseDef.logicOffset}）</div><table class="pert-grid-table"><thead><tr><th>段号</th><th>段长</th><th>基址（B）</th></tr></thead><tbody>${caseDef.segTable.map((s) => `<tr class="${s.seg === caseDef.logicSeg ? "is-sel" : ""}"><td>${s.seg}</td><td>${s.len}</td><td>${s.base}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="pert-grid-box"><div class="pert-grid-title">页表与快表参数（页大小=${caseDef.pageSizeBytes}B，逻辑地址=${caseDef.logicAddr}；主存=${caseDef.memNs}ns，快表命中率=${caseDef.tlbHitPct}%）</div><table class="pert-grid-table"><thead><tr><th>页号</th><th>物理块号</th></tr></thead><tbody>${caseDef.pageTable.map((f, idx) => `<tr><td>${idx}</td><td>${f}</td></tr>`).join("")}</tbody></table></div>`;
    return `${renderAddrFlowSvg(caseDef)}${tbl}`;
  }
  if (caseDef.mode === "alloc") {
    return `
      ${renderAllocBarSvg(caseDef, state.assignments)}
      <div class="pert-grid-box"><div class="pert-grid-title">空闲分区链（${escapeHtml(String(caseDef.algo).toUpperCase())}）· 待分配作业：${caseDef.jobs.map((j) => `${escapeHtml(j.id)}(${j.size}K)`).join(" → ")}</div>
        <table class="pert-grid-table"><thead><tr><th>分区名</th><th>起始地址(K)</th><th>大小(K)</th></tr></thead>
        <tbody>${caseDef.partitions.map((p) => `<tr><td><strong>${escapeHtml(p.id)}</strong></td><td>${p.base}</td><td>${p.size}</td></tr>`).join("")}</tbody></table>
      </div>
    `;
  }
  const baseIdx = Number(caseDef.baseIndex ?? 1);
  const hasPick = state.row !== "" && state.row != null && state.col !== "" && state.col != null;
  return `
    <div class="pert-grid-box"><div class="pert-grid-title">磁盘位示图（${caseDef.rows}行 × ${caseDef.cols}列，行/列/盘块号均从 ${baseIdx} 开始；1=已占，0=空闲）</div>
      <table class="pert-grid-table"><thead><tr><th>行\\列</th>${Array.from({ length: caseDef.cols }, (_, c) => `<th>${c + baseIdx}</th>`).join("")}</tr></thead>
      <tbody>${sol.grid.map((rowArr, r) => `<tr><th>${r + baseIdx}</th>${rowArr.map((bit, c) => {
        const picked = hasPick && Number(state.row) === r + baseIdx && Number(state.col) === c + baseIdx;
        return `<td><button type="button" class="dec-cell-btn os-bm-cell ${bit ? "is-occ" : ""} ${picked ? "is-dash" : ""}" data-bm-r="${r + baseIdx}" data-bm-c="${c + baseIdx}">${bit}</button></td>`;
      }).join("")}</tr>`).join("")}</tbody></table>
    </div>
  `;
};

const renderMemSide = (caseDef, state, gr, disAttr) => {
  if (caseDef.mode === "addr" && caseDef.addrType === "page") {
    const ck = gr?.checks;
    return `<div class="lab-inspector" style="margin-top:0;"><div class="lab-inspector-row">
      <label>页号 <input type="number" class="pert-mini-in ${ck ? (ck.pageNo ? "is-ok" : "is-bad") : ""}" data-mm-f="pageNo" value="${escapeHtml(state.pageNo ?? "")}" ${disAttr}></label>
      <label>页内偏移 <input type="number" class="pert-mini-in ${ck ? (ck.offset ? "is-ok" : "is-bad") : ""}" data-mm-f="offset" value="${escapeHtml(state.offset ?? "")}" ${disAttr}></label>
      <label>块号 <input type="number" class="pert-mini-in ${ck ? (ck.frameNo ? "is-ok" : "is-bad") : ""}" data-mm-f="frameNo" value="${escapeHtml(state.frameNo ?? "")}" ${disAttr}></label>
      <label>物理地址 <input type="number" class="pert-mini-in ${ck ? (ck.physAddr ? "is-ok" : "is-bad") : ""}" style="width:78px;" data-mm-f="physAddr" value="${escapeHtml(state.physAddr ?? "")}" ${disAttr}></label>
      <label>快表 EAT(ns) <input type="number" class="pert-mini-in ${ck ? (ck.eatNs ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.eatNs ?? "")}" data-mm-f="eatNs" ${disAttr}></label>
    </div></div>`;
  }
  if (caseDef.mode === "addr") {
    const ck = gr?.checks;
    return `<div class="lab-inspector" style="margin-top:0;"><div class="lab-inspector-row">
      <label>段基址 <input type="number" class="pert-mini-in ${ck ? (ck.baseAddr ? "is-ok" : "is-bad") : ""}" style="width:78px;" data-mm-f="baseAddr" value="${escapeHtml(state.baseAddr ?? "")}" ${disAttr}></label>
      <label>物理地址 <input type="number" class="pert-mini-in ${ck ? (ck.physAddr ? "is-ok" : "is-bad") : ""}" style="width:78px;" data-mm-f="physAddr" value="${escapeHtml(state.physAddr ?? "")}" ${disAttr}></label>
    </div></div>`;
  }
  if (caseDef.mode === "alloc") {
    return `<div class="pert-grid-box"><div class="pert-grid-title">作业分区分配填报（选中后左侧内存条同步预览）</div><table class="pert-grid-table"><thead><tr><th>作业(需求)</th><th>分配分区</th><th>分配首址(K)</th></tr></thead><tbody>
      ${caseDef.jobs.map((j, idx) => {
        const u = state.assignments?.[j.id] || {};
        const r = gr?.results?.[idx];
        return `<tr><td><strong>${escapeHtml(j.id)}</strong> (${j.size}K)</td>
          <td><select class="lab-select ${r ? (r.pOk ? "is-ok" : "is-bad") : ""}" data-mm-job="${escapeHtml(j.id)}" ${disAttr}><option value="">选分区</option>${caseDef.partitions.map((p) => `<option value="${escapeHtml(p.id)}" ${u.partId === p.id ? "selected" : ""}>${escapeHtml(p.id)}</option>`).join("")}</select></td>
          <td><input type="number" class="pert-mini-in ${r ? (r.bOk ? "is-ok" : "is-bad") : ""}" data-mm-base="${escapeHtml(j.id)}" value="${escapeHtml(u.allocBase ?? "")}" ${disAttr}></td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  const ck = gr?.checks;
  const goalTxt = caseDef.op === "recycle" ? `回收盘块号 ${escapeHtml(String(caseDef.targetBlock))}：点击左图对应格自动填入或手填` : `扫描位示图分配第 1 个空闲块：点击左图空闲格自动填入`;
  return `<div class="lab-inspector" style="margin-top:0;"><div style="font-size:0.7813rem;font-weight:600;margin-bottom:6px;">${goalTxt}</div><div class="lab-inspector-row">
    <label>行号 i <input type="number" class="pert-mini-in ${ck ? (ck.row ? "is-ok" : "is-bad") : ""}" data-mm-f="row" value="${escapeHtml(state.row ?? "")}" ${disAttr}></label>
    <label>列号 j <input type="number" class="pert-mini-in ${ck ? (ck.col ? "is-ok" : "is-bad") : ""}" data-mm-f="col" value="${escapeHtml(state.col ?? "")}" ${disAttr}></label>
    <label>盘块号 b <input type="number" class="pert-mini-in ${ck ? (ck.blockNo ? "is-ok" : "is-bad") : ""}" data-mm-f="blockNo" value="${escapeHtml(state.blockNo ?? "")}" ${disAttr}></label>
    <label>新位值 <input type="number" min="0" max="1" class="pert-mini-in ${ck ? (ck.nextVal ? "is-ok" : "is-bad") : ""}" data-mm-f="nextVal" value="${escapeHtml(state.nextVal ?? "")}" ${disAttr}></label>
  </div></div>`;
};

/** 挂载存储与外存交互实验台（地址变换 / 动态分区 / 磁盘位示图） */
export const mountOsMemLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  const sideRoot = studioSide || root;
  let caseDef = embedded && opts.spec ? resolveOsMemCase(opts.spec) : OS_MEM_CASES[0];
  const state = { ...(opts.initialPayload || {}), assignments: structuredClone(opts.initialPayload?.assignments || {}), grade: opts.gradeResult?.detail ?? opts.gradeResult ?? null };
  const getPayload = () => { const copy = structuredClone(state); delete copy.grade; return copy; };
  const notify = () => opts.onChange?.(getPayload());
  const disAttr = readOnly ? "disabled" : "";

  const render = () => {
    const sol = solveOsMem(caseDef);
    const gr = state.grade;
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <select id="os-mm-sel" class="lab-select">${OS_MEM_CASES.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-mm-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-mm-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-mm-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const inputsHtml = renderMemSide(caseDef, state, gr, disAttr);
    const visualHtml = `${toolbarHtml}${renderMemVisual(caseDef, sol, state)}`;
    const feedback = gr && !embedded ? `<div class="lab-feedback ${gr.allCorrect ? "ok" : "warn"}">批改：${gr.score} / ${gr.total} 项正确</div>` : "";
    root.innerHTML = studioSide ? visualHtml : `${visualHtml}<div style="margin-top:8px;">${inputsHtml}${feedback}</div>`;
    if (studioSide) studioSide.innerHTML = `${inputsHtml}${feedback}`;

    root.querySelector("#os-mm-sel")?.addEventListener("change", (e) => {
      caseDef = OS_MEM_CASES.find((c) => c.id === e.target.value) || OS_MEM_CASES[0];
      Object.keys(state).forEach((k) => delete state[k]); state.assignments = {}; state.grade = null; render();
    });
    if (!readOnly) {
      sideRoot.querySelectorAll("[data-mm-f]").forEach((inp) => inp.addEventListener("input", () => { state[inp.dataset.mmF] = inp.value; state.grade = null; notify(); }));
      sideRoot.querySelectorAll("[data-mm-job]").forEach((sel) => sel.addEventListener("change", () => {
        state.assignments[sel.dataset.mmJob] = { ...(state.assignments[sel.dataset.mmJob] || {}), partId: sel.value }; state.grade = null; notify(); render();
      }));
      sideRoot.querySelectorAll("[data-mm-base]").forEach((inp) => inp.addEventListener("input", () => {
        state.assignments[inp.dataset.mmBase] = { ...(state.assignments[inp.dataset.mmBase] || {}), allocBase: inp.value }; state.grade = null; notify();
      }));
      root.querySelectorAll("[data-bm-r]").forEach((btn) => btn.addEventListener("click", () => {
        const baseIdx = Number(caseDef.baseIndex ?? 1);
        const r = Number(btn.dataset.bmR); const c = Number(btn.dataset.bmC);
        state.row = String(r); state.col = String(c); state.blockNo = String((r - baseIdx) * (caseDef.cols || 8) + (c - baseIdx) + baseIdx);
        state.nextVal = caseDef.op === "recycle" ? "0" : "1"; state.grade = null; notify(); render();
      }));
    }
    root.querySelector("#os-mm-grade")?.addEventListener("click", () => { state.grade = gradeOsMem(caseDef, getPayload()); render(); });
    root.querySelector("#os-mm-clear")?.addEventListener("click", () => { Object.keys(state).forEach((k) => delete state[k]); state.assignments = {}; state.grade = null; notify(); render(); });
    root.querySelector("#os-mm-fill")?.addEventListener("click", () => {
      if (caseDef.mode === "addr" && caseDef.addrType === "page") Object.assign(state, { pageNo: sol.pageNo, offset: sol.offset, frameNo: sol.frameNo, physAddr: sol.physAddr, eatNs: sol.eatNs });
      else if (caseDef.mode === "addr") Object.assign(state, { baseAddr: sol.baseAddr, physAddr: sol.physAddr });
      else if (caseDef.mode === "alloc") state.assignments = Object.fromEntries(sol.assignments.map((a) => [a.jobId, { partId: a.partId, allocBase: String(a.allocBase) }]));
      else Object.assign(state, { row: sol.row, col: sol.col, blockNo: sol.blockNo, nextVal: sol.nextVal });
      state.grade = gradeOsMem(caseDef, getPayload()); notify(); render();
    });
  };

  render();
  return { getPayload };
};

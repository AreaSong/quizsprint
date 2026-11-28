import { escapeHtml } from "../api.js";
import { gradeOsDisk, gradeOsPaging, OS_DISK_CASES, OS_PAGING_CASES, solveOsDisk, solveOsPaging } from "./os-lab-core.js";
import { gradeOsMem, OS_MEM_CASES, solveOsMem } from "./os-mem-core.js";

export const resolveOsPagingCase = (spec) => (
  spec?.caseDef?.refs?.length ? spec.caseDef : (OS_PAGING_CASES.find((c) => c.id === spec?.caseId) || OS_PAGING_CASES[0])
);
export const resolveOsDiskCase = (spec) => (
  spec?.caseDef?.requests?.length ? spec.caseDef : (OS_DISK_CASES.find((c) => c.id === spec?.caseId) || OS_DISK_CASES[0])
);
export const resolveOsMemCase = (spec) => (
  spec?.caseDef?.mode ? spec.caseDef : (OS_MEM_CASES.find((c) => c.id === spec?.caseId) || OS_MEM_CASES[0])
);

/** 挂载页面置换演练台（FIFO / LRU / OPT 物理块步进矩阵） */
export const mountOsPagingLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  const sideRoot = studioSide || root;
  let caseDef = embedded && opts.spec ? resolveOsPagingCase(opts.spec) : OS_PAGING_CASES[0];
  const initP = opts.initialPayload || {};
  const state = {
    frames: Array.isArray(initP.frames) ? structuredClone(initP.frames) : caseDef.refs.map(() => Array(caseDef.frames).fill("")),
    faults: Array.isArray(initP.faults) ? [...initP.faults] : caseDef.refs.map(() => false),
    faultCount: initP.faultCount ?? "",
    faultRate: initP.faultRate ?? "",
    grade: opts.gradeResult?.detail ?? opts.gradeResult ?? null
  };
  const getPayload = () => ({ frames: structuredClone(state.frames), faults: [...state.faults], faultCount: state.faultCount, faultRate: state.faultRate });
  const notify = () => opts.onChange?.(getPayload());
  const disAttr = readOnly ? "disabled" : "";

  const render = () => {
    const sol = solveOsPaging(caseDef);
    const gr = state.grade;
    const refs = caseDef.refs || [];
    const cap = caseDef.frames || 3;
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <select id="os-pg-sel" class="lab-select">${OS_PAGING_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-pg-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-pg-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-pg-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const gridHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">物理块步进表（${escapeHtml(caseDef.algo.toUpperCase())} · ${cap} 个物理块，点击「复制左列」可快速延续）</div>
        <table class="pert-grid-table">
          <thead>
            <tr>
              <th>访问页</th>
              ${refs.map((p, i) => `<th><strong>${p}</strong>${i > 0 && !readOnly ? `<div><button type="button" class="btn ghost tiny js-pg-copy" data-col="${i}" style="padding:0 4px;font-size:0.65rem;" title="复制上一列">←</button></div>` : ""}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: cap }, (_, r) => `
              <tr>
                <td>块 ${r + 1}</td>
                ${refs.map((_, c) => {
                  const ok = gr?.stepResults?.[c]?.memOk;
                  return `<td><input type="number" class="pert-mini-in ${gr ? (ok ? "is-ok" : "is-bad") : ""}" style="width:34px;padding:2px;" data-pg-c="${c}" data-pg-r="${r}" value="${escapeHtml(state.frames[c]?.[r] ?? "")}" ${disAttr}></td>`;
                }).join("")}
              </tr>
            `).join("")}
            <tr>
              <td>缺页?</td>
              ${refs.map((_, c) => {
                const ok = gr?.stepResults?.[c]?.fOk;
                return `<td class="${gr ? (ok ? "is-ok" : "is-bad") : ""}"><input type="checkbox" data-pg-f="${c}" ${state.faults[c] ? "checked" : ""} ${disAttr}></td>`;
              }).join("")}
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const summaryHtml = `
      <div class="lab-inspector" style="margin-top:0;">
        <div class="lab-inspector-row">
          <label>缺页次数 <input id="os-pg-cnt" type="number" class="pert-mini-in ${gr ? (gr.cntOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.faultCount)}" placeholder="?" ${disAttr}></label>
          <label>缺页率(%) <input id="os-pg-rate" type="number" step="0.1" class="pert-mini-in ${gr ? (gr.rateOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.faultRate)}" placeholder="?" ${disAttr}></label>
        </div>
      </div>
      ${gr && !embedded ? `<div class="lab-feedback ${gr.allCorrect ? "ok" : "warn"}">批改：${gr.score} / ${gr.total} 项正确（参考缺页 ${sol.faultCount} 次，缺页率 ${sol.faultRate}%）</div>` : ""}
    `;
    root.innerHTML = studioSide ? `${toolbarHtml}${gridHtml}` : `${toolbarHtml}${gridHtml}<div style="margin-top:8px;">${summaryHtml}</div>`;
    if (studioSide) studioSide.innerHTML = summaryHtml;

    root.querySelector("#os-pg-sel")?.addEventListener("change", (e) => {
      caseDef = OS_PAGING_CASES.find((c) => c.id === e.target.value) || OS_PAGING_CASES[0];
      state.frames = caseDef.refs.map(() => Array(caseDef.frames).fill("")); state.faults = caseDef.refs.map(() => false);
      state.faultCount = ""; state.faultRate = ""; state.grade = null; render();
    });
    if (!readOnly) {
      root.querySelectorAll("[data-pg-c]").forEach((inp) => inp.addEventListener("input", () => {
        const c = Number(inp.dataset.pgC); const r = Number(inp.dataset.pgR);
        state.frames[c] = [...(state.frames[c] || Array(cap).fill(""))];
        state.frames[c][r] = inp.value; state.grade = null; notify();
      }));
      root.querySelectorAll("[data-pg-f]").forEach((chk) => chk.addEventListener("change", () => {
        state.faults[Number(chk.dataset.pgF)] = chk.checked; state.grade = null; notify();
      }));
      root.querySelectorAll(".js-pg-copy").forEach((btn) => btn.addEventListener("click", () => {
        const c = Number(btn.dataset.col);
        state.frames[c] = [...(state.frames[c - 1] || Array(cap).fill(""))];
        state.grade = null; notify(); render();
      }));
      sideRoot.querySelector("#os-pg-cnt")?.addEventListener("input", (e) => { state.faultCount = e.target.value; state.grade = null; notify(); });
      sideRoot.querySelector("#os-pg-rate")?.addEventListener("input", (e) => { state.faultRate = e.target.value; state.grade = null; notify(); });
    }
    root.querySelector("#os-pg-grade")?.addEventListener("click", () => { state.grade = gradeOsPaging(caseDef, getPayload()); render(); });
    root.querySelector("#os-pg-clear")?.addEventListener("click", () => {
      state.frames = caseDef.refs.map(() => Array(cap).fill("")); state.faults = caseDef.refs.map(() => false);
      state.faultCount = ""; state.faultRate = ""; state.grade = null; notify(); render();
    });
    root.querySelector("#os-pg-fill")?.addEventListener("click", () => {
      state.frames = sol.steps.map((s) => s.frames.map((v) => (v == null ? "" : String(v))));
      state.faults = sol.steps.map((s) => s.fault);
      state.faultCount = String(sol.faultCount); state.faultRate = String(sol.faultRate);
      state.grade = gradeOsPaging(caseDef, getPayload()); notify(); render();
    });
  };

  render();
  return { getPayload };
};

const buildDiskSvg = (caseDef, seq) => {
  const minT = Number(caseDef.minTrack ?? 0);
  const maxT = Number(caseDef.maxTrack ?? 199);
  const span = (maxT - minT) || 1;
  const w = 680;
  const pts = [Number(caseDef.head), ...seq];
  const h = Math.max(180, 62 + pts.length * 24);
  const mapX = (t) => 42 + ((Math.max(minT, Math.min(maxT, t)) - minT) / span) * (w - 84);
  const poly = pts.map((t, i) => `${mapX(t)},${48 + i * 22}`).join(" ");
  const ticks = [...new Set([minT, caseDef.head, ...caseDef.requests, maxT])].sort((a, b) => a - b);
  return `
    <svg class="pert-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="磁盘磁头移动轨迹图">
      <line x1="42" y1="30" x2="${w - 42}" y2="30" stroke="var(--line-strong)" stroke-width="2" />
      ${ticks.map((t) => `<g transform="translate(${mapX(t)}, 30)"><line y1="-4" y2="4" stroke="var(--muted)" /><text y="-10" text-anchor="middle" font-size="10" fill="${t === caseDef.head ? "var(--accent-fg)" : "var(--muted)"}">${t}</text></g>`).join("")}
      <polyline fill="none" stroke="var(--accent)" stroke-width="2.2" points="${poly}" />
      ${pts.map((t, i) => `
        <g transform="translate(${mapX(t)}, ${48 + i * 22})">
          <circle r="5" fill="${i === 0 ? "var(--ok)" : "var(--accent)"}" />
          <text x="10" y="4" font-size="11" font-weight="600" fill="var(--ink)">${i === 0 ? `起点 ${t}` : `#${i}: ${t}`}</text>
        </g>
      `).join("")}
    </svg>
  `;
};

/** 挂载磁盘调度轨迹画布实验台（FCFS / SSTF / SCAN / CSCAN） */
export const mountOsDiskLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  const sideRoot = studioSide || root;
  let caseDef = embedded && opts.spec ? resolveOsDiskCase(opts.spec) : OS_DISK_CASES[0];
  const initP = opts.initialPayload || {};
  const state = {
    seqStr: typeof initP.seqStr === "string" ? initP.seqStr : (Array.isArray(initP.sequence) ? initP.sequence.join(", ") : ""),
    totalSeek: initP.totalSeek ?? "",
    avgSeek: initP.avgSeek ?? "",
    grade: opts.gradeResult?.detail ?? opts.gradeResult ?? null
  };
  const parseSeq = () => state.seqStr.split(/(?:->|[\s,，;；→])+/).filter(Boolean).map(Number).filter(Number.isFinite);
  const getPayload = () => ({ seqStr: state.seqStr, sequence: parseSeq(), totalSeek: state.totalSeek, avgSeek: state.avgSeek });
  const notify = () => opts.onChange?.(getPayload());
  const disAttr = readOnly ? "disabled" : "";

  const render = () => {
    const sol = solveOsDisk(caseDef);
    const curSeq = parseSeq();
    const gr = state.grade;
    const usedMap = new Map();
    curSeq.forEach((x) => usedMap.set(x, (usedMap.get(x) || 0) + 1));
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <select id="os-dk-sel" class="lab-select">${OS_DISK_CASES.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-dk-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-dk-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-dk-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const canvasHtml = `${toolbarHtml}<div class="lab-svg-wrap is-canvas" style="margin-top:${embedded ? "0" : "6px"};">${buildDiskSvg(caseDef, curSeq)}</div>`;
    const sideHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">点击磁道请求按序排入服务轨迹（起点磁头=${Number(caseDef.head)}，${escapeHtml(String(caseDef.algo).toUpperCase())} ${caseDef.direction === "down" ? "向小磁道" : "向大磁道"}）</div>
        <div class="row-gap" style="margin-bottom:8px;">
          ${caseDef.requests.map((r) => {
            const left = usedMap.get(r) || 0;
            if (left > 0) usedMap.set(r, left - 1);
            return `<button type="button" class="btn tiny ${left > 0 ? "ghost" : "soft-active"}" data-dk-pick="${Number(r)}" ${readOnly || left > 0 ? "disabled" : ""}>+ ${Number(r)}</button>`;
          }).join("")}
          ${readOnly ? "" : '<button type="button" id="os-dk-pop" class="btn ghost tiny">撤销</button>'}
        </div>
        <input id="os-dk-seq" type="text" value="${escapeHtml(state.seqStr)}" placeholder="或直接输入磁道访问序列（逗号分隔）" style="width:100%;" ${readOnly ? "readonly" : ""}>
      </div>
      <div class="lab-inspector" style="margin-top:0;">
        <div class="lab-inspector-row">
          <label>总寻道长度 <input id="os-dk-tot" type="number" class="pert-mini-in ${gr ? (gr.totalOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.totalSeek)}" placeholder="?" ${disAttr}></label>
          <label>平均寻道长度 <input id="os-dk-avg" type="number" step="0.01" class="pert-mini-in ${gr ? (gr.avgOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.avgSeek)}" placeholder="?" ${disAttr}></label>
        </div>
      </div>
      ${gr && !embedded ? `<div class="lab-feedback ${gr.allCorrect ? "ok" : "warn"}">批改：${gr.score} / ${gr.total} 项正确（参考序列：${sol.sequence.join("→")}，总寻道 ${sol.totalSeek}）</div>` : ""}
    `;
    root.innerHTML = studioSide ? canvasHtml : `${canvasHtml}<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">${sideHtml}</div>`;
    if (studioSide) studioSide.innerHTML = sideHtml;

    root.querySelector("#os-dk-sel")?.addEventListener("change", (e) => {
      caseDef = OS_DISK_CASES.find((c) => c.id === e.target.value) || OS_DISK_CASES[0];
      state.seqStr = ""; state.totalSeek = ""; state.avgSeek = ""; state.grade = null; render();
    });
    if (!readOnly) {
      sideRoot.querySelectorAll("[data-dk-pick]").forEach((b) => b.addEventListener("click", () => {
        const arr = parseSeq(); arr.push(Number(b.dataset.dkPick)); state.seqStr = arr.join(", "); state.grade = null; notify(); render();
      }));
      sideRoot.querySelector("#os-dk-pop")?.addEventListener("click", () => {
        const arr = parseSeq(); arr.pop(); state.seqStr = arr.join(", "); state.grade = null; notify(); render();
      });
      sideRoot.querySelector("#os-dk-seq")?.addEventListener("input", (e) => {
        const pos = e.target.selectionStart; state.seqStr = e.target.value; state.grade = null; notify(); render();
        const nextEl = sideRoot.querySelector("#os-dk-seq");
        if (nextEl) { nextEl.focus(); if (pos != null) nextEl.setSelectionRange(pos, pos); }
      });
      sideRoot.querySelector("#os-dk-tot")?.addEventListener("input", (e) => { state.totalSeek = e.target.value; state.grade = null; notify(); });
      sideRoot.querySelector("#os-dk-avg")?.addEventListener("input", (e) => { state.avgSeek = e.target.value; state.grade = null; notify(); });
    }
    root.querySelector("#os-dk-grade")?.addEventListener("click", () => { state.grade = gradeOsDisk(caseDef, getPayload()); render(); });
    root.querySelector("#os-dk-clear")?.addEventListener("click", () => { state.seqStr = ""; state.totalSeek = ""; state.avgSeek = ""; state.grade = null; notify(); render(); });
    root.querySelector("#os-dk-fill")?.addEventListener("click", () => {
      state.seqStr = sol.sequence.join(", "); state.totalSeek = String(sol.totalSeek); state.avgSeek = String(sol.avgSeek);
      state.grade = gradeOsDisk(caseDef, getPayload()); notify(); render();
    });
  };

  render();
  return { getPayload };
};

const renderMemVisual = (caseDef, sol, state) => {
  if (caseDef.mode === "addr") {
    if (caseDef.addrType === "seg") {
      return `
        <div class="pert-grid-box"><div class="pert-grid-title">段表（当前访问逻辑地址：段号 S=${caseDef.logicSeg}，段内偏移 W=${caseDef.logicOffset}）</div>
          <table class="pert-grid-table"><thead><tr><th>段号</th><th>段长</th><th>基址（B）</th></tr></thead>
          <tbody>${caseDef.segTable.map((s) => `<tr class="${s.seg === caseDef.logicSeg ? "is-sel" : ""}"><td>${s.seg}</td><td>${s.len}</td><td>${s.base}</td></tr>`).join("")}</tbody></table>
        </div>
      `;
    }
    return `
      <div class="pert-grid-box"><div class="pert-grid-title">页表与快表参数（页大小=${caseDef.pageSizeBytes}B，逻辑地址=${caseDef.logicAddr}；主存=${caseDef.memNs}ns，快表命中率=${caseDef.tlbHitPct}%）</div>
        <table class="pert-grid-table"><thead><tr><th>页号</th><th>物理块号</th></tr></thead>
        <tbody>${caseDef.pageTable.map((f, idx) => `<tr><td>${idx}</td><td>${f}</td></tr>`).join("")}</tbody></table>
      </div>
    `;
  }
  if (caseDef.mode === "alloc") {
    return `
      <div class="pert-grid-box"><div class="pert-grid-title">空闲分区链（${escapeHtml(String(caseDef.algo).toUpperCase())}）· 待分配作业：${caseDef.jobs.map((j) => `${escapeHtml(j.id)}(${j.size}K)`).join(" → ")}</div>
        <table class="pert-grid-table"><thead><tr><th>分区名</th><th>起始地址(K)</th><th>大小(K)</th></tr></thead>
        <tbody>${caseDef.partitions.map((p) => `<tr><td><strong>${escapeHtml(p.id)}</strong></td><td>${p.base}</td><td>${p.size}</td></tr>`).join("")}</tbody></table>
      </div>
    `;
  }
  const baseIdx = Number(caseDef.baseIndex ?? 1);
  return `
    <div class="pert-grid-box"><div class="pert-grid-title">磁盘位示图（${caseDef.rows}行 × ${caseDef.cols}列，行/列/盘块号均从 ${baseIdx} 开始；1=已占，0=空闲）</div>
      <table class="pert-grid-table"><thead><tr><th>行\\列</th>${Array.from({ length: caseDef.cols }, (_, c) => `<th>${c + baseIdx}</th>`).join("")}</tr></thead>
      <tbody>${sol.grid.map((rowArr, r) => `<tr><th>${r + baseIdx}</th>${rowArr.map((bit, c) => {
        const picked = Number(state.row) === r + baseIdx && Number(state.col) === c + baseIdx;
        return `<td><button type="button" class="dec-cell-btn ${picked ? "is-dash" : ""}" data-bm-r="${r + baseIdx}" data-bm-c="${c + baseIdx}">${bit}</button></td>`;
      }).join("")}</tr>`).join("")}</tbody></table>
    </div>
  `;
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
        <select id="os-mm-sel" class="lab-select">${OS_MEM_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-mm-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-mm-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-mm-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    let inputsHtml = "";
    if (caseDef.mode === "addr" && caseDef.addrType === "page") {
      const ck = gr?.checks;
      inputsHtml = `<div class="lab-inspector" style="margin-top:0;"><div class="lab-inspector-row">
        <label>页号 <input type="number" class="pert-mini-in ${ck ? (ck.pageNo ? "is-ok" : "is-bad") : ""}" data-mm-f="pageNo" value="${escapeHtml(state.pageNo ?? "")}" ${disAttr}></label>
        <label>页内偏移 <input type="number" class="pert-mini-in ${ck ? (ck.offset ? "is-ok" : "is-bad") : ""}" data-mm-f="offset" value="${escapeHtml(state.offset ?? "")}" ${disAttr}></label>
        <label>块号 <input type="number" class="pert-mini-in ${ck ? (ck.frameNo ? "is-ok" : "is-bad") : ""}" data-mm-f="frameNo" value="${escapeHtml(state.frameNo ?? "")}" ${disAttr}></label>
        <label>物理地址 <input type="number" class="pert-mini-in ${ck ? (ck.physAddr ? "is-ok" : "is-bad") : ""}" style="width:72px;" data-mm-f="physAddr" value="${escapeHtml(state.physAddr ?? "")}" ${disAttr}></label>
        <label>快表 EAT(ns) <input type="number" class="pert-mini-in ${ck ? (ck.eatNs ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.eatNs ?? "")}" data-mm-f="eatNs" ${disAttr}></label>
      </div></div>`;
    } else if (caseDef.mode === "addr") {
      const ck = gr?.checks;
      inputsHtml = `<div class="lab-inspector" style="margin-top:0;"><div class="lab-inspector-row">
        <label>段基址 <input type="number" class="pert-mini-in ${ck ? (ck.baseAddr ? "is-ok" : "is-bad") : ""}" style="width:74px;" data-mm-f="baseAddr" value="${escapeHtml(state.baseAddr ?? "")}" ${disAttr}></label>
        <label>物理地址 <input type="number" class="pert-mini-in ${ck ? (ck.physAddr ? "is-ok" : "is-bad") : ""}" style="width:74px;" data-mm-f="physAddr" value="${escapeHtml(state.physAddr ?? "")}" ${disAttr}></label>
      </div></div>`;
    } else if (caseDef.mode === "alloc") {
      inputsHtml = `<div class="pert-grid-box"><div class="pert-grid-title">作业分区分配填报</div><table class="pert-grid-table"><thead><tr><th>作业(需求)</th><th>分配分区</th><th>分配首址(K)</th></tr></thead><tbody>
        ${caseDef.jobs.map((j, idx) => {
          const u = state.assignments?.[j.id] || {};
          const r = gr?.results?.[idx];
          return `<tr><td><strong>${escapeHtml(j.id)}</strong> (${j.size}K)</td>
            <td><select class="lab-select ${r ? (r.pOk ? "is-ok" : "is-bad") : ""}" data-mm-job="${escapeHtml(j.id)}" ${disAttr}><option value="">选分区</option>${caseDef.partitions.map((p) => `<option value="${escapeHtml(p.id)}" ${u.partId === p.id ? "selected" : ""}>${escapeHtml(p.id)}</option>`).join("")}</select></td>
            <td><input type="number" class="pert-mini-in ${r ? (r.bOk ? "is-ok" : "is-bad") : ""}" data-mm-base="${escapeHtml(j.id)}" value="${escapeHtml(u.allocBase ?? "")}" ${disAttr}></td></tr>`;
        }).join("")}</tbody></table></div>`;
    } else {
      const ck = gr?.checks;
      const goalTxt = caseDef.op === "recycle" ? `回收盘块号 ${caseDef.targetBlock}：算出行号、列号并填入新位值（也可点左表对应格）` : `扫描位示图分配第 1 个空闲块：写出所在行号、列号、盘块号与新位值`;
      inputsHtml = `<div class="lab-inspector" style="margin-top:0;"><div style="font-size:0.7813rem;font-weight:600;margin-bottom:6px;">${goalTxt}</div><div class="lab-inspector-row">
        <label>行号 i <input type="number" class="pert-mini-in ${ck ? (ck.row ? "is-ok" : "is-bad") : ""}" data-mm-f="row" value="${escapeHtml(state.row ?? "")}" ${disAttr}></label>
        <label>列号 j <input type="number" class="pert-mini-in ${ck ? (ck.col ? "is-ok" : "is-bad") : ""}" data-mm-f="col" value="${escapeHtml(state.col ?? "")}" ${disAttr}></label>
        <label>盘块号 b <input type="number" class="pert-mini-in ${ck ? (ck.blockNo ? "is-ok" : "is-bad") : ""}" data-mm-f="blockNo" value="${escapeHtml(state.blockNo ?? "")}" ${disAttr}></label>
        <label>新位值 <input type="number" min="0" max="1" class="pert-mini-in ${ck ? (ck.nextVal ? "is-ok" : "is-bad") : ""}" data-mm-f="nextVal" value="${escapeHtml(state.nextVal ?? "")}" ${disAttr}></label>
      </div></div>`;
    }
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
        state.assignments[sel.dataset.mmJob] = { ...(state.assignments[sel.dataset.mmJob] || {}), partId: sel.value }; state.grade = null; notify();
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

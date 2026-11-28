import { escapeHtml } from "../api.js";
import { gradeOsDisk, gradeOsPaging, OS_DISK_CASES, OS_PAGING_CASES, solveOsDisk, solveOsPaging } from "./os-lab-core.js";

export const resolveOsPagingCase = (spec) => (
  spec?.caseDef?.refs?.length ? spec.caseDef : (OS_PAGING_CASES.find((c) => c.id === spec?.caseId) || OS_PAGING_CASES[0])
);
export const resolveOsDiskCase = (spec) => (
  spec?.caseDef?.requests?.length ? spec.caseDef : (OS_DISK_CASES.find((c) => c.id === spec?.caseId) || OS_DISK_CASES[0])
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
        <select id="os-pg-sel" class="lab-select">${OS_PAGING_CASES.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-pg-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-pg-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-pg-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const gridHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">物理块步进画布（${escapeHtml(caseDef.algo.toUpperCase())} · ${cap} 个物理块，点击列头「←」快速复制左列，点底部切换命中/缺页）</div>
        <table class="pert-grid-table">
          <thead>
            <tr>
              <th>访问页</th>
              ${refs.map((p, i) => `<th><strong style="font-size:0.9375rem;">${escapeHtml(String(p))}</strong>${i > 0 && !readOnly ? `<div><button type="button" class="btn ghost tiny js-pg-copy" data-col="${i}" style="padding:1px 6px;font-size:0.7rem;" title="复制上一列">←</button></div>` : ""}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: cap }, (_, r) => `
              <tr>
                <td>块 ${r + 1}</td>
                ${refs.map((_, c) => {
                  const ok = gr?.stepResults?.[c]?.memOk;
                  return `<td><input type="number" class="pert-mini-in os-pg-cell ${gr ? (ok ? "is-ok" : "is-bad") : ""}" data-pg-c="${c}" data-pg-r="${r}" value="${escapeHtml(state.frames[c]?.[r] ?? "")}" ${disAttr}></td>`;
                }).join("")}
              </tr>
            `).join("")}
            <tr>
              <td>状态</td>
              ${refs.map((_, c) => {
                const ok = gr?.stepResults?.[c]?.fOk;
                const isF = Boolean(state.faults[c]);
                return `<td class="${gr ? (ok ? "is-ok" : "is-bad") : ""}"><button type="button" class="dec-cell-btn ${isF ? "is-dash" : ""}" data-pg-ftog="${c}" ${disAttr}>${isF ? "✗ 缺" : "✓ 中"}</button></td>`;
              }).join("")}
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const checkedFaults = state.faults.filter(Boolean).length;
    const summaryHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">缺页统计（访问总次数 = ${refs.length}）</div>
        <div class="lab-inspector-row">
          <label>缺页次数 <input id="os-pg-cnt" type="number" class="pert-mini-in ${gr ? (gr.cntOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.faultCount)}" placeholder="?" ${disAttr}></label>
          <label>缺页率(%) <input id="os-pg-rate" type="number" step="0.1" class="pert-mini-in ${gr ? (gr.rateOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.faultRate)}" placeholder="?" ${disAttr}></label>
        </div>
        <div class="muted-text" style="font-size:0.75rem;margin-top:8px;">当前画布已标「✗ 缺」：${checkedFaults} 次 · 公式：缺页率 = 缺页次数 ÷ ${refs.length} × 100%</div>
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
      root.querySelectorAll("[data-pg-ftog]").forEach((btn) => btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.pgFtog);
        state.faults[idx] = !state.faults[idx]; state.grade = null; notify(); render();
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

const buildDiskSvg = (caseDef, seq, readOnly) => {
  const minT = Number(caseDef.minTrack ?? 0);
  const maxT = Number(caseDef.maxTrack ?? 199);
  const span = (maxT - minT) || 1;
  const w = 680;
  const pts = [Number(caseDef.head), ...seq];
  const h = Math.max(210, 68 + pts.length * 24);
  const mapX = (t) => 42 + ((Math.max(minT, Math.min(maxT, t)) - minT) / span) * (w - 84);
  const poly = pts.map((t, i) => `${mapX(t)},${54 + i * 23}`).join(" ");
  const reqCounts = new Map();
  (caseDef.requests || []).forEach((x) => { const n = Number(x); reqCounts.set(n, (reqCounts.get(n) || 0) + 1); });
  const usedMap = new Map();
  seq.forEach((x) => { const n = Number(x); usedMap.set(n, (usedMap.get(n) || 0) + 1); });
  const ticks = [...new Set([minT, Number(caseDef.head), ...(caseDef.requests || []).map(Number), maxT])].sort((a, b) => a - b);
  const axisMarks = ticks.map((t) => {
    const isReq = reqCounts.has(t);
    const rem = (reqCounts.get(t) || 0) - (usedMap.get(t) || 0);
    const canPick = !readOnly && rem > 0;
    const hitAttr = canPick ? `class="disk-axis-hit" data-dk-pick="${Number(t)}"` : "";
    const col = t === Number(caseDef.head) ? "var(--ok)" : (canPick ? "var(--accent)" : "var(--muted)");
    return `<g ${hitAttr} transform="translate(${mapX(t)}, 30)"><line y1="-5" y2="5" stroke="${col}" stroke-width="${isReq ? 1.8 : 1}" />${isReq ? `<circle r="${canPick ? 5.5 : 3.5}" fill="${canPick ? "var(--accent)" : "var(--surface)"}" stroke="${col}" stroke-width="1.5" />` : ""}<text y="-11" text-anchor="middle" font-size="11" font-weight="${isReq ? 700 : 400}" fill="${col}">${Number(t)}</text></g>`;
  }).join("");
  const legs = pts.map((t, i) => {
    const dTxt = i > 0 ? ` (+${Math.abs(t - pts[i - 1])})` : "";
    return `<g transform="translate(${mapX(t)}, ${54 + i * 23})"><circle r="5" fill="${i === 0 ? "var(--ok)" : "var(--accent)"}" /><text x="10" y="4" font-size="11" font-weight="600" fill="var(--ink)">${i === 0 ? `起点 ${t}` : `#${i}: ${t}${dTxt}`}</text></g>`;
  }).join("");
  return `<svg class="pert-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="磁盘磁头移动轨迹图"><line x1="42" y1="30" x2="${w - 42}" y2="30" stroke="var(--line-strong)" stroke-width="2" />${axisMarks}<polyline fill="none" stroke="var(--accent)" stroke-width="2.2" points="${poly}" />${legs}</svg>`;
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
    curSeq.forEach((x) => { const n = Number(x); usedMap.set(n, (usedMap.get(n) || 0) + 1); });
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
    const tip = readOnly ? "" : '<div class="muted-text" style="font-size:0.75rem;">直接点击下方刻度尺上的蓝色磁道圆点按序连线绘制轨迹</div>';
    const canvasHtml = `${toolbarHtml}${tip}<div class="lab-svg-wrap is-canvas">${buildDiskSvg(caseDef, curSeq, readOnly)}</div>`;
    const sideHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">请求磁道调度序列（起点=${Number(caseDef.head)}，${escapeHtml(String(caseDef.algo).toUpperCase())} ${caseDef.direction === "down" ? "向小磁道" : "向大磁道"}）</div>
        <div class="row-gap" style="margin-bottom:8px;">
          ${caseDef.requests.map((r) => {
            const nr = Number(r);
            const left = usedMap.get(nr) || 0;
            if (left > 0) usedMap.set(nr, left - 1);
            return `<button type="button" class="btn tiny ${left > 0 ? "ghost" : "soft-active"}" data-dk-pick="${nr}" ${readOnly || left > 0 ? "disabled" : ""}>+ ${nr}</button>`;
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
      const bindPick = (scope) => scope.querySelectorAll("[data-dk-pick]").forEach((b) => b.addEventListener("click", () => {
        const arr = parseSeq(); arr.push(Number(b.dataset.dkPick)); state.seqStr = arr.join(", "); state.grade = null; notify(); render();
      }));
      bindPick(root);
      if (studioSide) bindPick(studioSide);
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

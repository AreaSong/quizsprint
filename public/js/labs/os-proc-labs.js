import { escapeHtml } from "../api.js";
import {
  gradeBankerAttempt,
  gradeOsScheduling,
  OS_BANKER_CASES,
  OS_SCHED_CASES,
  solveBankerCase,
  solveOsScheduling
} from "./os-lab-core.js";

export const resolveOsSchedCase = (spec) => (
  spec?.caseDef?.processes?.length ? spec.caseDef : (OS_SCHED_CASES.find((c) => c.id === spec?.caseId) || OS_SCHED_CASES[0])
);

export const resolveOsBankerCase = (spec) => (
  spec?.caseDef?.processes?.length ? spec.caseDef : (OS_BANKER_CASES.find((c) => c.id === spec?.caseId) || OS_BANKER_CASES[0])
);

const PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626"];

const buildGanttSvg = (caseDef, sol, showBars) => {
  const procs = caseDef.processes || [];
  const totalT = sol.gantt.reduce((m, g) => Math.max(m, g.end), 1);
  const w = 680;
  const mapX = (t) => 36 + (t / totalT) * (w - 64);
  if (!showBars) {
    const bars = procs.map((p, i) => `
      <g transform="translate(36, ${26 + i * 32})">
        <text x="-8" y="14" text-anchor="end" font-size="12" font-weight="700" fill="var(--ink)">${escapeHtml(p.id)}</text>
        <rect x="0" y="0" width="${Math.max(24, (p.burst / totalT) * (w - 90))}" height="20" rx="5" fill="${PALETTE[i % PALETTE.length]}" opacity="0.24" stroke="${PALETTE[i % PALETTE.length]}" />
        <text x="8" y="14" font-size="11" fill="var(--ink)">到达=${p.arrival} · 服务=${p.burst}</text>
      </g>
    `).join("");
    return `<svg class="pert-svg" viewBox="0 0 ${w} ${44 + procs.length * 32}" role="img" aria-label="进程参数视图">${bars}<text x="36" y="16" font-size="11" fill="var(--muted)">提交核对或背题模式后显示完整时间执行甘特图</text></svg>`;
  }

  const ticks = new Set([0]);
  const colorMap = Object.fromEntries(procs.map((p, i) => [p.id, PALETTE[i % PALETTE.length]]));
  const segs = sol.gantt.map((g) => {
    ticks.add(g.end);
    const x = mapX(g.start);
    const bw = Math.max(10, mapX(g.end) - x);
    const col = colorMap[g.id] || "#2563eb";
    return `
      <g>
        <rect x="${x}" y="30" width="${bw}" height="42" rx="4" fill="${col}" opacity="0.88" stroke="var(--surface)" stroke-width="1.5" />
        <text x="${x + bw / 2}" y="55" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${escapeHtml(g.id)}</text>
      </g>
    `;
  }).join("");
  const tickMarks = [...ticks].sort((a, b) => a - b).map((t) => {
    const x = mapX(t);
    return `<line x1="${x}" y1="74" x2="${x}" y2="82" stroke="var(--ink)" /><text x="${x}" y="96" text-anchor="middle" font-size="11" fill="var(--ink)">${t}</text>`;
  }).join("");
  return `
    <svg class="pert-svg" viewBox="0 0 ${w} 112" role="img" aria-label="进程调度甘特图">
      <text x="36" y="18" font-size="11" fill="var(--muted)">执行时间轴（甘特图 · ${escapeHtml(caseDef.algo.toUpperCase())}${caseDef.algo === "rr" ? ` q=${caseDef.quantum}` : ""}）</text>
      ${segs}
      <line x1="36" y1="76" x2="${w - 28}" y2="76" stroke="var(--line-strong)" stroke-width="1.5" />
      ${tickMarks}
    </svg>
  `;
};

/** 挂载操作系统进程调度演练台（FCFS / SJF / HRRN / RR） */
export const mountOsSchedLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  const sideRoot = studioSide || root;
  let caseDef = embedded && opts.spec ? resolveOsSchedCase(opts.spec) : OS_SCHED_CASES[0];
  const initP = opts.initialPayload || {};
  const state = {
    rows: structuredClone(initP.rows || {}),
    avgTurnaround: initP.avgTurnaround ?? "",
    avgWeighted: initP.avgWeighted ?? "",
    grade: opts.gradeResult?.detail ?? opts.gradeResult ?? null
  };
  const getPayload = () => ({
    rows: structuredClone(state.rows),
    avgTurnaround: state.avgTurnaround,
    avgWeighted: state.avgWeighted
  });
  const notify = () => opts.onChange?.(getPayload());
  const disAttr = readOnly ? "disabled" : "";

  const render = () => {
    const sol = solveOsScheduling(caseDef);
    const gr = state.grade;
    const showBars = Boolean(readOnly || gr);
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <div class="row-gap">
          <select id="os-sc-sel" class="lab-select">${OS_SCHED_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        </div>
        <div class="row-gap">
          <button type="button" id="os-sc-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-sc-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-sc-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const tableHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">时间指标计算表（${escapeHtml(caseDef.algo.toUpperCase())}${caseDef.algo === "rr" ? `，时间片 q=${caseDef.quantum}` : ""}）</div>
        <table class="pert-grid-table">
          <thead><tr><th>进程</th><th>到达</th><th>服务</th><th>完成</th><th>周转</th><th>带权周转</th></tr></thead>
          <tbody>
            ${caseDef.processes.map((p) => {
              const u = state.rows[p.id] || {};
              const rr = gr?.rowResults?.[p.id];
              return `
                <tr>
                  <td><strong>${escapeHtml(p.id)}</strong></td>
                  <td>${p.arrival}</td>
                  <td>${p.burst}</td>
                  <td><input type="number" step="0.01" class="pert-mini-in ${rr ? (rr.fOk ? "is-ok" : "is-bad") : ""}" data-sc-id="${escapeHtml(p.id)}" data-sc-k="finish" value="${escapeHtml(u.finish ?? "")}" placeholder="?" ${disAttr}></td>
                  <td><input type="number" step="0.01" class="pert-mini-in ${rr ? (rr.tOk ? "is-ok" : "is-bad") : ""}" data-sc-id="${escapeHtml(p.id)}" data-sc-k="turnaround" value="${escapeHtml(u.turnaround ?? "")}" placeholder="?" ${disAttr}></td>
                  <td><input type="number" step="0.01" class="pert-mini-in ${rr ? (rr.wOk ? "is-ok" : "is-bad") : ""}" data-sc-id="${escapeHtml(p.id)}" data-sc-k="weighted" value="${escapeHtml(u.weighted ?? "")}" placeholder="?" ${disAttr}></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="lab-inspector" style="margin-top:0;">
        <div class="lab-inspector-row">
          <label>平均周转时间 <input id="os-sc-avgt" type="number" step="0.01" class="pert-mini-in ${gr ? (gr.avgTOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.avgTurnaround)}" placeholder="?" ${disAttr}></label>
          <label>平均带权周转 <input id="os-sc-avgw" type="number" step="0.01" class="pert-mini-in ${gr ? (gr.avgWOk ? "is-ok" : "is-bad") : ""}" value="${escapeHtml(state.avgWeighted)}" placeholder="?" ${disAttr}></label>
        </div>
      </div>
      ${gr && !embedded ? `<div class="lab-feedback ${gr.allCorrect ? "ok" : "warn"}">批改：${gr.score} / ${gr.total} 项正确（平均周转=${sol.avgTurnaround}，平均带权=${sol.avgWeighted}）</div>` : ""}
    `;
    const canvasHtml = `${toolbarHtml}<div class="lab-svg-wrap is-canvas" style="margin-top:${embedded ? "0" : "6px"};">${buildGanttSvg(caseDef, sol, showBars)}</div>`;
    root.innerHTML = studioSide ? canvasHtml : `${canvasHtml}<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">${tableHtml}</div>`;
    if (studioSide) studioSide.innerHTML = tableHtml;

    root.querySelector("#os-sc-sel")?.addEventListener("change", (e) => {
      caseDef = OS_SCHED_CASES.find((c) => c.id === e.target.value) || OS_SCHED_CASES[0];
      state.rows = {}; state.avgTurnaround = ""; state.avgWeighted = ""; state.grade = null; render();
    });
    if (!readOnly) {
      sideRoot.querySelectorAll("[data-sc-id]").forEach((inp) => inp.addEventListener("input", () => {
        const id = inp.dataset.scId;
        state.rows[id] = { ...(state.rows[id] || {}), [inp.dataset.scK]: inp.value };
        state.grade = null; notify();
      }));
      sideRoot.querySelector("#os-sc-avgt")?.addEventListener("input", (e) => { state.avgTurnaround = e.target.value; state.grade = null; notify(); });
      sideRoot.querySelector("#os-sc-avgw")?.addEventListener("input", (e) => { state.avgWeighted = e.target.value; state.grade = null; notify(); });
    }
    root.querySelector("#os-sc-grade")?.addEventListener("click", () => { state.grade = gradeOsScheduling(caseDef, getPayload()); render(); });
    root.querySelector("#os-sc-clear")?.addEventListener("click", () => { state.rows = {}; state.avgTurnaround = ""; state.avgWeighted = ""; state.grade = null; notify(); render(); });
    root.querySelector("#os-sc-fill")?.addEventListener("click", () => {
      state.rows = Object.fromEntries(sol.rows.map((r) => [r.id, { finish: String(r.finish), turnaround: String(r.turnaround), weighted: String(r.weighted) }]));
      state.avgTurnaround = String(sol.avgTurnaround); state.avgWeighted = String(sol.avgWeighted);
      state.grade = gradeOsScheduling(caseDef, getPayload()); notify(); render();
    });
  };

  render();
  return { getPayload };
};

/** 挂载操作系统银行家算法演练台（Need 矩阵 + 安全序列交互构造） */
export const mountOsBankerLab = (root, opts = {}) => {
  const embedded = Boolean(opts.embedded);
  const readOnly = Boolean(opts.readOnly);
  const studioSide = opts.studio && opts.sideSlot ? opts.sideSlot : null;
  const sideRoot = studioSide || root;
  let caseDef = embedded && opts.spec ? resolveOsBankerCase(opts.spec) : OS_BANKER_CASES[0];
  const initP = opts.initialPayload || {};
  const state = {
    need: structuredClone(initP.need || {}),
    safe: initP.safe !== undefined ? Boolean(initP.safe) : true,
    sequence: Array.isArray(initP.sequence) ? [...initP.sequence] : [],
    grade: opts.gradeResult?.detail ?? opts.gradeResult ?? null
  };
  const getPayload = () => ({ need: structuredClone(state.need), safe: state.safe, sequence: [...state.sequence] });
  const notify = () => opts.onChange?.(getPayload());
  const disAttr = readOnly ? "disabled" : "";

  const render = () => {
    const sol = solveBankerCase(caseDef);
    const gr = state.grade;
    const resNames = caseDef.resources || ["A", "B", "C"];
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <select id="os-bk-sel" class="lab-select">${OS_BANKER_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-bk-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-bk-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-bk-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const resText = resNames.map((n) => escapeHtml(n)).join(" ");
    const matrixHtml = `
      ${caseDef.request ? `<div class="lab-feedback warn" style="margin-top:0;margin-bottom:8px;">请求向量：进程 <strong>${escapeHtml(caseDef.request.pid)}</strong> 提出申请 <code>Request = (${caseDef.request.vec.join(", ")})</code>（提示：表中填入 <strong>T0 初始 Need = Max - Allocation</strong>，右侧判断试探分配后是否安全及序列）</div>` : ""}
      <div class="pert-grid-box">
        <div class="pert-grid-title">资源分配与需求矩阵 · T0 Available = (${caseDef.available.join(", ")})</div>
        <table class="pert-grid-table">
          <thead><tr><th>进程</th><th>Allocation<br>(${resText})</th><th>Max<br>(${resText})</th><th>Need = Max - Alloc</th></tr></thead>
          <tbody>
            ${caseDef.processes.map((p) => {
              const uRow = state.need[p.id] || [];
              const okRow = gr?.needOk?.[p.id];
              return `
                <tr>
                  <td><strong>${escapeHtml(p.id)}</strong></td>
                  <td>${p.alloc.join(" &nbsp; ")}</td>
                  <td>${p.max.join(" &nbsp; ")}</td>
                  <td>${resNames.map((_, j) => `<input type="number" min="0" class="pert-mini-in ${okRow ? (okRow[j] ? "is-ok" : "is-bad") : ""}" style="width:40px;margin:0 2px;" data-bk-p="${escapeHtml(p.id)}" data-bk-j="${j}" value="${escapeHtml(uRow[j] ?? "")}" placeholder="?" ${disAttr}>`).join("")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
    const seqHtml = `
      <div class="pert-grid-box">
        <div class="pert-grid-title">安全性判定与安全序列构造</div>
        <div class="row-gap" style="margin-bottom:8px;">
          <button type="button" class="btn tiny ${state.safe ? "soft-active" : "ghost"}" data-bk-safe="1" ${disAttr}>安全（可分配）</button>
          <button type="button" class="btn tiny ${!state.safe ? "soft-active" : "ghost"}" data-bk-safe="0" ${disAttr}>不安全（阻塞等待）</button>
        </div>
        ${state.safe ? `
          <div class="muted-text" style="font-size:0.75rem;margin-bottom:6px;">依次点击下列进程追加到安全序列：</div>
          <div class="row-gap" style="margin-bottom:8px;">
            ${caseDef.processes.map((p) => `<button type="button" class="btn tiny ${state.sequence.includes(p.id) ? "ghost" : "soft-active"}" data-bk-pick="${escapeHtml(p.id)}" ${readOnly || state.sequence.includes(p.id) ? "disabled" : ""}>+ ${escapeHtml(p.id)}</button>`).join("")}
            ${readOnly ? "" : '<button type="button" id="os-bk-pop" class="btn ghost tiny">撤销</button><button type="button" id="os-bk-seqclr" class="btn ghost tiny">清空</button>'}
          </div>
          <div class="lab-feedback ${gr ? (gr.seqOk ? "ok" : "warn") : ""}" style="margin-top:0;">
            当前安全序列：<strong>${state.sequence.length ? `&lt; ${state.sequence.map((s) => escapeHtml(s)).join(" → ")} &gt;` : "（待点选构造）"}</strong>
          </div>
        ` : `<div class="lab-feedback" style="margin-top:0;">已判定当前请求或状态为不安全（无需填写安全序列）。</div>`}
      </div>
      ${gr && !embedded ? `<div class="lab-feedback ${gr.allCorrect ? "ok" : "warn"}">批改：${gr.score} / ${gr.total} 项正确${sol.safe ? `（参考序列 &lt;${sol.safeSeq.map((s) => escapeHtml(s)).join(", ")}&gt;）` : "（系统处于不安全状态）"}</div>` : ""}
    `;
    root.innerHTML = studioSide ? `${toolbarHtml}${matrixHtml}` : `${toolbarHtml}${matrixHtml}<div style="margin-top:8px;">${seqHtml}</div>`;
    if (studioSide) studioSide.innerHTML = seqHtml;

    root.querySelector("#os-bk-sel")?.addEventListener("change", (e) => {
      caseDef = OS_BANKER_CASES.find((c) => c.id === e.target.value) || OS_BANKER_CASES[0];
      state.need = {}; state.safe = true; state.sequence = []; state.grade = null; render();
    });
    if (!readOnly) {
      root.querySelectorAll("[data-bk-p]").forEach((inp) => inp.addEventListener("input", () => {
        const pid = inp.dataset.bkP; const j = Number(inp.dataset.bkJ);
        const row = [...(state.need[pid] || [])];
        row[j] = inp.value;
        state.need[pid] = row; state.grade = null; notify();
      }));
      sideRoot.querySelectorAll("[data-bk-safe]").forEach((b) => b.addEventListener("click", () => {
        state.safe = b.dataset.bkSafe === "1"; if (!state.safe) state.sequence = []; state.grade = null; notify(); render();
      }));
      sideRoot.querySelectorAll("[data-bk-pick]").forEach((b) => b.addEventListener("click", () => {
        if (!state.sequence.includes(b.dataset.bkPick)) { state.sequence.push(b.dataset.bkPick); state.grade = null; notify(); render(); }
      }));
      sideRoot.querySelector("#os-bk-pop")?.addEventListener("click", () => { state.sequence.pop(); state.grade = null; notify(); render(); });
      sideRoot.querySelector("#os-bk-seqclr")?.addEventListener("click", () => { state.sequence = []; state.grade = null; notify(); render(); });
    }
    root.querySelector("#os-bk-grade")?.addEventListener("click", () => { state.grade = gradeBankerAttempt(caseDef, getPayload()); render(); });
    root.querySelector("#os-bk-clear")?.addEventListener("click", () => { state.need = {}; state.safe = true; state.sequence = []; state.grade = null; notify(); render(); });
    root.querySelector("#os-bk-fill")?.addEventListener("click", () => {
      state.need = Object.fromEntries(Object.entries(sol.needRows).map(([k, arr]) => [k, arr.map(String)]));
      state.safe = sol.safe; state.sequence = [...sol.safeSeq]; state.grade = gradeBankerAttempt(caseDef, getPayload());
      notify(); render();
    });
  };

  render();
  return { getPayload };
};

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

const renderGanttTrack = (gantt, colorMap, mapX, yTop, label) => {
  const ticks = new Set([0]);
  const segs = gantt.map((g) => {
    const s = Number(g.start);
    const e = Number(g.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return "";
    ticks.add(s);
    ticks.add(e);
    const x = mapX(s);
    const bw = Math.max(12, mapX(e) - x);
    const col = colorMap[g.id] || "#2563eb";
    return `<g><rect x="${x}" y="${yTop}" width="${bw}" height="38" rx="4" fill="${col}" opacity="0.88" stroke="var(--surface)" stroke-width="1.5" /><text x="${x + bw / 2}" y="${yTop + 23}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${escapeHtml(g.id)}</text></g>`;
  }).join("");
  const tickMarks = [...ticks].sort((a, b) => a - b).map((t) => {
    const x = mapX(t);
    return `<line x1="${x}" y1="${yTop + 40}" x2="${x}" y2="${yTop + 47}" stroke="var(--ink)" /><text x="${x}" y="${yTop + 60}" text-anchor="middle" font-size="11" fill="var(--ink)">${Number(t)}</text>`;
  }).join("");
  return `<text x="36" y="${yTop - 8}" font-size="11" font-weight="600" fill="var(--muted)">${escapeHtml(label)}</text>${segs}<line x1="36" y1="${yTop + 42}" x2="652" y2="${yTop + 42}" stroke="var(--line-strong)" stroke-width="1.5" />${tickMarks}`;
};

const buildGanttSvg = (caseDef, sol, userGantt, showBars, readOnlyNoDraft) => {
  const procs = caseDef.processes || [];
  const solEnd = sol.gantt.reduce((m, g) => Math.max(m, Number(g.end) || 0), 1);
  const usrEnd = userGantt.reduce((m, g) => Math.max(m, Number(g.end) || 0), 0);
  const totalT = Math.max(solEnd, usrEnd, 1);
  const w = 680;
  const mapX = (t) => 36 + (t / totalT) * (w - 64);
  const colorMap = Object.fromEntries(procs.map((p, i) => [p.id, PALETTE[i % PALETTE.length]]));
  if (readOnlyNoDraft && showBars) {
    const refOnly = renderGanttTrack(sol.gantt, colorMap, mapX, 30, `参考调度甘特图（${escapeHtml(String(caseDef.algo).toUpperCase())}）`);
    return `<svg class="pert-svg" viewBox="0 0 ${w} 122" role="img" aria-label="进程调度甘特图">${refOnly}</svg>`;
  }
  const h = showBars ? 204 : 122;

  const emptyHint = userGantt.length ? "" : `<rect x="36" y="30" width="${w - 64}" height="38" rx="6" fill="none" stroke="var(--line-strong)" stroke-dasharray="6 4" /><text x="${w / 2}" y="53" text-anchor="middle" font-size="12" fill="var(--muted)">点击上方进程按钮在时间轴上拼接甘特图（总跨度 0 ~ ${totalT}）</text>`;
  const userTrack = userGantt.length
    ? renderGanttTrack(userGantt, colorMap, mapX, 30, `你的甘特图草稿（当前结束时刻 t=${usrEnd}）`)
    : `<text x="36" y="22" font-size="11" font-weight="600" fill="var(--muted)">时间执行轨道（${escapeHtml(String(caseDef.algo).toUpperCase())}${caseDef.algo === "rr" ? ` · q=${Number(caseDef.quantum)}` : ""}）</text>${emptyHint}<line x1="36" y1="72" x2="${w - 28}" y2="72" stroke="var(--line-strong)" stroke-width="1.5" /><text x="36" y="89" text-anchor="middle" font-size="11" fill="var(--ink)">0</text><text x="${w - 28}" y="89" text-anchor="middle" font-size="11" fill="var(--muted)">${totalT}</text>`;
  const refTrack = showBars ? renderGanttTrack(sol.gantt, colorMap, mapX, 118, `参考调度甘特图（${escapeHtml(String(caseDef.algo).toUpperCase())}）`) : "";

  return `<svg class="pert-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="进程调度甘特图">${userTrack}${refTrack}</svg>`;
};

const calcSchedRemain = (caseDef, userGantt) => {
  const used = Object.fromEntries((caseDef.processes || []).map((p) => [p.id, 0]));
  for (const g of userGantt) used[g.id] = (used[g.id] || 0) + Math.max(0, Number(g.end) - Number(g.start));
  const curEnd = userGantt.length ? Number(userGantt[userGantt.length - 1].end || 0) : 0;
  return { used, curEnd };
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
    userGantt: Array.isArray(initP.userGantt) ? structuredClone(initP.userGantt) : [],
    avgTurnaround: initP.avgTurnaround ?? "",
    avgWeighted: initP.avgWeighted ?? "",
    grade: opts.gradeResult?.detail ?? opts.gradeResult ?? null
  };
  const getPayload = () => ({
    rows: structuredClone(state.rows),
    userGantt: structuredClone(state.userGantt),
    avgTurnaround: state.avgTurnaround,
    avgWeighted: state.avgWeighted
  });
  const notify = () => opts.onChange?.(getPayload());
  const disAttr = readOnly ? "disabled" : "";

  const render = () => {
    const sol = solveOsScheduling(caseDef);
    const gr = state.grade;
    const showBars = Boolean(readOnly || gr);
    const readOnlyNoDraft = Boolean(readOnly && !state.userGantt.length);
    const { used, curEnd } = calcSchedRemain(caseDef, state.userGantt);
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <select id="os-sc-sel" class="lab-select">${OS_SCHED_CASES.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-sc-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-sc-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-sc-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const builderHtml = readOnly ? "" : `
      <div class="os-gantt-bar-row">
        <span class="muted-text" style="font-size:0.75rem;font-weight:600;">在画布排程（当前时刻 t=${curEnd}）：</span>
        ${caseDef.processes.map((p) => {
          const rem = Math.max(0, Number(p.burst) - (used[p.id] || 0));
          const step = caseDef.algo === "rr" ? Math.min(Number(caseDef.quantum || 2), rem) : rem;
          return `<button type="button" class="btn tiny ${rem > 0 ? "soft-active" : "ghost"} js-sc-add" data-pid="${escapeHtml(p.id)}" ${rem <= 0 ? "disabled" : ""}>+ ${escapeHtml(p.id)} (剩${rem}${step > 0 && step < rem ? `, +${step}` : ""})</button>`;
        }).join("")}
        <button type="button" id="os-sc-gpop" class="btn ghost tiny" ${state.userGantt.length ? "" : "disabled"}>撤销</button>
        <button type="button" id="os-sc-gclr" class="btn ghost tiny" ${state.userGantt.length ? "" : "disabled"}>清空甘特图</button>
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
                  <td>${Number(p.arrival)}</td>
                  <td>${Number(p.burst)}</td>
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
    const canvasHtml = `${toolbarHtml}${builderHtml}<div class="lab-svg-wrap is-canvas">${buildGanttSvg(caseDef, sol, state.userGantt, showBars, readOnlyNoDraft)}</div>`;
    root.innerHTML = studioSide ? canvasHtml : `${canvasHtml}<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">${tableHtml}</div>`;
    if (studioSide) studioSide.innerHTML = tableHtml;

    root.querySelector("#os-sc-sel")?.addEventListener("change", (e) => {
      caseDef = OS_SCHED_CASES.find((c) => c.id === e.target.value) || OS_SCHED_CASES[0];
      state.rows = {}; state.userGantt = []; state.avgTurnaround = ""; state.avgWeighted = ""; state.grade = null; render();
    });
    if (!readOnly) {
      root.querySelectorAll(".js-sc-add").forEach((b) => b.addEventListener("click", () => {
        const p = caseDef.processes.find((x) => x.id === b.dataset.pid);
        if (!p) return;
        const rem = Math.max(0, Number(p.burst) - (used[p.id] || 0));
        const run = caseDef.algo === "rr" ? Math.min(Number(caseDef.quantum || 2), rem) : rem;
        if (run <= 0) return;
        const start = Math.max(curEnd, Number(p.arrival || 0));
        state.userGantt.push({ id: p.id, start, end: start + run });
        state.grade = null; notify(); render();
      }));
      root.querySelector("#os-sc-gpop")?.addEventListener("click", () => { state.userGantt.pop(); state.grade = null; notify(); render(); });
      root.querySelector("#os-sc-gclr")?.addEventListener("click", () => { state.userGantt = []; state.grade = null; notify(); render(); });
      sideRoot.querySelectorAll("[data-sc-id]").forEach((inp) => inp.addEventListener("input", () => {
        const id = inp.dataset.scId;
        state.rows[id] = { ...(state.rows[id] || {}), [inp.dataset.scK]: inp.value };
        state.grade = null; notify();
      }));
      sideRoot.querySelector("#os-sc-avgt")?.addEventListener("input", (e) => { state.avgTurnaround = e.target.value; state.grade = null; notify(); });
      sideRoot.querySelector("#os-sc-avgw")?.addEventListener("input", (e) => { state.avgWeighted = e.target.value; state.grade = null; notify(); });
    }
    root.querySelector("#os-sc-grade")?.addEventListener("click", () => { state.grade = gradeOsScheduling(caseDef, getPayload()); render(); });
    root.querySelector("#os-sc-clear")?.addEventListener("click", () => { state.rows = {}; state.userGantt = []; state.avgTurnaround = ""; state.avgWeighted = ""; state.grade = null; notify(); render(); });
    root.querySelector("#os-sc-fill")?.addEventListener("click", () => {
      state.rows = Object.fromEntries(sol.rows.map((r) => [r.id, { finish: String(r.finish), turnaround: String(r.turnaround), weighted: String(r.weighted) }]));
      state.userGantt = structuredClone(sol.gantt);
      state.avgTurnaround = String(sol.avgTurnaround); state.avgWeighted = String(sol.avgWeighted);
      state.grade = gradeOsScheduling(caseDef, getPayload()); notify(); render();
    });
  };

  render();
  return { getPayload };
};

const calcBankerWorkScratch = (caseDef, userNeed, seq) => {
  const m = caseDef.available.length;
  let work = [...caseDef.available];
  const req = caseDef.request;
  if (req) work = work.map((v, j) => v - Number(req.vec[j] || 0));
  for (const pid of seq) {
    const p = caseDef.processes.find((x) => x.id === pid);
    if (!p) continue;
    work = work.map((v, j) => v + p.alloc[j] + (req?.pid === pid ? Number(req.vec[j] || 0) : 0));
  }
  const fitStatus = Object.fromEntries(caseDef.processes.map((p) => {
    const row = userNeed[p.id] || [];
    let missing = false;
    for (let j = 0; j < m; j += 1) {
      if (row[j] === "" || row[j] == null || !Number.isFinite(Number(row[j]))) { missing = true; break; }
    }
    if (missing) return [p.id, "pending"];
    const ok = Array.from({ length: m }, (_, j) => {
      const nVal = Number(row[j]) - (req?.pid === p.id ? Number(req.vec[j] || 0) : 0);
      return nVal >= 0 && nVal <= work[j];
    }).every(Boolean);
    return [p.id, ok ? "fit" : "wait"];
  }));
  return { work, fitStatus };
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
    const resText = resNames.map((n) => escapeHtml(n)).join(" ");
    const { work, fitStatus } = calcBankerWorkScratch(caseDef, state.need, state.sequence);
    const toolbarHtml = embedded ? "" : `
      <div class="lab-toolbar">
        <select id="os-bk-sel" class="lab-select">${OS_BANKER_CASES.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        <div class="row-gap">
          <button type="button" id="os-bk-grade" class="btn primary tiny">自动批改</button>
          <button type="button" id="os-bk-fill" class="btn ghost tiny">填入参考答案</button>
          <button type="button" id="os-bk-clear" class="btn ghost tiny">清空重做</button>
        </div>
      </div>
    `;
    const matrixHtml = `
      ${caseDef.request ? `<div class="lab-feedback warn" style="margin-top:0;">请求向量：进程 <strong>${escapeHtml(caseDef.request.pid)}</strong> 申请 <code>Request = (${caseDef.request.vec.join(", ")})</code>（下表填 <strong>T0 初始 Need = Max - Alloc</strong>）</div>` : ""}
      <div class="pert-grid-box">
        <div class="pert-grid-title">资源分配与需求矩阵 · T0 Available = (${caseDef.available.join(", ")})</div>
        <table class="pert-grid-table">
          <thead><tr><th>进程</th><th>Allocation<br>(${resText})</th><th>Max<br>(${resText})</th><th>Need = Max - Alloc</th><th>试算比对</th></tr></thead>
          <tbody>
            ${caseDef.processes.map((p) => {
              const uRow = state.need[p.id] || [];
              const okRow = gr?.needOk?.[p.id];
              const fs = state.sequence.includes(p.id) ? "done" : fitStatus[p.id];
              const badge = fs === "done" ? '<span class="badge ok">已入列</span>' : fs === "fit" ? '<span class="badge ok">Need≤Work</span>' : fs === "wait" ? '<span class="badge warn">暂不足</span>' : '<span class="muted-text">-</span>';
              return `
                <tr>
                  <td><strong>${escapeHtml(p.id)}</strong></td>
                  <td>${p.alloc.join(" &nbsp; ")}</td>
                  <td>${p.max.join(" &nbsp; ")}</td>
                  <td>${resNames.map((_, j) => `<input type="number" min="0" class="pert-mini-in ${okRow ? (okRow[j] ? "is-ok" : "is-bad") : ""}" style="width:44px;margin:0 2px;" data-bk-p="${escapeHtml(p.id)}" data-bk-j="${j}" value="${escapeHtml(uRow[j] ?? "")}" placeholder="?" ${disAttr}>`).join("")}</td>
                  <td data-bk-badge="${escapeHtml(p.id)}">${badge}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="os-work-strip">
        <span>当前试算向量 <strong>Work = (${work.join(", ")})</strong></span>
        <span class="muted-text" style="font-size:0.75rem;">根据你填入的 Need 与右侧已选序列实时推演</span>
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
      const refreshBankerScratch = () => {
        const next = calcBankerWorkScratch(caseDef, state.need, state.sequence);
        const wEl = root.querySelector(".os-work-strip strong");
        if (wEl) wEl.textContent = `Work = (${next.work.join(", ")})`;
        caseDef.processes.forEach((p) => {
          const cell = root.querySelector(`[data-bk-badge="${CSS.escape(p.id)}"]`);
          if (!cell) return;
          const fs = state.sequence.includes(p.id) ? "done" : next.fitStatus[p.id];
          cell.innerHTML = fs === "done" ? '<span class="badge ok">已入列</span>' : fs === "fit" ? '<span class="badge ok">Need≤Work</span>' : fs === "wait" ? '<span class="badge warn">暂不足</span>' : '<span class="muted-text">-</span>';
        });
      };
      root.querySelectorAll("[data-bk-p]").forEach((inp) => inp.addEventListener("input", () => {
        const pid = inp.dataset.bkP; const j = Number(inp.dataset.bkJ);
        const row = [...(state.need[pid] || [])];
        row[j] = inp.value; state.need[pid] = row; state.grade = null; notify(); refreshBankerScratch();
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

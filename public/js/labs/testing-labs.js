import { escapeHtml } from "../api.js";
import { BLACKBOX_CASES, evaluateBlackboxInputs, evaluateWhiteboxCases, WHITEBOX_SPEC } from "./se-lab-core.js";

const buildAxisSvg = (caseDef, report) => {
  const { min, max } = caseDef;
  const pad = Math.max(2, Math.round((max - min) * 0.12));
  const lo = min - pad;
  const hi = max + pad;
  const mapX = (val) => 40 + ((Math.max(lo, Math.min(hi, val)) - lo) / (hi - lo)) * 620;
  const xMin = mapX(min);
  const xMax = mapX(max);
  const dots = report.values.map((v) => {
    const x = mapX(v);
    const isOk = v >= min && v <= max;
    return `
      <g transform="translate(${x}, 54)">
        <circle r="6" fill="${isOk ? "var(--ok)" : "var(--bad)"}" />
        <text y="-12" text-anchor="middle" font-size="11" fill="var(--ink)">${v}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="axis-svg" viewBox="0 0 700 105" role="img" aria-label="边界值数轴">
      <rect x="${xMin}" y="46" width="${xMax - xMin}" height="16" rx="4" fill="var(--ok-soft)" stroke="var(--ok)" />
      <line x1="30" y1="54" x2="670" y2="54" stroke="var(--line-strong)" stroke-width="2" />
      <text x="${xMin}" y="86" text-anchor="middle" font-size="11" fill="var(--muted)">min=${min}</text>
      <text x="${xMax}" y="86" text-anchor="middle" font-size="11" fill="var(--muted)">max=${max}</text>
      ${dots}
    </svg>
  `;
};

/** 挂载黑盒测试（等价类划分 + 边界值分析）实验台 */
export const mountBlackboxLab = (root) => {
  let caseDef = BLACKBOX_CASES[0];
  let inputStr = `${caseDef.min}, ${caseDef.max}`;

  const render = () => {
    const rawList = inputStr.split(/[\s,，;；]+/).filter(Boolean);
    const report = evaluateBlackboxInputs(caseDef, rawList);
    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          <select id="bb-case-sel" class="lab-select">
            ${BLACKBOX_CASES.map((c) => `<option value="${c.id}" ${c.id === caseDef.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
          <span class="badge ${report.eqPct === 100 ? "ok" : "warn"}">等价类 ${report.eqPct}%</span>
          <span class="badge ${report.boundaryPct === 100 ? "ok" : "warn"}">边界点 ${report.hitBoundaries.length}/6 (${report.boundaryPct}%)</span>
        </div>
        <button type="button" id="bb-fill-btn" class="btn ghost tiny">填入完整边界用例</button>
      </div>
      <p class="muted-text" style="margin:4px 0 8px;font-size:0.7813rem;">${escapeHtml(caseDef.hint)}</p>
      <div class="row-gap" style="margin-bottom:10px;">
        <input id="bb-input" type="text" value="${escapeHtml(inputStr)}" placeholder="输入测试数值，用逗号或空格分隔..." style="flex:1;min-width:220px;">
      </div>
      <div class="lab-svg-wrap">${buildAxisSvg(caseDef, report)}</div>
      <div class="row-gap" style="margin-top:8px;">
        ${report.eqClasses.map((c) => `<span class="badge ${c.hit ? "ok" : ""}">${c.hit ? "✓" : "○"} ${escapeHtml(c.label)}</span>`).join("")}
      </div>
      <div class="lab-feedback ${report.missingBoundaries.length ? "warn" : "ok"}" style="margin-top:8px;">
        ${report.missingBoundaries.length ? `还缺少关键边界点：${report.missingBoundaries.join("、")}` : "✓ 已覆盖全部有效/无效等价类与 6 个关键边界点！"}
      </div>
    `;
    root.querySelector("#bb-case-sel")?.addEventListener("change", (e) => {
      caseDef = BLACKBOX_CASES.find((c) => c.id === e.target.value) || BLACKBOX_CASES[0];
      inputStr = `${caseDef.min}, ${caseDef.max}`;
      render();
    });
    root.querySelector("#bb-input")?.addEventListener("input", (e) => { inputStr = e.target.value; render(); });
    root.querySelector("#bb-fill-btn")?.addEventListener("click", () => {
      const m = caseDef.min;
      const x = caseDef.max;
      inputStr = `${m - 1}, ${m}, ${m + 1}, ${Math.round((m + x) / 2)}, ${x - 1}, ${x}, ${x + 1}`;
      render();
    });
  };

  render();
};

const METRIC_LABELS = [
  ["statement", "语句覆盖"],
  ["decision", "判定覆盖"],
  ["condition", "条件覆盖"],
  ["decisionCondition", "判定/条件"],
  ["combo", "条件组合"],
  ["path", "路径覆盖"]
];

const buildCfgSvg = (evalRes) => {
  const paths = new Set(evalRes.hitPaths);
  const hitTT = paths.has("T-T");
  const hitTF = paths.has("T-F");
  const hitFT = paths.has("F-T");
  const hitFF = paths.has("F-F");
  const d1T = hitTT || hitTF;
  const d1F = hitFT || hitFF;
  const d2T = hitTT || hitFT;
  const d2F = hitTF || hitFF;
  return `
    <svg class="cfg-svg" viewBox="0 0 360 250" role="img" aria-label="控制流图">
      <defs><marker id="cfg-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--ink)"/></marker></defs>
      <path class="cfg-edge ${d1T ? "is-hit" : ""}" d="M180,48 L100,88" marker-end="url(#cfg-arr)"/>
      <path class="cfg-edge ${d1F ? "is-hit" : ""}" d="M180,48 L250,128" marker-end="url(#cfg-arr)"/>
      <path class="cfg-edge ${d1T ? "is-hit" : ""}" d="M100,116 L180,145" marker-end="url(#cfg-arr)"/>
      <path class="cfg-edge ${d2T ? "is-hit" : ""}" d="M180,175 L100,206" marker-end="url(#cfg-arr)"/>
      <path class="cfg-edge ${d2F ? "is-hit" : ""}" d="M180,175 L250,226" marker-end="url(#cfg-arr)"/>
      <g class="cfg-node is-hit" transform="translate(180,32)"><rect x="-78" y="-16" width="156" height="32" rx="8"/><text y="4" text-anchor="middle">D1: A&gt;1 &amp;&amp; B==0</text></g>
      <g class="cfg-node ${d1T ? "is-hit" : ""}" transform="translate(100,102)"><rect x="-52" y="-15" width="104" height="30" rx="6"/><text y="4" text-anchor="middle">S1: X = X / A</text></g>
      <g class="cfg-node is-hit" transform="translate(180,160)"><rect x="-78" y="-16" width="156" height="32" rx="8"/><text y="4" text-anchor="middle">D2: A==2 || X&gt;1</text></g>
      <g class="cfg-node ${d2T ? "is-hit" : ""}" transform="translate(100,220)"><rect x="-52" y="-15" width="104" height="30" rx="6"/><text y="4" text-anchor="middle">S2: X = X + 1</text></g>
      <text x="122" y="66" font-size="10" fill="var(--muted)">T</text>
      <text x="234" y="82" font-size="10" fill="var(--muted)">F</text>
      <text x="122" y="192" font-size="10" fill="var(--muted)">T</text>
      <text x="230" y="206" font-size="10" fill="var(--muted)">F</text>
    </svg>
  `;
};

/** 挂载白盒测试（6 种逻辑覆盖 + 控制流图高亮）实验台 */
export const mountWhiteboxLab = (root) => {
  let cases = structuredClone(WHITEBOX_SPEC.trapCases);

  const render = () => {
    const evalRes = evaluateWhiteboxCases(cases);
    root.innerHTML = `
      <div class="lab-toolbar">
        <div class="row-gap">
          <button type="button" id="wb-trap-btn" class="btn soft-active tiny">经典陷阱：条件100% ≠ 判定100%</button>
          <button type="button" id="wb-full-btn" class="btn ghost tiny">填入全覆盖用例</button>
          <button type="button" id="wb-add-btn" class="btn ghost tiny">+ 添加用例</button>
        </div>
      </div>
      <div class="wb-lab-grid">
        <div>
          <pre class="wb-code">${escapeHtml(WHITEBOX_SPEC.code)}</pre>
          <div class="wb-cases-list">
            ${cases.map((c, idx) => `
              <div class="row-gap wb-case-row">
                <span class="badge">#${idx + 1}</span>
                <label>A <input type="number" class="lab-num-in" data-wb-idx="${idx}" data-wb-key="A" value="${c.A}"></label>
                <label>B <input type="number" class="lab-num-in" data-wb-idx="${idx}" data-wb-key="B" value="${c.B}"></label>
                <label>X <input type="number" class="lab-num-in" data-wb-idx="${idx}" data-wb-key="X" value="${c.X}"></label>
                <span class="muted-text" style="font-size:0.75rem;">路径 ${evalRes.traces[idx]?.pathKey || "-"} · 终值 X=${evalRes.traces[idx]?.outX ?? "-"}</span>
                <button type="button" class="btn ghost tiny" data-wb-del="${idx}">删</button>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="lab-svg-wrap">${buildCfgSvg(evalRes)}</div>
      </div>
      <div class="wb-metrics-grid">
        ${METRIC_LABELS.map(([k, lbl]) => `
          <div class="wb-metric-pill ${evalRes.metrics[k] === 100 ? "is-full" : ""}">
            <span>${lbl}</span><strong>${evalRes.metrics[k]}%</strong>
          </div>
        `).join("")}
      </div>
    `;
    root.querySelector("#wb-trap-btn")?.addEventListener("click", () => { cases = structuredClone(WHITEBOX_SPEC.trapCases); render(); });
    root.querySelector("#wb-full-btn")?.addEventListener("click", () => { cases = structuredClone(WHITEBOX_SPEC.fullCases); render(); });
    root.querySelector("#wb-add-btn")?.addEventListener("click", () => { cases.push({ A: 2, B: 0, X: 4 }); render(); });
    root.querySelectorAll("[data-wb-del]").forEach((b) => b.addEventListener("click", () => { cases.splice(Number(b.dataset.wbDel), 1); render(); }));
    root.querySelectorAll("[data-wb-idx]").forEach((inp) => inp.addEventListener("change", () => {
      cases[Number(inp.dataset.wbIdx)][inp.dataset.wbKey] = Number(inp.value);
      render();
    }));
  };

  render();
};

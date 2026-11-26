import { escapeHtml, parseMatchPair } from "../api.js";
import { iconSvg } from "../icons.js";

const normText = (v) => String(v || "").trim().toLowerCase();

export const isSubjectiveType = (q) => q?.type === "4" || q?.type === "6";
export const isOrderType = (q) => q?.type === "7";
export const isMatchType = (q) => q?.type === "8";

const shuffleCopy = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const initOrderItems = (q) => {
  const raw = (q?.answers || []).map(String).filter(Boolean);
  if (raw.length < 2) return raw;
  const shuffled = shuffleCopy(raw);
  if (shuffled.every((v, i) => v === raw[i])) [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  return shuffled;
};

export const initMatchState = (q) => {
  const pairs = (q?.answers || []).map(parseMatchPair).filter((p) => p.left && p.right);
  let pool = shuffleCopy(pairs.map((p) => p.right));
  if (pool.length >= 2 && pool.every((v, i) => v === pairs[i].right)) [pool[0], pool[1]] = [pool[1], pool[0]];
  return { pairs, pool, assignments: {}, selectedChip: "" };
};

export const buildOrderQuestionHtml = ({ q, items, record, showAnswerNow }) => {
  const active = showAnswerNow && record?.selected?.length ? record.selected : (showAnswerNow ? q.answers : items);
  const expected = q.answers || [];
  return `
    <div class="muted-text" style="font-size:0.7813rem;">拖动下列卡片调整为正确顺序，或使用右侧上下箭头微调</div>
    <div class="order-list" id="order-list">
      ${active.map((text, idx) => {
        const cls = showAnswerNow ? (normText(text) === normText(expected[idx]) ? "is-ok" : "is-bad") : "";
        return `
          <div class="order-item ${cls}" draggable="${!showAnswerNow}" data-idx="${idx}">
            <div class="order-item-left">
              <span class="order-idx">${idx + 1}</span>
              <span>${escapeHtml(text)}</span>
            </div>
            ${!showAnswerNow ? `
              <div class="row-gap" style="gap:4px;">
                <button type="button" class="btn ghost tiny js-order-up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""} title="上移">↑</button>
                <button type="button" class="btn ghost tiny js-order-down" data-idx="${idx}" ${idx === active.length - 1 ? "disabled" : ""} title="下移">↓</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>
    ${!showAnswerNow ? `<div style="margin-top:12px;"><button type="button" id="btn-confirm-order" class="btn primary">提交排序</button></div>` : ""}
  `;
};

export const buildMatchQuestionHtml = ({ q, state, record, showAnswerNow }) => {
  const { pairs, pool, assignments, selectedChip } = state;
  const activeAssign = {};
  if (showAnswerNow) {
    const src = record?.selected?.length ? record.selected : (q.answers || []);
    src.forEach((raw) => { const p = parseMatchPair(raw); if (p.left) activeAssign[p.left] = p.right; });
  } else {
    Object.assign(activeAssign, assignments);
  }
  const usedSet = new Set(Object.values(activeAssign));
  const remainPool = pool.filter((r) => !usedSet.has(r));
  const allFilled = pairs.length > 0 && pairs.every((p) => Boolean(activeAssign[p.left]));

  return `
    <div class="muted-text" style="font-size:0.7813rem;">将下方选项拖入对应右侧槽位（也可先点选选项再点击槽位，点已填槽位可撤回）</div>
    <div class="match-board">
      ${pairs.map((p) => {
        const val = activeAssign[p.left] || "";
        let cls = val ? "filled" : "";
        if (showAnswerNow) cls = normText(val) === normText(p.right) ? "is-ok" : "is-bad";
        return `
          <div class="match-row">
            <div class="match-left">${escapeHtml(p.left)}</div>
            <span class="muted-text match-arrow">${iconSvg("chevronRight", 14)}</span>
            <div class="match-slot ${cls}" data-left="${escapeHtml(p.left)}" draggable="${Boolean(val && !showAnswerNow)}">
              <span>${val ? escapeHtml(val) : "拖放或点击填入..."}</span>
              ${val && !showAnswerNow ? '<span class="muted-text" style="font-size:0.75rem;">×</span>' : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
    ${!showAnswerNow ? `
      <div class="match-pool" id="match-pool">
        ${remainPool.length ? remainPool.map((r) => `
          <div class="match-chip ${selectedChip === r ? "selected" : ""}" draggable="true" data-chip="${escapeHtml(r)}">${escapeHtml(r)}</div>
        `).join("") : '<span class="muted-text" style="font-size:0.7813rem;">已全部填入，可点击下方「提交配对」或点击槽位撤回调整</span>'}
      </div>
      <div class="row-gap" style="margin-top:12px;">
        <button type="button" id="btn-confirm-match" class="btn primary" ${allFilled ? "" : "disabled"}>提交配对</button>
        <button type="button" id="btn-reset-match" class="btn ghost">全部重置</button>
      </div>
    ` : ""}
  `;
};

const bindOrderEvents = ({ container, getOrderItems, setOrderItems, onRerender, onSubmit }) => {
  const listEl = container.querySelector("#order-list");
  if (!listEl) return;
  let dragIdx = -1;
  const swapOrder = (from, to) => {
    const items = [...getOrderItems()];
    if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    setOrderItems(items);
    onRerender();
  };
  listEl.querySelectorAll(".order-item").forEach((el) => {
    el.addEventListener("dragstart", () => { dragIdx = Number(el.dataset.idx); });
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("drag-over"); swapOrder(dragIdx, Number(el.dataset.idx)); });
  });
  listEl.querySelectorAll(".js-order-up").forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.idx); swapOrder(i, i - 1); }));
  listEl.querySelectorAll(".js-order-down").forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.idx); swapOrder(i, i + 1); }));
  container.querySelector("#btn-confirm-order")?.addEventListener("click", () => onSubmit(getOrderItems()));
};

const bindMatchEvents = ({ container, getMatchState, onRerender, onSubmit }) => {
  const state = getMatchState();
  if (!state) return;
  let dragChip = "";
  const placeChip = (left, chip) => {
    if (!left || !chip) return;
    for (const [k, v] of Object.entries(state.assignments)) { if (v === chip) delete state.assignments[k]; }
    state.assignments[left] = chip;
    state.selectedChip = "";
    onRerender();
  };
  container.querySelectorAll(".match-chip").forEach((el) => {
    el.addEventListener("dragstart", () => { dragChip = el.dataset.chip || ""; });
    el.addEventListener("click", () => { state.selectedChip = state.selectedChip === el.dataset.chip ? "" : el.dataset.chip; onRerender(); });
  });
  container.querySelectorAll(".match-slot").forEach((slot) => {
    const left = slot.dataset.left;
    slot.addEventListener("dragstart", () => { dragChip = state.assignments[left] || ""; });
    slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("drag-over"); });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", (e) => { e.preventDefault(); slot.classList.remove("drag-over"); placeChip(left, dragChip); });
    slot.addEventListener("click", () => {
      if (state.selectedChip) return placeChip(left, state.selectedChip);
      if (state.assignments[left]) { delete state.assignments[left]; onRerender(); }
    });
  });
  container.querySelector("#btn-reset-match")?.addEventListener("click", () => { state.assignments = {}; state.selectedChip = ""; onRerender(); });
  container.querySelector("#btn-confirm-match")?.addEventListener("click", () => {
    onSubmit(state.pairs.map((p) => `${p.left} => ${state.assignments[p.left] || ""}`));
  });
};

export const bindDragQuestionEvents = (opts) => {
  if (isOrderType(opts.q)) bindOrderEvents(opts);
  else if (isMatchType(opts.q)) bindMatchEvents(opts);
};

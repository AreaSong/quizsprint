import { escapeHtml, LETTERS, parseMatchPair } from "../api.js";
import { mountExamRoomInteractiveLab } from "../labs/practice-lab-host.js";

const CHOICE_TYPES = new Set(["0", "1", "3", "5"]);

const renderOrderRowsHtml = (items) => items.map((text, idx) => `
  <div class="order-item" data-idx="${idx}">
    <div class="order-item-left"><span class="order-idx">${idx + 1}</span><span>${escapeHtml(text)}</span></div>
    <div class="row-gap" style="gap:4px;">
      <button type="button" class="btn ghost tiny js-er-ord-up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="btn ghost tiny js-er-ord-down" data-idx="${idx}" ${idx === items.length - 1 ? "disabled" : ""}>↓</button>
    </div>
  </div>
`).join("");

/** 为正式考场渲染全题型（0-8）输入区 */
export const renderExamQuestionInputHtml = (q, savedList = []) => {
  const t = String(q.type || "0");
  if (CHOICE_TYPES.has(t)) {
    const opts = q.options?.length ? q.options : (t === "3" ? ["正确", "错误"] : []);
    if (opts.length) {
      return `
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
          ${opts.map((opt, oi) => `
            <label class="row-gap" style="cursor:pointer;">
              <input type="${t === "1" || t === "5" ? "checkbox" : "radio"}" name="q_${escapeHtml(q.id)}" value="${escapeHtml(opt)}">
              <span>${LETTERS[oi] || oi + 1}. ${escapeHtml(opt)}</span>
            </label>
          `).join("")}
        </div>
      `;
    }
  }
  if (t === "7") {
    const items = savedList.length ? savedList : (q.orderItems || []);
    return `<div class="muted-text" style="font-size:0.7813rem;margin-top:6px;">点击右侧上下箭头调整正确顺序：</div>
      <div class="order-list er-order-list" style="margin-top:6px;">${renderOrderRowsHtml(items)}</div>`;
  }
  if (t === "8") {
    const lefts = q.matchLefts || [];
    const rights = q.matchRights || [];
    if (!lefts.length) return `<textarea class="er-fill er-lines" rows="4" placeholder="每行输入一条配对（格式：左侧 => 右侧）..." style="width:100%;margin-top:8px;"></textarea>`;
    return `<div class="match-board er-match-board" style="margin-top:8px;">
      ${lefts.map((left) => `
        <div class="match-row">
          <div class="match-left">${escapeHtml(left)}</div>
          <select class="er-match-sel" data-left="${escapeHtml(left)}" style="flex:1;min-width:0;">
            <option value="">-- 请选择对应项 --</option>
            ${rights.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")}
          </select>
        </div>
      `).join("")}
    </div>`;
  }
  if (t === "4" || t === "6") {
    return `<textarea class="er-fill er-essay" rows="4" placeholder="请输入作答步骤 / 代码 / 简答内容..." style="width:100%;margin-top:8px;"></textarea>`;
  }
  if (t === "9") return `<div class="er-lab-slot embedded-lab-slot" style="margin-top:8px;"></div>`;
  return `<input class="er-fill" type="text" placeholder="请输入答案（多空用 | 分隔）" style="width:100%;margin-top:8px;">`;
};

const bindOrderCard = (card, q, answers, persistDraft) => {
  const listEl = card.querySelector(".er-order-list");
  if (!listEl) return;
  if (!Array.isArray(answers[q.id]) || !answers[q.id].length) {
    answers[q.id] = [...(q.orderItems || [])];
  }
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-er-ord-up, .js-er-ord-down");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const dir = btn.classList.contains("js-er-ord-up") ? -1 : 1;
    const arr = [...(answers[q.id] || q.orderItems || [])];
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= arr.length) return;
    [arr[idx], arr[nextIdx]] = [arr[nextIdx], arr[idx]];
    answers[q.id] = arr;
    listEl.innerHTML = renderOrderRowsHtml(arr);
    persistDraft();
  });
};

/** 绑定考场全部题型事件并从草稿精确回填已选/已填答案 */
export const bindAndRestoreExamInputs = (container, questions, answers, persistDraft) => {
  for (const q of questions) {
    const card = container.querySelector(`[data-qid="${CSS.escape(q.id)}"]`);
    if (!card) continue;
    const saved = Array.isArray(answers[q.id]) ? answers[q.id] : [];
    const t = String(q.type || "0");
    if (t === "9") { mountExamRoomInteractiveLab({ card, q, savedList: saved, onChange: (arr) => { answers[q.id] = arr; persistDraft(); } }); continue; }
    if (t === "7") { bindOrderCard(card, q, answers, persistDraft); continue; }
    if (t === "8" && (q.matchLefts || []).length) {
      const pairMap = Object.fromEntries(saved.map(parseMatchPair).filter((p) => p.left).map((p) => [p.left, p.right]));
      const sels = [...card.querySelectorAll(".er-match-sel")];
      sels.forEach((sel) => { if (pairMap[sel.dataset.left]) sel.value = pairMap[sel.dataset.left]; });
      card.addEventListener("change", (e) => {
        if (!e.target.closest(".er-match-sel")) return;
        answers[q.id] = sels.filter((s) => s.value).map((s) => `${s.dataset.left} => ${s.value}`);
        persistDraft();
      });
      continue;
    }
    const checkInputs = [...card.querySelectorAll("input[type=radio], input[type=checkbox]")];
    if (checkInputs.length) {
      const picked = new Set(saved);
      checkInputs.forEach((inp) => { inp.checked = picked.has(inp.value); });
      continue;
    }
    const fill = card.querySelector(".er-fill");
    if (fill && saved.length) {
      fill.value = fill.classList.contains("er-essay") ? saved.join("\n\n") : (fill.classList.contains("er-lines") ? saved.join("\n") : saved.join(" | "));
    }
  }
  container.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const qid = inp.closest("[data-qid]").dataset.qid;
      answers[qid] = [...container.querySelectorAll(`[data-qid="${CSS.escape(qid)}"] input:checked`)].map((i) => i.value);
      persistDraft();
    });
  });
  container.querySelectorAll(".er-fill").forEach((inp) => {
    inp.addEventListener("input", () => {
      const qid = inp.closest("[data-qid]").dataset.qid;
      if (inp.classList.contains("er-essay")) answers[qid] = inp.value.trim() ? [inp.value.trim()] : [];
      else answers[qid] = inp.value.split(inp.classList.contains("er-lines") ? /\r?\n/ : "|").map((s) => s.trim()).filter(Boolean);
      persistDraft();
    });
  });
};

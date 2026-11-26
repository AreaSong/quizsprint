import {
  apiRequest,
  buildBankOptionsHtml,
  escapeHtml,
  fetchBankQuestionsSafe,
  LETTERS,
  showToast,
  TYPE_LABELS
} from "../api.js";
import { openConfirmDialog, openFormDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import { openQuestionEditorModal } from "./question-editor-modal.js";

const normalizeKey = (t) => String(t || "").replace(/[\s\p{P}]/gu, "").toLowerCase();

const buildManageShellHtml = (bank, banks, isAdmin) => `
  <div class="panel view-frame">
    <div class="view-head">
      <div class="row-gap" style="justify-content:space-between;">
        <div class="row-gap">
          <h2 style="margin:0;">试题管理</h2>
          <select id="m-bank-select" class="bank-select-inline" aria-label="切换管理题库">
            ${buildBankOptionsHtml(banks, bank.id, { showCount: true })}
          </select>
        </div>
        <div class="row-gap">
          <button id="btn-dup-check" type="button" class="btn ghost tiny">试题查重</button>
          <button id="btn-add-one" type="button" class="btn primary tiny">${isAdmin ? "+ 单题录入" : "登录管理"}</button>
        </div>
      </div>
      <div id="m-stats-row" class="row-gap" style="margin-top:8px;"></div>
      <div class="row-gap" style="margin-top:10px;">
        <select id="f-type">
          <option value="">全部题型</option>
          ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <select id="f-chapter"><option value="">全部章节</option></select>
        <input id="f-kw" type="search" placeholder="筛选题干 / 选项 / 答案..." style="flex:1;min-width:180px;">
      </div>
      <div id="m-batch-bar" class="batch-bar" hidden>
        <span class="muted-text" style="color:var(--ink);font-weight:600;">已选 <strong id="m-sel-cnt">0</strong> 题</span>
        <div class="row-gap">
          <button id="btn-batch-chapter" type="button" class="btn ghost tiny">批量改章节</button>
          <button id="btn-batch-type" type="button" class="btn ghost tiny">批量改题型</button>
          <button id="btn-batch-diff" type="button" class="btn ghost tiny">批量改难度</button>
          <button id="btn-batch-del" type="button" class="btn ghost-danger tiny">批量删除</button>
          <button id="btn-batch-clear" type="button" class="btn ghost tiny">取消选择</button>
        </div>
      </div>
    </div>
    <div class="admin-table-wrap view-scroll" style="margin-top:12px;">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:32px;"><input id="chk-all" type="checkbox" aria-label="全选本页"></th>
            <th style="width:86px;">题型</th>
            <th>题目（点击展开选项、图片与解析）</th>
            <th style="width:170px;">答案</th>
            <th style="width:96px;">章节</th>
            <th style="width:124px;">操作</th>
          </tr>
        </thead>
        <tbody id="m-tbody"></tbody>
      </table>
    </div>
    <div id="m-foot" class="row-gap view-foot" style="justify-content:space-between;">
      <span id="m-page-info" class="muted-text" style="font-size:0.75rem;"></span>
      <div class="row-gap">
        <select id="pg-size" style="padding:4px 8px;font-size:0.75rem;">
          ${[30, 50, 100].map((n) => `<option value="${n}">每页 ${n} 题</option>`).join("")}
        </select>
        <button type="button" id="pg-prev" class="btn ghost tiny">上一页</button>
        <button type="button" id="pg-next" class="btn ghost tiny">下一页</button>
      </div>
    </div>
  </div>
  <div id="edit-modal" class="modal-backdrop" hidden></div>
`;

const buildQuestionRowsHtml = (pageItems, selectedIds, isAdmin) => {
  if (!pageItems.length) return '<tr><td colspan="6" class="muted-text">没有匹配的试题</td></tr>';
  return pageItems.map((q) => `
    <tr data-qid="${escapeHtml(q.id)}">
      <td><input class="row-chk" type="checkbox" ${selectedIds.has(q.id) ? "checked" : ""}></td>
      <td><span class="type-pill" data-qtype="${escapeHtml(q.type)}">${TYPE_LABELS[q.type] || "其他"}</span></td>
      <td>
        <details class="q-table-details">
          <summary>
            <span class="search-chevron">${iconSvg("chevronRight", 13)}</span>
            <span>${escapeHtml(q.title.split(/\r?\n/)[0].slice(0, 80))}</span>
            ${q.images?.length ? `<span class="bank-pill">图 ${q.images.length}</span>` : ""}
            ${q.answerImages?.length ? `<span class="bank-pill">答图 ${q.answerImages.length}</span>` : ""}
          </summary>
          <div class="q-table-detail-box muted-text">
            ${(q.images || []).map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;margin:4px 6px 4px 0;border:1px solid var(--line);">`).join("")}
            ${(q.answerImages || []).map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;margin:4px 6px 4px 0;border:1px solid var(--ok);">`).join("")}
            ${(q.options || []).map((o, i) => `<div>${LETTERS[i] || i + 1}. ${escapeHtml(o)}</div>`).join("")}
            ${q.analysis ? `<div style="margin-top:4px;"><strong>解析：</strong>${escapeHtml(q.analysis)}</div>` : ""}
          </div>
        </details>
      </td>
      <td style="color:var(--ok);font-weight:600;">${escapeHtml((q.answers || []).join(" / ").split(/\r?\n/)[0].slice(0, 60))}</td>
      <td class="muted-text">${escapeHtml(q.chapter || "-")} <span class="bank-pill">${escapeHtml(q.difficulty || "中等")}</span></td>
      <td>
        ${isAdmin ? `
          <div class="row-gap" style="gap:6px;">
            <button type="button" class="btn ghost tiny" data-act="edit">编辑</button>
            <button type="button" class="btn ghost-danger tiny" data-act="del">删除</button>
          </div>
        ` : '<span class="muted-text">只读</span>'}
      </td>
    </tr>
  `).join("");
};

export const renderManageView = async (container, ctx) => {
  const { activeBankId, banks, isAdmin, onRequireLogin, onRefreshBanks, onSelectBank } = ctx;
  const bank = banks.find((b) => b.id === activeBankId);
  if (!bank) {
    container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”选择或创建一个题库。</p></div>';
    return;
  }

  let questions = [];
  try { questions = (await fetchBankQuestionsSafe(bank.id)).questions || []; }
  catch (err) { container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`; return; }

  const state = { type: "", chapter: "", keyword: "", dupOnly: false, page: 1, pageSize: 30, selectedIds: new Set() };
  container.innerHTML = buildManageShellHtml(bank, banks, isAdmin);

  const chapterSel = container.querySelector("#f-chapter");
  const tbodyEl = container.querySelector("#m-tbody");
  const chkAll = container.querySelector("#chk-all");
  const batchBar = container.querySelector("#m-batch-bar");
  const modal = container.querySelector("#edit-modal");
  let currentPageItems = [];

  const syncChapters = () => {
    const chapters = [...new Set(questions.map((q) => q.chapter).filter(Boolean))];
    if (state.chapter && !chapters.includes(state.chapter)) state.chapter = "";
    chapterSel.innerHTML = `<option value="">全部章节</option>${chapters.map((c) => `<option value="${escapeHtml(c)}" ${state.chapter === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}`;
  };

  const renderListPart = () => {
    syncChapters();
    const dupMap = new Map();
    const typeCounts = {};
    for (const q of questions) {
      const k = normalizeKey(q.title);
      dupMap.set(k, (dupMap.get(k) || 0) + 1);
      typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
    }
    const kw = state.keyword.trim().toLowerCase();
    const filtered = questions.filter((q) => {
      if (state.type && String(q.type) !== state.type) return false;
      if (state.chapter && q.chapter !== state.chapter) return false;
      if (state.dupOnly && (dupMap.get(normalizeKey(q.title)) || 0) < 2) return false;
      if (kw && !`${q.title} ${(q.options || []).join(" ")} ${(q.answers || []).join(" ")}`.toLowerCase().includes(kw)) return false;
      return true;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const startIdx = (state.page - 1) * state.pageSize;
    currentPageItems = filtered.slice(startIdx, startIdx + state.pageSize);

    container.querySelector("#m-stats-row").innerHTML = `
      <span class="muted-text">共 ${questions.length} 题 · 匹配 ${filtered.length} 题</span>
      ${Object.entries(typeCounts).map(([k, v]) => `<span class="type-pill" data-qtype="${escapeHtml(k)}">${TYPE_LABELS[k] || "其他"} ${v}</span>`).join("")}
    `;
    tbodyEl.innerHTML = buildQuestionRowsHtml(currentPageItems, state.selectedIds, isAdmin);
    chkAll.checked = currentPageItems.length > 0 && currentPageItems.every((q) => state.selectedIds.has(q.id));
    batchBar.hidden = !isAdmin || state.selectedIds.size === 0;
    container.querySelector("#m-sel-cnt").textContent = String(state.selectedIds.size);
    container.querySelector("#m-page-info").textContent = `第 ${state.page} / ${totalPages} 页（本页显示 ${currentPageItems.length} 题）`;
    container.querySelector("#pg-prev").disabled = state.page <= 1;
    container.querySelector("#pg-next").disabled = state.page >= totalPages;
  };

  const reloadQuestions = async () => {
    questions = (await fetchBankQuestionsSafe(bank.id)).questions || [];
    await onRefreshBanks();
    renderListPart();
  };

  const runBatch = async (payload, okMsg) => {
    try {
      await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/batch`, {
        method: "POST", body: JSON.stringify({ ids: [...state.selectedIds], ...payload })
      });
      state.selectedIds.clear();
      showToast(okMsg, "ok");
      await reloadQuestions();
    } catch (err) { showToast(err.message, "bad"); }
  };

  container.querySelector("#m-bank-select").addEventListener("change", (e) => { onSelectBank?.(e.target.value); renderManageView(container, { ...ctx, activeBankId: e.target.value }); });
  container.querySelector("#f-type").addEventListener("change", (e) => { state.type = e.target.value; state.page = 1; renderListPart(); });
  chapterSel.addEventListener("change", (e) => { state.chapter = e.target.value; state.page = 1; renderListPart(); });
  container.querySelector("#f-kw").addEventListener("input", (e) => { state.keyword = e.target.value; state.page = 1; renderListPart(); });
  container.querySelector("#btn-dup-check").addEventListener("click", (e) => {
    state.dupOnly = !state.dupOnly;
    state.page = 1;
    e.currentTarget.classList.toggle("soft-active", state.dupOnly);
    e.currentTarget.classList.toggle("ghost", !state.dupOnly);
    renderListPart();
  });
  container.querySelector("#pg-size").addEventListener("change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderListPart(); });
  container.querySelector("#pg-prev").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; renderListPart(); } });
  container.querySelector("#pg-next").addEventListener("click", () => { state.page += 1; renderListPart(); });
  container.querySelector("#btn-add-one").addEventListener("click", () => {
    if (!isAdmin) return onRequireLogin();
    openQuestionEditorModal(modal, { bankId: bank.id, item: null, onSaved: reloadQuestions });
  });
  chkAll.addEventListener("change", () => {
    currentPageItems.forEach((q) => (chkAll.checked ? state.selectedIds.add(q.id) : state.selectedIds.delete(q.id)));
    renderListPart();
  });
  tbodyEl.addEventListener("change", (e) => {
    const chk = e.target.closest(".row-chk");
    if (!chk) return;
    const qid = chk.closest("tr").dataset.qid;
    if (chk.checked) state.selectedIds.add(qid); else state.selectedIds.delete(qid);
    renderListPart();
  });
  tbodyEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const qid = btn.closest("tr").dataset.qid;
    if (btn.dataset.act === "edit") return openQuestionEditorModal(modal, { bankId: bank.id, item: questions.find((q) => q.id === qid), onSaved: reloadQuestions });
    const ok = await openConfirmDialog({ title: "删除试题", message: "确定删除该试题吗？删除后无法恢复。", confirmText: "确认删除", danger: true });
    if (!ok) return;
    try {
      await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/${encodeURIComponent(qid)}`, { method: "DELETE" });
      state.selectedIds.delete(qid);
      showToast("已删除", "ok");
      await reloadQuestions();
    } catch (err) { showToast(err.message, "bad"); }
  });
  container.querySelector("#btn-batch-clear")?.addEventListener("click", () => { state.selectedIds.clear(); renderListPart(); });
  container.querySelector("#btn-batch-del")?.addEventListener("click", async () => {
    const ok = await openConfirmDialog({ title: "批量删除试题", message: `确定删除选中的 ${state.selectedIds.size} 道试题吗？`, confirmText: "确认删除", danger: true });
    if (ok) runBatch({ action: "delete" }, "批量删除成功");
  });
  container.querySelector("#btn-batch-chapter")?.addEventListener("click", async () => {
    const form = await openFormDialog({ title: `批量修改章节（已选 ${state.selectedIds.size} 题）`, fields: [{ name: "chapter", label: "新的章节名称", placeholder: "如：第一章 绪论" }], submitText: "应用修改" });
    if (form) runBatch({ action: "update", chapter: form.chapter.trim() }, "批量修改章节成功");
  });
  container.querySelector("#btn-batch-type")?.addEventListener("click", async () => {
    const form = await openFormDialog({ title: `批量修改题型（已选 ${state.selectedIds.size} 题）`, fields: [{ name: "type", label: "目标题型", type: "select", value: "0", options: Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })) }], submitText: "应用修改" });
    if (form && TYPE_LABELS[form.type]) runBatch({ action: "update", type: form.type }, "批量修改题型成功");
  });
  container.querySelector("#btn-batch-diff")?.addEventListener("click", async () => {
    const form = await openFormDialog({ title: `批量修改难度（已选 ${state.selectedIds.size} 题）`, fields: [{ name: "difficulty", label: "目标难度", type: "select", value: "中等", options: ["简单", "中等", "困难"].map((d) => ({ value: d, label: d })) }], submitText: "应用修改" });
    if (form?.difficulty) runBatch({ action: "update", difficulty: form.difficulty }, "批量修改难度成功");
  });

  renderListPart();
};

import {
  apiRequest,
  escapeHtml,
  fetchBankQuestionsSafe,
  LETTERS,
  showToast,
  TYPE_LABELS
} from "../api.js";
import { openFormDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";

const normalizeKey = (t) => String(t || "").replace(/[\s\p{P}]/gu, "").toLowerCase();

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const buildManageShellHtml = (bank, banks, isAdmin) => `
  <div class="panel view-frame">
    <div class="view-head">
      <div class="row-gap" style="justify-content:space-between;">
        <div class="row-gap">
          <h2 style="margin:0;">试题管理</h2>
          <select id="m-bank-select" class="bank-select-inline" aria-label="切换管理题库">
            ${banks.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === bank.id ? "selected" : ""}>${escapeHtml(b.name)} (${b.questionCount || 0})</option>`).join("")}
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
      <span id="m-page-info" class="muted-text" style="font-size:12px;"></span>
      <div class="row-gap">
        <select id="pg-size" style="padding:4px 8px;font-size:12px;">
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
            <span>${escapeHtml(q.title)}</span>
            ${q.images?.length ? `<span class="bank-pill">图 ${q.images.length}</span>` : ""}
          </summary>
          <div class="q-table-detail-box muted-text">
            ${(q.images || []).map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;margin:4px 6px 4px 0;border:1px solid var(--line);">`).join("")}
            ${(q.options || []).map((o, i) => `<div>${LETTERS[i] || i + 1}. ${escapeHtml(o)}</div>`).join("")}
            ${q.analysis ? `<div style="margin-top:4px;"><strong>解析：</strong>${escapeHtml(q.analysis)}</div>` : ""}
          </div>
        </details>
      </td>
      <td style="color:var(--ok);font-weight:600;">${escapeHtml((q.answers || []).join(" / "))}</td>
      <td class="muted-text">${escapeHtml(q.chapter || "-")}</td>
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

const buildEditorShellHtml = (item, imageCount) => `
  <div class="modal-card modal-shell" style="max-width:600px;">
    <div class="modal-head"><h3>${item ? "编辑试题" : "单题录入"}</h3><button id="ed-close" type="button" class="btn ghost tiny">关闭</button></div>
    <form id="ed-form">
      <div class="modal-body stack-form">
        <div class="row-gap">
          <label style="flex:1;"><span>题型</span><select id="ed-type">${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${(item?.type || "0") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label style="flex:1;"><span>章节</span><input id="ed-chapter" value="${escapeHtml(item?.chapter || "")}" placeholder="可选"></label>
          <label style="flex:1;"><span>难度</span><select id="ed-diff">${["简单", "中等", "困难"].map((d) => `<option ${item?.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        </div>
        <label><span>题干（支持直接 Ctrl/Cmd+V 粘贴截图）</span><textarea id="ed-title" rows="3" required>${escapeHtml(item?.title || "")}</textarea></label>
        <div>
          <div class="row-gap" style="justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:600;">题目图片（<span id="ed-img-cnt">${imageCount}</span> 张）</span>
            <label class="btn ghost tiny">上传图片<input id="ed-img-file" type="file" accept="image/*" hidden></label>
          </div>
          <div id="ed-img-list" class="row-gap"></div>
        </div>
        <label><span>选项（每行一个，填空/简答留空）</span><textarea id="ed-options" rows="4">${escapeHtml((item?.options || []).join("\n"))}</textarea></label>
        <label><span>答案（多选用 | 分隔，选择题可填字母或正文）</span><input id="ed-answers" value="${escapeHtml((item?.answers || []).join(" | "))}" required></label>
        <label><span>解析</span><textarea id="ed-analysis" rows="2">${escapeHtml(item?.analysis || "")}</textarea></label>
      </div>
      <div class="modal-foot">
        <span class="muted-text">支持截图粘贴直接上传</span>
        <div class="row-gap">
          <button type="button" id="ed-cancel" class="btn ghost">取消</button>
          <button type="submit" class="btn primary">保存试题</button>
        </div>
      </div>
    </form>
  </div>
`;

const openQuestionEditorModal = (modal, { bankId, item, onSaved }) => {
  const isNew = !item;
  const images = [...(item?.images || [])];
  modal.hidden = false;
  modal.innerHTML = buildEditorShellHtml(item, images.length);

  const renderThumbs = () => {
    modal.querySelector("#ed-img-cnt").textContent = String(images.length);
    modal.querySelector("#ed-img-list").innerHTML = images.map((src, i) => `
      <div style="position:relative;">
        <img src="${escapeHtml(src)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--line);">
        <button type="button" class="btn danger tiny js-rm-img" data-idx="${i}" style="position:absolute;top:-6px;right:-6px;padding:1px 5px;">×</button>
      </div>
    `).join("");
  };

  const uploadDataUrl = async (dataUrl) => {
    try {
      const res = await apiRequest("/api/upload/image", { method: "POST", body: JSON.stringify({ dataUrl }) });
      images.push(res.url);
      renderThumbs();
      showToast("图片已上传", "ok");
    } catch (err) {
      showToast(err.message, "bad");
    }
  };

  renderThumbs();
  const closeModal = () => { modal.hidden = true; };
  modal.querySelector("#ed-close").addEventListener("click", closeModal);
  modal.querySelector("#ed-cancel").addEventListener("click", closeModal);
  modal.querySelector("#ed-img-list").addEventListener("click", (e) => {
    const rm = e.target.closest(".js-rm-img");
    if (rm) { images.splice(Number(rm.dataset.idx), 1); renderThumbs(); }
  });
  modal.querySelector("#ed-img-file").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await uploadDataUrl(await fileToDataUrl(f));
    e.target.value = "";
  });
  modal.querySelector("#ed-title").addEventListener("paste", async (e) => {
    const imgItem = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
    if (imgItem) { e.preventDefault(); await uploadDataUrl(await fileToDataUrl(imgItem.getAsFile())); }
  });
  modal.querySelector("#ed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type: modal.querySelector("#ed-type").value,
      chapter: modal.querySelector("#ed-chapter").value.trim(),
      difficulty: modal.querySelector("#ed-diff").value,
      title: modal.querySelector("#ed-title").value.trim(),
      images,
      options: modal.querySelector("#ed-options").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      answers: modal.querySelector("#ed-answers").value.split("|").map((s) => s.trim()).filter(Boolean),
      analysis: modal.querySelector("#ed-analysis").value.trim()
    };
    try {
      const url = `/api/banks/${encodeURIComponent(bankId)}/questions${isNew ? "" : `/${encodeURIComponent(item.id)}`}`;
      await apiRequest(url, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) });
      modal.hidden = true;
      showToast("保存成功", "ok");
      await onSaved();
    } catch (err) {
      showToast(err.message, "bad");
    }
  });
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
    if (!confirm("确定删除该试题吗？")) return;
    try {
      await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/${encodeURIComponent(qid)}`, { method: "DELETE" });
      state.selectedIds.delete(qid);
      showToast("已删除", "ok");
      await reloadQuestions();
    } catch (err) { showToast(err.message, "bad"); }
  });
  container.querySelector("#btn-batch-clear")?.addEventListener("click", () => { state.selectedIds.clear(); renderListPart(); });
  container.querySelector("#btn-batch-del")?.addEventListener("click", () => { if (confirm(`确定删除选中的 ${state.selectedIds.size} 道试题吗？`)) runBatch({ action: "delete" }, "批量删除成功"); });
  container.querySelector("#btn-batch-chapter")?.addEventListener("click", async () => {
    const form = await openFormDialog({ title: `批量修改章节（已选 ${state.selectedIds.size} 题）`, fields: [{ name: "chapter", label: "新的章节名称", placeholder: "如：第一章 绪论" }], submitText: "应用修改" });
    if (form) runBatch({ action: "update", chapter: form.chapter.trim() }, "批量修改章节成功");
  });
  container.querySelector("#btn-batch-type")?.addEventListener("click", async () => {
    const form = await openFormDialog({ title: `批量修改题型（已选 ${state.selectedIds.size} 题）`, fields: [{ name: "type", label: "目标题型", type: "select", value: "0", options: Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })) }], submitText: "应用修改" });
    if (form && TYPE_LABELS[form.type]) runBatch({ action: "update", type: form.type }, "批量修改题型成功");
  });

  renderListPart();
};

import {
  apiRequest,
  escapeHtml,
  fetchBankQuestionsSafe,
  LETTERS,
  showToast,
  TYPE_LABELS
} from "../api.js";
import { openFormDialog } from "../dialog.js";

const normalizeKey = (t) => String(t || "").replace(/[\s\p{P}]/gu, "").toLowerCase();

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export const renderManageView = async (container, ctx) => {
  const { activeBankId, banks, isAdmin, onRequireLogin, onRefreshBanks, onNavigate, onSelectBank } = ctx;
  const bank = banks.find((b) => b.id === activeBankId);
  if (!bank) {
    container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”选择或创建一个题库。</p></div>';
    return;
  }

  let questions = [];
  try {
    questions = (await fetchBankQuestionsSafe(bank.id)).questions || [];
  } catch (err) {
    container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const state = { type: "", chapter: "", keyword: "", dupOnly: false, page: 1, pageSize: 30, selectedIds: new Set() };

  const renderBody = () => {
    const chapters = [...new Set(questions.map((q) => q.chapter).filter(Boolean))];
    const dupMap = new Map();
    const typeCounts = {};
    for (const q of questions) {
      const k = normalizeKey(q.title);
      dupMap.set(k, (dupMap.get(k) || 0) + 1);
      typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
    }

    const filtered = questions.filter((q) => {
      if (state.type && String(q.type) !== state.type) return false;
      if (state.chapter && q.chapter !== state.chapter) return false;
      if (state.dupOnly && (dupMap.get(normalizeKey(q.title)) || 0) < 2) return false;
      if (state.keyword) {
        const kw = state.keyword.toLowerCase();
        const text = `${q.title} ${(q.options || []).join(" ")} ${(q.answers || []).join(" ")}`.toLowerCase();
        if (!text.includes(kw)) return false;
      }
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const startIdx = (state.page - 1) * state.pageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.pageSize);
    const allPageSelected = pageItems.length > 0 && pageItems.every((q) => state.selectedIds.has(q.id));

    container.innerHTML = `
      <div class="panel view-frame">
        <div class="view-head">
          <div class="row-gap" style="justify-content:space-between;">
            <div>
              <div class="row-gap">
                <h2 style="margin:0;">${escapeHtml(bank.name)} · 试题管理</h2>
                ${banks.length > 1 ? `
                  <select id="m-bank-select" class="bank-select-inline" aria-label="切换管理题库">
                    ${banks.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === bank.id ? "selected" : ""}>${escapeHtml(b.name)} (${b.questionCount || 0})</option>`).join("")}
                  </select>
                ` : ""}
              </div>
              <div class="row-gap" style="margin-top:6px;">
                <span class="muted-text">共 ${questions.length} 题 · 匹配 ${filtered.length} 题</span>
                ${Object.entries(typeCounts).map(([k, v]) => `<span class="badge">${TYPE_LABELS[k] || "其他"} ${v}</span>`).join("")}
              </div>
            </div>
            <div class="row-gap">
              <button id="btn-add-one" class="btn primary tiny">${isAdmin ? "+ 单题录入" : "登录管理"}</button>
              <button id="btn-go-import" class="btn ghost tiny">批量导题</button>
              <button id="btn-dup-check" class="btn ${state.dupOnly ? "primary" : "ghost"} tiny">试题查重</button>
              ${isAdmin ? `
                <button id="btn-batch-chapter" class="btn ghost tiny" ${state.selectedIds.size ? "" : "disabled"}>批量改章节</button>
                <button id="btn-batch-type" class="btn ghost tiny" ${state.selectedIds.size ? "" : "disabled"}>批量改题型</button>
                <button id="btn-batch-del" class="btn danger tiny" ${state.selectedIds.size ? "" : "disabled"}>批量删除 (${state.selectedIds.size})</button>
              ` : ""}
            </div>
          </div>

          <div class="row-gap" style="margin-top:12px;">
            <select id="f-type">
              <option value="">全部题型</option>
              ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${state.type === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
            <select id="f-chapter">
              <option value="">全部章节</option>
              ${chapters.map((c) => `<option value="${escapeHtml(c)}" ${state.chapter === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
            </select>
            <input id="f-kw" type="search" value="${escapeHtml(state.keyword)}" placeholder="筛选题干/选项/答案..." style="flex:1;min-width:180px;">
          </div>
        </div>

        <div class="table-wrap view-scroll" style="margin-top:12px;">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:32px;"><input id="chk-all" type="checkbox" ${allPageSelected ? "checked" : ""}></th>
                <th style="width:86px;">题型</th>
                <th>题目（点击展开选项、图片与解析）</th>
                <th style="width:160px;">答案</th>
                <th style="width:90px;">章节</th>
                <th style="width:120px;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${pageItems.map((q) => `
                <tr data-qid="${escapeHtml(q.id)}">
                  <td><input class="row-chk" type="checkbox" ${state.selectedIds.has(q.id) ? "checked" : ""}></td>
                  <td><span class="badge">${TYPE_LABELS[q.type] || "其他"}</span></td>
                  <td>
                    <details>
                      <summary style="cursor:pointer;font-weight:600;">${q.images?.length ? "🖼️ " : ""}${escapeHtml(q.title)}</summary>
                      <div class="muted-text" style="margin-top:6px;font-size:13px;">
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
                      <button class="btn ghost tiny" data-act="edit">编辑</button>
                      <button class="btn danger tiny" data-act="del">删</button>
                    ` : `<span class="muted-text">只读</span>`}
                  </td>
                </tr>
              `).join("") || '<tr><td colspan="6" class="muted-text">没有匹配的试题</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="row-gap view-foot" style="justify-content:space-between;">
          <span class="muted-text" style="font-size:12px;">第 ${state.page} / ${totalPages} 页（本页显示 ${pageItems.length} 题）</span>
          <div class="row-gap">
            <select id="pg-size" style="padding:4px 8px;font-size:12px;">
              ${[30, 50, 100].map((n) => `<option value="${n}" ${state.pageSize === n ? "selected" : ""}>每页 ${n} 题</option>`).join("")}
            </select>
            <button type="button" id="pg-prev" class="btn ghost tiny" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
            <button type="button" id="pg-next" class="btn ghost tiny" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>
          </div>
        </div>
      </div>
      <div id="edit-modal" class="modal-backdrop" hidden></div>
    `;

    container.querySelector("#m-bank-select")?.addEventListener("change", (e) => {
      const nextId = e.target.value;
      onSelectBank?.(nextId);
      renderManageView(container, { ...ctx, activeBankId: nextId });
    });
    container.querySelector("#f-type").addEventListener("change", (e) => { state.type = e.target.value; state.page = 1; renderBody(); });
    container.querySelector("#f-chapter").addEventListener("change", (e) => { state.chapter = e.target.value; state.page = 1; renderBody(); });
    container.querySelector("#f-kw").addEventListener("input", (e) => { state.keyword = e.target.value; state.page = 1; renderBody(); });
    container.querySelector("#btn-dup-check").addEventListener("click", () => { state.dupOnly = !state.dupOnly; state.page = 1; renderBody(); });
    container.querySelector("#pg-size").addEventListener("change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderBody(); });
    container.querySelector("#pg-prev").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; renderBody(); } });
    container.querySelector("#pg-next").addEventListener("click", () => { if (state.page < totalPages) { state.page += 1; renderBody(); } });
    container.querySelector("#btn-go-import").addEventListener("click", () => onNavigate("import"));
    container.querySelector("#btn-add-one").addEventListener("click", () => { if (!isAdmin) return onRequireLogin(); openQuestionEditor(null); });

    const chkAll = container.querySelector("#chk-all");
    chkAll.addEventListener("change", () => {
      if (chkAll.checked) pageItems.forEach((q) => state.selectedIds.add(q.id));
      else pageItems.forEach((q) => state.selectedIds.delete(q.id));
      renderBody();
    });
    container.querySelectorAll(".row-chk").forEach((chk) => {
      chk.addEventListener("change", () => {
        const qid = chk.closest("tr").dataset.qid;
        if (chk.checked) state.selectedIds.add(qid); else state.selectedIds.delete(qid);
        renderBody();
      });
    });

    const runBatch = async (payload, okMsg) => {
      try {
        await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/batch`, {
          method: "POST",
          body: JSON.stringify({ ids: [...state.selectedIds], ...payload })
        });
        questions = (await fetchBankQuestionsSafe(bank.id)).questions || [];
        state.selectedIds.clear();
        showToast(okMsg, "ok");
        await onRefreshBanks();
        renderBody();
      } catch (err) { showToast(err.message, "bad"); }
    };

    container.querySelector("#btn-batch-del")?.addEventListener("click", () => {
      if (confirm(`确定删除选中的 ${state.selectedIds.size} 道试题吗？`)) runBatch({ action: "delete" }, "批量删除成功");
    });
    container.querySelector("#btn-batch-chapter")?.addEventListener("click", async () => {
      const form = await openFormDialog({ title: `批量修改章节（已选 ${state.selectedIds.size} 题）`, fields: [{ name: "chapter", label: "新的章节名称", placeholder: "如：第一章 绪论" }], submitText: "应用修改" });
      if (form) runBatch({ action: "update", chapter: form.chapter.trim() }, "批量修改章节成功");
    });
    container.querySelector("#btn-batch-type")?.addEventListener("click", async () => {
      const form = await openFormDialog({
        title: `批量修改题型（已选 ${state.selectedIds.size} 题）`,
        fields: [{ name: "type", label: "目标题型", type: "select", value: "0", options: Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })) }],
        submitText: "应用修改"
      });
      if (form && TYPE_LABELS[form.type]) runBatch({ action: "update", type: form.type }, "批量修改题型成功");
    });

    container.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const qid = btn.closest("tr").dataset.qid;
        const target = questions.find((q) => q.id === qid);
        if (btn.dataset.act === "edit") return openQuestionEditor(target);
        if (!confirm("确定删除该试题吗？")) return;
        try {
          await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/${encodeURIComponent(qid)}`, { method: "DELETE" });
          questions = questions.filter((q) => q.id !== qid);
          showToast("已删除", "ok");
          await onRefreshBanks();
          renderBody();
        } catch (err) { showToast(err.message, "bad"); }
      });
    });
  };

  const openQuestionEditor = (item) => {
    const modal = container.querySelector("#edit-modal");
    const isNew = !item;
    let images = [...(item?.images || [])];
    modal.hidden = false;

    const renderModal = () => {
      modal.innerHTML = `
        <div class="modal-card" style="max-width:580px;max-height:90vh;overflow-y:auto;">
          <div class="modal-head"><h3>${isNew ? "单题录入" : "编辑试题"}</h3><button id="ed-close" class="btn ghost tiny">关闭</button></div>
          <form id="ed-form" class="stack-form">
            <div class="row-gap">
              <label style="flex:1;"><span>题型</span><select id="ed-type">${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${(item?.type || "0") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
              <label style="flex:1;"><span>章节</span><input id="ed-chapter" value="${escapeHtml(item?.chapter || "")}" placeholder="可选"></label>
              <label style="flex:1;"><span>难度</span><select id="ed-diff">${["简单", "中等", "困难"].map((d) => `<option ${item?.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
            </div>
            <label><span>题干（支持直接 Ctrl/Cmd+V 粘贴截图）</span><textarea id="ed-title" rows="3" required>${escapeHtml(item?.title || "")}</textarea></label>
            <div>
              <div class="row-gap" style="justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:13px;font-weight:600;">题目图片（${images.length} 张）</span>
                <label class="btn ghost tiny">上传图片<input id="ed-img-file" type="file" accept="image/*" hidden></label>
              </div>
              <div class="row-gap">
                ${images.map((src, i) => `
                  <div style="position:relative;">
                    <img src="${escapeHtml(src)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--line);">
                    <button type="button" class="btn danger tiny js-rm-img" data-idx="${i}" style="position:absolute;top:-6px;right:-6px;padding:1px 5px;">×</button>
                  </div>
                `).join("")}
              </div>
            </div>
            <label><span>选项（每行一个，填空/简答留空）</span><textarea id="ed-options" rows="4">${escapeHtml((item?.options || []).join("\n"))}</textarea></label>
            <label><span>答案（多选用 | 分隔，选择题可填字母或正文）</span><input id="ed-answers" value="${escapeHtml((item?.answers || []).join(" | "))}" required></label>
            <label><span>解析</span><textarea id="ed-analysis" rows="2">${escapeHtml(item?.analysis || "")}</textarea></label>
            <div class="modal-actions"><button type="submit" class="btn primary">保存</button></div>
          </form>
        </div>
      `;
      modal.querySelector("#ed-close").addEventListener("click", () => { modal.hidden = true; });
      modal.querySelectorAll(".js-rm-img").forEach((b) => b.addEventListener("click", () => { images.splice(Number(b.dataset.idx), 1); renderModal(); }));
      const uploadImageDataUrl = async (dataUrl) => {
        try { images.push((await apiRequest("/api/upload/image", { method: "POST", body: JSON.stringify({ dataUrl }) })).url); showToast("图片已上传", "ok"); renderModal(); }
        catch (err) { showToast(err.message, "bad"); }
      };
      modal.querySelector("#ed-img-file").addEventListener("change", async (e) => { const f = e.target.files?.[0]; if (f) await uploadImageDataUrl(await fileToDataUrl(f)); });
      modal.querySelector("#ed-title").addEventListener("paste", async (e) => {
        const imgItem = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
        if (imgItem) { e.preventDefault(); await uploadImageDataUrl(await fileToDataUrl(imgItem.getAsFile())); }
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
          if (isNew) await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions`, { method: "POST", body: JSON.stringify(payload) });
          else await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/${encodeURIComponent(item.id)}`, { method: "PUT", body: JSON.stringify(payload) });
          questions = (await fetchBankQuestionsSafe(bank.id)).questions || [];
          modal.hidden = true; showToast("保存成功", "ok"); await onRefreshBanks(); renderBody();
        } catch (err) { showToast(err.message, "bad"); }
      });
    };
    renderModal();
  };

  renderBody();
};

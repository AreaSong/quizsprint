import {
  apiRequest,
  escapeHtml,
  fetchBankQuestionsSafe,
  LETTERS,
  showToast,
  TYPE_LABELS
} from "../api.js";

const normalizeKey = (t) => String(t || "").replace(/[\s\p{P}]/gu, "").toLowerCase();

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export const renderManageView = async (container, ctx) => {
  const { activeBankId, banks, isAdmin, onRequireLogin, onRefreshBanks, onNavigate } = ctx;
  const bank = banks.find((b) => b.id === activeBankId);
  if (!bank) {
    container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”选择或创建一个题库。</p></div>';
    return;
  }

  let questions = [];
  try {
    const res = await fetchBankQuestionsSafe(bank.id);
    questions = res.questions || [];
  } catch (err) {
    container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const state = { type: "", chapter: "", keyword: "", dupOnly: false, selectedIds: new Set() };

  const renderBody = () => {
    const chapters = [...new Set(questions.map((q) => q.chapter).filter(Boolean))];
    const dupMap = new Map();
    for (const q of questions) {
      const k = normalizeKey(q.title);
      dupMap.set(k, (dupMap.get(k) || 0) + 1);
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

    container.innerHTML = `
      <div class="panel">
        <div class="row-gap" style="justify-content:space-between;">
          <div>
            <h2 style="margin:0;">${escapeHtml(bank.name)} · 试题管理</h2>
            <span class="muted-text">共 ${questions.length} 题，当前显示 ${filtered.length} 题</span>
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

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:32px;"><input id="chk-all" type="checkbox"></th>
                <th style="width:86px;">题型</th>
                <th>题目（点击展开选项、图片与解析）</th>
                <th style="width:160px;">答案</th>
                <th style="width:90px;">章节</th>
                <th style="width:120px;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((q) => `
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
      </div>
      <div id="edit-modal" class="modal-backdrop" hidden></div>
    `;

    container.querySelector("#f-type").addEventListener("change", (e) => { state.type = e.target.value; renderBody(); });
    container.querySelector("#f-chapter").addEventListener("change", (e) => { state.chapter = e.target.value; renderBody(); });
    container.querySelector("#f-kw").addEventListener("input", (e) => { state.keyword = e.target.value; renderBody(); });
    container.querySelector("#btn-dup-check").addEventListener("click", () => { state.dupOnly = !state.dupOnly; renderBody(); });
    container.querySelector("#btn-go-import").addEventListener("click", () => onNavigate("import"));
    container.querySelector("#btn-add-one").addEventListener("click", () => {
      if (!isAdmin) return onRequireLogin();
      openQuestionEditor(null);
    });

    const chkAll = container.querySelector("#chk-all");
    chkAll.addEventListener("change", () => {
      if (chkAll.checked) filtered.forEach((q) => state.selectedIds.add(q.id));
      else filtered.forEach((q) => state.selectedIds.delete(q.id));
      renderBody();
    });

    container.querySelectorAll(".row-chk").forEach((chk) => {
      chk.addEventListener("change", () => {
        const qid = chk.closest("tr").dataset.qid;
        if (chk.checked) state.selectedIds.add(qid);
        else state.selectedIds.delete(qid);
        renderBody();
      });
    });

    const runBatch = async (payload, okMsg) => {
      try {
        await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/batch`, {
          method: "POST",
          body: JSON.stringify({ ids: [...state.selectedIds], ...payload })
        });
        const refreshed = await fetchBankQuestionsSafe(bank.id);
        questions = refreshed.questions || [];
        state.selectedIds.clear();
        showToast(okMsg, "ok");
        await onRefreshBanks();
        renderBody();
      } catch (err) {
        showToast(err.message, "bad");
      }
    };

    container.querySelector("#btn-batch-del")?.addEventListener("click", () => {
      if (confirm(`确定删除选中的 ${state.selectedIds.size} 道试题吗？`)) runBatch({ action: "delete" }, "批量删除成功");
    });
    container.querySelector("#btn-batch-chapter")?.addEventListener("click", () => {
      const chapter = prompt("请输入新的章节名称：");
      if (chapter !== null) runBatch({ action: "update", chapter }, "批量修改章节成功");
    });
    container.querySelector("#btn-batch-type")?.addEventListener("click", () => {
      const hint = Object.entries(TYPE_LABELS).map(([k, v]) => `${k}:${v}`).join(" ");
      const type = prompt(`请输入题型编号 (${hint})：`);
      if (type && TYPE_LABELS[type]) runBatch({ action: "update", type }, "批量修改题型成功");
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
        } catch (err) {
          showToast(err.message, "bad");
        }
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
          <div class="modal-head">
            <h3>${isNew ? "单题录入" : "编辑试题"}</h3>
            <button id="ed-close" class="btn ghost tiny">关闭</button>
          </div>
          <form id="ed-form" class="stack-form">
            <div class="row-gap">
              <label style="flex:1;"><span>题型</span>
                <select id="ed-type">
                  ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${(item?.type || "0") === k ? "selected" : ""}>${v}</option>`).join("")}
                </select>
              </label>
              <label style="flex:1;"><span>章节</span><input id="ed-chapter" value="${escapeHtml(item?.chapter || "")}" placeholder="可选"></label>
              <label style="flex:1;"><span>难度</span>
                <select id="ed-diff">
                  ${["简单", "中等", "困难"].map((d) => `<option ${item?.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}
                </select>
              </label>
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
      modal.querySelectorAll(".js-rm-img").forEach((b) => {
        b.addEventListener("click", () => {
          images.splice(Number(b.dataset.idx), 1);
          renderModal();
        });
      });

      const uploadImageDataUrl = async (dataUrl) => {
        try {
          const res = await apiRequest("/api/upload/image", { method: "POST", body: JSON.stringify({ dataUrl }) });
          images.push(res.url);
          showToast("图片已上传", "ok");
          renderModal();
        } catch (err) {
          showToast(err.message, "bad");
        }
      };

      modal.querySelector("#ed-img-file").addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (file) await uploadImageDataUrl(await fileToDataUrl(file));
      });
      modal.querySelector("#ed-title").addEventListener("paste", async (e) => {
        const imgItem = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
        if (imgItem) {
          e.preventDefault();
          await uploadImageDataUrl(await fileToDataUrl(imgItem.getAsFile()));
        }
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
          if (isNew) {
            await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions`, { method: "POST", body: JSON.stringify(payload) });
          } else {
            await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}/questions/${encodeURIComponent(item.id)}`, { method: "PUT", body: JSON.stringify(payload) });
          }
          const refreshed = await fetchBankQuestionsSafe(bank.id);
          questions = refreshed.questions || [];
          modal.hidden = true;
          showToast("保存成功", "ok");
          await onRefreshBanks();
          renderBody();
        } catch (err) {
          showToast(err.message, "bad");
        }
      });
    };

    renderModal();
  };

  renderBody();
};

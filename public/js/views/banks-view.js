import {
  apiRequest,
  downloadBankFileSafe,
  escapeHtml,
  fetchBankQuestionsSafe,
  getBankPracticeState,
  printQuestionsDocument,
  showToast
} from "../api.js";
import { openFormDialog } from "../dialog.js";

export const renderBanksView = (container, ctx) => {
  const { banks, activeBankId, isAdmin, isLoggedIn, onSelectBank, onNavigate, onRefreshBanks, onRequireLogin, onRequireUserLogin } = ctx;
  const folders = ["全部分组", ...new Set(banks.map((b) => b.folder || "默认分组"))];
  let activeFolder = "全部分组";
  let openMenuBankId = "";

  const closeMenus = () => {
    if (!openMenuBankId) return;
    openMenuBankId = "";
    container.querySelectorAll(".js-card-menu").forEach((el) => { el.hidden = true; });
  };

  const renderHeroBanner = () => {
    const cur = banks.find((b) => b.id === activeBankId) || banks[0];
    if (!cur) return "";
    const pState = getBankPracticeState(cur.id);
    const done = Object.keys(pState.records || {}).length;
    const total = cur.questionCount || 0;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const wrongCnt = (pState.wrongIds || []).length;
    return `
      <section class="hero-continue">
        <div style="flex:1;min-width:240px;">
          <div class="row-gap">
            <span class="badge">当前题库</span>
            <strong style="font-size:16px;">${cur.locked ? "🔒 " : ""}${escapeHtml(cur.name)}</strong>
            <span class="muted-text">已练 ${done}/${total} 题 (${pct}%) · 错题 ${wrongCnt}</span>
          </div>
          <div class="progress-bar" style="margin-top:10px;max-width:420px;"><span style="width:${pct}%"></span></div>
        </div>
        <div class="row-gap">
          <button type="button" id="hero-continue-btn" class="btn primary">${done > 0 ? "继续上次刷题" : "开始顺序刷题"}</button>
          ${wrongCnt > 0 ? `<button type="button" id="hero-wrong-btn" class="btn ghost">攻克错题 (${wrongCnt})</button>` : ""}
        </div>
      </section>
    `;
  };

  const render = () => {
    const visibleBanks = activeFolder === "全部分组"
      ? banks
      : banks.filter((b) => (b.folder || "默认分组") === activeFolder);

    const cardsHtml = visibleBanks.map((bank) => {
      const pState = getBankPracticeState(bank.id);
      const answeredCount = Object.keys(pState.records || {}).length;
      const total = bank.questionCount || 0;
      const pct = total ? Math.min(100, Math.round((answeredCount / total) * 100)) : 0;
      const wrongCount = (pState.wrongIds || []).length;
      const favCount = (pState.favoriteIds || []).length;
      const isCurrent = bank.id === activeBankId;

      return `
        <div class="bank-card ${isCurrent ? "selected" : ""}" data-bank-id="${escapeHtml(bank.id)}">
          <div>
            <div class="row-gap" style="justify-content:space-between;align-items:flex-start;">
              <div>
                <h3>${bank.locked ? "🔒 " : ""}${escapeHtml(bank.name)}</h3>
                <div class="row-gap" style="margin-top:6px;">
                  <span class="badge warn">${escapeHtml(bank.folder || "默认分组")}</span>
                  <span class="badge">${total} 题</span>
                </div>
              </div>
              <div class="card-more-wrap">
                <button type="button" class="btn ghost icon-btn js-more-btn" title="更多操作" aria-label="更多操作">⋯</button>
                <div class="dropdown-menu js-card-menu" ${openMenuBankId === bank.id ? "" : "hidden"}>
                  <button type="button" class="dropdown-item" data-action="manage">${isAdmin ? "管理试题" : "查看试题"}</button>
                  <button type="button" class="dropdown-item" data-action="print">打印 / 导出 PDF</button>
                  <button type="button" class="dropdown-item" data-action="export-xlsx">导出 Excel</button>
                  <button type="button" class="dropdown-item" data-action="export-json">导出 JSON</button>
                  ${isAdmin ? `
                    <div class="dropdown-sep"></div>
                    <button type="button" class="dropdown-item" data-action="config">题库设置与加密</button>
                    <button type="button" class="dropdown-item danger" data-action="delete">删除题库</button>
                  ` : ""}
                </div>
              </div>
            </div>
            <p class="muted-text" style="margin:8px 0 10px;">${escapeHtml(bank.description || "暂无简介")}</p>
            <div class="progress-bar"><span style="width:${pct}%"></span></div>
            <div class="row-gap muted-text" style="margin-top:6px;font-size:12px;">
              <span>已练 ${answeredCount}/${total} (${pct}%)</span>
              <span>错题 ${wrongCount}</span>
              <span>收藏 ${favCount}</span>
            </div>
          </div>
          <div class="row-gap">
            <button class="btn primary tiny" data-action="practice" data-mode="order">顺序练习</button>
            <button class="btn ghost tiny" data-action="practice" data-mode="recite">背题模式</button>
            <button class="btn ghost tiny" data-action="practice" data-mode="exam">模拟考试</button>
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      ${renderHeroBanner()}
      <div class="panel">
        <div class="row-gap" style="justify-content:space-between;">
          <div>
            <h2 style="margin:0;font-size:18px;">全部题库</h2>
            <p class="muted-text" style="margin:2px 0 0;">访客可浏览与搜题；登录后开启刷题、考试与云端同步。</p>
          </div>
          <div class="row-gap">
            <button id="btn-new-bank" class="btn primary tiny">${isAdmin ? "+ 新建题库" : "登录建库"}</button>
            ${isAdmin ? `<button id="btn-merge-bank" class="btn ghost tiny">合并题库</button>` : ""}
            ${isAdmin ? `<button id="btn-go-import" class="btn ghost tiny">批量导题</button>` : ""}
          </div>
        </div>
        <div class="row-gap" style="margin-top:12px;">
          ${folders.map((f) => `<button class="btn tiny ${f === activeFolder ? "primary" : "ghost"}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
        <div class="cards-grid">${cardsHtml || '<p class="muted-text">当前分组暂无题库。</p>'}</div>
      </div>
    `;

    container.querySelector("#hero-continue-btn")?.addEventListener("click", () => {
      const cur = banks.find((b) => b.id === activeBankId) || banks[0];
      if (cur) { onSelectBank(cur.id); onNavigate("practice", { mode: "order" }); }
    });
    container.querySelector("#hero-wrong-btn")?.addEventListener("click", () => {
      const cur = banks.find((b) => b.id === activeBankId) || banks[0];
      if (cur) { onSelectBank(cur.id); onNavigate("practice", { mode: "wrong" }); }
    });

    container.querySelectorAll("button[data-folder]").forEach((btn) => {
      btn.addEventListener("click", () => { activeFolder = btn.dataset.folder; render(); });
    });

    container.querySelector("#btn-new-bank").addEventListener("click", async () => {
      if (!isAdmin) return onRequireLogin();
      const form = await openFormDialog({
        title: "新建题库",
        fields: [
          { name: "name", label: "题库名称", required: true, placeholder: "如：计算机网络期末" },
          { name: "folder", label: "文件夹分组", value: "默认分组" },
          { name: "description", label: "题库简介（可选）" }
        ],
        submitText: "创建题库"
      });
      if (!form || !form.name.trim()) return;
      try {
        const data = await apiRequest("/api/banks", {
          method: "POST",
          body: JSON.stringify({ name: form.name.trim(), folder: form.folder.trim() || "默认分组", description: form.description.trim() })
        });
        showToast("题库已创建", "ok");
        onSelectBank(data.bank.id);
        await onRefreshBanks();
      } catch (err) { showToast(err.message, "bad"); }
    });

    container.querySelector("#btn-merge-bank")?.addEventListener("click", async () => {
      if (banks.length < 2) return showToast("至少需要 2 个题库才能合并", "bad");
      const form = await openFormDialog({
        title: "合并多个题库",
        description: "将所选题库去重合并为一个新题库（原题库保留不受影响）。",
        fields: [
          { name: "sourceIds", label: "选择要合并的题库（至少 2 个）", type: "checkboxes", options: banks.map((b) => ({ value: b.id, label: `${b.name} (${b.questionCount || 0} 题)` })) },
          { name: "targetName", label: "合并后的新题库名称", value: "合并题库", required: true }
        ],
        submitText: "开始合并"
      });
      if (!form || (form.sourceIds || []).length < 2) return;
      try {
        const res = await apiRequest("/api/banks/merge", { method: "POST", body: JSON.stringify({ sourceIds: form.sourceIds, targetName: form.targetName.trim() || "合并题库" }) });
        showToast(`合并成功，共 ${res.created} 题`, "ok");
        onSelectBank(res.bank.id);
        await onRefreshBanks();
      } catch (err) { showToast(err.message, "bad"); }
    });

    container.querySelector("#btn-go-import")?.addEventListener("click", () => onNavigate("import"));

    container.addEventListener("click", (e) => {
      if (!e.target.closest(".card-more-wrap")) closeMenus();
    });

    container.querySelectorAll(".bank-card").forEach((card) => {
      const bankId = card.dataset.bankId;
      const currentBank = banks.find((b) => b.id === bankId);
      card.querySelector(".js-more-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenuBankId = openMenuBankId === bankId ? "" : bankId;
        container.querySelectorAll(".bank-card").forEach((c) => {
          const m = c.querySelector(".js-card-menu");
          if (m) m.hidden = c.dataset.bankId !== openMenuBankId;
        });
      });

      card.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        closeMenus();
        const action = btn.dataset.action;
        onSelectBank(bankId);
        if (action === "practice") return onNavigate("practice", { mode: btn.dataset.mode });
        if (action === "manage") return onNavigate("manage");
        if (action === "export-xlsx" || action === "export-json") {
          if (!isLoggedIn) { showToast("请先登录账号后再导出题库", "bad"); return onRequireUserLogin(); }
          try { await downloadBankFileSafe(currentBank, action === "export-xlsx" ? "xlsx" : "json"); }
          catch (err) { showToast(err.message, "bad"); }
          return;
        }
        if (action === "print") {
          if (!isLoggedIn) { showToast("请先登录账号后再打印或导出试卷", "bad"); return onRequireUserLogin(); }
          try {
            const res = await fetchBankQuestionsSafe(bankId);
            const withAns = confirm("是否包含答案与解析？（确定=含答案解析，取消=纯试卷）");
            printQuestionsDocument(res.bank?.name || "试卷导出", res.questions || [], withAns);
          } catch (err) { showToast(err.message, "bad"); }
          return;
        }
        if (action === "config") {
          const form = await openFormDialog({
            title: "题库设置",
            fields: [
              { name: "name", label: "题库名称", value: currentBank?.name || "", required: true },
              { name: "folder", label: "文件夹分组", value: currentBank?.folder || "默认分组" },
              { name: "description", label: "题库简介", value: currentBank?.description || "" },
              { name: "password", label: "访问密码（留空表示公开不加密）", type: "password", placeholder: "留空公开" }
            ],
            submitText: "保存设置"
          });
          if (!form || !form.name.trim()) return;
          try {
            await apiRequest(`/api/banks/${encodeURIComponent(bankId)}`, {
              method: "PUT",
              body: JSON.stringify({ name: form.name.trim(), folder: form.folder.trim() || "默认分组", description: form.description.trim(), password: form.password })
            });
            showToast("题库设置已更新", "ok");
            await onRefreshBanks();
          } catch (err) { showToast(err.message, "bad"); }
          return;
        }
        if (action === "delete") {
          if (!confirm("确定删除该题库及其全部试题吗？此操作不可撤销！")) return;
          try { await apiRequest(`/api/banks/${encodeURIComponent(bankId)}`, { method: "DELETE" }); showToast("题库已删除", "ok"); await onRefreshBanks(); }
          catch (err) { showToast(err.message, "bad"); }
        }
      });
    });
  };

  render();
};

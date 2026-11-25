import {
  apiRequest,
  downloadBankFileSafe,
  escapeHtml,
  fetchBankQuestionsSafe,
  getBankPracticeState,
  printQuestionsDocument,
  showToast
} from "../api.js";

export const renderBanksView = (container, ctx) => {
  const { banks, activeBankId, isAdmin, isLoggedIn, onSelectBank, onNavigate, onRefreshBanks, onRequireLogin, onRequireUserLogin } = ctx;
  const folders = ["全部分组", ...new Set(banks.map((b) => b.folder || "默认分组"))];
  let activeFolder = "全部分组";

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
            <div class="row-gap" style="justify-content:space-between;">
              <h3>${bank.locked ? "🔒 " : ""}${escapeHtml(bank.name)}</h3>
              <span class="badge">${total} 题</span>
            </div>
            <div class="row-gap" style="margin:4px 0 6px;">
              <span class="badge warn">${escapeHtml(bank.folder || "默认分组")}</span>
              <span class="muted-text">${escapeHtml(bank.description || "暂无简介")}</span>
            </div>
            <div class="progress-bar"><span style="width:${pct}%"></span></div>
            <div class="row-gap muted-text" style="margin-top:6px;font-size:12px;">
              <span>已练 ${answeredCount}/${total} (${pct}%)</span>
              <span>错题 ${wrongCount}</span>
              <span>收藏 ${favCount}</span>
            </div>
          </div>
          <div class="row-gap">
            <button class="btn primary tiny" data-action="practice" data-mode="order">顺序练习</button>
            <button class="btn ghost tiny" data-action="practice" data-mode="recite">背题</button>
            <button class="btn ghost tiny" data-action="practice" data-mode="exam">模拟考</button>
            <button class="btn ghost tiny" data-action="manage">${isAdmin ? "管理" : "查看试题"}</button>
            <button class="btn ghost tiny" data-action="print">打印/PDF</button>
            <button class="btn ghost tiny" data-action="export-xlsx">Excel</button>
            <button class="btn ghost tiny" data-action="export-json">JSON</button>
            ${isAdmin ? `
              <button class="btn ghost tiny" data-action="config">设置</button>
              <button class="btn danger tiny" data-action="delete">删除</button>
            ` : ""}
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      <div class="panel">
        <div class="row-gap" style="justify-content:space-between;">
          <div>
            <h2 style="margin:0;">题库中心</h2>
            <p class="muted-text" style="margin:4px 0 0;">访客可查看题库与搜题；登录学员账号后即可开启刷题、背题、模拟考与跨设备云端同步。</p>
          </div>
          <div class="row-gap">
            <button id="btn-new-bank" class="btn primary">${isAdmin ? "+ 新建题库" : "登录建库"}</button>
            ${isAdmin ? `<button id="btn-merge-bank" class="btn ghost">合并题库</button>` : ""}
            <button id="btn-go-import" class="btn ghost">批量导题</button>
          </div>
        </div>
        <div class="row-gap" style="margin-top:12px;">
          ${folders.map((f) => `<button class="btn tiny ${f === activeFolder ? "primary" : "ghost"}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
        <div class="cards-grid">${cardsHtml || '<p class="muted-text">当前分组暂无题库。</p>'}</div>
      </div>
    `;

    container.querySelectorAll("button[data-folder]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFolder = btn.dataset.folder;
        render();
      });
    });

    container.querySelector("#btn-new-bank").addEventListener("click", async () => {
      if (!isAdmin) return onRequireLogin();
      const name = prompt("请输入新题库名称：");
      if (!name || !name.trim()) return;
      const folder = prompt("所属文件夹分组（默认：默认分组）：", "默认分组") || "默认分组";
      const description = prompt("题库简介（可选）：") || "";
      try {
        const data = await apiRequest("/api/banks", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), folder, description })
        });
        showToast("题库已创建", "ok");
        onSelectBank(data.bank.id);
        await onRefreshBanks();
      } catch (err) {
        showToast(err.message, "bad");
      }
    });

    container.querySelector("#btn-merge-bank")?.addEventListener("click", async () => {
      if (banks.length < 2) return showToast("至少需要 2 个题库才能合并", "bad");
      const listHint = banks.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
      const picks = prompt(`请输入要合并的题库编号（逗号分隔，如 1,2）：\n${listHint}`);
      if (!picks) return;
      const sourceIds = picks.split(/[,，\s]+/).map((n) => banks[Number(n) - 1]?.id).filter(Boolean);
      const targetName = prompt("合并后的新题库名称：", "合并题库");
      if (!targetName) return;
      try {
        const res = await apiRequest("/api/banks/merge", {
          method: "POST",
          body: JSON.stringify({ sourceIds, targetName })
        });
        showToast(`合并成功，共 ${res.created} 题`, "ok");
        onSelectBank(res.bank.id);
        await onRefreshBanks();
      } catch (err) {
        showToast(err.message, "bad");
      }
    });

    container.querySelector("#btn-go-import").addEventListener("click", () => onNavigate("import"));

    container.querySelectorAll(".bank-card").forEach((card) => {
      const bankId = card.dataset.bankId;
      const currentBank = banks.find((b) => b.id === bankId);
      card.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        onSelectBank(bankId);
        if (action === "practice") return onNavigate("practice", { mode: btn.dataset.mode });
        if (action === "manage") return onNavigate("manage");
        if (action === "export-xlsx" || action === "export-json") {
          if (!isLoggedIn) {
            showToast("请先登录账号后再导出题库", "bad");
            return onRequireUserLogin();
          }
          try {
            await downloadBankFileSafe(currentBank, action === "export-xlsx" ? "xlsx" : "json");
          } catch (err) {
            showToast(err.message, "bad");
          }
          return;
        }
        if (action === "print") {
          if (!isLoggedIn) {
            showToast("请先登录账号后再打印或导出试卷", "bad");
            return onRequireUserLogin();
          }
          try {
            const res = await fetchBankQuestionsSafe(bankId);
            const withAns = confirm("是否包含答案与解析？（确定=含答案解析，取消=纯试卷）");
            printQuestionsDocument(res.bank?.name || "试卷导出", res.questions || [], withAns);
          } catch (err) {
            showToast(err.message, "bad");
          }
          return;
        }
        if (action === "config") {
          const nextName = prompt("题库名称：", currentBank?.name || "");
          if (!nextName || !nextName.trim()) return;
          const nextFolder = prompt("文件夹分组：", currentBank?.folder || "默认分组") || "默认分组";
          const nextPwd = prompt("访问密码（留空表示公开不加密）：", "");
          try {
            await apiRequest(`/api/banks/${encodeURIComponent(bankId)}`, {
              method: "PUT",
              body: JSON.stringify({
                name: nextName.trim(),
                folder: nextFolder,
                ...(nextPwd !== null ? { password: nextPwd } : {})
              })
            });
            showToast("题库设置已更新", "ok");
            await onRefreshBanks();
          } catch (err) {
            showToast(err.message, "bad");
          }
          return;
        }
        if (action === "delete") {
          if (!confirm("确定删除该题库及其全部试题吗？此操作不可撤销！")) return;
          try {
            await apiRequest(`/api/banks/${encodeURIComponent(bankId)}`, { method: "DELETE" });
            showToast("题库已删除", "ok");
            await onRefreshBanks();
          } catch (err) {
            showToast(err.message, "bad");
          }
        }
      });
    });
  };

  render();
};

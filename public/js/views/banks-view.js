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
import { iconSvg } from "../icons.js";

const VIEW_MODE_KEY = "qs_banks_view_mode";
const IGNORED_DESCS = new Set(["暂无简介", "自动从历史题库迁移的默认题库"]);
const RING_CIRCUMFERENCE = 2 * Math.PI * 16;
let banksAbortCtrl = null;

const isMeaningfulDesc = (desc) => {
  const clean = String(desc || "").trim();
  return Boolean(clean && !IGNORED_DESCS.has(clean));
};

const getBankStats = (bank) => {
  const pState = getBankPracticeState(bank.id);
  const done = Object.keys(pState.records || {}).length;
  const total = Number(bank.questionCount || 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return {
    done,
    total,
    pct,
    wrong: (pState.wrongIds || []).length,
    fav: (pState.favoriteIds || []).length,
    mastered: (pState.masteredIds || []).length
  };
};

const renderModeTilesHtml = (stats) => {
  const tiles = [
    { mode: "order", icon: "play", title: "顺序练习", sub: `从头刷题 · ${stats.done}/${stats.total}` },
    { mode: "chapter", icon: "layers", title: "章节练习", sub: "按章节分块专项" },
    { mode: "random", icon: "shuffle", title: "随机练习", sub: `打乱未掌握 ${Math.max(0, stats.total - stats.mastered)} 题` },
    { mode: "recite", icon: "eye", title: "背题模式", sub: "直出答案与解析" },
    { mode: "wrong", icon: "alert", title: "错题本", sub: stats.wrong ? `${stats.wrong} 道待巩固` : "暂无错题", tone: stats.wrong ? "is-bad" : "" },
    { mode: "favorite", icon: "star", title: "收藏夹", sub: stats.fav ? `已收藏 ${stats.fav} 题` : "重点收藏回顾", tone: stats.fav ? "is-warn" : "" },
    { mode: "type", icon: "sliders", title: "题型专项", sub: "单选/多选/填空等" },
    { mode: "exam", icon: "clock", title: "模拟考试", sub: "限时抽题自测" }
  ];
  return `
    <div class="mode-tiles">
      ${tiles.map((t) => `
        <button type="button" class="mode-tile ${t.tone || ""}" data-wb-mode="${t.mode}">
          <span class="mode-tile-icon">${iconSvg(t.icon, 16)}</span>
          <span class="mode-tile-body">
            <strong>${t.title}</strong>
            <span>${t.sub}</span>
          </span>
        </button>
      `).join("")}
    </div>
  `;
};

const renderWorkbenchHtml = (bank) => {
  if (!bank) return "";
  const st = getBankStats(bank);
  const offset = RING_CIRCUMFERENCE * (1 - st.pct / 100);
  const lockIcon = bank.locked ? iconSvg("lock", 15) : "";
  const desc = isMeaningfulDesc(bank.description) ? ` · ${escapeHtml(bank.description)}` : "";
  return `
    <section class="bank-workbench">
      <div class="wb-head">
        <div class="wb-title-wrap">
          <span class="bank-cover">${iconSvg("book", 20)}</span>
          <div style="min-width:0;">
            <h2 class="wb-title">${lockIcon}<span>${escapeHtml(bank.name)}</span></h2>
            <div class="wb-sub">共 ${st.total} 题 · 已练 ${st.done} 题 · 错题 ${st.wrong} · 收藏 ${st.fav}${desc}</div>
          </div>
        </div>
        <div class="wb-head-right">
          <div class="wb-ring-wrap">
            <svg class="wb-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle class="wb-ring-bg" cx="20" cy="20" r="16"></circle>
              <circle class="wb-ring-val" cx="20" cy="20" r="16"
                stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
                stroke-dashoffset="${offset.toFixed(2)}"></circle>
            </svg>
            <div class="wb-ring-text">
              <strong>${st.pct}%</strong>
              <span>掌握进度</span>
            </div>
          </div>
          <button type="button" id="wb-start-btn" class="btn primary">${st.done > 0 ? "继续刷题" : "开始顺序刷题"}</button>
        </div>
      </div>
      ${renderModeTilesHtml(st)}
    </section>
  `;
};

const renderMoreMenuHtml = (isAdmin, isOpen) => `
  <div class="card-more-wrap">
    <button type="button" class="btn ghost icon-btn js-more-btn" title="更多操作" aria-label="更多操作">${iconSvg("more", 16)}</button>
    <div class="dropdown-menu js-card-menu" ${isOpen ? "" : "hidden"}>
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
`;

const buildBankMetaLine = (bank, st) => {
  const parts = [`${st.total} 题`, `已练 ${st.done}`];
  if (st.wrong > 0) parts.push(`错 ${st.wrong}`);
  if (st.fav > 0) parts.push(`藏 ${st.fav}`);
  if (isMeaningfulDesc(bank.description)) parts.push(escapeHtml(bank.description));
  return parts.join(" · ");
};

const renderBankRowHtml = (bank, { st, isCurrent, isAdmin, isMenuOpen }) => {
  const folder = String(bank.folder || "").trim();
  const folderTag = folder && folder !== "默认分组" ? `<span class="tag-pill">${escapeHtml(folder)}</span>` : "";
  const curTag = isCurrent ? '<span class="tag-pill current">当前</span>' : "";
  const lockIcon = bank.locked ? iconSvg("lock", 13) : "";
  return `
    <div class="bank-row ${isCurrent ? "selected" : ""}" data-bank-id="${escapeHtml(bank.id)}">
      <div class="bank-row-left" data-select-bank="${escapeHtml(bank.id)}" title="点击设为当前练习题库">
        <span class="bank-cover-sm">${iconSvg("book", 17)}</span>
        <div class="bank-row-info">
          <div class="bank-row-title">${lockIcon}<span>${escapeHtml(bank.name)}</span>${curTag}${folderTag}</div>
          <div class="bank-row-meta">${buildBankMetaLine(bank, st)}</div>
        </div>
      </div>
      <div class="bank-row-right">
        <div class="bank-row-prog">
          <div class="progress-bar"><span style="width:${st.pct}%"></span></div>
          <span class="bank-pct-num">${st.pct}%</span>
        </div>
        <div class="row-gap" style="flex-wrap:nowrap;">
          <button type="button" class="btn ghost tiny" data-action="practice" data-mode="order">刷题</button>
          <button type="button" class="btn ghost tiny" data-action="practice" data-mode="recite">背题</button>
          <button type="button" class="btn ghost tiny" data-action="practice" data-mode="exam">模考</button>
          ${renderMoreMenuHtml(isAdmin, isMenuOpen)}
        </div>
      </div>
    </div>
  `;
};

const renderBankCardHtml = (bank, { st, isCurrent, isAdmin, isMenuOpen }) => {
  const folder = String(bank.folder || "").trim();
  const folderTag = folder && folder !== "默认分组" ? `<span class="tag-pill">${escapeHtml(folder)}</span>` : "";
  const curTag = isCurrent ? '<span class="tag-pill current">当前</span>' : "";
  const lockIcon = bank.locked ? iconSvg("lock", 13) : "";
  return `
    <div class="bank-card ${isCurrent ? "selected" : ""}" data-bank-id="${escapeHtml(bank.id)}">
      <div>
        <div class="bank-card-head">
          <div class="row-gap" style="flex:1;min-width:0;flex-wrap:nowrap;" data-select-bank="${escapeHtml(bank.id)}">
            <span class="bank-cover-sm">${iconSvg("book", 17)}</span>
            <div style="min-width:0;">
              <h3 class="bank-card-title">${lockIcon}<span>${escapeHtml(bank.name)}</span>${curTag}${folderTag}</h3>
              <div class="bank-card-meta">${buildBankMetaLine(bank, st)}</div>
            </div>
          </div>
          ${renderMoreMenuHtml(isAdmin, isMenuOpen)}
        </div>
        <div class="row-gap" style="margin-top:14px;">
          <div class="progress-bar" style="flex:1;height:5px;"><span style="width:${st.pct}%"></span></div>
          <span class="bank-pct-num">${st.pct}%</span>
        </div>
      </div>
      <div class="row-gap">
        <button type="button" class="btn ghost tiny" style="flex:1;" data-action="practice" data-mode="order">刷题</button>
        <button type="button" class="btn ghost tiny" data-action="practice" data-mode="recite">背题</button>
        <button type="button" class="btn ghost tiny" data-action="practice" data-mode="exam">模考</button>
      </div>
    </div>
  `;
};

const renderSectionHeadHtml = ({ banksCount, folders, activeFolder, keyword, hasCustomFolders, viewMode, isAdmin }) => `
  <div class="section-head">
    <div class="row-gap">
      <h3 class="section-title">我的题库 <span class="section-count">(${banksCount})</span></h3>
      ${hasCustomFolders && folders.length > 2 ? folders.map((f) => `<button type="button" class="btn tiny ${f === activeFolder ? "primary" : "ghost"}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("") : ""}
    </div>
    <div class="row-gap">
      ${banksCount >= 4 ? `<input id="banks-kw" class="banks-filter-input" type="search" value="${escapeHtml(keyword)}" placeholder="搜索题库...">` : ""}
      <div class="view-seg" role="group" aria-label="查看方式">
        <button type="button" class="view-seg-btn ${viewMode === "list" ? "active" : ""}" data-view-mode="list">${iconSvg("list", 14)}<span>横条</span></button>
        <button type="button" class="view-seg-btn ${viewMode === "grid" ? "active" : ""}" data-view-mode="grid">${iconSvg("grid", 14)}<span>卡片</span></button>
      </div>
      ${isAdmin ? `
        <button type="button" id="btn-new-bank" class="btn ghost tiny">+ 新建题库</button>
        <button type="button" id="btn-merge-bank" class="btn ghost tiny">合并</button>
        <button type="button" id="btn-go-import" class="btn ghost tiny">导题</button>
      ` : ""}
    </div>
  </div>
`;

export const renderBanksView = (container, ctx) => {
  banksAbortCtrl?.abort();
  banksAbortCtrl = new AbortController();
  const { signal } = banksAbortCtrl;
  const { banks, activeBankId, isAdmin, isLoggedIn, onSelectBank, onNavigate, onRefreshBanks, onRequireUserLogin } = ctx;

  const folders = ["全部分组", ...new Set(banks.map((b) => String(b.folder || "").trim() || "默认分组"))];
  const hasCustomFolders = folders.some((f) => f !== "全部分组" && f !== "默认分组");
  let currentActiveId = banks.some((b) => b.id === activeBankId) ? activeBankId : (banks[0]?.id || "");
  let activeFolder = "全部分组";
  let keyword = "";
  let openMenuBankId = "";
  let viewMode = localStorage.getItem(VIEW_MODE_KEY) === "grid" ? "grid" : "list";

  const closeMenus = () => {
    if (!openMenuBankId) return;
    openMenuBankId = "";
    container.querySelectorAll(".js-card-menu").forEach((el) => { el.hidden = true; });
  };

  const render = () => {
    const curBank = banks.find((b) => b.id === currentActiveId) || banks[0] || null;
    if (curBank) currentActiveId = curBank.id;
    const kw = keyword.trim().toLowerCase();
    const visibleBanks = banks.filter((b) => {
      const fName = String(b.folder || "").trim() || "默认分组";
      if (activeFolder !== "全部分组" && fName !== activeFolder) return false;
      if (kw && !`${b.name} ${b.description || ""}`.toLowerCase().includes(kw)) return false;
      return true;
    });

    const itemsHtml = visibleBanks.map((bank) => {
      const meta = { st: getBankStats(bank), isCurrent: bank.id === currentActiveId, isAdmin, isMenuOpen: openMenuBankId === bank.id };
      return viewMode === "grid" ? renderBankCardHtml(bank, meta) : renderBankRowHtml(bank, meta);
    }).join("");

    const listWrapHtml = visibleBanks.length
      ? (viewMode === "grid" ? `<div class="cards-grid">${itemsHtml}</div>` : `<div class="bank-list">${itemsHtml}</div>`)
      : '<div class="panel"><p class="muted-text" style="margin:0;">暂无题库。</p></div>';

    container.innerHTML = `
      <div class="view-frame">
        ${renderWorkbenchHtml(curBank)}
        <section class="banks-section view-frame">
          ${renderSectionHeadHtml({ banksCount: banks.length, folders, activeFolder, keyword, hasCustomFolders, viewMode, isAdmin })}
          <div class="view-scroll banks-scroll-body">${listWrapHtml}</div>
        </section>
      </div>
    `;
  };

  const handleBankAction = async (action, bankId, targetEl) => {
    const currentBank = banks.find((b) => b.id === bankId);
    onSelectBank(bankId);
    currentActiveId = bankId;
    if (action === "practice") return onNavigate("practice", { mode: targetEl.dataset.mode || "order" });
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
          { name: "description", label: "题库简介（可选）", value: currentBank?.description || "" },
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
  };

  const openNewBankModal = async () => {
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
  };

  const openMergeModal = async () => {
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
  };

  container.addEventListener("input", (e) => {
    if (e.target.id === "banks-kw") { keyword = e.target.value; render(); }
  }, { signal });

  container.addEventListener("click", (e) => {
    const modeBtn = e.target.closest("button[data-view-mode]");
    if (modeBtn) { viewMode = modeBtn.dataset.viewMode === "grid" ? "grid" : "list"; localStorage.setItem(VIEW_MODE_KEY, viewMode); return render(); }
    const folderBtn = e.target.closest("button[data-folder]");
    if (folderBtn) { activeFolder = folderBtn.dataset.folder; return render(); }
    if (e.target.closest("#wb-start-btn") && currentActiveId) { onSelectBank(currentActiveId); return onNavigate("practice", { mode: "order" }); }
    const wbTile = e.target.closest("[data-wb-mode]");
    if (wbTile && currentActiveId) { onSelectBank(currentActiveId); return onNavigate("practice", { mode: wbTile.dataset.wbMode }); }
    if (e.target.closest("#btn-new-bank")) return openNewBankModal();
    if (e.target.closest("#btn-merge-bank")) return openMergeModal();
    if (e.target.closest("#btn-go-import")) return onNavigate("import");

    const moreBtn = e.target.closest(".js-more-btn");
    if (moreBtn) {
      e.stopPropagation();
      const bankId = moreBtn.closest("[data-bank-id]")?.dataset.bankId || "";
      openMenuBankId = openMenuBankId === bankId ? "" : bankId;
      container.querySelectorAll("[data-bank-id]").forEach((el) => {
        const m = el.querySelector(".js-card-menu");
        if (m) m.hidden = el.dataset.bankId !== openMenuBankId;
      });
      return;
    }

    const actionEl = e.target.closest("[data-action]");
    if (actionEl) {
      const bankId = actionEl.closest("[data-bank-id]")?.dataset.bankId;
      closeMenus();
      if (bankId) handleBankAction(actionEl.dataset.action, bankId, actionEl);
      return;
    }
    const selectEl = e.target.closest("[data-select-bank]");
    if (selectEl) {
      currentActiveId = selectEl.dataset.selectBank;
      onSelectBank(currentActiveId);
      closeMenus();
      return render();
    }
    if (!e.target.closest(".card-more-wrap")) closeMenus();
  }, { signal });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".card-more-wrap")) closeMenus();
  }, { signal });

  render();
};

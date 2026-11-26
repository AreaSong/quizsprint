import {
  apiRequest,
  BANK_CATEGORIES,
  downloadBankFileSafe,
  escapeHtml,
  fetchBankQuestionsSafe,
  getBankPracticeState,
  printQuestionsDocument,
  showToast
} from "../api.js";
import { openConfirmDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import { openBankConfigModal, openBankCreateModal, openBankMergeModal, openSubjectModal } from "./banks-modals.js";

const VIEW_MODE_KEY = "qs_banks_view_mode";
const ACTIVE_TERM_KEY = "qs_banks_term";
const ACTIVE_SUBJECT_KEY = "qs_banks_subject";
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
    done, total, pct,
    wrong: (pState.wrongIds || []).length,
    fav: (pState.favoriteIds || []).length,
    mastered: (pState.masteredIds || []).length
  };
};

const formatExamCountdown = (examDate) => {
  if (!examDate) return null;
  const target = new Date(`${examDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays > 0) return { text: `距考试还有 ${diffDays} 天`, cls: diffDays <= 7 ? "warn" : "" };
  if (diffDays === 0) return { text: "今天考试", cls: "bad" };
  return { text: "考试已过", cls: "" };
};

const renderBankTagsHtml = (bank, isCurrent) => {
  const cat = bank.category || "theory";
  const catTag = `<span class="cat-pill" data-cat="${escapeHtml(cat)}">${BANK_CATEGORIES[cat] || "理论"}</span>`;
  const subLabel = bank.subjectName || (bank.folder && bank.folder !== "默认分组" ? bank.folder : "");
  const subTag = subLabel ? `<span class="tag-pill">${escapeHtml(subLabel)}</span>` : "";
  const curTag = isCurrent ? '<span class="tag-pill current">当前</span>' : "";
  return `${curTag}${catTag}${subTag}`;
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
          <span class="mode-tile-body"><strong>${t.title}</strong><span>${t.sub}</span></span>
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
            <h2 class="wb-title">${lockIcon}<span>${escapeHtml(bank.name)}</span>${renderBankTagsHtml(bank, false)}</h2>
            <div class="wb-sub">共 ${st.total} 题 · 已练 ${st.done} 题 · 错题 ${st.wrong} · 收藏 ${st.fav}${desc}</div>
          </div>
        </div>
        <div class="wb-head-right">
          <div class="wb-ring-wrap">
            <svg class="wb-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle class="wb-ring-bg" cx="20" cy="20" r="16"></circle>
              <circle class="wb-ring-val" cx="20" cy="20" r="16" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
            </svg>
            <div class="wb-ring-text"><strong>${st.pct}%</strong><span>掌握进度</span></div>
          </div>
          <button type="button" id="wb-start-btn" class="btn primary">${st.done > 0 ? "继续刷题" : "开始顺序刷题"}</button>
        </div>
      </div>
      ${renderModeTilesHtml(st)}
    </section>
  `;
};

const renderSubjectBarHtml = ({ terms, activeTerm, termSubjects, activeSubjectId, banks, isAdmin }) => {
  const allCount = banks.reduce((s, b) => s + Number(b.questionCount || 0), 0);
  const ungroupedCnt = banks.filter((b) => !b.subjectId).reduce((s, b) => s + Number(b.questionCount || 0), 0);
  return `
    <div class="subject-bar">
      <div class="subject-bar-left">
        ${terms.length ? `
          <select id="sub-term-sel" class="subject-term-sel" aria-label="按学期筛选">
            <option value="ALL" ${activeTerm === "ALL" ? "selected" : ""}>全部学期</option>
            ${terms.map((t) => `<option value="${escapeHtml(t)}" ${activeTerm === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
          </select>
        ` : ""}
        <div class="subject-pills">
          <button type="button" class="subject-pill ${activeSubjectId === "" ? "active" : ""}" data-subject-id="">
            <span>全部科目</span><span class="subject-pill-cnt">${allCount}</span>
          </button>
          ${termSubjects.map((s) => `
            <button type="button" class="subject-pill ${activeSubjectId === s.id ? "active" : ""}" data-subject-id="${escapeHtml(s.id)}">
              <span>${escapeHtml(s.name)}</span><span class="subject-pill-cnt">${s.questionCount || 0}</span>
            </button>
          `).join("")}
          ${activeTerm === "ALL" && ungroupedCnt > 0 ? `
            <button type="button" class="subject-pill ${activeSubjectId === "__none__" ? "active" : ""}" data-subject-id="__none__">
              <span>未分类</span><span class="subject-pill-cnt">${ungroupedCnt}</span>
            </button>
          ` : ""}
        </div>
      </div>
      ${isAdmin ? '<button type="button" id="btn-new-subject" class="btn ghost tiny">+ 新建科目</button>' : ""}
    </div>
  `;
};

const renderSubjectOverviewHtml = (subject, subjectBanks, isAdmin) => {
  if (!subject) return "";
  const total = subjectBanks.reduce((s, b) => s + Number(b.questionCount || 0), 0);
  const done = subjectBanks.reduce((s, b) => s + getBankStats(b).done, 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const cd = formatExamCountdown(subject.examDate);
  return `
    <div class="subject-overview">
      <div class="subject-ov-main">
        <div class="row-gap">
          <strong style="font-size:0.9375rem;">${escapeHtml(subject.name)}</strong>
          ${subject.term ? `<span class="tag-pill">${escapeHtml(subject.term)}</span>` : ""}
          ${cd ? `<span class="badge ${cd.cls}">${escapeHtml(cd.text)}</span>` : ""}
        </div>
        <div class="muted-text" style="font-size:0.7813rem;">共 ${subjectBanks.length} 个题库 · ${total} 题 · 已练 ${done} 题${subject.description ? ` · ${escapeHtml(subject.description)}` : ""}</div>
      </div>
      <div class="row-gap">
        <div class="subject-ov-prog">
          <div class="progress-bar" style="flex:1;height:6px;"><span style="width:${pct}%"></span></div>
          <span class="bank-pct-num">${pct}%</span>
        </div>
        ${isAdmin ? `
          <button type="button" id="btn-edit-subject" class="btn ghost tiny">编辑科目</button>
          <button type="button" id="btn-del-subject" class="btn ghost-danger tiny">删除</button>
        ` : ""}
      </div>
    </div>
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
      ${isAdmin ? '<div class="dropdown-sep"></div><button type="button" class="dropdown-item" data-action="config">题库设置与加密</button><button type="button" class="dropdown-item danger" data-action="delete">删除题库</button>' : ""}
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

const renderBankRowHtml = (bank, { st, isCurrent, isAdmin, isMenuOpen }) => `
  <div class="bank-row ${isCurrent ? "selected" : ""}" data-bank-id="${escapeHtml(bank.id)}">
    <div class="bank-row-left" data-select-bank="${escapeHtml(bank.id)}" title="点击设为当前练习题库">
      <span class="bank-cover-sm">${iconSvg("book", 17)}</span>
      <div class="bank-row-info">
        <div class="bank-row-title">${bank.locked ? iconSvg("lock", 13) : ""}<span>${escapeHtml(bank.name)}</span>${renderBankTagsHtml(bank, isCurrent)}</div>
        <div class="bank-row-meta">${buildBankMetaLine(bank, st)}</div>
      </div>
    </div>
    <div class="bank-row-right">
      <div class="bank-row-prog"><div class="progress-bar"><span style="width:${st.pct}%"></span></div><span class="bank-pct-num">${st.pct}%</span></div>
      <div class="row-gap" style="flex-wrap:nowrap;">
        <button type="button" class="btn ghost tiny" data-action="practice" data-mode="order">刷题</button>
        <button type="button" class="btn ghost tiny" data-action="practice" data-mode="recite">背题</button>
        <button type="button" class="btn ghost tiny" data-action="practice" data-mode="exam">模考</button>
        ${renderMoreMenuHtml(isAdmin, isMenuOpen)}
      </div>
    </div>
  </div>
`;

const renderBankCardHtml = (bank, { st, isCurrent, isAdmin, isMenuOpen }) => `
  <div class="bank-card ${isCurrent ? "selected" : ""}" data-bank-id="${escapeHtml(bank.id)}">
    <div>
      <div class="bank-card-head">
        <div class="row-gap" style="flex:1;min-width:0;flex-wrap:nowrap;" data-select-bank="${escapeHtml(bank.id)}">
          <span class="bank-cover-sm">${iconSvg("book", 17)}</span>
          <div style="min-width:0;">
            <h3 class="bank-card-title">${bank.locked ? iconSvg("lock", 13) : ""}<span>${escapeHtml(bank.name)}</span></h3>
            <div class="row-gap" style="margin-top:6px;gap:5px;">${renderBankTagsHtml(bank, isCurrent)}</div>
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

export const renderBanksView = (container, ctx) => {
  banksAbortCtrl?.abort();
  banksAbortCtrl = new AbortController();
  const { signal } = banksAbortCtrl;
  const { banks, subjects = [], activeBankId, isAdmin, isLoggedIn, onSelectBank, onNavigate, onRefreshBanks, onRequireUserLogin } = ctx;

  const terms = [...new Set(subjects.map((s) => s.term).filter(Boolean))];
  let activeTerm = localStorage.getItem(ACTIVE_TERM_KEY) || "ALL";
  if (activeTerm !== "ALL" && !terms.includes(activeTerm)) activeTerm = "ALL";
  let activeSubjectId = localStorage.getItem(ACTIVE_SUBJECT_KEY) || "";
  let activeCategory = "";
  let currentActiveId = banks.some((b) => b.id === activeBankId) ? activeBankId : (banks[0]?.id || "");
  let keyword = "";
  let openMenuBankId = "";
  let viewMode = localStorage.getItem(VIEW_MODE_KEY) === "grid" ? "grid" : "list";

  const closeMenus = () => {
    if (!openMenuBankId) return;
    openMenuBankId = "";
    container.querySelectorAll(".js-card-menu").forEach((el) => { el.hidden = true; });
  };

  const getFilteredState = () => {
    const termSubjects = activeTerm === "ALL" ? subjects : subjects.filter((s) => s.term === activeTerm);
    const termSubjectIds = new Set(termSubjects.map((s) => s.id));
    if (activeSubjectId && activeSubjectId !== "__none__" && !termSubjectIds.has(activeSubjectId)) activeSubjectId = "";
    const curSubject = subjects.find((s) => s.id === activeSubjectId) || null;
    const kw = keyword.trim().toLowerCase();
    const scopeBanks = banks.filter((b) => {
      if (activeTerm !== "ALL" && !termSubjectIds.has(b.subjectId)) return false;
      if (activeSubjectId === "__none__" && b.subjectId) return false;
      if (activeSubjectId && activeSubjectId !== "__none__" && b.subjectId !== activeSubjectId) return false;
      return true;
    });
    const visibleBanks = scopeBanks.filter((b) => {
      if (activeCategory && (b.category || "theory") !== activeCategory) return false;
      if (kw && !`${b.name} ${b.description || ""} ${b.subjectName || ""}`.toLowerCase().includes(kw)) return false;
      return true;
    });
    return { termSubjects, curSubject, scopeBanks, visibleBanks };
  };

  const renderListArea = () => {
    const { visibleBanks, scopeBanks } = getFilteredState();
    const listWrap = container.querySelector("#banks-scroll-body");
    const cntEl = container.querySelector("#banks-count-lbl");
    if (cntEl) cntEl.textContent = `(${visibleBanks.length}/${scopeBanks.length})`;
    if (!listWrap) return;
    const itemsHtml = visibleBanks.map((bank) => {
      const meta = { st: getBankStats(bank), isCurrent: bank.id === currentActiveId, isAdmin, isMenuOpen: openMenuBankId === bank.id };
      return viewMode === "grid" ? renderBankCardHtml(bank, meta) : renderBankRowHtml(bank, meta);
    }).join("");
    listWrap.innerHTML = visibleBanks.length
      ? (viewMode === "grid" ? `<div class="cards-grid">${itemsHtml}</div>` : `<div class="bank-list">${itemsHtml}</div>`)
      : `<div class="panel empty-state" style="margin:20px auto;"><div class="empty-state-icon">${iconSvg("book", 20)}</div><strong style="font-size:0.875rem;">当前筛选下暂无题库</strong><p class="muted-text" style="margin:0;">可切换学期/科目，或点击右上角新建题库。</p></div>`;
  };

  const render = () => {
    const { termSubjects, curSubject, scopeBanks } = getFilteredState();
    const curBank = scopeBanks.find((b) => b.id === currentActiveId) || scopeBanks[0] || banks.find((b) => b.id === currentActiveId) || banks[0] || null;
    if (curBank && curBank.id !== currentActiveId) { currentActiveId = curBank.id; onSelectBank(currentActiveId); }
    const catBtns = [["", "全部"], ...Object.entries(BANK_CATEGORIES)].map(([k, lbl]) => `
      <button type="button" class="btn tiny ${activeCategory === k ? "soft-active" : "ghost"}" data-cat-filter="${k}">${lbl}</button>
    `).join("");

    container.innerHTML = `
      <div class="view-frame">
        ${renderSubjectBarHtml({ terms, activeTerm, termSubjects, activeSubjectId, banks, isAdmin })}
        ${renderSubjectOverviewHtml(curSubject, scopeBanks, isAdmin)}
        ${renderWorkbenchHtml(curBank)}
        <section class="banks-section view-frame">
          <div class="section-head">
            <div class="row-gap">
              <h3 class="section-title">题库列表 <span id="banks-count-lbl" class="section-count"></span></h3>
              <div class="cat-filter-row">${catBtns}</div>
            </div>
            <div class="row-gap">
              <input id="banks-kw" class="banks-filter-input" type="search" value="${escapeHtml(keyword)}" placeholder="搜索题库或科目...">
              <div class="view-seg" role="group" aria-label="查看方式">
                <button type="button" class="view-seg-btn ${viewMode === "list" ? "active" : ""}" data-view-mode="list">${iconSvg("list", 14)}<span>横条</span></button>
                <button type="button" class="view-seg-btn ${viewMode === "grid" ? "active" : ""}" data-view-mode="grid">${iconSvg("grid", 14)}<span>卡片</span></button>
              </div>
              ${isAdmin ? '<button type="button" id="btn-new-bank" class="btn primary tiny">+ 新建题库</button><button type="button" id="btn-merge-bank" class="btn ghost tiny">合并</button><button type="button" id="btn-go-import" class="btn ghost tiny">导题</button>' : ""}
            </div>
          </div>
          <div id="banks-scroll-body" class="view-scroll banks-scroll-body"></div>
        </section>
      </div>
    `;
    renderListArea();
  };

  const handleBankAction = async (action, bankId, targetEl) => {
    const currentBank = banks.find((b) => b.id === bankId);
    onSelectBank(bankId); currentActiveId = bankId;
    if (action === "practice") return onNavigate("practice", { mode: targetEl.dataset.mode || "order" });
    if (action === "manage") return onNavigate("manage");
    if (action === "export-xlsx" || action === "export-json") {
      if (!isLoggedIn) { showToast("请先登录账号后再导出题库", "bad"); return onRequireUserLogin(); }
      try { await downloadBankFileSafe(currentBank, action === "export-xlsx" ? "xlsx" : "json"); } catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (action === "print") {
      if (!isLoggedIn) { showToast("请先登录账号后再打印或导出试卷", "bad"); return onRequireUserLogin(); }
      try {
        const res = await fetchBankQuestionsSafe(bankId);
        const withAns = await openConfirmDialog({ title: "打印 / 导出试卷", message: "请选择导出格式：包含参考答案与解析，还是导出纯净空白试卷？", confirmText: "含答案解析", cancelText: "纯试卷", threeState: true });
        if (withAns !== null) printQuestionsDocument(res.bank?.name || "试卷导出", res.questions || [], withAns);
      } catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (action === "config") return openBankConfigModal({ bank: currentBank, subjects, onSaved: onRefreshBanks });
    if (action === "delete") {
      const ok = await openConfirmDialog({ title: "删除题库", message: "确定删除该题库及其全部试题吗？此操作不可撤销！", confirmText: "确认删除", danger: true });
      if (!ok) return;
      try { await apiRequest(`/api/banks/${encodeURIComponent(bankId)}`, { method: "DELETE" }); showToast("题库已删除", "ok"); await onRefreshBanks(); } catch (err) { showToast(err.message, "bad"); }
    }
  };

  container.addEventListener("change", (e) => {
    if (e.target.id === "sub-term-sel") { activeTerm = e.target.value; localStorage.setItem(ACTIVE_TERM_KEY, activeTerm); render(); }
  }, { signal });
  container.addEventListener("input", (e) => { if (e.target.id === "banks-kw") { keyword = e.target.value; renderListArea(); } }, { signal });
  container.addEventListener("click", async (e) => {
    const subBtn = e.target.closest("button[data-subject-id]");
    if (subBtn) { activeSubjectId = subBtn.dataset.subjectId; localStorage.setItem(ACTIVE_SUBJECT_KEY, activeSubjectId); return render(); }
    const catBtn = e.target.closest("button[data-cat-filter]");
    if (catBtn) { activeCategory = catBtn.dataset.catFilter; return render(); }
    const modeBtn = e.target.closest("button[data-view-mode]");
    if (modeBtn) { viewMode = modeBtn.dataset.viewMode === "grid" ? "grid" : "list"; localStorage.setItem(VIEW_MODE_KEY, viewMode); return render(); }
    if (e.target.closest("#wb-start-btn") && currentActiveId) { onSelectBank(currentActiveId); return onNavigate("practice", { mode: "order" }); }
    const wbTile = e.target.closest("[data-wb-mode]");
    if (wbTile && currentActiveId) { onSelectBank(currentActiveId); return onNavigate("practice", { mode: wbTile.dataset.wbMode }); }
    const defSubId = activeSubjectId && activeSubjectId !== "__none__" ? activeSubjectId : "";
    if (e.target.closest("#btn-new-subject")) return openSubjectModal({ defaultTerm: activeTerm === "ALL" ? "" : activeTerm, onSaved: async (sub) => { activeSubjectId = sub.id; localStorage.setItem(ACTIVE_SUBJECT_KEY, activeSubjectId); await onRefreshBanks(); } });
    if (e.target.closest("#btn-edit-subject")) return openSubjectModal({ subject: subjects.find((s) => s.id === activeSubjectId), onSaved: onRefreshBanks });
    if (e.target.closest("#btn-del-subject")) {
      const ok = await openConfirmDialog({ title: "删除科目", message: "确定删除该科目吗？仅解绑归类关系，旗下题库与试题不会丢失。", confirmText: "确认删除", danger: true });
      if (!ok) return;
      try { await apiRequest(`/api/subjects/${encodeURIComponent(activeSubjectId)}`, { method: "DELETE" }); activeSubjectId = ""; localStorage.setItem(ACTIVE_SUBJECT_KEY, ""); showToast("科目已删除", "ok"); await onRefreshBanks(); } catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (e.target.closest("#btn-new-bank")) return openBankCreateModal({ subjects, defaultSubjectId: defSubId, onCreated: async (b) => { onSelectBank(b.id); await onRefreshBanks(); } });
    if (e.target.closest("#btn-merge-bank")) return openBankMergeModal({ banks, subjects, defaultSubjectId: defSubId, onMerged: async (b) => { onSelectBank(b.id); await onRefreshBanks(); } });
    if (e.target.closest("#btn-go-import")) return onNavigate("import");

    const moreBtn = e.target.closest(".js-more-btn");
    if (moreBtn) {
      e.stopPropagation();
      const bid = moreBtn.closest("[data-bank-id]")?.dataset.bankId || "";
      openMenuBankId = openMenuBankId === bid ? "" : bid;
      container.querySelectorAll("[data-bank-id]").forEach((el) => { const m = el.querySelector(".js-card-menu"); if (m) m.hidden = el.dataset.bankId !== openMenuBankId; });
      return;
    }
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) { const bid = actionEl.closest("[data-bank-id]")?.dataset.bankId; closeMenus(); if (bid) handleBankAction(actionEl.dataset.action, bid, actionEl); return; }
    const selectEl = e.target.closest("[data-select-bank]");
    if (selectEl) { currentActiveId = selectEl.dataset.selectBank; onSelectBank(currentActiveId); closeMenus(); return render(); }
    if (!e.target.closest(".card-more-wrap")) closeMenus();
  }, { signal });

  document.addEventListener("click", (e) => { if (!e.target.closest(".card-more-wrap")) closeMenus(); }, { signal });
  render();
};

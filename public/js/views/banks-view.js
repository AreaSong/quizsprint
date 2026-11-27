import {
  apiRequest,
  BANK_CATEGORIES,
  downloadBankFileSafe,
  escapeHtml,
  fetchBankQuestionsSafe,
  printQuestionsDocument,
  showToast
} from "../api.js";
import { openConfirmDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import { openBankConfigModal, openBankCreateModal, openBankMergeModal, openSubjectModal } from "./banks-modals.js";
import {
  renderExamNoticeBoardHtml,
  renderGroupedBanksHtml,
  renderSubjectBarHtml,
  renderSubjectOverviewHtml,
  renderWorkbenchHtml
} from "./banks-renderers.js";

const VIEW_MODE_KEY = "qs_banks_view_mode";
const ACTIVE_TERM_KEY = "qs_banks_term";
const ACTIVE_SUBJECT_KEY = "qs_banks_subject";
let banksAbortCtrl = null;

export const renderBanksView = (container, ctx) => {
  banksAbortCtrl?.abort();
  banksAbortCtrl = new AbortController();
  const { signal } = banksAbortCtrl;
  const { banks, subjects = [], activeBankId, isAdmin, isLoggedIn, siteInfo, onSelectBank, onNavigate, onRefreshBanks, onRequireUserLogin } = ctx;

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
    listWrap.innerHTML = renderGroupedBanksHtml({
      visibleBanks, subjects, activeSubjectId, activeCategory, keyword, viewMode,
      currentActiveId, isAdmin, openMenuBankId
    });
  };

  const render = () => {
    const { termSubjects, curSubject, scopeBanks } = getFilteredState();
    const curBank = scopeBanks.find((b) => b.id === currentActiveId) || scopeBanks[0] || banks.find((b) => b.id === currentActiveId) || banks[0] || null;
    if (curBank && curBank.id !== currentActiveId) { currentActiveId = curBank.id; onSelectBank(currentActiveId); }
    const catBtns = [["", "全部"], ...Object.entries(BANK_CATEGORIES)].map(([k, lbl]) => `
      <button type="button" class="btn tiny ${activeCategory === k ? "soft-active" : "ghost"}" data-cat-filter="${k}">${lbl}</button>
    `).join("");

    container.innerHTML = `
      <div class="view-frame banks-view-frame">
        ${renderExamNoticeBoardHtml(siteInfo?.siteConfig?.examNotices || [], isAdmin)}
        ${renderSubjectBarHtml({ terms, activeTerm, termSubjects, activeSubjectId, banks, isAdmin })}
        <div class="banks-split">
          <section class="banks-main-col view-frame">
            ${renderSubjectOverviewHtml(curSubject, scopeBanks, isAdmin)}
            <div class="section-head">
              <div class="row-gap">
                <h3 class="section-title">${curSubject ? `${escapeHtml(curSubject.name)} · 模块列表` : "科目与题库列表"} <span id="banks-count-lbl" class="section-count"></span></h3>
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
          <aside id="banks-workbench-slot" class="banks-side-col">
            ${renderWorkbenchHtml(curBank)}
          </aside>
        </div>
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
    if (e.target.closest(".js-open-se-lab")) return;
    if (e.target.closest("#btn-back-all-subjects")) { activeSubjectId = ""; localStorage.setItem(ACTIVE_SUBJECT_KEY, ""); return render(); }
    const enterEl = e.target.closest("[data-enter-subject]");
    if (enterEl) { activeSubjectId = enterEl.dataset.enterSubject; localStorage.setItem(ACTIVE_SUBJECT_KEY, activeSubjectId); return render(); }
    const subBtn = e.target.closest("button[data-subject-id]");
    if (subBtn) { activeSubjectId = subBtn.dataset.subjectId; localStorage.setItem(ACTIVE_SUBJECT_KEY, activeSubjectId); return render(); }
    const catBtn = e.target.closest("button[data-cat-filter]");
    if (catBtn) {
      activeCategory = catBtn.dataset.catFilter;
      container.querySelectorAll("button[data-cat-filter]").forEach((b) => {
        const active = b.dataset.catFilter === activeCategory;
        b.classList.toggle("soft-active", active);
        b.classList.toggle("ghost", !active);
      });
      return renderListArea();
    }
    const modeBtn = e.target.closest("button[data-view-mode]");
    if (modeBtn) {
      viewMode = modeBtn.dataset.viewMode === "grid" ? "grid" : "list";
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
      container.querySelectorAll("button[data-view-mode]").forEach((b) => b.classList.toggle("active", b.dataset.viewMode === viewMode));
      return renderListArea();
    }
    const startBtn = e.target.closest("#wb-start-btn");
    if (startBtn && currentActiveId) { onSelectBank(currentActiveId); return onNavigate("practice", { mode: startBtn.dataset.startMode || "order" }); }
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
    if (e.target.closest("#btn-edit-exam-notices")) return onNavigate("system");
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
    if (selectEl) {
      currentActiveId = selectEl.dataset.selectBank;
      onSelectBank(currentActiveId);
      closeMenus();
      const wbSlot = container.querySelector("#banks-workbench-slot");
      const listWrap = container.querySelector("#banks-scroll-body");
      if (wbSlot && listWrap) {
        const prevTop = listWrap.scrollTop;
        wbSlot.innerHTML = renderWorkbenchHtml(banks.find((b) => b.id === currentActiveId) || null);
        renderListArea();
        listWrap.scrollTop = prevTop;
        return;
      }
      return render();
    }
    if (!e.target.closest(".card-more-wrap")) closeMenus();
  }, { signal });

  document.addEventListener("click", (e) => { if (!e.target.closest(".card-more-wrap")) closeMenus(); }, { signal });
  render();
};

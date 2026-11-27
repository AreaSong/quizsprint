import { BANK_CATEGORIES, escapeHtml, getBankPracticeState } from "../api.js";
import { iconSvg } from "../icons.js";

const IGNORED_DESCS = new Set(["暂无简介", "自动从历史题库迁移的默认题库"]);
const RING_CIRCUMFERENCE = 2 * Math.PI * 16;

export const isMeaningfulDesc = (desc) => {
  const clean = String(desc || "").trim();
  return Boolean(clean && !IGNORED_DESCS.has(clean));
};

export const getBankStats = (bank) => {
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

export const formatExamCountdown = (examDate) => {
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

export const renderExamNoticeBoardHtml = (examNotices = [], isAdmin = false) => {
  if (!Array.isArray(examNotices) || !examNotices.length) return "";
  return `
    <section class="exam-notice-board">
      <div class="exam-notice-lead">${iconSvg("clock", 14)}<span>考试安排</span></div>
      <div class="exam-notice-list">
        ${examNotices.map((n) => {
          const dateMatch = String(n.timeText || "").match(/\b(\d{4}-\d{2}-\d{2})\b/);
          const cd = formatExamCountdown(dateMatch?.[1] || "");
          return `
            <div class="exam-notice-chip">
              <strong>${escapeHtml(n.title || "考试通知")}</strong>
              ${n.timeText ? `<span class="exam-notice-time">${escapeHtml(n.timeText)}</span>` : ""}
              ${n.duration ? `<span class="tag-pill">${escapeHtml(n.duration)}</span>` : ""}
              ${cd ? `<span class="badge ${cd.cls}">${escapeHtml(cd.text)}</span>` : ""}
              ${n.note ? `<span class="muted-text exam-notice-note" title="${escapeHtml(n.note)}">${escapeHtml(n.note)}</span>` : ""}
            </div>
          `;
        }).join("")}
      </div>
      ${isAdmin ? '<button type="button" id="btn-edit-exam-notices" class="btn ghost tiny exam-notice-edit-btn">编辑</button>' : ""}
    </section>
  `;
};

export const renderBankTagsHtml = (bank, isCurrent) => {
  const cat = bank.category || "theory";
  const catTag = `<span class="cat-pill" data-cat="${escapeHtml(cat)}">${BANK_CATEGORIES[cat] || "理论"}</span>`;
  const subLabel = bank.subjectName || (bank.folder && bank.folder !== "默认分组" ? bank.folder : "");
  const subTag = subLabel ? `<span class="tag-pill">${escapeHtml(subLabel)}</span>` : "";
  const curTag = isCurrent ? '<span class="tag-pill current">当前</span>' : "";
  return `${curTag}${catTag}${subTag}`;
};

const renderModeTilesHtml = (stats) => {
  const tiles = [
    { mode: "order", icon: "play", title: "顺序练习", tone: "tone-accent", meta: stats.total ? `${stats.done}/${stats.total}` : "全部", isCount: Boolean(stats.total) },
    { mode: "chapter", icon: "layers", title: "章节练习", tone: "tone-accent", meta: "分章", isCount: false },
    { mode: "random", icon: "shuffle", title: "随机练习", tone: "tone-violet", meta: "抽题", isCount: false },
    { mode: "recite", icon: "eye", title: "背题模式", tone: "tone-ok", meta: "看解", isCount: false },
    { mode: "wrong", icon: "alert", title: "错题本", tone: "tone-bad", meta: stats.wrong ? String(stats.wrong) : "0题", isCount: stats.wrong > 0 },
    { mode: "favorite", icon: "star", title: "收藏夹", tone: "tone-warn", meta: stats.fav ? String(stats.fav) : "0题", isCount: stats.fav > 0 },
    { mode: "type", icon: "sliders", title: "题型专项", tone: "tone-violet", meta: "分类", isCount: false },
    { mode: "exam", icon: "clock", title: "模拟考试", tone: "tone-warn", meta: "限时", isCount: false }
  ];
  return `
    <div class="mode-tiles">
      ${tiles.map((t) => `
        <button type="button" class="mode-tile ${t.tone}" data-wb-mode="${t.mode}">
          <span class="mode-tile-icon">${iconSvg(t.icon, 14)}</span>
          <span class="mode-tile-label">${t.title}</span>
          <span class="mode-tile-badge" data-count="${t.isCount ? "1" : "0"}">${t.meta}</span>
        </button>
      `).join("")}
    </div>
  `;
};

export const renderWorkbenchHtml = (bank) => {
  if (!bank) return "";
  const st = getBankStats(bank);
  const offset = RING_CIRCUMFERENCE * (1 - st.pct / 100);
  const desc = isMeaningfulDesc(bank.description) ? escapeHtml(bank.description) : "当前选中练习题库，支持顺序、分章、背题与限时模考";
  return `
    <section class="bank-workbench">
      <div class="wb-head">
        <div class="wb-title-wrap">
          <span class="bank-cover">${iconSvg("book", 19)}</span>
          <div style="min-width:0;">
            <h2 class="wb-title">${bank.locked ? iconSvg("lock", 14) : ""}<span>${escapeHtml(bank.name)}</span>${renderBankTagsHtml(bank, false)}</h2>
            <div class="wb-sub" title="${desc}">${desc}</div>
          </div>
        </div>
        <div class="wb-head-right">
          <div class="wb-kpis">
            <div class="wb-kpi"><strong>${st.total}</strong><span>总题量</span></div>
            <div class="wb-kpi"><strong>${st.done}</strong><span>已练习</span></div>
            <div class="wb-kpi ${st.wrong ? "is-bad" : ""}"><strong>${st.wrong}</strong><span>错题</span></div>
            <div class="wb-kpi ${st.fav ? "is-warn" : ""}"><strong>${st.fav}</strong><span>收藏</span></div>
          </div>
          <div class="wb-ring-wrap">
            <svg class="wb-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle class="wb-ring-bg" cx="20" cy="20" r="16"></circle>
              <circle class="wb-ring-val" cx="20" cy="20" r="16" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
            </svg>
            <div class="wb-ring-text"><strong>${st.pct}%</strong><span>进度</span></div>
          </div>
          <button type="button" id="wb-start-btn" class="btn primary tiny">${iconSvg("play", 13)}<span>${st.done > 0 ? "继续刷题" : "开始刷题"}</span></button>
        </div>
      </div>
      ${renderModeTilesHtml(st)}
    </section>
  `;
};

export const renderSubjectBarHtml = ({ terms, activeTerm, termSubjects, activeSubjectId, banks, isAdmin }) => {
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

export const renderSubjectOverviewHtml = (subject, subjectBanks, isAdmin) => {
  if (!subject) return "";
  const total = subjectBanks.reduce((s, b) => s + Number(b.questionCount || 0), 0);
  const done = subjectBanks.reduce((s, b) => s + getBankStats(b).done, 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const cd = formatExamCountdown(subject.examDate);
  const notesCount = subjectBanks.filter((b) => (b.category || "theory") === "notes").length;
  const quizCount = subjectBanks.length - notesCount;
  const modText = notesCount && quizCount ? `刷题库 ${quizCount} · 课本重点 ${notesCount}` : `共 ${subjectBanks.length} 个模块`;
  return `
    <div class="subject-overview">
      <div class="subject-ov-main">
        <div class="row-gap">
          <button type="button" id="btn-back-all-subjects" class="btn ghost tiny">← 全部科目</button>
          <strong style="font-size:0.9375rem;">${escapeHtml(subject.name)}</strong>
          ${subject.term ? `<span class="tag-pill">${escapeHtml(subject.term)}</span>` : ""}
          ${cd ? `<span class="badge ${cd.cls}">${escapeHtml(cd.text)}</span>` : ""}
        </div>
        <div class="muted-text" style="font-size:0.7813rem;">${modText} · ${total} 题 · 已练 ${done} 题${subject.description ? ` · ${escapeHtml(subject.description)}` : ""}</div>
      </div>
      <div class="row-gap">
        <div class="subject-ov-prog">
          <div class="progress-bar" style="flex:1;height:6px;"><span style="width:${pct}%"></span></div>
          <span class="bank-pct-num">${pct}%</span>
        </div>
        ${isAdmin ? '<button type="button" id="btn-edit-subject" class="btn ghost tiny">编辑科目</button><button type="button" id="btn-del-subject" class="btn ghost-danger tiny">删除</button>' : ""}
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

const buildBankActionBtns = (bank, flexFirst = false) => {
  const isNotes = (bank.category || "theory") === "notes";
  const firstStyle = flexFirst ? ' style="flex:1;"' : "";
  return isNotes
    ? `<button type="button" class="btn soft-active tiny"${firstStyle} data-action="practice" data-mode="recite">背题</button><button type="button" class="btn ghost tiny" data-action="practice" data-mode="order">刷题</button><button type="button" class="btn ghost tiny" data-action="practice" data-mode="exam">模考</button>`
    : `<button type="button" class="btn ghost tiny"${firstStyle} data-action="practice" data-mode="order">刷题</button><button type="button" class="btn ghost tiny" data-action="practice" data-mode="recite">背题</button><button type="button" class="btn ghost tiny" data-action="practice" data-mode="exam">模考</button>`;
};

const renderBankItemHtml = (bank, viewMode, { st, isCurrent, isAdmin, isMenuOpen }) => {
  if (viewMode === "grid") {
    return `
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
          <div class="row-gap" style="margin-top:14px;"><div class="progress-bar" style="flex:1;height:5px;"><span style="width:${st.pct}%"></span></div><span class="bank-pct-num">${st.pct}%</span></div>
        </div>
        <div class="row-gap">${buildBankActionBtns(bank, true)}</div>
      </div>
    `;
  }
  return `
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
        <div class="row-gap" style="flex-wrap:nowrap;">${buildBankActionBtns(bank, false)}${renderMoreMenuHtml(isAdmin, isMenuOpen)}</div>
      </div>
    </div>
  `;
};

const renderItemsCollectionHtml = (list, viewMode, ctx) => {
  const html = list.map((b) => renderBankItemHtml(b, viewMode, {
    st: getBankStats(b),
    isCurrent: b.id === ctx.currentActiveId,
    isAdmin: ctx.isAdmin,
    isMenuOpen: ctx.openMenuBankId === b.id
  })).join("");
  return viewMode === "grid" ? `<div class="cards-grid">${html}</div>` : `<div class="bank-list">${html}</div>`;
};

const renderSubjectGroupBlockHtml = (subject, groupBanks, viewMode, ctx) => {
  const total = groupBanks.reduce((s, b) => s + Number(b.questionCount || 0), 0);
  const done = groupBanks.reduce((s, b) => s + getBankStats(b).done, 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const cd = subject ? formatExamCountdown(subject.examDate) : null;
  const subId = subject ? subject.id : "__none__";
  const catCounts = new Map();
  for (const b of groupBanks) {
    const c = b.category || "theory";
    catCounts.set(c, (catCounts.get(c) || 0) + 1);
  }
  const catSummary = [...catCounts.entries()]
    .map(([c, n]) => `<span class="cat-pill" data-cat="${escapeHtml(c)}">${BANK_CATEGORIES[c] || "理论"} ${n}</span>`)
    .join("");
  return `
    <section class="subject-group-block" data-group-subject="${escapeHtml(subId)}">
      <div class="subject-group-head" data-enter-subject="${escapeHtml(subId)}" title="点击进入该科目查看分模块详情">
        <div class="subject-group-head-left">
          <span class="subject-group-name">${escapeHtml(subject ? subject.name : "未分类题库")}</span>
          ${subject?.term ? `<span class="tag-pill">${escapeHtml(subject.term)}</span>` : ""}
          ${cd ? `<span class="badge ${cd.cls}">${escapeHtml(cd.text)}</span>` : ""}
          ${catSummary}
        </div>
        <div class="subject-group-head-right">
          <span class="muted-text" style="font-size:0.75rem;">${groupBanks.length} 个模块 · ${total} 题</span>
          <div class="subject-group-prog"><div class="progress-bar" style="flex:1;height:5px;"><span style="width:${pct}%"></span></div><span class="bank-pct-num">${pct}%</span></div>
          <button type="button" class="btn ghost tiny" data-enter-subject="${escapeHtml(subId)}">进入科目 →</button>
        </div>
      </div>
      <div class="subject-group-body">${renderItemsCollectionHtml(groupBanks, viewMode, ctx)}</div>
    </section>
  `;
};

export const renderGroupedBanksHtml = (opts) => {
  const { visibleBanks, subjects, activeSubjectId, activeCategory, keyword, viewMode } = opts;
  if (!visibleBanks.length) {
    return `<div class="panel empty-state" style="margin:20px auto;"><div class="empty-state-icon">${iconSvg("book", 20)}</div><strong style="font-size:0.875rem;">当前筛选下暂无题库</strong><p class="muted-text" style="margin:0;">可切换学期/科目，或点击右上角新建题库。</p></div>`;
  }
  // 全部科目且未搜索时：按科目分层打包展示
  if (!activeSubjectId && !keyword.trim()) {
    const bySub = new Map();
    for (const b of visibleBanks) {
      const k = b.subjectId || "__none__";
      if (!bySub.has(k)) bySub.set(k, []);
      bySub.get(k).push(b);
    }
    const orderedIds = [...subjects.map((s) => s.id).filter((id) => bySub.has(id)), ...(bySub.has("__none__") ? ["__none__"] : [])];
    const subMap = new Map(subjects.map((s) => [s.id, s]));
    return `<div class="subject-group-list">${orderedIds.map((id) => renderSubjectGroupBlockHtml(subMap.get(id) || null, bySub.get(id), viewMode, opts)).join("")}</div>`;
  }
  // 已进入单个科目且未限定单一分类时：区分「刷题题库」与「课本重点」两块
  if (activeSubjectId && !activeCategory) {
    const noteBanks = visibleBanks.filter((b) => (b.category || "theory") === "notes");
    const quizBanks = visibleBanks.filter((b) => (b.category || "theory") !== "notes");
    if (noteBanks.length && quizBanks.length) {
      return `
        <div class="module-section">
          <div class="module-section-head"><span>刷题题库</span><span class="muted-text">${quizBanks.length} 个</span></div>
          ${renderItemsCollectionHtml(quizBanks, viewMode, opts)}
        </div>
        <div class="module-section">
          <div class="module-section-head is-notes"><span>课本重点 · 老师标注知识点</span><span class="muted-text">${noteBanks.length} 个</span></div>
          ${renderItemsCollectionHtml(noteBanks, viewMode, opts)}
        </div>
      `;
    }
  }
  return renderItemsCollectionHtml(visibleBanks, viewMode, opts);
};

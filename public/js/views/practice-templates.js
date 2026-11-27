import { buildBankOptionsHtml, escapeHtml, LETTERS, parseMatchPair, TYPE_LABELS } from "../api.js";
import { iconSvg } from "../icons.js";
import { renderRichMarkdown } from "../markdown.js";
import {
  buildMatchQuestionHtml,
  buildOrderQuestionHtml,
  isMatchType,
  isOrderType,
  isSubjectiveType
} from "./practice-drag.js";

export const shuffleArray = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const computeChapterStats = (questions, records) => {
  const map = new Map();
  for (const q of questions) {
    const name = String(q.chapter || "").trim() || "未分章节";
    const cur = map.get(name) || { name, total: 0, done: 0 };
    cur.total += 1;
    if (records[q.id]) cur.done += 1;
    map.set(name, cur);
  }
  return [...map.values()];
};

export const normText = (v) => String(v || "").trim().toLowerCase();
export const isMultiChoice = (q) => q.type === "1" || q.type === "5";

export const isAnswerCorrect = (q, userSelected) => {
  const expected = (q.answers || []).map(normText).filter(Boolean);
  const actual = (Array.isArray(userSelected) ? userSelected : [userSelected]).map(normText).filter(Boolean);
  if (!expected.length || !actual.length) return false;
  if (q.type === "2" || q.type === "7") return expected.length === actual.length && expected.every((ans, idx) => ans === actual[idx]);
  const expSet = new Set(expected);
  const uniq = [...new Set(actual)];
  return uniq.length === expSet.size && uniq.every((item) => expSet.has(item));
};

export const buildInteractionHtml = ({ q, opts, record, multiDraft, showAnswerNow, examSession, orderItems, matchState }) => {
  if (isOrderType(q)) return buildOrderQuestionHtml({ q, items: orderItems || [], record, showAnswerNow });
  if (isMatchType(q)) return buildMatchQuestionHtml({ q, state: matchState, record, showAnswerNow });
  const isChoice = ["0", "1", "3", "5"].includes(String(q.type));
  if (isChoice && opts.length) {
    const expectedSet = new Set((q.answers || []).map(normText));
    const activeSelected = multiDraft.size ? [...multiDraft] : (record?.selected || []);
    const userSet = new Set(activeSelected.map(normText));
    return `
      <div class="options-list">
        ${opts.map((opt, idx) => {
          const normOpt = normText(opt);
          let cls = "option-item";
          if (showAnswerNow) {
            if (expectedSet.has(normOpt)) cls += " correct";
            else if (userSet.has(normOpt)) cls += " wrong";
          } else if (userSet.has(normOpt)) {
            cls += " selected";
          }
          return `
            <button type="button" class="${cls}" data-opt="${escapeHtml(opt)}">
              <span class="opt-key">${LETTERS[idx] || idx + 1}</span>
              <span>${escapeHtml(opt)}</span>
            </button>
          `;
        }).join("")}
      </div>
      ${isMultiChoice(q) && !showAnswerNow ? `
        <div style="margin-top:12px;">
          <button type="button" id="btn-confirm-multi" class="btn primary">确认${q.type === "5" ? "不定项" : "多选"}答案 (Enter)</button>
        </div>
      ` : ""}
    `;
  }
  const val = (record?.selected || []).join(" | ");
  if (isSubjectiveType(q)) {
    const ph = q.type === "6"
      ? "先在心中过一遍实现步骤 / 伪代码 / 算法矩阵（也可以在这里默写关键词），再点下方翻看参考答案..."
      : "在此输入你的简答作答思路（提交后可对照参考答案自评）...";
    return `
      <div class="stack-form">
        <textarea id="essay-input" rows="5" placeholder="${ph}" ${showAnswerNow && !examSession ? "readonly" : ""}>${escapeHtml(val)}</textarea>
        ${!showAnswerNow ? `<div><button type="button" id="btn-confirm-essay" class="btn primary">翻看参考答案 (Space)</button></div>` : ""}
      </div>
    `;
  }
  return `
    <div class="row-gap">
      <input id="fill-input" type="text" value="${escapeHtml(val)}" placeholder="输入答案（多空用 | 分隔，回车提交）" style="flex:1;" ${showAnswerNow && !examSession ? "readonly" : ""}>
      ${!showAnswerNow ? `<button type="button" id="btn-confirm-fill" class="btn primary">提交核对</button>` : ""}
    </div>
  `;
};

const renderAnswerContentHtml = (q) => {
  const ansList = q.answers || [];
  if (isOrderType(q)) {
    return `<div style="margin-top:8px;"><strong style="color:var(--ok);">正确顺序：</strong><ol style="margin:6px 0 0;padding-left:20px;">${ansList.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ol></div>`;
  }
  if (isMatchType(q)) {
    return `<div style="margin-top:8px;"><strong style="color:var(--ok);">正确配对：</strong><div class="stack-form" style="gap:4px;margin-top:6px;">${ansList.map((a) => {
      const p = parseMatchPair(a);
      return `<div><strong>${escapeHtml(p.left)}</strong> <span class="muted-text">→</span> <span style="color:var(--ok);font-weight:600;">${escapeHtml(p.right)}</span></div>`;
    }).join("")}</div></div>`;
  }
  if (isSubjectiveType(q)) {
    return `
      <div style="margin-top:8px;">
        <div class="row-gap" style="justify-content:space-between;margin-bottom:4px;">
          <strong style="color:var(--ok);">参考答案：</strong>
          <button type="button" id="btn-copy-ans" class="btn ghost tiny">${iconSvg("copy", 12)}<span>复制答案</span></button>
        </div>
        <div class="md-content">${renderRichMarkdown(ansList.join("\n\n"))}</div>
      </div>
    `;
  }
  return `<strong style="color:var(--ok);">正确答案：${escapeHtml(ansList.join(" | "))}</strong>`;
};

export const buildAnswerPanelHtml = ({ q, record, showAnswerNow, bankState, examSession }) => {
  if (!showAnswerNow) return "";
  const isSubj = isSubjectiveType(q);
  const inWrong = !examSession && (bankState?.wrongIds || []).includes(q.id);
  const selfEvalHtml = isSubj && !examSession ? `
    <div class="flashcard-bar">
      <span class="muted-text" style="font-size:0.7813rem;">掌握程度自评：</span>
      <button type="button" id="btn-eval-master" class="btn ok tiny">✓ 秒会 · 斩题</button>
      <button type="button" id="btn-eval-fuzzy" class="btn ghost tiny">? 模糊 · 留待再背</button>
      <button type="button" id="btn-eval-bad" class="btn ghost-danger tiny">✕ 不会 · 入错题本</button>
    </div>
  ` : "";
  const ansImgsHtml = (q.answerImages || []).length ? `
    <div class="answer-img-wrap">
      <div class="muted-text" style="font-size:0.75rem;font-weight:600;margin-bottom:6px;">参考答案配图（流程图 / 运行结果）</div>
      <div class="row-gap">${q.answerImages.map((src) => `<img class="q-img" src="${escapeHtml(src)}" alt="参考答案配图" style="max-width:100%;max-height:300px;">`).join("")}</div>
    </div>
  ` : "";

  return `
    <div class="answer-box">
      <div class="row-gap" style="justify-content:space-between;">
        <div class="row-gap">
          ${!isSubj && !isOrderType(q) && !isMatchType(q) ? renderAnswerContentHtml(q) : `<span style="font-weight:600;color:var(--ink);">答案与解析</span>`}
          ${record ? `<span class="badge ${record.correct ? "ok" : "bad"}">${record.correct ? "回答正确" : "回答错误"}</span>` : ""}
        </div>
        <div class="row-gap">
          ${inWrong ? '<button type="button" id="btn-rm-wrong" class="btn ghost tiny">移出错题本</button>' : ""}
          ${record && !examSession ? `<button type="button" id="btn-redo-q" class="btn ghost tiny">${iconSvg("rotate", 13)}<span>重做</span></button>` : ""}
          ${examSession ? "" : `<button type="button" id="btn-jump-note" class="btn ghost tiny">${iconSvg("note", 13)}<span>记笔记</span></button>`}
          <button type="button" id="btn-ai-explain" class="btn ghost tiny">${iconSvg("sparkles", 13)}<span>AI 解析</span></button>
        </div>
      </div>
      ${isSubj || isOrderType(q) || isMatchType(q) ? renderAnswerContentHtml(q) : ""}
      ${ansImgsHtml}
      ${q.analysis ? `<div style="margin-top:10px;"><strong>解析：</strong><div class="md-content" style="margin-top:4px;">${renderRichMarkdown(q.analysis)}</div></div>` : ""}
      ${selfEvalHtml}
    </div>
  `;
};

export const buildSheetInnerHtml = ({ list, currentIndex, activeRecords, examSession, settings, mode, bankState }) => {
  const correctCount = list.filter((item) => activeRecords[item.id]?.correct === true).length;
  const wrongCount = list.filter((item) => activeRecords[item.id]?.correct === false).length;
  const doneCount = correctCount + wrongCount;
  const rate = doneCount ? Math.round((correctCount / doneCount) * 100) : 0;
  const wrongLen = !examSession ? (bankState?.wrongIds || []).length : 0;
  const favLen = !examSession ? (bankState?.favoriteIds || []).length : 0;
  const masterLen = !examSession ? (bankState?.masteredIds || []).length : 0;

  return `
    <div class="row-gap" style="justify-content:space-between;font-size:0.75rem;">
      <div class="row-gap muted-text" style="font-variant-numeric:tabular-nums;">
        <span style="color:var(--ok);font-weight:600;">对 ${correctCount}</span>
        <span style="color:var(--bad);font-weight:600;">错 ${wrongCount}</span>
        <span>正确率 ${rate}%</span>
      </div>
      ${examSession ? "" : '<button type="button" class="btn ghost tiny js-reset-progress">清空进度</button>'}
    </div>
    <div class="sheet-grid">
      ${list.map((item, idx) => {
        const rec = activeRecords[item.id];
        const cls = ["sheet-cell"];
        if (idx === currentIndex) cls.push("current");
        if (rec && (!examSession || examSession.submitted)) cls.push(rec.correct ? "ok" : "bad");
        else if (rec && examSession) cls.push("current");
        return `<button type="button" class="${cls.join(" ")}" data-jump="${idx}">${idx + 1}</button>`;
      }).join("")}
    </div>
    ${wrongLen || favLen || masterLen ? `
      <div class="row-gap" style="gap:6px;margin-bottom:6px;">
        ${wrongLen ? `<button type="button" class="btn ghost tiny js-clear-wrong">清错题 (${wrongLen})</button>` : ""}
        ${favLen ? `<button type="button" class="btn ghost tiny js-clear-fav">清收藏 (${favLen})</button>` : ""}
        ${masterLen ? `<button type="button" class="btn ghost tiny js-clear-mastered">清斩题 (${masterLen})</button>` : ""}
      </div>
    ` : ""}
    ${mode === "wrong" && list.length ? `<button class="btn ghost tiny js-export-wrong" style="width:100%;margin-top:8px;">导出/打印错题本</button>` : ""}
    <details class="sheet-settings">
      <summary>练习偏好设置 ▾</summary>
      <div style="margin-top:8px;">
        <label class="switch-row"><span>背题模式（直出答案）</span><input class="js-sw-recite" type="checkbox" ${settings.reciteMode ? "checked" : ""}></label>
        <label class="switch-row"><span>答对自动下一题</span><input class="js-sw-auto" type="checkbox" ${settings.autoNext ? "checked" : ""}></label>
        <label class="switch-row"><span>选项乱序</span><input class="js-sw-shuffle" type="checkbox" ${settings.shuffleOptions ? "checked" : ""}></label>
        ${examSession ? "" : `
          <div class="switch-row">
            <span>选题策略</span>
            <select class="js-sw-strategy" style="padding:3px 6px;font-size:0.75rem;">
              <option value="default" ${settings.strategy === "default" ? "selected" : ""}>默认顺序</option>
              <option value="wrongFirst" ${settings.strategy === "wrongFirst" ? "selected" : ""}>错题优先</option>
              <option value="unansweredFirst" ${settings.strategy === "unansweredFirst" ? "selected" : ""}>未做题优先</option>
            </select>
          </div>
        `}
        <div class="switch-row">
          <span>错题移出条件</span>
          <select class="js-sw-streak" style="padding:3px 6px;font-size:0.75rem;">
            ${[1, 2, 3].map((n) => `<option value="${n}" ${Number(settings.wrongClearStreak || 1) === n ? "selected" : ""}>连续答对 ${n} 次</option>`).join("")}
          </select>
        </div>
      </div>
    </details>
  `;
};

export const buildNoteHistoryItemsHtml = (list, notesMap = {}) => {
  const notedEntries = list
    .map((item, idx) => ({ item, idx, note: notesMap[item.id] }))
    .filter((entry) => entry.note && entry.note.trim());
  return {
    count: notedEntries.length,
    html: notedEntries.map((entry) => `
      <div class="row-gap" style="gap:4px;align-items:stretch;flex-wrap:nowrap;">
        <button type="button" class="note-history-item" style="flex:1;min-width:0;" data-jump="${entry.idx}">
          <div style="font-weight:600;color:var(--accent-fg);">第 ${entry.idx + 1} 题 · ${escapeHtml(entry.item.title.slice(0, 16))}</div>
          <div class="muted-text" style="margin-top:2px;">${escapeHtml(entry.note.slice(0, 36))}</div>
        </button>
        <button type="button" class="btn ghost-danger tiny js-del-note" data-del-note="${escapeHtml(entry.item.id)}" title="删除此笔记" style="padding:0 6px;flex:none;">×</button>
      </div>
    `).join("") || '<p class="muted-text" style="margin:4px 0;font-size:0.75rem;">暂无历史笔记</p>'
  };
};

export const buildNotesPanelHtml = (list, q, bankState, inputId = "aside-note-input") => {
  const notesMap = bankState.notes || {};
  const { count, html } = buildNoteHistoryItemsHtml(list, notesMap);

  return `
    <div class="notes-panel-body">
      <div class="row-gap" style="justify-content:space-between;flex:none;">
        <span class="row-gap" style="gap:6px;">${iconSvg("note", 14)}<strong>本题笔记</strong></span>
        <div class="row-gap" style="gap:6px;">
          <button type="button" class="btn ghost tiny js-clear-cur-note" style="padding:1px 7px;" ${notesMap[q.id]?.trim() ? "" : "hidden"}>清空</button>
          <span class="muted-text js-note-status" style="font-size:0.75rem;">自动保存</span>
        </div>
      </div>
      <textarea id="${inputId}" class="note-textarea" placeholder="在此记录解题思路、记忆口诀或易错点（停笔自动保存）...">${escapeHtml(notesMap[q.id] || "")}</textarea>
      <div style="flex:none;font-size:0.8125rem;"><strong>本卷已记 (<span class="js-note-history-count">${count}</span>)</strong></div>
      <div class="note-history-list js-note-history-wrap">${html}</div>
    </div>
  `;
};

export const buildExamSetupHtml = (bankName, allQuestions) => {
  const counts = {};
  for (const q of allQuestions) counts[q.type] = (counts[q.type] || 0) + 1;
  const typeRows = Object.entries(TYPE_LABELS)
    .filter(([k]) => counts[k] > 0)
    .map(([k, label]) => `
      <div class="row-gap" style="justify-content:space-between;" data-type-row="${k}">
        <span style="min-width:110px;">${label}（共 ${counts[k]} 题）</span>
        <label class="row-gap" style="font-weight:400;">抽 <input class="ex-tc-cnt" data-type="${k}" type="number" min="0" max="${counts[k]}" value="${Math.min(5, counts[k])}" style="width:68px;"> 题</label>
        <label class="row-gap" style="font-weight:400;">每题 <input class="ex-tc-score" data-type="${k}" type="number" min="0.5" step="0.5" value="2" style="width:68px;"> 分</label>
      </div>
    `).join("");

  return `
    <div class="panel" style="max-width:600px;margin:0 auto;">
      <h2 style="margin-top:0;">${escapeHtml(bankName)} · 模拟考试配置</h2>
      <form id="exam-setup-form" class="stack-form">
        <div class="row-gap">
          <label class="row-gap" style="flex-direction:row;cursor:pointer;"><input type="radio" name="ex-mode" value="quick" checked> 快速随机抽题</label>
          <label class="row-gap" style="flex-direction:row;cursor:pointer;"><input type="radio" name="ex-mode" value="byType"> 按题型抽题设分</label>
        </div>
        <div id="ex-quick-box">
          <label><span>抽取题数（最多 ${allQuestions.length} 题，总分 100 分）</span>
            <input id="ex-count" type="number" min="1" max="${allQuestions.length}" value="${Math.min(20, allQuestions.length)}">
          </label>
        </div>
        <div id="ex-type-box" class="stack-form" style="padding:10px;background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;" hidden>
          ${typeRows}
          <div class="muted-text">当前卷面总分：<strong id="ex-total-preview">0</strong> 分</div>
        </div>
        <div class="row-gap">
          <label style="flex:1;"><span>考试时长（分钟）</span><input id="ex-mins" type="number" min="1" max="240" value="30" required></label>
          <label style="flex:1;"><span>及格分数线</span><input id="ex-pass" type="number" min="1" value="60" required></label>
        </div>
        <div class="row-gap">
          <button type="submit" class="btn primary">开始模拟考试</button>
          <button type="button" id="ex-cancel" class="btn ghost">返回练习</button>
        </div>
      </form>
    </div>
  `;
};

export const buildImmersiveBarHtml = (bankName, currentIndex, total, settings) => {
  const pct = total ? Math.round(((currentIndex + 1) / total) * 100) : 0;
  return `
  <div class="immersive-bar">
    <div class="row-gap">
      <button id="btn-exit-immersive" class="btn ghost tiny">${iconSvg("chevronLeft", 14)}<span>退出沉浸</span></button>
      <strong>${escapeHtml(bankName)}</strong>
      <span class="muted-text" style="font-variant-numeric:tabular-nums;">${currentIndex + 1} / ${total}</span>
    </div>
    <div class="row-gap">
      <button id="btn-imm-recite" class="btn ghost tiny ${settings.reciteMode ? "soft-active" : ""}">${iconSvg("eye", 14)}<span>背题</span></button>
      <button class="btn ghost tiny js-open-notes-modal">${iconSvg("note", 14)}<span>笔记</span></button>
      <button class="btn ghost tiny js-open-ai-modal">${iconSvg("sparkles", 14)}<span>AI</span></button>
      <button class="btn ghost tiny js-open-sheet">${iconSvg("grid", 14)}<span>答题卡</span></button>
      <button id="btn-imm-theme" class="btn ghost tiny">${iconSvg("sliders", 14)}<span>主题</span></button>
    </div>
    <div class="imm-progress-track"><div class="imm-progress-fill" style="width:${pct}%"></div></div>
  </div>
`;
};

export const buildModeBarHtml = ({ bank, banks = [], mode, bankState, typeFilter, chapterFilter, chapterStats, examSession, settings, notesCollapsed = false }) => `
  <div class="practice-toolbar">
    <div class="toolbar-left">
      ${banks.length > 1 ? `
        <select id="p-bank-select" class="bank-select-inline" aria-label="切换刷题题库">
          ${buildBankOptionsHtml(banks, bank.id, { showCount: true })}
        </select>
      ` : `<span class="toolbar-bank-name">${iconSvg("book", 15)}<span>${escapeHtml(bank.name)}</span></span>`}
      <div class="mode-pills" role="tablist" aria-label="练习模式">
        ${[
          ["order", "顺序"],
          ["chapter", "章节"],
          ["random", "随机"],
          ["type", "题型"],
          ["wrong", `错题 ${(bankState.wrongIds || []).length}`],
          ["favorite", `收藏 ${(bankState.favoriteIds || []).length}`],
          ["exam", "模考"]
        ].map(([k, label]) => `<button type="button" class="mode-pill ${mode === k ? "active" : ""}" data-mode="${k}">${label}</button>`).join("")}
      </div>
      ${mode === "type" ? `
        <select id="p-type-filter" class="toolbar-sub-select">
          <option value="">全部题型</option>
          ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${typeFilter === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      ` : ""}
      ${mode === "chapter" ? `
        <select id="p-chapter-filter" class="toolbar-sub-select">
          <option value="">全部章节 (${chapterStats.reduce((s, c) => s + c.total, 0)} 题)</option>
          ${chapterStats.map((c) => `<option value="${escapeHtml(c.name)}" ${chapterFilter === c.name ? "selected" : ""}>${escapeHtml(c.name)} (${c.done}/${c.total})</option>`).join("")}
        </select>
      ` : ""}
    </div>
    <div class="toolbar-right">
      ${examSession ? `
        <span class="badge warn">剩余 <span id="exam-clock">${String(Math.floor(examSession.remainSec / 60)).padStart(2, "0")}:${String(examSession.remainSec % 60).padStart(2, "0")}</span></span>
        ${examSession.submitted ? "" : `<button type="button" id="btn-submit-exam" class="btn ok tiny">交卷评分</button>`}
      ` : ""}
      <button type="button" id="btn-quick-recite" class="btn tiny ${settings.reciteMode ? "soft-active" : "ghost"}" title="开启或关闭背题直出答案">${iconSvg("eye", 14)}<span>背题</span></button>
      <button type="button" id="btn-toggle-notes" class="btn ghost tiny desktop-only-btn" title="收起或展开左侧笔记栏">${iconSvg("sidebarLeft", 14)}<span>${notesCollapsed ? "笔记栏" : "收起笔记"}</span></button>
      <button type="button" id="btn-toggle-aside" class="btn ghost tiny desktop-only-btn" title="收起或展开右侧辅助栏">${iconSvg("sidebar", 14)}<span>${settings.asideCollapsed ? "辅助栏" : "收起辅助"}</span></button>
      <button type="button" id="btn-toggle-immersive" class="btn ghost tiny" title="全屏沉浸作答">${iconSvg("maximize", 14)}<span>沉浸</span></button>
    </div>
  </div>
`;

export const buildPracticeShellHtml = () => `
  <div class="practice-shell">
    <div id="p-modebar-slot"></div>
    <div id="p-immbar-slot"></div>
    <div id="p-examres-slot"></div>
    <div id="p-empty-slot" class="panel" hidden><p class="muted-text" style="margin:0;">当前模式下暂无题目（比如错题本/收藏夹/所选章节为空）。</p></div>
    <div class="practice-layout">
      <aside id="p-notes-slot" class="practice-notes panel"></aside>
      <div class="pane-resizer" data-resize="notes" title="左右拖动调节笔记栏宽度（双击恢复默认）"></div>
      <section class="question-box">
        <div class="q-progress-track"><span id="p-progress-fill"></span></div>
        <div id="p-q-head" class="row-gap q-head" style="justify-content:space-between;"></div>
        <div id="p-q-body" class="q-body-scroll"></div>
        <div id="p-q-footer" class="row-gap practice-nav-footer" style="justify-content:space-between;padding-top:14px;border-top:1px solid var(--line);">
          <button id="btn-prev" class="btn ghost tiny">${iconSvg("chevronLeft", 14)}<span>上一题</span></button>
          <span class="muted-text kbd-hint" style="font-size:0.75rem;">A-F / 1-6 选 · Enter 确认 · ← / → 切题</span>
          <button class="btn ghost tiny mobile-only-btn js-fav-btn">${iconSvg("star", 14)}</button>
          <button class="btn ghost tiny mobile-only-btn js-open-notes-modal">笔记</button>
          <button class="btn ghost tiny mobile-sheet-trigger js-open-sheet">答题卡</button>
          <button class="btn ghost tiny mobile-only-btn js-open-ai-modal">AI</button>
          <button id="btn-next" class="btn primary tiny"><span>下一题</span>${iconSvg("chevronRight", 14)}</button>
        </div>
      </section>
      <div class="pane-resizer" data-resize="aside" title="左右拖动调节辅助栏宽度（双击恢复默认）"></div>
      <aside class="practice-aside panel">
        <div id="p-aside-tabs" class="aside-tabs">
          <button type="button" class="aside-tab-btn js-aside-tab active" data-tab="sheet">答题卡</button>
          <button type="button" class="aside-tab-btn js-aside-tab" data-tab="ai">AI 助教</button>
        </div>
        <div id="p-aside-body" class="aside-body-scroll"></div>
      </aside>
    </div>
    <div id="notes-modal" class="modal-backdrop" hidden><div class="modal-card"><div class="modal-head"><h3>题目笔记</h3><button id="notes-modal-close" class="btn ghost tiny" data-modal-close>关闭</button></div><div id="modal-notes-body"></div></div></div>
    <div id="sheet-modal" class="modal-backdrop" hidden><div class="modal-card"><div class="modal-head"><h3>答题卡与设置</h3><button id="sheet-modal-close" class="btn ghost tiny" data-modal-close>关闭</button></div><div id="modal-sheet-body"></div></div></div>
    <div id="ai-chat-modal" class="modal-backdrop" hidden><div class="modal-card" style="max-width:520px;"><div class="modal-head"><h3>AI 题伴助教</h3><button id="ai-chat-modal-close" class="btn ghost tiny" data-modal-close>关闭</button></div><div id="modal-ai-chat"></div></div></div>
  </div>
`;

export const buildQuestionHeadHtml = ({ q, currentIndex, total, examSession, scoreVal, streakBadge, isFav, isMastered }) => `
  <div class="row-gap">
    <span class="type-pill" data-qtype="${escapeHtml(q.type)}">${TYPE_LABELS[q.type] || "其他"}</span>
    ${q.chapter ? `<span class="tag-pill">${escapeHtml(q.chapter)}</span>` : ""}
    ${examSession ? `<span class="badge ok">${scoreVal} 分</span>` : ""}
    ${streakBadge}
    <span class="muted-text" style="font-variant-numeric:tabular-nums;">第 ${currentIndex + 1} / ${total} 题</span>
  </div>
  <div class="row-gap">
    <button class="btn ghost tiny js-fav-btn">${iconSvg("star", 13)}<span>${isFav ? "已收藏" : "收藏"}</span></button>
    <button id="btn-master" class="btn tiny ${isMastered ? "ok" : "ghost"}">${iconSvg("check", 13)}<span>${isMastered ? "已斩题" : "斩题"}</span></button>
  </div>
`;

export const buildQuestionBodyHtml = ({ q, opts, record, multiDraft, showAnswerNow, bankState, examSession, orderItems, matchState }) => `
  <div class="q-title md-content">${renderRichMarkdown(q.title)}</div>
  ${(q.images || []).length ? `<div class="row-gap" style="margin-bottom:12px;">${q.images.map((src) => `<img class="q-img" src="${escapeHtml(src)}" alt="试题配图" style="max-width:100%;max-height:300px;">`).join("")}</div>` : ""}
  ${buildInteractionHtml({ q, opts, record, multiDraft, showAnswerNow, examSession, orderItems, matchState })}
  ${buildAnswerPanelHtml({ q, record, showAnswerNow, bankState, examSession })}
`;

export const buildPracticeLoginHtml = () => `
  <div class="panel" style="max-width:520px;margin:28px auto;text-align:center;">
    <h2 style="margin-top:0;">请先登录账号</h2>
    <p class="muted-text">访客模式下仅支持浏览题库与搜题看题；登录账号后即可开启顺序/随机刷题、章节练习、背题模式、笔记与模拟考试。</p>
    <button id="p-go-login" class="btn primary">立即登录</button>
  </div>
`;

export const buildExamBannerHtml = (examRes, examSession, total) => examRes
  ? `<div class="answer-box" style="margin-bottom:14px;border-color:var(--accent);"><strong>模拟考试成绩：${examRes.score} / ${examSession.totalScore} 分</strong>（答对 ${examRes.correctCount} / ${total}，及格线 ${examSession.passScore} 分）</div>`
  : "";

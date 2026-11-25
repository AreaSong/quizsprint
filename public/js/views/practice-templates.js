import { escapeHtml, LETTERS, TYPE_LABELS } from "../api.js";

export const normText = (v) => String(v || "").trim().toLowerCase();
export const isMultiChoice = (q) => q.type === "1" || q.type === "5";

export const isAnswerCorrect = (q, userSelected) => {
  const expected = (q.answers || []).map(normText).filter(Boolean);
  const actual = (Array.isArray(userSelected) ? userSelected : [userSelected]).map(normText).filter(Boolean);
  if (!expected.length || actual.length !== expected.length) return false;
  if (q.type === "2") return expected.every((ans, idx) => ans === actual[idx]);
  const expSet = new Set(expected);
  return actual.every((item) => expSet.has(item));
};

export const buildInteractionHtml = ({ q, opts, record, multiDraft, showAnswerNow, examSession }) => {
  if (opts.length) {
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
            <button class="${cls}" data-opt="${escapeHtml(opt)}">
              <span class="opt-key">${LETTERS[idx] || idx + 1}</span>
              <span>${escapeHtml(opt)}</span>
            </button>
          `;
        }).join("")}
      </div>
      ${isMultiChoice(q) && !showAnswerNow ? `
        <div style="margin-top:12px;">
          <button id="btn-confirm-multi" class="btn primary">确认${q.type === "5" ? "不定项" : "多选"}答案 (Enter)</button>
        </div>
      ` : ""}
    `;
  }
  const val = (record?.selected || []).join(" | ");
  if (q.type === "4") {
    return `
      <div class="stack-form">
        <textarea id="essay-input" rows="4" placeholder="在此输入你的简答作答思路（提交后可对照参考答案自评）..." ${showAnswerNow && !examSession ? "readonly" : ""}>${escapeHtml(val)}</textarea>
        ${!showAnswerNow ? `<div><button id="btn-confirm-essay" class="btn primary">核对参考答案</button></div>` : ""}
      </div>
    `;
  }
  return `
    <div class="row-gap">
      <input id="fill-input" type="text" value="${escapeHtml(val)}" placeholder="输入答案（多空用 | 分隔，回车提交）" style="flex:1;" ${showAnswerNow && !examSession ? "readonly" : ""}>
      ${!showAnswerNow ? `<button id="btn-confirm-fill" class="btn primary">提交核对</button>` : ""}
    </div>
  `;
};

export const buildAnswerPanelHtml = ({ q, record, showAnswerNow, bankState, examSession }) => {
  if (!showAnswerNow) return "";
  const selfEvalHtml = q.type === "4" && !examSession ? `
    <div class="row-gap" style="margin-top:8px;">
      <span class="muted-text">主观题自评：</span>
      <button type="button" id="btn-eval-ok" class="btn tiny ${record?.correct ? "ok" : "ghost"}">✓ 答对了（已掌握）</button>
      <button type="button" id="btn-eval-bad" class="btn tiny ${record && !record.correct ? "danger" : "ghost"}">✕ 答错了（入错题本）</button>
    </div>
  ` : "";

  return `
    <div class="answer-box">
      <div class="row-gap" style="justify-content:space-between;">
        <div>
          <strong style="color:var(--ok);">正确答案：${escapeHtml((q.answers || []).join(" | "))}</strong>
          ${record ? `<span class="badge ${record.correct ? "ok" : "bad"}" style="margin-left:8px;">${record.correct ? "回答正确" : "回答错误"}</span>` : ""}
        </div>
        <button id="btn-ai-explain" class="btn ghost tiny">AI 深度解析</button>
      </div>
      ${selfEvalHtml}
      ${q.analysis ? `<div style="margin-top:8px;"><strong>解析：</strong>${escapeHtml(q.analysis)}</div>` : ""}
      <div id="ai-explain-box" class="muted-text" style="margin-top:8px;white-space:pre-wrap;" hidden></div>
      <div style="margin-top:10px;">
        <input id="q-note-input" type="text" value="${escapeHtml((bankState.notes || {})[q.id] || "")}" placeholder="写一条个人笔记（自动保存在本地/云端）..." style="width:100%;">
      </div>
    </div>
  `;
};

export const buildSheetInnerHtml = ({ list, currentIndex, activeRecords, examSession, settings, mode }) => {
  const correctCount = list.filter((item) => activeRecords[item.id]?.correct === true).length;
  const wrongCount = list.filter((item) => activeRecords[item.id]?.correct === false).length;
  const doneCount = correctCount + wrongCount;
  const rate = doneCount ? Math.round((correctCount / doneCount) * 100) : 0;

  return `
    <div class="row-gap" style="justify-content:space-between;">
      <strong>答题卡</strong>
      <button class="btn ghost tiny js-reset-progress">清空进度</button>
    </div>
    <div class="sheet-grid">
      ${list.map((item, idx) => {
        const rec = activeRecords[item.id];
        const cls = ["sheet-cell"];
        if (idx === currentIndex) cls.push("current");
        if (rec && (!examSession || examSession.submitted)) cls.push(rec.correct ? "ok" : "bad");
        else if (rec && examSession) cls.push("current");
        return `<button class="${cls.join(" ")}" data-jump="${idx}">${idx + 1}</button>`;
      }).join("")}
    </div>
    <div class="row-gap muted-text" style="justify-content:space-between;font-size:12px;">
      <span style="color:var(--ok);">对 ${correctCount}</span>
      <span style="color:var(--bad);">错 ${wrongCount}</span>
      <span>正确率 ${rate}%</span>
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:12px 0;">
    <label class="switch-row"><span>背题模式（直出答案）</span><input class="js-sw-recite" type="checkbox" ${settings.reciteMode ? "checked" : ""}></label>
    <label class="switch-row"><span>答对自动下一题</span><input class="js-sw-auto" type="checkbox" ${settings.autoNext ? "checked" : ""}></label>
    <label class="switch-row"><span>选项乱序</span><input class="js-sw-shuffle" type="checkbox" ${settings.shuffleOptions ? "checked" : ""}></label>
    <div class="switch-row">
      <span>选题策略</span>
      <select class="js-sw-strategy" style="padding:3px 6px;font-size:12px;">
        <option value="default" ${settings.strategy === "default" ? "selected" : ""}>默认顺序</option>
        <option value="wrongFirst" ${settings.strategy === "wrongFirst" ? "selected" : ""}>错题优先</option>
        <option value="unansweredFirst" ${settings.strategy === "unansweredFirst" ? "selected" : ""}>未做题优先</option>
      </select>
    </div>
    ${mode === "wrong" && list.length ? `<button class="btn ghost tiny js-export-wrong" style="width:100%;margin-top:8px;">导出/打印错题本</button>` : ""}
  `;
};

export const buildNotesAsideHtml = (list, q, bankState) => {
  const notesMap = bankState.notes || {};
  const notedEntries = list
    .map((item, idx) => ({ item, idx, note: notesMap[item.id] }))
    .filter((entry) => entry.note && entry.note.trim());

  return `
    <aside class="panel practice-notes-aside">
      <div class="row-gap" style="justify-content:space-between;">
        <strong>本题笔记</strong>
        <span class="muted-text" style="font-size:12px;">自动保存</span>
      </div>
      <textarea id="aside-note-input" class="note-textarea" placeholder="在这里记录本题解题思路、口诀或易错点...">${escapeHtml(notesMap[q.id] || "")}</textarea>
      <div class="row-gap" style="justify-content:space-between;margin-top:4px;">
        <strong>已记笔记 (${notedEntries.length})</strong>
      </div>
      <div class="note-history-list">
        ${notedEntries.map((entry) => `
          <button type="button" class="note-history-item" data-jump="${entry.idx}">
            <div style="font-weight:600;color:var(--accent);">第 ${entry.idx + 1} 题 · ${escapeHtml(entry.item.title.slice(0, 18))}</div>
            <div class="muted-text" style="margin-top:2px;">${escapeHtml(entry.note.slice(0, 40))}</div>
          </button>
        `).join("") || '<p class="muted-text" style="margin:4px 0;font-size:12px;">暂无历史笔记</p>'}
      </div>
    </aside>
  `;
};

export const buildExamSetupHtml = (bankName, maxCount) => `
  <div class="panel" style="max-width:560px;margin:0 auto;">
    <h2 style="margin-top:0;">${escapeHtml(bankName)} · 模拟考试配置</h2>
    <form id="exam-setup-form" class="stack-form">
      <label><span>抽取题数（最多 ${maxCount} 题）</span>
        <input id="ex-count" type="number" min="1" max="${maxCount}" value="${Math.min(20, maxCount)}" required>
      </label>
      <label><span>考试时长（分钟）</span><input id="ex-mins" type="number" min="1" max="240" value="30" required></label>
      <label><span>及格分数（满分 100 分）</span><input id="ex-pass" type="number" min="1" max="100" value="60" required></label>
      <div class="row-gap">
        <button type="submit" class="btn primary">开始模拟考试</button>
        <button type="button" id="ex-cancel" class="btn ghost">返回练习</button>
      </div>
    </form>
  </div>
`;

export const buildModeBarHtml = ({ bank, mode, bankState, typeFilter, examSession, settings }) => `
  <div class="panel practice-modebar" style="margin-bottom:14px;padding:10px 14px;">
    <div class="row-gap" style="justify-content:space-between;">
      <div class="row-gap">
        <strong>${escapeHtml(bank.name)}</strong>
        ${[
          ["order", "顺序练习"],
          ["random", "随机练习"],
          ["type", "题型练习"],
          ["wrong", `错题本 (${(bankState.wrongIds || []).length})`],
          ["favorite", `收藏 (${(bankState.favoriteIds || []).length})`],
          ["exam", "模拟考试"]
        ].map(([k, label]) => `<button class="btn tiny ${mode === k ? "primary" : "ghost"}" data-mode="${k}">${label}</button>`).join("")}
        ${mode === "type" ? `
          <select id="p-type-filter" style="padding:3px 8px;font-size:12px;">
            <option value="">全部题型</option>
            ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${typeFilter === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        ` : ""}
      </div>
      <div class="row-gap">
        ${examSession ? `
          <span class="badge warn">剩余 <span id="exam-clock">${String(Math.floor(examSession.remainSec / 60)).padStart(2, "0")}:${String(examSession.remainSec % 60).padStart(2, "0")}</span></span>
          ${examSession.submitted ? "" : `<button id="btn-submit-exam" class="btn ok tiny">交卷评分</button>`}
        ` : ""}
        <button id="btn-toggle-immersive" class="btn ghost tiny">${settings.immersive ? "退出沉浸" : "沉浸模式"}</button>
      </div>
    </div>
  </div>
`;

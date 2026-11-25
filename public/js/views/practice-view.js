import {
  aiRequest,
  escapeHtml,
  fetchBankQuestionsSafe,
  getBankPracticeState,
  getGlobalSettings,
  LETTERS,
  printQuestionsDocument,
  saveBankPracticeState,
  saveGlobalSettings,
  showToast,
  TYPE_LABELS
} from "../api.js";
import { mountAiChatWidget } from "./ai-chat-widget.js";
import {
  buildAnswerPanelHtml,
  buildExamSetupHtml,
  buildImmersiveBarHtml,
  buildInteractionHtml,
  buildModeBarHtml,
  buildNotesPanelHtml,
  buildSheetInnerHtml,
  computeChapterStats,
  isAnswerCorrect,
  isMultiChoice,
  shuffleArray
} from "./practice-templates.js";

let activePracticeCleanup = null;
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

export const renderPracticeView = async (container, ctx) => {
  if (activePracticeCleanup) { activePracticeCleanup(); activePracticeCleanup = null; }
  const { activeBankId, banks, isLoggedIn, onRequireUserLogin, onToggleTheme, routeParams = {} } = ctx;
  if (!isLoggedIn) {
    container.innerHTML = `
      <div class="panel" style="max-width:520px;margin:28px auto;text-align:center;">
        <h2 style="margin-top:0;">请先登录账号</h2>
        <p class="muted-text">访客模式下仅支持浏览题库与搜题看题；登录账号后即可开启顺序/随机刷题、章节练习、背题模式、笔记与模拟考试。</p>
        <button id="p-go-login" class="btn primary">立即登录</button>
      </div>
    `;
    container.querySelector("#p-go-login")?.addEventListener("click", onRequireUserLogin);
    return;
  }

  const bank = banks.find((b) => b.id === activeBankId);
  if (!bank) { container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”选择一个题库。</p></div>'; return; }

  let allQuestions = [];
  try { allQuestions = (await fetchBankQuestionsSafe(bank.id)).questions || []; }
  catch (err) { container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`; return; }
  if (!allQuestions.length) { container.innerHTML = '<div class="panel"><p class="muted-text">当前题库暂无题目，请先去“批量导题”添加试题。</p></div>'; return; }

  const settings = getGlobalSettings();
  const bankState = getBankPracticeState(bank.id);
  bankState.wrongStreaks = bankState.wrongStreaks || {};
  document.body.classList.toggle("immersive-mode", Boolean(settings.immersive));
  let mode = routeParams.mode || "order";
  if (mode === "recite") { settings.reciteMode = true; saveGlobalSettings(settings); mode = "order"; }

  let typeFilter = "";
  let chapterFilter = "";
  let asideTab = "sheet";
  let list = [];
  let currentIndex = 0;
  let multiDraft = new Set();
  let drillRecords = {};
  let examSession = null;
  let examTimer = null;
  let keydownHandler = null;
  const optionCache = new Map();

  const stopTimer = () => { if (examTimer) clearInterval(examTimer); examTimer = null; };
  const clearKeydown = () => { if (keydownHandler) window.removeEventListener("keydown", keydownHandler); keydownHandler = null; };
  activePracticeCleanup = () => { stopTimer(); clearKeydown(); };

  const cachedOptions = (q) => {
    const key = `${q.id}_${settings.shuffleOptions}`;
    if (!optionCache.has(key)) {
      const opts = q.options || [];
      optionCache.set(key, !settings.shuffleOptions || q.type === "3" || opts.length < 2 ? opts : shuffleArray(opts));
    }
    return optionCache.get(key);
  };

  const buildList = () => {
    stopTimer(); examSession = null; multiDraft.clear(); drillRecords = {};
    const mastered = new Set(bankState.masteredIds || []);
    const wrong = new Set(bankState.wrongIds || []);
    const fav = new Set(bankState.favoriteIds || []);

    if (mode === "random") list = shuffleArray(allQuestions.filter((q) => !mastered.has(q.id)));
    else if (mode === "wrong") list = allQuestions.filter((q) => wrong.has(q.id));
    else if (mode === "favorite") list = allQuestions.filter((q) => fav.has(q.id));
    else if (mode === "type") list = allQuestions.filter((q) => !typeFilter || String(q.type) === typeFilter);
    else if (mode === "chapter") list = allQuestions.filter((q) => !chapterFilter || (String(q.chapter || "").trim() || "未分章节") === chapterFilter);
    else if (mode === "hotWrong" && Array.isArray(routeParams.hotIds)) {
      const hotSet = new Set(routeParams.hotIds.map(String));
      list = allQuestions.filter((q) => hotSet.has(q.id));
    } else {
      const base = [...allQuestions];
      if (settings.strategy === "wrongFirst") base.sort((a, b) => (wrong.has(b.id) ? 1 : 0) - (wrong.has(a.id) ? 1 : 0));
      else if (settings.strategy === "unansweredFirst") base.sort((a, b) => (bankState.records[a.id] ? 1 : 0) - (bankState.records[b.id] ? 1 : 0));
      list = base;
      currentIndex = Math.min(bankState.lastIndex || 0, Math.max(0, list.length - 1));
      return;
    }
    currentIndex = 0;
  };

  const recordAnswer = (q, selectedArr, correct, countDaily = true) => {
    if (examSession) { examSession.answers[q.id] = { selected: selectedArr, correct }; return; }
    drillRecords[q.id] = { selected: selectedArr, correct };
    bankState.records[q.id] = { selected: selectedArr, correct };
    const wrongSet = new Set(bankState.wrongIds || []);
    const needStreak = Math.max(1, Number(settings.wrongClearStreak || 1));

    if (correct && wrongSet.has(q.id)) {
      const nextStreak = Number(bankState.wrongStreaks[q.id] || 0) + 1;
      if (nextStreak >= needStreak) {
        wrongSet.delete(q.id); delete bankState.wrongStreaks[q.id];
        if (needStreak > 1) showToast(`已连续答对 ${needStreak} 次，移出错题本！`, "ok");
      } else {
        bankState.wrongStreaks[q.id] = nextStreak;
        showToast(`错题巩固进度：${nextStreak}/${needStreak}`, "ok");
      }
    } else if (!correct) {
      wrongSet.add(q.id);
      bankState.wrongStreaks[q.id] = 0;
    }
    bankState.wrongIds = [...wrongSet];
    bankState.lastIndex = currentIndex;
    saveBankPracticeState(bank.id, bankState, countDaily ? { answered: 1, correct: correct ? 1 : 0, questionId: q.id } : null);
  };

  const goPrev = () => { if (currentIndex > 0) { currentIndex -= 1; multiDraft.clear(); renderMain(); } };
  const goNext = () => {
    if (currentIndex < list.length - 1) {
      currentIndex += 1; multiDraft.clear();
      if (!examSession) { bankState.lastIndex = currentIndex; saveBankPracticeState(bank.id, bankState); }
      renderMain();
    }
  };

  const calcExamScore = () => {
    let earned = 0; let correctCount = 0;
    for (const q of list) {
      if (examSession.answers[q.id]?.correct) { correctCount += 1; earned += Number(examSession.scoreMap[q.id] || 0); }
    }
    return { score: round1(earned), correctCount };
  };

  const submitExam = () => {
    if (!examSession) return;
    stopTimer(); examSession.submitted = true;
    const wrongSet = new Set(bankState.wrongIds || []);
    for (const q of list) if (!examSession.answers[q.id]?.correct) { wrongSet.add(q.id); bankState.wrongStreaks[q.id] = 0; }
    bankState.wrongIds = [...wrongSet];
    saveBankPracticeState(bank.id, bankState);
    const { score, correctCount } = calcExamScore();
    showToast(`交卷完成：得分 ${score}/${examSession.totalScore} 分（${correctCount}/${list.length}）`, score >= examSession.passScore ? "ok" : "bad");
    renderMain();
  };

  const renderExamSetup = () => {
    container.innerHTML = buildExamSetupHtml(bank.name, allQuestions);
    const quickBox = container.querySelector("#ex-quick-box");
    const typeBox = container.querySelector("#ex-type-box");
    const totalEl = container.querySelector("#ex-total-preview");
    const passEl = container.querySelector("#ex-pass");
    const calcTypePreview = () => {
      let sum = 0;
      container.querySelectorAll("[data-type-row]").forEach((row) => { sum += Number(row.querySelector(".ex-tc-cnt").value || 0) * Number(row.querySelector(".ex-tc-score").value || 0); });
      const rounded = round1(sum);
      if (totalEl) totalEl.textContent = String(rounded);
      return rounded;
    };
    container.querySelectorAll('input[name="ex-mode"]').forEach((r) => r.addEventListener("change", () => {
      const byType = r.value === "byType" && r.checked;
      quickBox.hidden = byType; typeBox.hidden = !byType;
      passEl.value = String(Math.max(1, Math.round((byType ? calcTypePreview() : 100) * 0.6)));
    }));
    typeBox?.addEventListener("input", () => { passEl.value = String(Math.max(1, Math.round(calcTypePreview() * 0.6))); });
    container.querySelector("#ex-cancel").addEventListener("click", () => { mode = "order"; buildList(); renderMain(); });
    container.querySelector("#exam-setup-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const isByType = container.querySelector('input[name="ex-mode"]:checked')?.value === "byType";
      const scoreMap = {};
      if (isByType) {
        list = [];
        container.querySelectorAll("[data-type-row]").forEach((row) => {
          const picked = shuffleArray(allQuestions.filter((q) => String(q.type) === row.dataset.typeRow)).slice(0, Math.max(0, Number(row.querySelector(".ex-tc-cnt").value || 0)));
          const sc = Math.max(0.5, Number(row.querySelector(".ex-tc-score").value || 2));
          for (const q of picked) { list.push(q); scoreMap[q.id] = sc; }
        });
        if (!list.length) return showToast("请至少抽取 1 道题", "bad");
      } else {
        const count = Math.min(allQuestions.length, Math.max(1, Number(container.querySelector("#ex-count").value)));
        list = shuffleArray(allQuestions).slice(0, count);
        for (const q of list) scoreMap[q.id] = 100 / list.length;
      }
      const totalScore = round1(list.reduce((s, q) => s + Number(scoreMap[q.id] || 0), 0));
      const mins = Math.max(1, Number(container.querySelector("#ex-mins").value));
      currentIndex = 0;
      examSession = { answers: {}, scoreMap, totalScore, submitted: false, passScore: Math.max(1, Number(passEl.value)), remainSec: mins * 60 };
      examTimer = setInterval(() => {
        if (!examSession || examSession.submitted || (location.hash && location.hash !== "#practice")) return stopTimer();
        examSession.remainSec -= 1;
        const clock = container.querySelector("#exam-clock");
        if (clock) clock.textContent = `${String(Math.floor(examSession.remainSec / 60)).padStart(2, "0")}:${String(examSession.remainSec % 60).padStart(2, "0")}`;
        if (examSession.remainSec <= 0) submitExam();
      }, 1000);
      renderMain();
    });
  };

  const bindKeyboardAndTouch = (q, opts, showAnswerNow) => {
    clearKeydown();
    const onKeyDown = (e) => {
      if (!document.body.contains(container) || (location.hash.startsWith("#") && location.hash !== "#practice")) return clearKeydown();
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Enter" && e.target.id === "fill-input") { e.preventDefault(); container.querySelector("#btn-confirm-fill")?.click(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); return; }
      if (e.key === "Enter") {
        if (!showAnswerNow && isMultiChoice(q)) { e.preventDefault(); container.querySelector("#btn-confirm-multi")?.click(); }
        else if (showAnswerNow) { e.preventDefault(); goNext(); }
        return;
      }
      if (!showAnswerNow && opts.length) {
        const idx = LETTERS.indexOf(e.key.toUpperCase());
        const numIdx = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
        const target = idx >= 0 && idx < opts.length ? idx : (numIdx >= 0 && numIdx < opts.length ? numIdx : -1);
        if (target >= 0) { e.preventDefault(); container.querySelectorAll(".option-item")[target]?.click(); }
      }
    };
    keydownHandler = onKeyDown;
    window.addEventListener("keydown", onKeyDown);

    const qBox = container.querySelector(".question-box");
    let tx = 0; let ty = 0;
    qBox?.addEventListener("touchstart", (e) => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
    qBox?.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - tx;
      const dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) goNext(); else goPrev();
      }
    }, { passive: true });
  };

  const bindMainEvents = (q, opts, showAnswerNow) => {
    container.querySelector("#btn-prev")?.addEventListener("click", goPrev);
    container.querySelector("#btn-next")?.addEventListener("click", goNext);
    container.querySelectorAll(".js-fav-btn").forEach((b) => b.addEventListener("click", () => {
      const set = new Set(bankState.favoriteIds || []);
      if (set.has(q.id)) set.delete(q.id); else set.add(q.id);
      bankState.favoriteIds = [...set]; saveBankPracticeState(bank.id, bankState); renderMain();
    }));
    container.querySelector("#btn-master")?.addEventListener("click", () => {
      const set = new Set(bankState.masteredIds || []);
      if (set.has(q.id)) set.delete(q.id); else { set.add(q.id); bankState.wrongIds = (bankState.wrongIds || []).filter((id) => id !== q.id); }
      bankState.masteredIds = [...set]; saveBankPracticeState(bank.id, bankState); renderMain();
    });
    const saveNote = (val) => {
      bankState.notes = bankState.notes || {};
      bankState.notes[q.id] = String(val || "").trim();
      saveBankPracticeState(bank.id, bankState);
      showToast("笔记已保存", "ok");
    };
    container.querySelector("#q-note-input")?.addEventListener("change", (e) => { saveNote(e.target.value); });
    container.querySelector("#aside-note-input")?.addEventListener("change", (e) => { saveNote(e.target.value); renderMain(); });
    container.querySelector("#btn-eval-ok")?.addEventListener("click", () => { recordAnswer(q, bankState.records[q.id]?.selected || ["已作答"], true, false); renderMain(); });
    container.querySelector("#btn-eval-bad")?.addEventListener("click", () => { recordAnswer(q, bankState.records[q.id]?.selected || ["已作答"], false, false); renderMain(); });
    container.querySelector("#btn-redo-q")?.addEventListener("click", () => {
      delete drillRecords[q.id]; delete bankState.records[q.id]; multiDraft.clear();
      saveBankPracticeState(bank.id, bankState); renderMain();
    });
    container.querySelector("#btn-toggle-immersive")?.addEventListener("click", () => { settings.immersive = !settings.immersive; saveGlobalSettings(settings); document.body.classList.toggle("immersive-mode", settings.immersive); renderMain(); });
    container.querySelector("#btn-exit-immersive")?.addEventListener("click", () => { settings.immersive = false; saveGlobalSettings(settings); document.body.classList.remove("immersive-mode"); renderMain(); });
    container.querySelector("#btn-imm-recite")?.addEventListener("click", () => { settings.reciteMode = !settings.reciteMode; saveGlobalSettings(settings); renderMain(); });
    container.querySelector("#btn-imm-theme")?.addEventListener("click", () => onToggleTheme?.());

    container.querySelectorAll(".js-aside-tab").forEach((b) => b.addEventListener("click", () => { asideTab = b.dataset.tab; renderMain(); }));
    const aiModal = container.querySelector("#ai-chat-modal");
    const asideAiRoot = container.querySelector("#aside-ai-chat");
    const modalAiRoot = container.querySelector("#modal-ai-chat");
    if (asideAiRoot && asideTab === "ai") mountAiChatWidget(asideAiRoot, q);
    container.querySelectorAll(".js-open-ai-modal").forEach((b) => b.addEventListener("click", () => { if (aiModal) { mountAiChatWidget(modalAiRoot, q); aiModal.hidden = false; } }));
    container.querySelector("#ai-chat-modal-close")?.addEventListener("click", () => { if (aiModal) aiModal.hidden = true; if (asideAiRoot && asideTab === "ai") mountAiChatWidget(asideAiRoot, q); });
    const sheetModal = container.querySelector("#sheet-modal");
    container.querySelectorAll(".js-open-sheet").forEach((b) => b.addEventListener("click", () => { if (sheetModal) sheetModal.hidden = false; }));
    container.querySelector("#sheet-modal-close")?.addEventListener("click", () => { if (sheetModal) sheetModal.hidden = true; });
    container.querySelectorAll("button[data-jump]").forEach((b) => b.addEventListener("click", () => { currentIndex = Number(b.dataset.jump); multiDraft.clear(); if (sheetModal) sheetModal.hidden = true; renderMain(); }));
    container.querySelectorAll(".js-reset-progress").forEach((b) => b.addEventListener("click", () => {
      if (!confirm("确定清空本题库的刷题记录吗？")) return;
      bankState.records = {}; bankState.lastIndex = 0; drillRecords = {}; saveBankPracticeState(bank.id, bankState); currentIndex = 0; renderMain();
    }));

    container.querySelectorAll(".js-sw-recite").forEach((el) => el.addEventListener("change", (e) => { settings.reciteMode = e.target.checked; saveGlobalSettings(settings); renderMain(); }));
    container.querySelectorAll(".js-sw-auto").forEach((el) => el.addEventListener("change", (e) => { settings.autoNext = e.target.checked; saveGlobalSettings(settings); }));
    container.querySelectorAll(".js-sw-shuffle").forEach((el) => el.addEventListener("change", (e) => { settings.shuffleOptions = e.target.checked; saveGlobalSettings(settings); renderMain(); }));
    container.querySelectorAll(".js-sw-strategy").forEach((el) => el.addEventListener("change", (e) => { settings.strategy = e.target.value; saveGlobalSettings(settings); buildList(); renderMain(); }));
    container.querySelectorAll(".js-sw-streak").forEach((el) => el.addEventListener("change", (e) => { settings.wrongClearStreak = Number(e.target.value || 1); saveGlobalSettings(settings); renderMain(); }));
    container.querySelectorAll(".js-export-wrong").forEach((el) => el.addEventListener("click", () => printQuestionsDocument(`${bank.name} - 错题本`, list, true)));
    container.querySelector("#btn-ai-explain")?.addEventListener("click", async () => {
      const box = container.querySelector("#ai-explain-box");
      if (!box) return;
      box.hidden = false; box.textContent = "AI 正在生成深度解析...";
      try { box.textContent = (await aiRequest("/api/ai/explain", { question: q })).explanation; } catch (err) { box.textContent = err.message; }
    });

    if (!showAnswerNow) {
      container.querySelectorAll(".option-item").forEach((optBtn) => optBtn.addEventListener("click", () => {
        const val = optBtn.dataset.opt;
        if (isMultiChoice(q)) { if (multiDraft.has(val)) multiDraft.delete(val); else multiDraft.add(val); renderMain(); }
        else {
          const correct = isAnswerCorrect(q, [val]);
          recordAnswer(q, [val], correct); renderMain();
          if (correct && settings.autoNext && !examSession && currentIndex < list.length - 1) setTimeout(goNext, 420);
        }
      }));
      container.querySelector("#btn-confirm-multi")?.addEventListener("click", () => {
        if (!multiDraft.size) return showToast("请至少选择一个选项", "bad");
        recordAnswer(q, [...multiDraft], isAnswerCorrect(q, [...multiDraft])); multiDraft.clear(); renderMain();
      });
      container.querySelector("#btn-confirm-fill")?.addEventListener("click", () => {
        const raw = container.querySelector("#fill-input").value.trim();
        if (!raw) return showToast("请输入答案", "bad");
        const sel = raw.split("|").map((s) => s.trim()).filter(Boolean);
        recordAnswer(q, sel, isAnswerCorrect(q, sel)); renderMain();
      });
      container.querySelector("#btn-confirm-essay")?.addEventListener("click", () => {
        const raw = container.querySelector("#essay-input").value.trim();
        recordAnswer(q, [raw || "（已查看参考答案）"], raw ? isAnswerCorrect(q, [raw]) : true); renderMain();
      });
    }
    bindKeyboardAndTouch(q, opts, showAnswerNow);
  };

  const renderMain = () => {
    clearKeydown();
    if (mode === "exam" && !examSession) return renderExamSetup();
    const chapterStats = computeChapterStats(allQuestions, bankState.records || {});
    const modeBar = buildModeBarHtml({ bank, mode, bankState, typeFilter, chapterFilter, chapterStats, examSession, settings });
    const bindBar = () => {
      container.querySelectorAll("button[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; buildList(); renderMain(); }));
      container.querySelector("#p-type-filter")?.addEventListener("change", (e) => { typeFilter = e.target.value; buildList(); renderMain(); });
      container.querySelector("#p-chapter-filter")?.addEventListener("change", (e) => { chapterFilter = e.target.value; buildList(); renderMain(); });
      container.querySelector("#btn-submit-exam")?.addEventListener("click", submitExam);
    };
    if (!list.length) {
      container.innerHTML = `${modeBar}<div class="panel"><p class="muted-text">当前模式下暂无题目（比如错题本/收藏夹/所选章节为空）。</p></div>`;
      bindBar(); return;
    }

    const q = list[currentIndex];
    const isDrillMode = mode === "wrong" || mode === "hotWrong";
    const activeRecords = examSession ? examSession.answers : (isDrillMode ? drillRecords : bankState.records);
    const record = activeRecords[q.id];
    const showAnswerNow = (!examSession && settings.reciteMode) || (examSession ? examSession.submitted : Boolean(record));
    const opts = cachedOptions(q);
    const isFav = (bankState.favoriteIds || []).includes(q.id);
    const isMastered = (bankState.masteredIds || []).includes(q.id);
    const examRes = examSession?.submitted ? calcExamScore() : null;
    const sheetInnerHtml = buildSheetInnerHtml({ list, currentIndex, activeRecords, examSession, settings, mode });
    const pct = Math.round(((currentIndex + 1) / list.length) * 100);
    const needStreak = Math.max(1, Number(settings.wrongClearStreak || 1));
    const curStreak = Number((bankState.wrongStreaks || {})[q.id] || 0);
    const streakBadge = needStreak > 1 && (bankState.wrongIds || []).includes(q.id)
      ? `<span class="badge warn">巩固 ${curStreak}/${needStreak}</span>` : "";

    const asideBody = asideTab === "sheet" ? sheetInnerHtml : (asideTab === "notes" ? buildNotesPanelHtml(list, q, bankState) : '<div id="aside-ai-chat"></div>');

    container.innerHTML = `
      ${modeBar}
      ${buildImmersiveBarHtml(bank.name, currentIndex, list.length, settings)}
      ${examRes ? `<div class="answer-box" style="margin-bottom:14px;border-color:var(--accent);"><strong>模拟考试成绩：${examRes.score} / ${examSession.totalScore} 分</strong>（答对 ${examRes.correctCount} / ${list.length}，及格线 ${examSession.passScore} 分）</div>` : ""}
      <div class="practice-layout">
        <section class="question-box">
          <div class="q-progress-track"><span style="width:${pct}%"></span></div>
          <div class="row-gap" style="justify-content:space-between;">
            <div class="row-gap">
              <span class="badge">${TYPE_LABELS[q.type] || "其他"}</span>
              ${q.chapter ? `<span class="badge warn">${escapeHtml(q.chapter)}</span>` : ""}
              ${examSession ? `<span class="badge ok">${round1(examSession.scoreMap[q.id] || 0)} 分</span>` : ""}
              ${streakBadge}
              <span class="muted-text">第 ${currentIndex + 1} / ${list.length} 题</span>
            </div>
            <div class="row-gap">
              <button class="btn ghost tiny js-fav-btn">${isFav ? "★ 已收藏" : "☆ 收藏"}</button>
              <button id="btn-master" class="btn tiny ${isMastered ? "ok" : "ghost"}">${isMastered ? "✓ 已斩题" : "斩题"}</button>
            </div>
          </div>
          <div class="q-title">${escapeHtml(q.title)}</div>
          ${(q.images || []).length ? `<div class="row-gap" style="margin-bottom:12px;">${q.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid var(--line);">`).join("")}</div>` : ""}
          ${buildInteractionHtml({ q, opts, record, multiDraft, showAnswerNow, examSession })}
          ${buildAnswerPanelHtml({ q, record, showAnswerNow, bankState, examSession })}
          <div class="row-gap practice-nav-footer" style="justify-content:space-between;margin-top:20px;padding-top:14px;border-top:1px solid var(--line);">
            <button id="btn-prev" class="btn ghost tiny" ${currentIndex === 0 ? "disabled" : ""}>上一题</button>
            <span class="muted-text kbd-hint" style="font-size:12px;">A-F/1-6 选 · Enter 确认 · ←/→ 切题</span>
            <button class="btn ghost tiny mobile-only-btn js-fav-btn">${isFav ? "★" : "☆"}</button>
            <button class="btn ghost tiny mobile-sheet-trigger js-open-sheet">答题卡</button>
            <button class="btn ghost tiny mobile-only-btn js-open-ai-modal">AI</button>
            <button id="btn-next" class="btn primary tiny" ${currentIndex >= list.length - 1 ? "disabled" : ""}>下一题</button>
          </div>
        </section>
        <aside class="practice-aside panel">
          <div class="aside-tabs">
            ${[["sheet", "答题卡"], ["notes", "本题笔记"], ["ai", "AI 助教"]].map(([k, lbl]) => `
              <button type="button" class="aside-tab-btn js-aside-tab ${asideTab === k ? "active" : ""}" data-tab="${k}">${lbl}</button>
            `).join("")}
          </div>
          ${asideBody}
        </aside>
      </div>
      <div id="sheet-modal" class="modal-backdrop" hidden><div class="modal-card"><div class="modal-head"><h3>答题卡与设置</h3><button id="sheet-modal-close" class="btn ghost tiny">关闭</button></div>${sheetInnerHtml}</div></div>
      <div id="ai-chat-modal" class="modal-backdrop" hidden><div class="modal-card" style="max-width:520px;"><div class="modal-head"><h3>AI 题伴助教</h3><button id="ai-chat-modal-close" class="btn ghost tiny">关闭</button></div><div id="modal-ai-chat"></div></div></div>
    `;
    bindBar(); bindMainEvents(q, opts, showAnswerNow);
  };

  buildList();
  renderMain();
};

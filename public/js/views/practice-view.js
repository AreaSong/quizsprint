import {
  escapeHtml, fetchBankQuestionsSafe, getBankPracticeState, getGlobalSettings,
  LETTERS, printQuestionsDocument, saveBankPracticeState, saveGlobalSettings, showToast
} from "../api.js";
import { mountAiChatWidget } from "./ai-chat-widget.js";
import { bindPaneResizers, createNotesController } from "./practice-notes.js";
import { bindDragQuestionEvents, initMatchState, initOrderItems, isMatchType, isOrderType, isSubjectiveType } from "./practice-drag.js";
import { mountExamSetup } from "./practice-exam.js";
import {
  buildImmersiveBarHtml, buildModeBarHtml, buildNotesPanelHtml,
  buildPracticeShellHtml, buildQuestionBodyHtml, buildQuestionFooterHtml, buildQuestionHeadHtml,
  buildSheetInnerHtml, computeChapterStats, isAnswerCorrect, isMultiChoice, shuffleArray
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
  let aiWide = Number(settings.asideWidth || 332) >= 460;
  let pendingAiPrompt = "";
  let shellMounted = false;
  let lastRenderedQid = null;
  let lastRenderedAsideTab = "";
  const optionCache = new Map();
  const orderDraftMap = new Map();
  const matchDraftMap = new Map();
  const getOrderItems = (q) => { if (!orderDraftMap.has(q.id)) orderDraftMap.set(q.id, initOrderItems(q)); return orderDraftMap.get(q.id); };
  const getMatchState = (q) => { if (!matchDraftMap.has(q.id)) matchDraftMap.set(q.id, initMatchState(q)); return matchDraftMap.get(q.id); };

  const isNotesCollapsed = () => (settings.notesCollapsed == null ? window.innerWidth < 1320 : Boolean(settings.notesCollapsed));
  const stopTimer = () => { if (examTimer) clearInterval(examTimer); examTimer = null; };
  const clearKeydown = () => { if (keydownHandler) window.removeEventListener("keydown", keydownHandler); keydownHandler = null; };
  const notesCtrl = createNotesController({
    container,
    bankId: bank.id,
    bankState,
    getList: () => list,
    onJump: (idx) => { currentIndex = idx; multiDraft.clear(); renderMain(); }
  });
  const flushPendingNote = () => notesCtrl.flush();
  activePracticeCleanup = () => { flushPendingNote(); stopTimer(); clearKeydown(); };

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

  const goPrev = () => { if (currentIndex > 0) { flushPendingNote(); currentIndex -= 1; multiDraft.clear(); renderMain(); } };
  const goNext = () => {
    if (currentIndex < list.length - 1) {
      flushPendingNote();
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

  const renderExamSetup = () => mountExamSetup({
    container,
    bankName: bank.name,
    allQuestions,
    onCancel: () => { mode = "order"; buildList(); renderMain(); },
    onStart: ({ list: picked, scoreMap, totalScore, passScore, mins }) => {
      list = picked; currentIndex = 0;
      examSession = { answers: {}, scoreMap, totalScore, submitted: false, passScore, remainSec: mins * 60 };
      examTimer = setInterval(() => {
        if (!examSession || examSession.submitted || (location.hash && location.hash !== "#practice")) return stopTimer();
        examSession.remainSec -= 1;
        const clock = container.querySelector("#exam-clock");
        if (clock) clock.textContent = `${String(Math.floor(examSession.remainSec / 60)).padStart(2, "0")}:${String(examSession.remainSec % 60).padStart(2, "0")}`;
        if (examSession.remainSec <= 0) submitExam();
      }, 1000);
      renderMain();
    }
  });

  const bindKeyboardAndTouch = (q, opts, showAnswerNow) => {
    clearKeydown();
    const onKeyDown = (e) => {
      if (!document.body.contains(container) || (location.hash.startsWith("#") && location.hash !== "#practice")) return clearKeydown();
      if (document.querySelector(".modal-backdrop:not([hidden])")) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Enter" && e.target.id === "fill-input") { e.preventDefault(); container.querySelector("#btn-confirm-fill")?.click(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); return; }
      if (e.key === " " && !showAnswerNow && isSubjectiveType(q)) { e.preventDefault(); container.querySelector("#btn-confirm-essay")?.click(); return; }
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
  };

  const getAiOpts = (q, allowWide, autoPrompt = "") => ({
    isWide: aiWide,
    onToggleWide: allowWide ? () => {
      aiWide = !aiWide; settings.asideWidth = aiWide ? 520 : 332; saveGlobalSettings(settings);
      container.querySelector(".practice-shell")?.style.setProperty("--aside-w", `${settings.asideWidth}px`);
      renderMain({ forceAi: true });
    } : null,
    onAppendNote: (text) => notesCtrl.append(q.id, text),
    initialState: bankState.aiChats?.[q.id] || null,
    onHistoryChange: (st) => {
      bankState.aiChats = bankState.aiChats || {};
      if (st) bankState.aiChats[q.id] = st; else delete bankState.aiChats[q.id];
      saveBankPracticeState(bank.id, bankState);
    },
    autoPrompt
  });

  const bindPersistentShell = () => {
    bindPaneResizers({
      container, settings,
      onSave: (side, w) => { if (side === "notes") settings.notesWidth = w; else { settings.asideWidth = w; aiWide = w >= 460; } saveGlobalSettings(settings); }
    });
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
    container.querySelector("#sheet-modal-close")?.addEventListener("click", () => {
      const m = container.querySelector("#sheet-modal");
      if (m) m.hidden = true;
    });
    container.querySelector("#ai-chat-modal-close")?.addEventListener("click", () => {
      const aiModal = container.querySelector("#ai-chat-modal");
      const asideAiRoot = container.querySelector("#aside-ai-chat");
      const q = list[currentIndex];
      if (aiModal) aiModal.hidden = true;
      if (q && asideAiRoot && asideTab === "ai") mountAiChatWidget(asideAiRoot, q, getAiOpts(q, true));
    });
  };

  const bindSheetScope = (scope) => {
    if (!scope) return;
    const sheetModal = container.querySelector("#sheet-modal");
    scope.querySelectorAll("button[data-jump]").forEach((b) => b.addEventListener("click", () => {
      flushPendingNote(); currentIndex = Number(b.dataset.jump); multiDraft.clear();
      if (sheetModal) sheetModal.hidden = true;
      renderMain();
    }));
    scope.querySelector(".js-reset-progress")?.addEventListener("click", () => {
      if (!confirm("确定清空本题库的刷题记录吗？")) return;
      bankState.records = {}; bankState.lastIndex = 0; drillRecords = {}; saveBankPracticeState(bank.id, bankState); currentIndex = 0; renderMain();
    });
    scope.querySelector(".js-sw-recite")?.addEventListener("change", (e) => { settings.reciteMode = e.target.checked; saveGlobalSettings(settings); renderMain(); });
    scope.querySelector(".js-sw-auto")?.addEventListener("change", (e) => { settings.autoNext = e.target.checked; saveGlobalSettings(settings); });
    scope.querySelector(".js-sw-shuffle")?.addEventListener("change", (e) => { settings.shuffleOptions = e.target.checked; saveGlobalSettings(settings); renderMain(); });
    scope.querySelector(".js-sw-strategy")?.addEventListener("change", (e) => { settings.strategy = e.target.value; saveGlobalSettings(settings); buildList(); renderMain(); });
    scope.querySelector(".js-sw-streak")?.addEventListener("change", (e) => { settings.wrongClearStreak = Number(e.target.value || 1); saveGlobalSettings(settings); renderMain(); });
    scope.querySelector(".js-export-wrong")?.addEventListener("click", () => printQuestionsDocument(`${bank.name} - 错题本`, list, true));
  };

  const bindBarEvents = () => {
    container.querySelector("#p-bank-select")?.addEventListener("change", (e) => {
      flushPendingNote();
      const nextId = e.target.value;
      ctx.onSelectBank?.(nextId);
      renderPracticeView(container, { ...ctx, activeBankId: nextId, routeParams: { mode } });
    });
    container.querySelectorAll("button[data-mode]").forEach((b) => b.addEventListener("click", () => { flushPendingNote(); mode = b.dataset.mode; buildList(); renderMain(); }));
    container.querySelector("#p-type-filter")?.addEventListener("change", (e) => { flushPendingNote(); typeFilter = e.target.value; buildList(); renderMain(); });
    container.querySelector("#p-chapter-filter")?.addEventListener("change", (e) => { flushPendingNote(); chapterFilter = e.target.value; buildList(); renderMain(); });
    container.querySelector("#btn-submit-exam")?.addEventListener("click", submitExam);
    container.querySelector("#btn-quick-recite")?.addEventListener("click", () => { settings.reciteMode = !settings.reciteMode; saveGlobalSettings(settings); renderMain(); });
    container.querySelector("#btn-toggle-notes")?.addEventListener("click", () => { settings.notesCollapsed = !isNotesCollapsed(); saveGlobalSettings(settings); renderMain(); });
    container.querySelector("#btn-toggle-aside")?.addEventListener("click", () => { settings.asideCollapsed = !settings.asideCollapsed; saveGlobalSettings(settings); renderMain(); });
    container.querySelector("#btn-toggle-immersive")?.addEventListener("click", () => { settings.immersive = !settings.immersive; saveGlobalSettings(settings); document.body.classList.toggle("immersive-mode", settings.immersive); renderMain(); });
  };

  const bindCommonControls = (q) => {
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
    container.querySelector("#btn-exit-immersive")?.addEventListener("click", () => { settings.immersive = false; saveGlobalSettings(settings); document.body.classList.remove("immersive-mode"); renderMain(); });
    container.querySelector("#btn-imm-recite")?.addEventListener("click", () => { settings.reciteMode = !settings.reciteMode; saveGlobalSettings(settings); renderMain(); });
    container.querySelector("#btn-imm-theme")?.addEventListener("click", () => onToggleTheme?.());
    container.querySelectorAll(".js-open-sheet").forEach((b) => b.addEventListener("click", () => { const m = container.querySelector("#sheet-modal"); if (m) m.hidden = false; }));
    container.querySelectorAll(".js-open-ai-modal").forEach((b) => b.addEventListener("click", () => {
      const aiModal = container.querySelector("#ai-chat-modal");
      if (aiModal) { mountAiChatWidget(container.querySelector("#modal-ai-chat"), q, getAiOpts(q, false)); aiModal.hidden = false; }
    }));
    notesCtrl.bind(q.id, () => {
      settings.notesCollapsed = false; saveGlobalSettings(settings); renderMain();
      container.querySelector("#aside-note-input")?.focus();
    });
  };

  const bindQuestionInteractive = (q, showAnswerNow) => {
    const curSel = () => bankState.records[q.id]?.selected || ["已查看"];
    container.querySelector("#btn-eval-master")?.addEventListener("click", () => {
      recordAnswer(q, curSel(), true, false);
      bankState.masteredIds = [...new Set([...(bankState.masteredIds || []), q.id])];
      bankState.wrongIds = (bankState.wrongIds || []).filter((id) => id !== q.id);
      saveBankPracticeState(bank.id, bankState); showToast("已标记秒会并斩题", "ok");
      if (settings.autoNext && currentIndex < list.length - 1) goNext(); else renderMain();
    });
    container.querySelector("#btn-eval-fuzzy")?.addEventListener("click", () => { recordAnswer(q, curSel(), true, false); showToast("已记录为模糊，保留后续复习"); renderMain(); });
    container.querySelector("#btn-eval-bad")?.addEventListener("click", () => { recordAnswer(q, curSel(), false, false); showToast("已加入错题本"); renderMain(); });
    container.querySelector("#btn-copy-ans")?.addEventListener("click", () => {
      navigator.clipboard?.writeText((q.answers || []).join("\n")).then(() => showToast("已复制参考答案", "ok")).catch(() => {});
    });
    container.querySelector("#btn-redo-q")?.addEventListener("click", () => {
      delete drillRecords[q.id]; delete bankState.records[q.id]; multiDraft.clear(); orderDraftMap.delete(q.id); matchDraftMap.delete(q.id);
      saveBankPracticeState(bank.id, bankState); renderMain();
    });
    container.querySelector("#btn-ai-explain")?.addEventListener("click", () => {
      const prompt = "请详细解析这道题：说明正确答案的核心依据，逐项分析错误选项，并提炼 1-2 条记忆要点。";
      if (window.innerWidth <= 960 || settings.immersive) {
        const aiModal = container.querySelector("#ai-chat-modal");
        if (aiModal) { mountAiChatWidget(container.querySelector("#modal-ai-chat"), q, getAiOpts(q, false, prompt)); aiModal.hidden = false; }
        return;
      }
      settings.asideCollapsed = false; saveGlobalSettings(settings);
      asideTab = "ai"; pendingAiPrompt = prompt; renderMain();
    });
    if (showAnswerNow) return;
    bindDragQuestionEvents({
      container, q, getOrderItems: () => getOrderItems(q), setOrderItems: (arr) => orderDraftMap.set(q.id, arr),
      getMatchState: () => getMatchState(q), onRerender: renderMain,
      onSubmit: (sel) => { recordAnswer(q, sel, isAnswerCorrect(q, sel)); renderMain(); }
    });
    container.querySelectorAll(".option-item").forEach((optBtn) => optBtn.addEventListener("click", () => {
      const val = optBtn.dataset.opt;
      if (isMultiChoice(q)) { if (multiDraft.has(val)) multiDraft.delete(val); else multiDraft.add(val); renderMain(); return; }
      const correct = isAnswerCorrect(q, [val]);
      recordAnswer(q, [val], correct); renderMain();
      if (correct && settings.autoNext && !examSession && currentIndex < list.length - 1) setTimeout(goNext, 420);
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
  };

  const updateAsidePanel = (q, sheetInnerHtml, activeAsideTab, wasMounted, qChanged, forceAi) => {
    const tabsEl = container.querySelector("#p-aside-tabs");
    const bodyEl = container.querySelector("#p-aside-body");
    const modalSheetEl = container.querySelector("#modal-sheet-body");
    tabsEl.innerHTML = [["sheet", "答题卡"], ["ai", "AI 助教"]].map(([k, lbl]) =>
      `<button type="button" class="aside-tab-btn js-aside-tab ${activeAsideTab === k ? "active" : ""}" data-tab="${k}">${lbl}</button>`
    ).join("");
    tabsEl.querySelectorAll(".js-aside-tab").forEach((b) => b.addEventListener("click", () => { asideTab = b.dataset.tab; renderMain(); }));
    modalSheetEl.innerHTML = sheetInnerHtml;
    bindSheetScope(modalSheetEl);
    if (activeAsideTab === "ai") {
      bodyEl.className = "aside-body-scroll is-ai-tab";
      const prompt = pendingAiPrompt;
      pendingAiPrompt = "";
      const needMount = !wasMounted || qChanged || lastRenderedAsideTab !== "ai" || Boolean(prompt) || forceAi || !bodyEl.querySelector("#aside-ai-chat");
      if (needMount) {
        bodyEl.innerHTML = '<div id="aside-ai-chat"></div>';
        mountAiChatWidget(bodyEl.querySelector("#aside-ai-chat"), q, getAiOpts(q, true, prompt));
      }
    } else {
      const prevScroll = wasMounted && lastRenderedAsideTab === "sheet" ? bodyEl.scrollTop : 0;
      const wasOpen = Boolean(wasMounted && lastRenderedAsideTab === "sheet" && bodyEl.querySelector(".sheet-settings")?.open);
      bodyEl.className = "aside-body-scroll";
      bodyEl.innerHTML = sheetInnerHtml;
      if (wasOpen) { const det = bodyEl.querySelector(".sheet-settings"); if (det) det.open = true; }
      bodyEl.scrollTop = prevScroll;
      bindSheetScope(bodyEl);
    }
    lastRenderedAsideTab = activeAsideTab;
  };

  const renderMain = (renderOpts = {}) => {
    clearKeydown();
    if (mode === "exam" && !examSession) {
      shellMounted = false; lastRenderedQid = null; lastRenderedAsideTab = "";
      return renderExamSetup();
    }
    const wasMounted = shellMounted;
    if (!shellMounted) {
      container.innerHTML = buildPracticeShellHtml();
      bindPersistentShell();
      shellMounted = true;
    }
    const notesCollapsed = isNotesCollapsed();
    const activeAsideTab = asideTab === "ai" ? "ai" : "sheet";
    const shell = container.querySelector(".practice-shell");
    shell.classList.toggle("notes-collapsed", notesCollapsed);
    shell.classList.toggle("aside-collapsed", Boolean(settings.asideCollapsed));
    shell.classList.toggle("ai-wide", activeAsideTab === "ai" && aiWide);

    const chapterStats = computeChapterStats(allQuestions, bankState.records || {});
    container.querySelector("#p-modebar-slot").innerHTML = buildModeBarHtml({
      bank, banks, mode, bankState, typeFilter, chapterFilter, chapterStats, examSession, settings, notesCollapsed
    });
    bindBarEvents();

    const emptyEl = container.querySelector("#p-empty-slot");
    const layoutEl = container.querySelector(".practice-layout");
    const immEl = container.querySelector("#p-immbar-slot");
    const examResEl = container.querySelector("#p-examres-slot");
    if (!list.length) {
      emptyEl.hidden = false; layoutEl.hidden = true; immEl.innerHTML = ""; examResEl.innerHTML = "";
      lastRenderedQid = null;
      return;
    }
    emptyEl.hidden = true; layoutEl.hidden = false;

    const q = list[currentIndex];
    const qChanged = q.id !== lastRenderedQid;
    const isDrillMode = mode === "wrong" || mode === "hotWrong";
    const activeRecords = examSession ? examSession.answers : (isDrillMode ? drillRecords : bankState.records);
    const record = activeRecords[q.id];
    const showAnswerNow = (!examSession && settings.reciteMode) || (examSession ? examSession.submitted : Boolean(record));
    const opts = cachedOptions(q);
    const examRes = examSession?.submitted ? calcExamScore() : null;
    const needStreak = Math.max(1, Number(settings.wrongClearStreak || 1));
    const curStreak = Number((bankState.wrongStreaks || {})[q.id] || 0);
    const streakBadge = needStreak > 1 && (bankState.wrongIds || []).includes(q.id) ? `<span class="badge warn">巩固 ${curStreak}/${needStreak}</span>` : "";

    immEl.innerHTML = buildImmersiveBarHtml(bank.name, currentIndex, list.length, settings);
    examResEl.innerHTML = examRes ? `<div class="answer-box" style="margin-bottom:14px;border-color:var(--accent);"><strong>模拟考试成绩：${examRes.score} / ${examSession.totalScore} 分</strong>（答对 ${examRes.correctCount} / ${list.length}，及格线 ${examSession.passScore} 分）</div>` : "";
    container.querySelector("#p-progress-fill").style.width = `${Math.round(((currentIndex + 1) / list.length) * 100)}%`;
    container.querySelector("#p-q-head").innerHTML = buildQuestionHeadHtml({
      q, currentIndex, total: list.length, examSession, scoreVal: examSession ? round1(examSession.scoreMap[q.id] || 0) : 0,
      streakBadge, isFav: (bankState.favoriteIds || []).includes(q.id), isMastered: (bankState.masteredIds || []).includes(q.id)
    });

    const qBodyEl = container.querySelector("#p-q-body");
    const prevQScroll = !qChanged && wasMounted ? qBodyEl.scrollTop : 0;
    qBodyEl.innerHTML = buildQuestionBodyHtml({
      q, opts, record, multiDraft, showAnswerNow, bankState, examSession,
      orderItems: isOrderType(q) ? getOrderItems(q) : [], matchState: isMatchType(q) ? getMatchState(q) : null
    });
    if (qChanged) {
      qBodyEl.scrollTop = 0; qBodyEl.classList.remove("q-enter"); void qBodyEl.offsetWidth; qBodyEl.classList.add("q-enter");
    } else {
      qBodyEl.classList.remove("q-enter"); qBodyEl.scrollTop = prevQScroll;
    }

    container.querySelector("#p-q-footer").innerHTML = buildQuestionFooterHtml(currentIndex, list.length);
    if (!wasMounted || qChanged) {
      container.querySelector("#p-notes-slot").innerHTML = buildNotesPanelHtml(list, q, bankState, "aside-note-input");
      container.querySelector("#modal-notes-body").innerHTML = buildNotesPanelHtml(list, q, bankState, "modal-note-input");
    }
    const sheetInnerHtml = buildSheetInnerHtml({ list, currentIndex, activeRecords, examSession, settings, mode });
    updateAsidePanel(q, sheetInnerHtml, activeAsideTab, wasMounted, qChanged, Boolean(renderOpts.forceAi));
    lastRenderedQid = q.id;
    bindCommonControls(q);
    bindQuestionInteractive(q, showAnswerNow);
    bindKeyboardAndTouch(q, opts, showAnswerNow);
  };

  buildList();
  renderMain();
};

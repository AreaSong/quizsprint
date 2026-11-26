import {
  escapeHtml, fetchBankQuestionsSafe, getBankPracticeState, getGlobalSettings,
  LETTERS, printQuestionsDocument, saveBankPracticeState, saveGlobalSettings, showToast
} from "../api.js";
import { openConfirmDialog } from "../dialog.js";
import { mountAiChatWidget } from "./ai-chat-widget.js";
import { bindPaneResizers, bindSwipeNav, createNotesController } from "./practice-notes.js";
import { bindDragQuestionEvents, initMatchState, initOrderItems, isMatchType, isOrderType, isSubjectiveType } from "./practice-drag.js";
import { mountExamSetup } from "./practice-exam.js";
import {
  buildExamBannerHtml, buildImmersiveBarHtml, buildModeBarHtml, buildNotesPanelHtml,
  buildPracticeLoginHtml, buildPracticeShellHtml, buildQuestionBodyHtml, buildQuestionHeadHtml,
  buildSheetInnerHtml, computeChapterStats, isAnswerCorrect, isMultiChoice, shuffleArray
} from "./practice-templates.js";

let activePracticeCleanup = null;
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

export const renderPracticeView = async (container, ctx) => {
  if (activePracticeCleanup) { activePracticeCleanup(); activePracticeCleanup = null; }
  const { activeBankId, banks, isLoggedIn, onRequireUserLogin, onToggleTheme, routeParams = {} } = ctx;
  if (!isLoggedIn) {
    container.innerHTML = buildPracticeLoginHtml();
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
  let typeFilter = ""; let chapterFilter = ""; let asideTab = "sheet"; let list = []; let currentIndex = 0;
  let multiDraft = new Set(); let drillRecords = {}; let examSession = null; let examTimer = null; let keydownHandler = null;
  let aiWide = Number(settings.asideWidth || 332) >= 460; let pendingAiPrompt = "";
  let shellMounted = false; let lastRenderedQid = null; let lastRenderedAsideTab = "";
  let lastModeBarKey = ""; let lastSheetKey = ""; let lastNotesListVer = -1;
  let listVersion = 0; let sheetVersion = 0; let justAnsweredQid = null; let qBodyAnim = null;
  const optionCache = new Map(); const orderDraftMap = new Map(); const matchDraftMap = new Map();
  const getOrderItems = (q) => { if (!orderDraftMap.has(q.id)) orderDraftMap.set(q.id, initOrderItems(q)); return orderDraftMap.get(q.id); };
  const getMatchState = (q) => { if (!matchDraftMap.has(q.id)) matchDraftMap.set(q.id, initMatchState(q)); return matchDraftMap.get(q.id); };

  const isNotesCollapsed = () => (settings.notesCollapsed == null ? window.innerWidth < 1320 : Boolean(settings.notesCollapsed));
  const stopTimer = () => { if (examTimer) clearInterval(examTimer); examTimer = null; };
  const clearKeydown = () => { if (keydownHandler) window.removeEventListener("keydown", keydownHandler); keydownHandler = null; };
  const notesCtrl = createNotesController({ container, bankId: bank.id, bankState, getList: () => list, onJump: (idx) => { currentIndex = idx; multiDraft.clear(); renderMain(); } });
  const flushPendingNote = () => notesCtrl.flush();
  activePracticeCleanup = () => { flushPendingNote(); stopTimer(); clearKeydown(); };

  const cachedOptions = (q) => {
    const key = `${q.id}_${settings.shuffleOptions}`;
    if (!optionCache.has(key)) {
      const rawOpts = q.options || [];
      const opts = !rawOpts.length && String(q.type) === "3" ? ["正确", "错误"] : rawOpts;
      optionCache.set(key, !settings.shuffleOptions || q.type === "3" || opts.length < 2 ? opts : shuffleArray(opts));
    }
    return optionCache.get(key);
  };

  const buildList = () => {
    stopTimer(); examSession = null; multiDraft.clear(); drillRecords = {};
    listVersion += 1; sheetVersion += 1;
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
    sheetVersion += 1;
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
    for (const q of list) if (examSession.answers[q.id]?.correct) { correctCount += 1; earned += Number(examSession.scoreMap[q.id] || 0); }
    return { score: round1(earned), correctCount };
  };

  const submitExam = () => {
    if (!examSession) return;
    stopTimer(); examSession.submitted = true; sheetVersion += 1;
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
      list = picked; currentIndex = 0; listVersion += 1; sheetVersion += 1;
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
    onToggleWide: allowWide ? () => { aiWide = !aiWide; settings.asideWidth = aiWide ? 520 : 332; saveGlobalSettings(settings); container.querySelector(".practice-shell")?.style.setProperty("--aside-w", `${settings.asideWidth}px`); renderMain({ forceAi: true }); } : null,
    onAppendNote: (text) => notesCtrl.append(q.id, text),
    initialState: bankState.aiChats?.[q.id] || null,
    onHistoryChange: (st) => { bankState.aiChats = bankState.aiChats || {}; if (st) bankState.aiChats[q.id] = st; else delete bankState.aiChats[q.id]; saveBankPracticeState(bank.id, bankState); },
    autoPrompt
  });

  const activeRecordsMap = () => (examSession ? examSession.answers : (mode === "wrong" || mode === "hotWrong" ? drillRecords : bankState.records));
  const openNotesDesktop = () => { settings.notesCollapsed = false; saveGlobalSettings(settings); renderMain(); container.querySelector("#aside-note-input")?.focus(); };

  const syncNotesModalBody = () => {
    const q = list[currentIndex];
    if (!q) return;
    container.querySelector("#modal-notes-body").innerHTML = buildNotesPanelHtml(list, q, bankState, "modal-note-input");
    notesCtrl.bind(q.id, openNotesDesktop);
  };

  const clearBankList = async (field, title, message, toastMsg) => {
    if (!(await openConfirmDialog({ title, message, confirmText: "确认清空", danger: true }))) return;
    bankState[field] = []; if (field === "wrongIds") bankState.wrongStreaks = {};
    sheetVersion += 1; saveBankPracticeState(bank.id, bankState);
    if ((field === "wrongIds" && mode === "wrong") || (field === "masteredIds" && mode === "random")) buildList();
    showToast(toastMsg, "ok"); renderMain();
  };

  const bindSheetScope = (scope) => {
    if (!scope) return;
    const sheetModal = container.querySelector("#sheet-modal");
    scope.querySelectorAll("button[data-jump]").forEach((b) => b.addEventListener("click", () => {
      flushPendingNote(); currentIndex = Number(b.dataset.jump); multiDraft.clear();
      if (sheetModal) sheetModal.hidden = true;
      renderMain();
    }));
    scope.querySelector(".js-reset-progress")?.addEventListener("click", async () => {
      if (!(await openConfirmDialog({ title: "清空刷题记录", message: "确定清空本题库的刷题记录吗？清空后错题与已做统计需重新积累。", confirmText: "确认清空", danger: true }))) return;
      bankState.records = {}; bankState.lastIndex = 0; drillRecords = {}; sheetVersion += 1;
      saveBankPracticeState(bank.id, bankState); currentIndex = 0; renderMain();
    });
    scope.querySelector(".js-clear-wrong")?.addEventListener("click", () => clearBankList("wrongIds", "清空错题本", "确定清空本题库错题本标记吗？（不影响已完成记录）", "已清空错题本"));
    scope.querySelector(".js-clear-mastered")?.addEventListener("click", () => clearBankList("masteredIds", "清空已斩题", "确定恢复全部已斩题以便重新练习吗？", "已重置斩题标记"));
    scope.querySelector(".js-sw-recite")?.addEventListener("change", (e) => { settings.reciteMode = e.target.checked; saveGlobalSettings(settings); renderMain(); });
    scope.querySelector(".js-sw-auto")?.addEventListener("change", (e) => { settings.autoNext = e.target.checked; saveGlobalSettings(settings); });
    scope.querySelector(".js-sw-shuffle")?.addEventListener("change", (e) => { settings.shuffleOptions = e.target.checked; saveGlobalSettings(settings); renderMain(); });
    scope.querySelector(".js-sw-strategy")?.addEventListener("change", (e) => { settings.strategy = e.target.value; saveGlobalSettings(settings); buildList(); renderMain(); });
    scope.querySelector(".js-sw-streak")?.addEventListener("change", (e) => { settings.wrongClearStreak = Number(e.target.value || 1); saveGlobalSettings(settings); renderMain(); });
    scope.querySelector(".js-export-wrong")?.addEventListener("click", () => printQuestionsDocument(`${bank.name} - 错题本`, list, true));
  };

  const handleShellClick = (e) => {
    const q = list[currentIndex];
    if (e.target.closest("#btn-prev")) return goPrev();
    if (e.target.closest("#btn-next")) return goNext();
    const tabBtn = e.target.closest("#p-aside-tabs .js-aside-tab");
    if (tabBtn) { asideTab = tabBtn.dataset.tab; return renderMain(); }
    if (q && e.target.closest(".js-fav-btn")) {
      const set = new Set(bankState.favoriteIds || []);
      if (set.has(q.id)) set.delete(q.id); else set.add(q.id);
      bankState.favoriteIds = [...set]; saveBankPracticeState(bank.id, bankState); return renderMain();
    }
    if (e.target.closest("#btn-exit-immersive")) { settings.immersive = false; saveGlobalSettings(settings); document.body.classList.remove("immersive-mode"); return renderMain(); }
    if (e.target.closest("#btn-imm-recite")) { settings.reciteMode = !settings.reciteMode; saveGlobalSettings(settings); return renderMain(); }
    if (e.target.closest("#btn-imm-theme")) return onToggleTheme?.();
    if (e.target.closest(".js-open-sheet")) {
      const m = container.querySelector("#sheet-modal");
      const body = container.querySelector("#modal-sheet-body");
      body.innerHTML = buildSheetInnerHtml({ list, currentIndex, activeRecords: activeRecordsMap(), examSession, settings, mode, bankState });
      bindSheetScope(body);
      if (m) m.hidden = false;
    } else if (e.target.closest(".js-open-notes-modal")) {
      syncNotesModalBody();
      const m = container.querySelector("#notes-modal");
      if (m) m.hidden = false;
    } else if (q && e.target.closest(".js-open-ai-modal")) {
      const m = container.querySelector("#ai-chat-modal");
      if (m) { mountAiChatWidget(container.querySelector("#modal-ai-chat"), q, getAiOpts(q, false)); m.hidden = false; }
    }
  };

  const bindPersistentShell = () => {
    bindPaneResizers({ container, settings, onSave: (side, w) => { if (side === "notes") settings.notesWidth = w; else { settings.asideWidth = w; aiWide = w >= 460; } saveGlobalSettings(settings); } });
    const shell = container.querySelector(".practice-shell");
    shell?.addEventListener("click", (e) => { if (e.target.closest("#btn-jump-note") && (window.innerWidth <= 960 || document.body.classList.contains("immersive-mode"))) syncNotesModalBody(); }, true);
    shell?.addEventListener("click", handleShellClick);
    bindSwipeNav(container.querySelector(".question-box"), goPrev, goNext);
    container.querySelector("#sheet-modal-close")?.addEventListener("click", () => { const m = container.querySelector("#sheet-modal"); if (m) m.hidden = true; });
    container.querySelector("#ai-chat-modal-close")?.addEventListener("click", () => {
      const m = container.querySelector("#ai-chat-modal"); const root = container.querySelector("#aside-ai-chat"); const q = list[currentIndex];
      if (m) m.hidden = true;
      if (q && root && asideTab === "ai") mountAiChatWidget(root, q, getAiOpts(q, true));
    });
  };

  const bindBarEvents = () => {
    container.querySelector("#p-bank-select")?.addEventListener("change", (e) => {
      flushPendingNote(); const nextId = e.target.value;
      ctx.onSelectBank?.(nextId); renderPracticeView(container, { ...ctx, activeBankId: nextId, routeParams: { mode } });
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

  const bindAnswerActions = (q) => {
    const curSel = () => bankState.records[q.id]?.selected || ["已查看"];
    const markSubj = (ok, msg, master = false) => {
      justAnsweredQid = q.id; recordAnswer(q, curSel(), ok, false);
      if (master) {
        bankState.masteredIds = [...new Set([...(bankState.masteredIds || []), q.id])];
        bankState.wrongIds = (bankState.wrongIds || []).filter((id) => id !== q.id);
      }
      saveBankPracticeState(bank.id, bankState); showToast(msg, master ? "ok" : "");
      if (master && settings.autoNext && currentIndex < list.length - 1) goNext(); else renderMain();
    };
    container.querySelector("#btn-master")?.addEventListener("click", () => {
      const set = new Set(bankState.masteredIds || []);
      if (set.has(q.id)) set.delete(q.id); else { set.add(q.id); bankState.wrongIds = (bankState.wrongIds || []).filter((id) => id !== q.id); }
      bankState.masteredIds = [...set]; sheetVersion += 1; saveBankPracticeState(bank.id, bankState); renderMain();
    });
    container.querySelector("#btn-rm-wrong")?.addEventListener("click", () => {
      bankState.wrongIds = (bankState.wrongIds || []).filter((id) => id !== q.id); delete bankState.wrongStreaks[q.id];
      sheetVersion += 1; saveBankPracticeState(bank.id, bankState); showToast("已移出错题本", "ok");
      if (mode === "wrong") buildList(); renderMain();
    });
    container.querySelector("#btn-eval-master")?.addEventListener("click", () => markSubj(true, "已标记秒会并斩题", true));
    container.querySelector("#btn-eval-fuzzy")?.addEventListener("click", () => markSubj(true, "已记录为模糊，保留后续复习"));
    container.querySelector("#btn-eval-bad")?.addEventListener("click", () => markSubj(false, "已加入错题本"));
    container.querySelector("#btn-copy-ans")?.addEventListener("click", () => navigator.clipboard?.writeText((q.answers || []).join("\n")).then(() => showToast("已复制参考答案", "ok")).catch(() => {}));
    container.querySelector("#btn-redo-q")?.addEventListener("click", () => {
      delete drillRecords[q.id]; delete bankState.records[q.id]; multiDraft.clear(); orderDraftMap.delete(q.id); matchDraftMap.delete(q.id);
      sheetVersion += 1; saveBankPracticeState(bank.id, bankState); renderMain();
    });
    container.querySelector("#btn-ai-explain")?.addEventListener("click", () => {
      const prompt = "请详细解析这道题：说明正确答案的核心依据，逐项分析错误选项，并提炼 1-2 条记忆要点。";
      if (window.innerWidth <= 960 || settings.immersive) {
        const m = container.querySelector("#ai-chat-modal");
        if (m) { mountAiChatWidget(container.querySelector("#modal-ai-chat"), q, getAiOpts(q, false, prompt)); m.hidden = false; }
        return;
      }
      settings.asideCollapsed = false; saveGlobalSettings(settings); asideTab = "ai"; pendingAiPrompt = prompt; renderMain();
    });
  };

  const bindInputControls = (q, showAnswerNow) => {
    if (showAnswerNow) return;
    bindDragQuestionEvents({
      container, q, getOrderItems: () => getOrderItems(q), setOrderItems: (arr) => orderDraftMap.set(q.id, arr),
      getMatchState: () => getMatchState(q), onRerender: renderMain,
      onSubmit: (sel) => { justAnsweredQid = q.id; recordAnswer(q, sel, isAnswerCorrect(q, sel)); renderMain(); }
    });
    container.querySelectorAll(".option-item").forEach((optBtn) => optBtn.addEventListener("click", () => {
      const val = optBtn.dataset.opt;
      if (isMultiChoice(q)) { if (multiDraft.has(val)) multiDraft.delete(val); else multiDraft.add(val); renderMain(); return; }
      const correct = isAnswerCorrect(q, [val]); justAnsweredQid = q.id;
      recordAnswer(q, [val], correct); renderMain();
      if (correct && settings.autoNext && !examSession && currentIndex < list.length - 1) setTimeout(goNext, 420);
    }));
    container.querySelector("#btn-confirm-multi")?.addEventListener("click", () => {
      if (!multiDraft.size) return showToast("请至少选择一个选项", "bad");
      justAnsweredQid = q.id; recordAnswer(q, [...multiDraft], isAnswerCorrect(q, [...multiDraft])); multiDraft.clear(); renderMain();
    });
    container.querySelector("#btn-confirm-fill")?.addEventListener("click", () => {
      const raw = container.querySelector("#fill-input").value.trim();
      if (!raw) return showToast("请输入答案", "bad");
      const sel = raw.split("|").map((s) => s.trim()).filter(Boolean);
      justAnsweredQid = q.id; recordAnswer(q, sel, isAnswerCorrect(q, sel)); renderMain();
    });
    container.querySelector("#btn-confirm-essay")?.addEventListener("click", () => {
      const raw = container.querySelector("#essay-input").value.trim();
      justAnsweredQid = q.id; recordAnswer(q, [raw || "（已查看参考答案）"], raw ? isAnswerCorrect(q, [raw]) : true); renderMain();
    });
  };

  const updateNotesSlot = (q, wasMounted, qChanged) => {
    if (!wasMounted || lastNotesListVer !== listVersion) {
      container.querySelector("#p-notes-slot").innerHTML = buildNotesPanelHtml(list, q, bankState, "aside-note-input");
      lastNotesListVer = listVersion;
    } else if (qChanged) {
      const inputEl = container.querySelector("#aside-note-input");
      if (inputEl) inputEl.value = (bankState.notes || {})[q.id] || "";
      container.querySelectorAll(".js-note-status").forEach((el) => { el.textContent = "自动保存"; });
      notesCtrl.setQid(q.id);
    }
    notesCtrl.bind(q.id, openNotesDesktop);
  };

  const updateAsidePanel = (q, activeRecords, activeAsideTab, wasMounted, qChanged, forceAi) => {
    const bodyEl = container.querySelector("#p-aside-body");
    container.querySelectorAll("#p-aside-tabs .js-aside-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeAsideTab));
    if (activeAsideTab === "ai") {
      bodyEl.className = "aside-body-scroll is-ai-tab";
      const prompt = pendingAiPrompt; pendingAiPrompt = "";
      if (!wasMounted || qChanged || lastRenderedAsideTab !== "ai" || Boolean(prompt) || forceAi || !bodyEl.querySelector("#aside-ai-chat")) {
        bodyEl.innerHTML = '<div id="aside-ai-chat"></div>';
        mountAiChatWidget(bodyEl.querySelector("#aside-ai-chat"), q, getAiOpts(q, true, prompt));
      }
    } else {
      const sheetKey = [mode, list.length, sheetVersion, (bankState.wrongIds || []).length, (bankState.masteredIds || []).length, settings.reciteMode, settings.shuffleOptions, settings.strategy, settings.wrongClearStreak, Boolean(examSession), Boolean(examSession?.submitted), examSession && !examSession.submitted ? currentIndex : ""].join("|");
      if (wasMounted && lastRenderedAsideTab === "sheet" && sheetKey === lastSheetKey) {
        bodyEl.querySelectorAll(".sheet-cell.current").forEach((c) => c.classList.remove("current"));
        bodyEl.querySelector(`.sheet-cell[data-jump="${currentIndex}"]`)?.classList.add("current");
      } else {
        const prevScroll = wasMounted && lastRenderedAsideTab === "sheet" ? bodyEl.scrollTop : 0;
        const wasOpen = Boolean(wasMounted && lastRenderedAsideTab === "sheet" && bodyEl.querySelector(".sheet-settings")?.open);
        bodyEl.className = "aside-body-scroll";
        bodyEl.innerHTML = buildSheetInnerHtml({ list, currentIndex, activeRecords, examSession, settings, mode, bankState });
        if (wasOpen) { const det = bodyEl.querySelector(".sheet-settings"); if (det) det.open = true; }
        bodyEl.scrollTop = prevScroll;
        bindSheetScope(bodyEl);
        lastSheetKey = sheetKey;
      }
    }
    lastRenderedAsideTab = activeAsideTab;
  };

  const renderCenterQuestion = (q, wasMounted, qChanged, activeRecords, opts, showAnswerNow) => {
    const immEl = container.querySelector("#p-immbar-slot");
    if (settings.immersive) immEl.innerHTML = buildImmersiveBarHtml(bank.name, currentIndex, list.length, settings);
    else if (immEl.innerHTML) immEl.innerHTML = "";
    const examRes = examSession?.submitted ? calcExamScore() : null;
    container.querySelector("#p-examres-slot").innerHTML = buildExamBannerHtml(examRes, examSession, list.length);
    const needStreak = Math.max(1, Number(settings.wrongClearStreak || 1));
    const curStreak = Number((bankState.wrongStreaks || {})[q.id] || 0);
    const streakBadge = needStreak > 1 && (bankState.wrongIds || []).includes(q.id) ? `<span class="badge warn">巩固 ${curStreak}/${needStreak}</span>` : "";
    container.querySelector("#p-progress-fill").style.width = `${Math.round(((currentIndex + 1) / list.length) * 100)}%`;
    container.querySelector("#p-q-head").innerHTML = buildQuestionHeadHtml({ q, currentIndex, total: list.length, examSession, scoreVal: examSession ? round1(examSession.scoreMap[q.id] || 0) : 0, streakBadge, isFav: (bankState.favoriteIds || []).includes(q.id), isMastered: (bankState.masteredIds || []).includes(q.id) });
    const qBodyEl = container.querySelector("#p-q-body");
    const prevQScroll = !qChanged && wasMounted ? qBodyEl.scrollTop : 0;
    const isJustAns = justAnsweredQid === q.id; justAnsweredQid = null;
    qBodyEl.classList.toggle("is-just-answered", isJustAns);
    qBodyEl.innerHTML = buildQuestionBodyHtml({ q, opts, record: activeRecords[q.id], multiDraft, showAnswerNow, bankState, examSession, orderItems: isOrderType(q) ? getOrderItems(q) : [], matchState: isMatchType(q) ? getMatchState(q) : null });
    if (qChanged) {
      qBodyEl.scrollTop = 0;
      if (typeof qBodyEl.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        qBodyAnim?.cancel();
        qBodyAnim = qBodyEl.animate([{ opacity: 0, transform: "translate3d(0, 5px, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }], { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      }
    } else qBodyEl.scrollTop = prevQScroll;
  };

  const renderMain = (renderOpts = {}) => {
    clearKeydown();
    if (mode === "exam" && !examSession) { shellMounted = false; lastRenderedQid = null; lastRenderedAsideTab = ""; lastModeBarKey = ""; lastSheetKey = ""; return renderExamSetup(); }
    const wasMounted = shellMounted;
    if (!shellMounted) { container.innerHTML = buildPracticeShellHtml(); bindPersistentShell(); shellMounted = true; }
    const notesCollapsed = isNotesCollapsed();
    const activeAsideTab = asideTab === "ai" ? "ai" : "sheet";
    const shell = container.querySelector(".practice-shell");
    shell.classList.toggle("notes-collapsed", notesCollapsed);
    shell.classList.toggle("aside-collapsed", Boolean(settings.asideCollapsed));
    shell.classList.toggle("ai-wide", activeAsideTab === "ai" && aiWide);

    const modeBarKey = [bank.id, mode, typeFilter, chapterFilter, (bankState.wrongIds || []).length, (bankState.favoriteIds || []).length, settings.reciteMode, notesCollapsed, settings.asideCollapsed, settings.immersive, Boolean(examSession), Boolean(examSession?.submitted), sheetVersion].join("|");
    if (!wasMounted || modeBarKey !== lastModeBarKey) {
      const chapterStats = computeChapterStats(allQuestions, bankState.records || {});
      container.querySelector("#p-modebar-slot").innerHTML = buildModeBarHtml({ bank, banks, mode, bankState, typeFilter, chapterFilter, chapterStats, examSession, settings, notesCollapsed });
      bindBarEvents(); lastModeBarKey = modeBarKey;
    }

    const emptyEl = container.querySelector("#p-empty-slot"); const layoutEl = container.querySelector(".practice-layout");
    if (!list.length) {
      emptyEl.hidden = false; layoutEl.hidden = true;
      container.querySelector("#p-immbar-slot").innerHTML = ""; container.querySelector("#p-examres-slot").innerHTML = "";
      lastRenderedQid = null; return;
    }
    emptyEl.hidden = true; layoutEl.hidden = false;

    const q = list[currentIndex];
    const qChanged = q.id !== lastRenderedQid;
    const activeRecords = activeRecordsMap();
    const showAnswerNow = (!examSession && settings.reciteMode) || (examSession ? examSession.submitted : Boolean(activeRecords[q.id]));
    const opts = cachedOptions(q);
    renderCenterQuestion(q, wasMounted, qChanged, activeRecords, opts, showAnswerNow);
    container.querySelector("#btn-prev").disabled = currentIndex === 0;
    container.querySelector("#btn-next").disabled = currentIndex >= list.length - 1;
    updateNotesSlot(q, wasMounted, qChanged);
    updateAsidePanel(q, activeRecords, activeAsideTab, wasMounted, qChanged, Boolean(renderOpts.forceAi));
    lastRenderedQid = q.id;
    bindAnswerActions(q);
    bindInputControls(q, showAnswerNow);
    bindKeyboardAndTouch(q, opts, showAnswerNow);
  };

  buildList();
  renderMain();
};

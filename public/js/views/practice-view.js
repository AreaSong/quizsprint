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
  buildInteractionHtml,
  buildModeBarHtml,
  buildNotesAsideHtml,
  buildSheetInnerHtml,
  isAnswerCorrect,
  isMultiChoice
} from "./practice-templates.js";

let activePracticeCleanup = null;

const shuffleArray = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const renderPracticeView = async (container, ctx) => {
  if (activePracticeCleanup) {
    activePracticeCleanup();
    activePracticeCleanup = null;
  }
  const { activeBankId, banks, isLoggedIn, onRequireUserLogin, routeParams = {} } = ctx;
  if (!isLoggedIn) {
    container.innerHTML = `
      <div class="panel" style="max-width:520px;margin:28px auto;text-align:center;">
        <h2 style="margin-top:0;">请先登录账号</h2>
        <p class="muted-text">访客模式下仅支持浏览题库与搜题看题；登录账号后即可开启顺序/随机刷题、背题模式、笔记与模拟考试。</p>
        <button id="p-go-login" class="btn primary">立即登录</button>
      </div>
    `;
    container.querySelector("#p-go-login")?.addEventListener("click", onRequireUserLogin);
    return;
  }

  const bank = banks.find((b) => b.id === activeBankId);
  if (!bank) {
    container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”选择一个题库。</p></div>';
    return;
  }

  let allQuestions = [];
  try {
    const res = await fetchBankQuestionsSafe(bank.id);
    allQuestions = res.questions || [];
  } catch (err) {
    container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`;
    return;
  }
  if (!allQuestions.length) {
    container.innerHTML = '<div class="panel"><p class="muted-text">当前题库暂无题目，请先去“批量导题”添加试题。</p></div>';
    return;
  }

  const settings = getGlobalSettings();
  const bankState = getBankPracticeState(bank.id);
  document.body.classList.toggle("immersive-mode", Boolean(settings.immersive));
  let mode = routeParams.mode || "order";
  if (mode === "recite") {
    settings.reciteMode = true;
    saveGlobalSettings(settings);
    mode = "order";
  }

  let typeFilter = "";
  let list = [];
  let currentIndex = 0;
  let multiDraft = new Set();
  let examSession = null;
  let examTimer = null;
  let keydownHandler = null;
  const optionCache = new Map();

  const stopTimer = () => {
    if (examTimer) clearInterval(examTimer);
    examTimer = null;
  };
  const clearKeydown = () => {
    if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  };
  activePracticeCleanup = () => { stopTimer(); clearKeydown(); };

  const cachedOptions = (q) => {
    const key = `${q.id}_${settings.shuffleOptions}`;
    if (!optionCache.has(key)) {
      const opts = q.options || [];
      const next = !settings.shuffleOptions || q.type === "3" || opts.length < 2 ? opts : shuffleArray(opts);
      optionCache.set(key, next);
    }
    return optionCache.get(key);
  };

  const buildList = () => {
    stopTimer();
    examSession = null;
    multiDraft.clear();
    const mastered = new Set(bankState.masteredIds || []);
    const wrong = new Set(bankState.wrongIds || []);
    const fav = new Set(bankState.favoriteIds || []);

    if (mode === "random") list = shuffleArray(allQuestions.filter((q) => !mastered.has(q.id)));
    else if (mode === "wrong") list = allQuestions.filter((q) => wrong.has(q.id));
    else if (mode === "favorite") list = allQuestions.filter((q) => fav.has(q.id));
    else if (mode === "type") list = allQuestions.filter((q) => !typeFilter || String(q.type) === typeFilter);
    else {
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
    if (examSession) {
      examSession.answers[q.id] = { selected: selectedArr, correct };
      return;
    }
    bankState.records[q.id] = { selected: selectedArr, correct };
    const wrongSet = new Set(bankState.wrongIds || []);
    if (correct) wrongSet.delete(q.id);
    else wrongSet.add(q.id);
    bankState.wrongIds = [...wrongSet];
    bankState.lastIndex = currentIndex;
    saveBankPracticeState(bank.id, bankState, countDaily ? { answered: 1, correct: correct ? 1 : 0 } : null);
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      currentIndex -= 1;
      multiDraft.clear();
      renderMain();
    }
  };

  const goNext = () => {
    if (currentIndex < list.length - 1) {
      currentIndex += 1;
      multiDraft.clear();
      if (!examSession) {
        bankState.lastIndex = currentIndex;
        saveBankPracticeState(bank.id, bankState);
      }
      renderMain();
    }
  };

  const submitExam = () => {
    if (!examSession) return;
    stopTimer();
    examSession.submitted = true;
    const wrongSet = new Set(bankState.wrongIds || []);
    let correctCount = 0;
    for (const q of list) {
      if (examSession.answers[q.id]?.correct) correctCount += 1;
      else wrongSet.add(q.id);
    }
    bankState.wrongIds = [...wrongSet];
    saveBankPracticeState(bank.id, bankState);
    const score = Math.round((correctCount / list.length) * 100);
    showToast(`交卷完成：得分 ${score} 分（${correctCount}/${list.length}）`, score >= examSession.passScore ? "ok" : "bad");
    renderMain();
  };

  const renderExamSetup = () => {
    container.innerHTML = buildExamSetupHtml(bank.name, allQuestions.length);
    container.querySelector("#ex-cancel").addEventListener("click", () => { mode = "order"; buildList(); renderMain(); });
    container.querySelector("#exam-setup-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const count = Math.min(allQuestions.length, Math.max(1, Number(container.querySelector("#ex-count").value)));
      const mins = Math.max(1, Number(container.querySelector("#ex-mins").value));
      const passScore = Math.max(1, Number(container.querySelector("#ex-pass").value));
      list = shuffleArray(allQuestions).slice(0, count);
      currentIndex = 0;
      examSession = { answers: {}, submitted: false, passScore, remainSec: mins * 60 };
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

  const bindKeyboard = (q, opts, showAnswerNow) => {
    clearKeydown();
    const onKeyDown = (e) => {
      if (!document.body.contains(container) || (location.hash.startsWith("#") && location.hash !== "#practice")) {
        clearKeydown();
        return;
      }
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Enter" && e.target.id === "fill-input") {
          e.preventDefault();
          container.querySelector("#btn-confirm-fill")?.click();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); return; }
      if (e.key === "Enter") {
        if (!showAnswerNow && isMultiChoice(q)) {
          e.preventDefault();
          container.querySelector("#btn-confirm-multi")?.click();
        } else if (showAnswerNow) {
          e.preventDefault();
          goNext();
        }
        return;
      }
      if (!showAnswerNow && opts.length) {
        const upper = e.key.toUpperCase();
        const letterIdx = LETTERS.indexOf(upper);
        const numIdx = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
        const targetIdx = letterIdx >= 0 && letterIdx < opts.length ? letterIdx : (numIdx >= 0 && numIdx < opts.length ? numIdx : -1);
        if (targetIdx >= 0) {
          e.preventDefault();
          container.querySelectorAll(".option-item")[targetIdx]?.click();
        }
      }
    };
    keydownHandler = onKeyDown;
    window.addEventListener("keydown", onKeyDown);
  };

  const bindMainEvents = (q, opts, showAnswerNow) => {
    container.querySelector("#btn-prev")?.addEventListener("click", goPrev);
    container.querySelector("#btn-next")?.addEventListener("click", goNext);

    container.querySelector("#btn-fav")?.addEventListener("click", () => {
      const set = new Set(bankState.favoriteIds || []);
      if (set.has(q.id)) set.delete(q.id); else set.add(q.id);
      bankState.favoriteIds = [...set];
      saveBankPracticeState(bank.id, bankState);
      renderMain();
    });

    container.querySelector("#btn-master")?.addEventListener("click", () => {
      const set = new Set(bankState.masteredIds || []);
      if (set.has(q.id)) set.delete(q.id);
      else {
        set.add(q.id);
        bankState.wrongIds = (bankState.wrongIds || []).filter((id) => id !== q.id);
      }
      bankState.masteredIds = [...set];
      saveBankPracticeState(bank.id, bankState);
      renderMain();
    });

    const saveNote = (val) => {
      bankState.notes = bankState.notes || {};
      bankState.notes[q.id] = String(val || "").trim();
      saveBankPracticeState(bank.id, bankState);
      showToast("笔记已保存", "ok");
    };
    container.querySelector("#q-note-input")?.addEventListener("change", (e) => {
      saveNote(e.target.value);
      const aside = container.querySelector("#aside-note-input");
      if (aside) aside.value = e.target.value;
    });
    container.querySelector("#aside-note-input")?.addEventListener("change", (e) => { saveNote(e.target.value); renderMain(); });

    container.querySelector("#btn-eval-ok")?.addEventListener("click", () => {
      const cur = bankState.records[q.id]?.selected || ["已作答"];
      recordAnswer(q, cur, true, false);
      renderMain();
    });
    container.querySelector("#btn-eval-bad")?.addEventListener("click", () => {
      const cur = bankState.records[q.id]?.selected || ["已作答"];
      recordAnswer(q, cur, false, false);
      renderMain();
    });

    container.querySelector("#btn-toggle-immersive")?.addEventListener("click", () => {
      settings.immersive = !settings.immersive;
      saveGlobalSettings(settings);
      document.body.classList.toggle("immersive-mode", settings.immersive);
      renderMain();
    });
    container.querySelector("#btn-exit-immersive")?.addEventListener("click", () => {
      settings.immersive = false;
      saveGlobalSettings(settings);
      document.body.classList.remove("immersive-mode");
      renderMain();
    });
    container.querySelector("#btn-imm-recite")?.addEventListener("click", () => { settings.reciteMode = !settings.reciteMode; saveGlobalSettings(settings); renderMain(); });
    container.querySelector("#btn-imm-eye")?.addEventListener("click", () => {
      settings.eyeCare = !settings.eyeCare;
      saveGlobalSettings(settings);
      document.body.classList.toggle("eye-care", settings.eyeCare);
      renderMain();
    });

    const aiModal = container.querySelector("#ai-chat-modal");
    const asideAiRoot = container.querySelector("#aside-ai-chat");
    const modalAiRoot = container.querySelector("#modal-ai-chat");
    mountAiChatWidget(asideAiRoot, q);
    container.querySelectorAll(".js-open-ai-modal").forEach((btn) => {
      btn.addEventListener("click", () => { if (aiModal) { mountAiChatWidget(modalAiRoot, q); aiModal.hidden = false; } });
    });
    container.querySelector("#ai-chat-modal-close")?.addEventListener("click", () => { if (aiModal) aiModal.hidden = true; mountAiChatWidget(asideAiRoot, q); });

    const sheetModal = container.querySelector("#sheet-modal");
    container.querySelectorAll(".js-open-sheet").forEach((b) => b.addEventListener("click", () => { if (sheetModal) sheetModal.hidden = false; }));
    container.querySelector("#sheet-modal-close")?.addEventListener("click", () => { if (sheetModal) sheetModal.hidden = true; });
    container.querySelectorAll("button[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => { currentIndex = Number(btn.dataset.jump); multiDraft.clear(); if (sheetModal) sheetModal.hidden = true; renderMain(); });
    });
    container.querySelectorAll(".js-reset-progress").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("确定清空本题库的刷题记录吗？")) return;
        bankState.records = {};
        bankState.lastIndex = 0;
        saveBankPracticeState(bank.id, bankState);
        currentIndex = 0;
        renderMain();
      });
    });

    container.querySelectorAll(".js-sw-recite").forEach((el) => el.addEventListener("change", (e) => { settings.reciteMode = e.target.checked; saveGlobalSettings(settings); renderMain(); }));
    container.querySelectorAll(".js-sw-auto").forEach((el) => el.addEventListener("change", (e) => { settings.autoNext = e.target.checked; saveGlobalSettings(settings); }));
    container.querySelectorAll(".js-sw-shuffle").forEach((el) => el.addEventListener("change", (e) => { settings.shuffleOptions = e.target.checked; saveGlobalSettings(settings); renderMain(); }));
    container.querySelectorAll(".js-sw-strategy").forEach((el) => el.addEventListener("change", (e) => { settings.strategy = e.target.value; saveGlobalSettings(settings); buildList(); renderMain(); }));
    container.querySelectorAll(".js-export-wrong").forEach((el) => el.addEventListener("click", () => printQuestionsDocument(`${bank.name} - 错题本`, list, true)));

    container.querySelector("#btn-ai-explain")?.addEventListener("click", async () => {
      const box = container.querySelector("#ai-explain-box");
      if (!box) return;
      box.hidden = false;
      box.textContent = "AI 正在生成深度解析...";
      try {
        const res = await aiRequest("/api/ai/explain", { question: q });
        box.textContent = res.explanation;
      } catch (err) {
        box.textContent = err.message;
      }
    });

    if (!showAnswerNow) {
      container.querySelectorAll(".option-item").forEach((optBtn) => {
        optBtn.addEventListener("click", () => {
          const val = optBtn.dataset.opt;
          if (isMultiChoice(q)) {
            if (multiDraft.has(val)) multiDraft.delete(val); else multiDraft.add(val);
            renderMain();
          } else {
            const correct = isAnswerCorrect(q, [val]);
            recordAnswer(q, [val], correct);
            renderMain();
            if (correct && settings.autoNext && !examSession && currentIndex < list.length - 1) setTimeout(goNext, 420);
          }
        });
      });

      container.querySelector("#btn-confirm-multi")?.addEventListener("click", () => {
        if (!multiDraft.size) return showToast("请至少选择一个选项", "bad");
        const selected = [...multiDraft];
        recordAnswer(q, selected, isAnswerCorrect(q, selected));
        multiDraft.clear();
        renderMain();
      });

      container.querySelector("#btn-confirm-fill")?.addEventListener("click", () => {
        const raw = container.querySelector("#fill-input").value.trim();
        if (!raw) return showToast("请输入答案", "bad");
        const selected = raw.split("|").map((s) => s.trim()).filter(Boolean);
        recordAnswer(q, selected, isAnswerCorrect(q, selected));
        renderMain();
      });

      container.querySelector("#btn-confirm-essay")?.addEventListener("click", () => {
        const raw = container.querySelector("#essay-input").value.trim();
        const selected = [raw || "（已查看参考答案）"];
        const exact = raw ? isAnswerCorrect(q, [raw]) : true;
        recordAnswer(q, selected, exact);
        renderMain();
      });
    }
    bindKeyboard(q, opts, showAnswerNow);
  };

  const renderMain = () => {
    clearKeydown();
    if (mode === "exam" && !examSession) return renderExamSetup();
    const modeBar = buildModeBarHtml({ bank, mode, bankState, typeFilter, examSession, settings });
    const bindBar = () => {
      container.querySelectorAll("button[data-mode]").forEach((btn) => btn.addEventListener("click", () => { mode = btn.dataset.mode; buildList(); renderMain(); }));
      container.querySelector("#p-type-filter")?.addEventListener("change", (e) => { typeFilter = e.target.value; buildList(); renderMain(); });
      container.querySelector("#btn-submit-exam")?.addEventListener("click", submitExam);
    };

    if (!list.length) {
      container.innerHTML = `${modeBar}<div class="panel"><p class="muted-text">当前模式下暂无题目（比如错题本/收藏夹为空）。</p></div>`;
      bindBar();
      return;
    }

    const q = list[currentIndex];
    const activeRecords = examSession ? examSession.answers : bankState.records;
    const record = activeRecords[q.id];
    const showAnswerNow = (!examSession && settings.reciteMode) || (examSession ? examSession.submitted : Boolean(record));
    const opts = cachedOptions(q);
    const isFav = (bankState.favoriteIds || []).includes(q.id);
    const isMastered = (bankState.masteredIds || []).includes(q.id);
    const correctCount = list.filter((item) => activeRecords[item.id]?.correct === true).length;
    const sheetInnerHtml = buildSheetInnerHtml({ list, currentIndex, activeRecords, examSession, settings, mode });

    container.innerHTML = `
      ${modeBar}
      <div class="immersive-bar">
        <div class="row-gap">
          <button id="btn-exit-immersive" class="btn ghost tiny">← 退出沉浸</button>
          <strong>${escapeHtml(bank.name)}</strong>
          <span class="muted-text">${currentIndex + 1} / ${list.length}</span>
        </div>
        <div class="row-gap">
          <button id="btn-imm-recite" class="btn tiny ${settings.reciteMode ? "primary" : "ghost"}">背题</button>
          <button id="btn-imm-eye" class="btn tiny ${settings.eyeCare ? "ok" : "ghost"}">护眼</button>
          <button class="btn primary tiny js-open-ai-modal">问 AI</button>
          <button class="btn ghost tiny js-open-sheet">答题卡</button>
        </div>
      </div>
      ${examSession?.submitted ? `<div class="answer-box" style="margin-bottom:14px;border-color:var(--accent);"><strong>模拟考试成绩：${Math.round((correctCount / list.length) * 100)} 分</strong>（答对 ${correctCount} / ${list.length}，及格线 ${examSession.passScore} 分）</div>` : ""}
      <div class="practice-layout">
        ${buildNotesAsideHtml(list, q, bankState)}
        <section class="question-box">
          <div class="row-gap" style="justify-content:space-between;">
            <div class="row-gap">
              <span class="badge">${TYPE_LABELS[q.type] || "其他"}</span>
              ${q.chapter ? `<span class="badge warn">${escapeHtml(q.chapter)}</span>` : ""}
              <span class="muted-text">第 ${currentIndex + 1} / ${list.length} 题</span>
            </div>
            <div class="row-gap">
              <button class="btn primary tiny js-open-ai-modal">问 AI</button>
              <button id="btn-fav" class="btn tiny ${isFav ? "primary" : "ghost"}">${isFav ? "★ 已收藏" : "☆ 收藏"}</button>
              <button id="btn-master" class="btn tiny ${isMastered ? "ok" : "ghost"}">${isMastered ? "✓ 已斩题" : "斩题"}</button>
            </div>
          </div>
          <div class="q-title">${escapeHtml(q.title)}</div>
          ${(q.images || []).length ? `<div class="row-gap" style="margin-bottom:12px;">${q.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid var(--line);">`).join("")}</div>` : ""}
          ${buildInteractionHtml({ q, opts, record, multiDraft, showAnswerNow, examSession })}
          ${buildAnswerPanelHtml({ q, record, showAnswerNow, bankState, examSession })}
          <div class="row-gap practice-nav-footer" style="justify-content:space-between;margin-top:18px;padding-top:14px;border-top:1px solid var(--line);">
            <button id="btn-prev" class="btn ghost" ${currentIndex === 0 ? "disabled" : ""}>上一题</button>
            <span class="muted-text" style="font-size:12px;">快捷键：A-F/1-6 选 · Enter 确认 · ←/→ 切题</span>
            <button class="btn ghost mobile-sheet-trigger js-open-sheet">答题卡 (${currentIndex + 1}/${list.length})</button>
            <button id="btn-next" class="btn primary" ${currentIndex >= list.length - 1 ? "disabled" : ""}>下一题</button>
          </div>
        </section>
        <aside class="practice-aside" style="display:flex;flex-direction:column;gap:14px;">
          <div class="panel">${sheetInnerHtml}</div>
          <div id="aside-ai-chat" class="panel"></div>
        </aside>
      </div>
      <div id="sheet-modal" class="modal-backdrop" hidden>
        <div class="modal-card"><div class="modal-head"><h3>答题卡与设置</h3><button id="sheet-modal-close" class="btn ghost tiny">关闭</button></div>${sheetInnerHtml}</div>
      </div>
      <div id="ai-chat-modal" class="modal-backdrop" hidden>
        <div class="modal-card" style="max-width:520px;"><div class="modal-head"><h3>AI 题伴助教</h3><button id="ai-chat-modal-close" class="btn ghost tiny">关闭</button></div><div id="modal-ai-chat"></div></div>
      </div>
    `;

    bindBar();
    bindMainEvents(q, opts, showAnswerNow);
  };

  buildList();
  renderMain();
};

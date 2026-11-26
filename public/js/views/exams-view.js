import { apiRequest, escapeHtml, getCloudUser, LETTERS, showToast, TYPE_LABELS } from "../api.js";
import { openFormDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import { openCreateExamModal, openEditExamModal, openMySubmissionsModal, openSubmissionsModal } from "./exam-modals.js";

let activeExamCleanup = null;

const getExamDraftKey = (examId) => `quizsprint_exam_draft_${examId}_${getCloudUser()?.id || "anon"}`;

const loadExamDraft = (examId) => {
  try {
    const raw = localStorage.getItem(getExamDraftKey(examId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveExamDraft = (examId, draft) => {
  try { localStorage.setItem(getExamDraftKey(examId), JSON.stringify(draft)); } catch { /* ignore */ }
};

const clearExamDraft = (examId) => {
  try { localStorage.removeItem(getExamDraftKey(examId)); } catch { /* ignore */ }
};

const restoreExamInputs = (container, questions, answers) => {
  for (const q of questions) {
    const saved = answers[q.id];
    if (!Array.isArray(saved) || !saved.length) continue;
    const card = container.querySelector(`[data-qid="${CSS.escape(q.id)}"]`);
    if (!card) continue;
    if (q.options?.length) {
      const picked = new Set(saved);
      card.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((inp) => {
        inp.checked = picked.has(inp.value);
      });
    } else {
      const fill = card.querySelector(".er-fill");
      if (fill) fill.value = saved.join(" | ");
    }
  }
};

const getExamStatus = (ex) => {
  const now = Date.now();
  const start = ex.startTime ? Date.parse(ex.startTime) : NaN;
  const end = ex.endTime ? Date.parse(ex.endTime) : NaN;
  if (!Number.isNaN(start) && now < start) return { label: "未开始", cls: "warn" };
  if (!Number.isNaN(end) && now > end) return { label: "已结束", cls: "bad" };
  return { label: "进行中", cls: "ok" };
};

const renderExamCardHtml = (ex, isAdmin) => {
  const st = getExamStatus(ex);
  const locked = ex.hasAccessCode ?? Boolean(ex.accessCode);
  return `
    <div class="bank-card" data-eid="${escapeHtml(ex.id)}">
      <div>
        <div class="row-gap" style="justify-content:space-between;align-items:flex-start;">
          <h3 style="margin:0;display:flex;align-items:center;gap:6px;">${locked ? `<span style="display:inline-flex;color:var(--warn);" title="密码考试">${iconSvg("lock", 14)}</span>` : ""}${escapeHtml(ex.title)}</h3>
          <span class="badge ${st.cls}">${st.label}</span>
        </div>
        <p class="muted-text" style="margin:8px 0;">来源：${escapeHtml(ex.bankName)} · ${ex.questionCount} 题 / ${ex.durationMinutes} 分钟 · 满分 ${ex.totalScore || 100}（及格 ${ex.passScore}）· 已交卷 ${ex.submissionCount} 人</p>
        <div class="row-gap">
          ${ex.disableCopy ? '<span class="badge warn">禁复制</span>' : ""}
          <span class="badge">限切屏 ${ex.maxTabSwitches} 次</span>
          ${ex.maxAttempts > 0 ? `<span class="badge warn">限考 ${ex.maxAttempts} 次</span>` : ""}
          ${ex.startTime || ex.endTime ? '<span class="badge">限时窗口</span>' : ""}
        </div>
      </div>
      <div class="row-gap">
        <button class="btn primary tiny" data-act="enter">进入考场</button>
        <button class="btn ghost tiny" data-act="copy">复制链接</button>
        ${isAdmin ? `
          <button class="btn ghost tiny" data-act="edit">编辑</button>
          <button class="btn ghost tiny" data-act="subs">成绩单/阅卷</button>
          <button class="btn danger tiny" data-act="del">删除</button>
        ` : ""}
      </div>
    </div>
  `;
};

const renderEmptyExamsHtml = (isAdmin) => `
  <div class="empty-state">
    <div class="empty-state-icon">${iconSvg("clock", 22)}</div>
    <strong style="font-size:15px;">暂无在线考试</strong>
    <p class="muted-text" style="margin:0;">管理员可发起在线考试，支持按题型配分、限时窗口、防切屏与简答题人工阅卷。</p>
    ${isAdmin ? '<button type="button" id="ex-empty-create" class="btn primary tiny" style="margin-top:4px;">+ 发起新考试</button>' : ""}
  </div>
`;

export const renderExamsView = async (container, ctx) => {
  if (activeExamCleanup) {
    activeExamCleanup();
    activeExamCleanup = null;
  }
  const { banks, activeBankId, isAdmin, isLoggedIn, routeParams = {}, onRequireLogin, onRequireUserLogin } = ctx;

  if (routeParams.examId) {
    if (!isLoggedIn) {
      container.innerHTML = `
        <div class="panel" style="max-width:500px;margin:28px auto;text-align:center;">
          <h2 style="margin-top:0;">请先登录账号</h2>
          <p class="muted-text">参加在线考试需要登录后记录成绩与防作弊状态。</p>
          <button id="ex-go-login" class="btn primary">立即登录</button>
        </div>
      `;
      container.querySelector("#ex-go-login")?.addEventListener("click", onRequireUserLogin);
      return;
    }
    return renderExamRoom(container, routeParams.examId, "", ctx);
  }
  ctx.setFocusMode?.(false);

  let exams = [];
  try {
    const res = await apiRequest("/api/exams");
    exams = res.exams || [];
  } catch (err) {
    showToast(err.message, "bad");
  }

  container.innerHTML = `
    <div class="panel view-frame">
      <div class="view-head">
        <div class="row-gap" style="justify-content:space-between;">
          <div>
            <h2 style="margin:0;">在线考试中心</h2>
            <span class="muted-text">按题型抽题或固定组卷 · 时间窗与限考管控 · 防切屏与人工阅卷</span>
          </div>
          <div class="row-gap">
            <button id="ex-my-subs-btn" class="btn ghost">${iconSvg("list", 15)}<span>我的成绩单</span></button>
            <button id="ex-create-btn" class="btn primary">${isAdmin ? "+ 发起新考试" : "管理员发考"}</button>
          </div>
        </div>
      </div>
      <div class="view-scroll" style="margin-top:14px;">
        ${exams.length ? `<div class="cards-grid">${exams.map((ex) => renderExamCardHtml(ex, isAdmin)).join("")}</div>` : renderEmptyExamsHtml(isAdmin)}
      </div>
    </div>
    <div id="ex-modal" class="modal-backdrop" hidden></div>
  `;

  const modal = container.querySelector("#ex-modal");
  container.querySelector("#ex-empty-create")?.addEventListener("click", () => container.querySelector("#ex-create-btn")?.click());

  if (routeParams.openMySubs && isLoggedIn) {
    openMySubmissionsModal(modal).catch((err) => showToast(err.message, "bad"));
  }

  container.querySelector("#ex-my-subs-btn").addEventListener("click", async () => {
    if (!isLoggedIn) {
      showToast("请先登录账号后再查看个人成绩单", "bad");
      return onRequireUserLogin();
    }
    try { await openMySubmissionsModal(modal); } catch (err) { showToast(err.message, "bad"); }
  });

  container.querySelector("#ex-create-btn").addEventListener("click", () => {
    if (!isAdmin) return onRequireLogin();
    if (!banks.length) return showToast("请先创建题库", "bad");
    openCreateExamModal(modal, {
      banks,
      activeBankId,
      onCreated: () => renderExamsView(container, ctx)
    });
  });

  container.querySelectorAll(".bank-card").forEach((card) => {
    const eid = card.dataset.eid;
    const ex = exams.find((x) => x.id === eid);
    card.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "enter") {
        if (!isLoggedIn) {
          showToast("请先登录账号后再进入考场", "bad");
          return onRequireUserLogin();
        }
        return renderExamRoom(container, eid, "", ctx);
      }
      if (act === "copy") {
        const link = `${location.origin}/#exam=${eid}`;
        navigator.clipboard?.writeText(link).catch(() => {});
        showToast(`已复制考场链接：${link}`, "ok");
        return;
      }
      if (act === "del") {
        if (!confirm("确定删除该考试吗？")) return;
        try {
          await apiRequest(`/api/exams/${encodeURIComponent(eid)}`, { method: "DELETE" });
          showToast("已删除", "ok");
          renderExamsView(container, ctx);
        } catch (err) {
          showToast(err.message, "bad");
        }
        return;
      }
      if (act === "edit" && ex) {
        return openEditExamModal(modal, { exam: ex, onUpdated: () => renderExamsView(container, ctx) });
      }
      if (act === "subs") {
        try {
          await openSubmissionsModal(modal, { exam: ex });
        } catch (err) {
          showToast(err.message, "bad");
        }
      }
    });
  });
};

const renderExamRoom = async (container, examId, code = "", ctx = {}) => {
  let exam;
  try {
    const res = await apiRequest(`/api/exams/${encodeURIComponent(examId)}?code=${encodeURIComponent(code)}`);
    exam = res.exam;
  } catch (err) {
    if (err.status === 403 && err.data?.needCode) {
      const form = await openFormDialog({
        title: `进入考场：${err.data.title || ""}`,
        description: "本场考试已加密，请输入考场密码：",
        fields: [{ name: "code", label: "考试密码", type: "password", required: true }],
        submitText: "进入考场"
      });
      if (!form) return;
      return renderExamRoom(container, examId, form.code, ctx);
    }
    container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`;
    return;
  }
  ctx.setFocusMode?.(true, exam.title || "在线考场", "exams");

  const draft = loadExamDraft(examId);
  if (draft && draft.endAt > Date.now() && draft.studentName) {
    showToast("已自动恢复上次未交卷作答草稿", "ok");
    return startExamSession(container, exam, {
      studentName: draft.studentName,
      studentNo: draft.studentNo || ""
    }, draft, () => renderExamsView(container, { ...ctx, routeParams: {} }));
  }
  if (draft) clearExamDraft(examId);

  container.innerHTML = `
    <div class="view-scroll">
      <div class="panel" style="max-width:480px;margin:20px auto;">
        <h2 style="margin-top:0;">${escapeHtml(exam.title)}</h2>
        <p class="muted-text">题数：${exam.questionsSnapshot.length} 题 · 满分：${exam.totalScore || 100} 分 · 及格：${exam.passScore} 分 · 时长：${exam.durationMinutes} 分钟 · 最多切屏 ${exam.maxTabSwitches} 次</p>
        <form id="join-exam-form" class="stack-form">
          <label><span>考生姓名</span><input id="stu-name" required placeholder="请输入真实姓名"></label>
          <label><span>学号/工号（可选）</span><input id="stu-no" placeholder="可选"></label>
          <button type="submit" class="btn primary">开始答题</button>
        </form>
      </div>
    </div>
  `;

  container.querySelector("#join-exam-form").addEventListener("submit", (e) => {
    e.preventDefault();
    startExamSession(container, exam, {
      studentName: container.querySelector("#stu-name").value.trim(),
      studentNo: container.querySelector("#stu-no").value.trim()
    }, null, () => renderExamsView(container, { ...ctx, routeParams: {} }));
  });
};

const startExamSession = (container, exam, student, restoredDraft = null, onBackExams = null) => {
  const questions = exam.questionsSnapshot || [];
  const answers = restoredDraft?.answers && typeof restoredDraft.answers === "object" ? { ...restoredDraft.answers } : {};
  const fallbackScore = questions.length ? Math.round(((exam.totalScore || 100) / questions.length) * 10) / 10 : 0;
  let tabSwitches = Number(restoredDraft?.tabSwitches || 0);
  let finished = false;
  const startTime = Number(restoredDraft?.startTime || Date.now());
  const endAt = Number(restoredDraft?.endAt || (startTime + exam.durationMinutes * 60000));
  const calcRemainSec = () => Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  let remainSec = calcRemainSec();

  const persistDraft = () => {
    if (!finished) saveExamDraft(exam.id, { ...student, answers, tabSwitches, startTime, endAt });
  };
  persistDraft();

  const submitNow = async () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
    try {
      const res = await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submit`, {
        method: "POST",
        body: JSON.stringify({
          ...student,
          answers,
          tabSwitches,
          usedSeconds: Math.round((Date.now() - startTime) / 1000)
        })
      });
      clearExamDraft(exam.id);
      const sub = res.submission;
      container.innerHTML = `
        <div class="view-scroll">
          <div class="panel" style="max-width:720px;margin:0 auto;">
            <div class="row-gap" style="justify-content:space-between;margin-bottom:10px;">
              <h2 style="margin:0;">交卷成功 · ${escapeHtml(exam.title)}</h2>
              <button type="button" id="er-back-exams" class="btn ghost tiny">返回考试中心</button>
            </div>
            <div class="row-gap" style="margin-bottom:14px;">
              <span class="badge ${sub.passed ? "ok" : "bad"}" style="font-size:16px;">得分：${sub.score} / ${exam.totalScore || 100} 分（${sub.passed ? "及格" : "不及格"}）</span>
              <span class="badge">答对 ${sub.correctCount} / ${sub.totalCount}</span>
              <span class="badge warn">切屏 ${sub.tabSwitches} 次</span>
              ${sub.manualGraded ? "" : '<span class="badge warn">含主观题，待管理员最终阅卷核分</span>'}
            </div>
            ${sub.details.map((d, i) => `
              <div class="panel" style="padding:10px;margin-bottom:8px;">
                <div class="row-gap" style="justify-content:space-between;">
                  <strong>${i + 1}. ${escapeHtml(d.title)}</strong>
                  <span><span class="badge">${d.earnedScore ?? 0} / ${d.maxScore ?? fallbackScore} 分</span> <span class="badge ${d.correct ? "ok" : "bad"}">${d.correct ? "正确" : (d.needManual ? "待阅卷" : "错误")}</span></span>
                </div>
                ${(d.images || []).length ? `<div class="row-gap" style="margin:6px 0;">${d.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;border:1px solid var(--line);">`).join("")}</div>` : ""}
                <div class="muted-text">你的答案：${escapeHtml((d.selected || []).join(" | ") || "未答")}${d.answerHidden ? " · 管理员设置交卷后暂不公开参考答案" : ` · 正确答案：${escapeHtml((d.expected || []).join(" | "))}`}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
      container.querySelector("#er-back-exams")?.addEventListener("click", () => onBackExams?.());
    } catch (err) {
      finished = false;
      persistDraft();
      showToast(err.message, "bad");
    }
  };

  let timer = null;
  const cleanupSession = () => {
    finished = true;
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
  const onVis = () => {
    if (!container.querySelector("#er-submit")) return cleanupSession();
    if (document.hidden && !finished) {
      tabSwitches += 1;
      persistDraft();
      showToast(`警告：检测到切屏 (${tabSwitches}/${exam.maxTabSwitches})`, "bad");
      if (exam.maxTabSwitches > 0 && tabSwitches > exam.maxTabSwitches) {
        showToast("切屏次数超限，系统自动交卷！", "bad");
        submitNow();
      }
    }
  };
  document.addEventListener("visibilitychange", onVis);
  activeExamCleanup = cleanupSession;

  const updateClock = () => {
    remainSec = calcRemainSec();
    const el = container.querySelector("#er-clock");
    if (el) el.textContent = `${String(Math.floor(remainSec / 60)).padStart(2, "0")}:${String(remainSec % 60).padStart(2, "0")}`;
    return remainSec;
  };
  timer = setInterval(() => {
    if (finished || !container.querySelector("#er-submit")) return cleanupSession();
    if (updateClock() <= 0) submitNow();
  }, 1000);

  container.innerHTML = `
    <div class="panel view-frame exam-room-frame" style="${exam.disableCopy ? "user-select:none;" : ""}">
      <div class="row-gap view-head" style="justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--line);">
        <div><strong>${escapeHtml(exam.title)}</strong> · ${escapeHtml(student.studentName)}</div>
        <div class="row-gap">
          <span class="badge warn">剩余 <span id="er-clock">${exam.durationMinutes}:00</span></span>
          <button id="er-submit" class="btn primary tiny">交卷</button>
        </div>
      </div>
      <div class="view-scroll" style="margin-top:14px;display:flex;flex-direction:column;gap:16px;padding-right:4px;">
        ${questions.map((q, idx) => `
          <div class="panel" data-qid="${escapeHtml(q.id)}">
            <div><span class="type-pill" data-qtype="${escapeHtml(q.type)}">${TYPE_LABELS[q.type] || "其他"}</span> <span class="badge ok">${exam.questionScores?.[q.id] ?? fallbackScore} 分</span> <strong>${idx + 1}. ${escapeHtml(q.title)}</strong></div>
            ${(q.images || []).length ? `<div class="row-gap" style="margin-top:8px;">${q.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:100%;max-height:220px;border-radius:6px;border:1px solid var(--line);">`).join("")}</div>` : ""}
            ${q.options?.length ? `
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
                ${q.options.map((opt, oi) => `
                  <label class="row-gap" style="cursor:pointer;">
                    <input type="${q.type === "1" || q.type === "5" ? "checkbox" : "radio"}" name="q_${escapeHtml(q.id)}" value="${escapeHtml(opt)}">
                    <span>${LETTERS[oi] || oi + 1}. ${escapeHtml(opt)}</span>
                  </label>
                `).join("")}
              </div>
            ` : ((q.type === "4" || q.type === "6" || q.type === "7" || q.type === "8")
              ? `<textarea class="er-fill ${q.type === "7" || q.type === "8" ? "er-lines" : ""}" rows="4" placeholder="${q.type === "7" ? "每行输入一个正确顺序步骤..." : (q.type === "8" ? "每行输入一条配对（格式：左侧 => 右侧）..." : "请输入作答步骤 / 代码 / 简答内容...")}" style="width:100%;margin-top:8px;"></textarea>`
              : `<input class="er-fill" type="text" placeholder="请输入答案（多空用 | 分隔）" style="width:100%;margin-top:8px;">`)}
          </div>
        `).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const qid = inp.closest("[data-qid]").dataset.qid;
      answers[qid] = [...container.querySelectorAll(`[data-qid="${CSS.escape(qid)}"] input:checked`)].map((i) => i.value);
      persistDraft();
    });
  });
  container.querySelectorAll(".er-fill").forEach((inp) => {
    inp.addEventListener("input", () => {
      const qid = inp.closest("[data-qid]").dataset.qid;
      const sep = inp.classList.contains("er-lines") ? /\r?\n/ : "|";
      answers[qid] = inp.tagName === "TEXTAREA" && !inp.classList.contains("er-lines")
        ? (inp.value.trim() ? [inp.value.trim()] : [])
        : inp.value.split(sep).map((s) => s.trim()).filter(Boolean);
      persistDraft();
    });
  });
  restoreExamInputs(container, questions, answers);
  updateClock();
  container.querySelector("#er-submit").addEventListener("click", () => {
    if (confirm("确认交卷吗？")) submitNow();
  });
};

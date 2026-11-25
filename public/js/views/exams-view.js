import { apiRequest, escapeHtml, LETTERS, showToast, TYPE_LABELS } from "../api.js";

const exportSubmissionsCsv = (examTitle, subs) => {
  const header = ["姓名", "学号", "得分", "是否及格", "答对题数", "总题数", "切屏次数", "用时(秒)", "交卷时间"];
  const rows = subs.map((s) => [
    s.studentName,
    s.studentNo,
    s.score,
    s.passed ? "及格" : "不及格",
    s.correctCount,
    s.totalCount,
    s.tabSwitches,
    s.usedSeconds,
    s.submittedAt
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${examTitle}-成绩单.csv`;
  a.click();
};

let activeExamCleanup = null;

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
    return renderExamRoom(container, routeParams.examId);
  }

  let exams = [];
  try {
    const res = await apiRequest("/api/exams");
    exams = res.exams || [];
  } catch (err) {
    showToast(err.message, "bad");
  }

  container.innerHTML = `
    <div class="panel">
      <div class="row-gap" style="justify-content:space-between;">
        <div>
          <h2 style="margin:0;">在线考试中心（发卷与防作弊）</h2>
          <span class="muted-text">支持密码发考、防切屏检测、禁复制、多选漏选得分及成绩单导出</span>
        </div>
        <button id="ex-create-btn" class="btn primary">${isAdmin ? "+ 发起新考试" : "管理员发考"}</button>
      </div>
      <div class="cards-grid">
        ${exams.map((ex) => `
          <div class="bank-card" data-eid="${escapeHtml(ex.id)}">
            <div>
              <div class="row-gap" style="justify-content:space-between;">
                <h3>${(ex.hasAccessCode ?? Boolean(ex.accessCode)) ? "🔒 " : ""}${escapeHtml(ex.title)}</h3>
                <span class="badge">${ex.questionCount} 题 · ${ex.durationMinutes} 分钟</span>
              </div>
              <p class="muted-text" style="margin:6px 0;">来源：${escapeHtml(ex.bankName)} · 及格 ${ex.passScore} 分 · 已交卷 ${ex.submissionCount} 人</p>
              <div class="row-gap">
                ${ex.disableCopy ? '<span class="badge warn">禁复制</span>' : ""}
                <span class="badge">限切屏 ${ex.maxTabSwitches} 次</span>
              </div>
            </div>
            <div class="row-gap">
              <button class="btn primary tiny" data-act="enter">进入考场</button>
              <button class="btn ghost tiny" data-act="copy">复制链接</button>
              ${isAdmin ? `
                <button class="btn ghost tiny" data-act="subs">成绩单</button>
                <button class="btn danger tiny" data-act="del">删除</button>
              ` : ""}
            </div>
          </div>
        `).join("") || '<p class="muted-text">暂无在线考试，管理员可点击右上角发起考试。</p>'}
      </div>
    </div>
    <div id="ex-modal" class="modal-backdrop" hidden></div>
  `;

  const modal = container.querySelector("#ex-modal");

  container.querySelector("#ex-create-btn").addEventListener("click", () => {
    if (!isAdmin) return onRequireLogin();
    if (!banks.length) return showToast("请先创建题库", "bad");
    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal-card" style="max-width:520px;">
        <div class="modal-head"><h3>发起在线考试</h3><button id="ex-m-close" class="btn ghost tiny">关闭</button></div>
        <form id="ex-m-form" class="stack-form">
          <label><span>考试名称</span><input id="ex-title" required placeholder="如：2026 期中摸底测试"></label>
          <label><span>选择题库</span>
            <select id="ex-bank">${banks.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === activeBankId ? "selected" : ""}>${escapeHtml(b.name)} (${b.questionCount})</option>`).join("")}</select>
          </label>
          <div class="row-gap">
            <label style="flex:1;"><span>抽题数</span><input id="ex-cnt" type="number" min="1" value="20"></label>
            <label style="flex:1;"><span>时长(分钟)</span><input id="ex-dur" type="number" min="1" value="30"></label>
            <label style="flex:1;"><span>及格分</span><input id="ex-pass" type="number" min="1" max="100" value="60"></label>
          </div>
          <div class="row-gap">
            <label style="flex:1;"><span>考试密码(可选)</span><input id="ex-code" placeholder="留空则免密"></label>
            <label style="flex:1;"><span>最大切屏次数</span><input id="ex-tab" type="number" min="0" value="3"></label>
          </div>
          <label class="switch-row"><span>禁止复制题目文本</span><input id="ex-nocopy" type="checkbox" checked></label>
          <label class="switch-row"><span>多选题漏选按比例得分</span><input id="ex-mpart" type="checkbox" checked></label>
          <label class="switch-row"><span>填空题按空平均得分</span><input id="ex-fpart" type="checkbox" checked></label>
          <div class="modal-actions"><button type="submit" class="btn primary">创建考试</button></div>
        </form>
      </div>
    `;
    modal.querySelector("#ex-m-close").addEventListener("click", () => { modal.hidden = true; });
    modal.querySelector("#ex-m-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await apiRequest("/api/exams", {
          method: "POST",
          body: JSON.stringify({
            title: modal.querySelector("#ex-title").value.trim(),
            bankId: modal.querySelector("#ex-bank").value,
            questionCount: Number(modal.querySelector("#ex-cnt").value),
            durationMinutes: Number(modal.querySelector("#ex-dur").value),
            passScore: Number(modal.querySelector("#ex-pass").value),
            accessCode: modal.querySelector("#ex-code").value.trim(),
            maxTabSwitches: Number(modal.querySelector("#ex-tab").value),
            disableCopy: modal.querySelector("#ex-nocopy").checked,
            multiPartialScore: modal.querySelector("#ex-mpart").checked,
            fillPartialScore: modal.querySelector("#ex-fpart").checked
          })
        });
        modal.hidden = true;
        showToast("考试已发布", "ok");
        renderExamsView(container, ctx);
      } catch (err) {
        showToast(err.message, "bad");
      }
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
        return renderExamRoom(container, eid);
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
      if (act === "subs") {
        let subs = [];
        try {
          const res = await apiRequest(`/api/exams/${encodeURIComponent(eid)}/submissions`);
          subs = res.submissions || [];
        } catch (err) {
          return showToast(err.message, "bad");
        }
        modal.hidden = false;
        modal.innerHTML = `
          <div class="modal-card" style="max-width:680px;max-height:85vh;overflow-y:auto;">
            <div class="modal-head">
              <h3>${escapeHtml(ex?.title || "")} · 成绩单 (${subs.length})</h3>
              <div class="row-gap">
                <button id="sub-csv" class="btn primary tiny">导出 CSV</button>
                <button id="sub-close" class="btn ghost tiny">关闭</button>
              </div>
            </div>
            <table class="data-table">
              <thead><tr><th>姓名</th><th>学号</th><th>得分</th><th>结果</th><th>切屏</th><th>交卷时间</th></tr></thead>
              <tbody>
                ${subs.map((s) => `
                  <tr>
                    <td>${escapeHtml(s.studentName)}</td>
                    <td>${escapeHtml(s.studentNo || "-")}</td>
                    <td><strong>${s.score}</strong></td>
                    <td><span class="badge ${s.passed ? "ok" : "bad"}">${s.passed ? "及格" : "不及格"}</span></td>
                    <td>${s.tabSwitches}</td>
                    <td class="muted-text">${escapeHtml(s.submittedAt.slice(0, 16).replace("T", " "))}</td>
                  </tr>
                `).join("") || '<tr><td colspan="6" class="muted-text">暂无交卷记录</td></tr>'}
              </tbody>
            </table>
          </div>
        `;
        modal.querySelector("#sub-close").addEventListener("click", () => { modal.hidden = true; });
        modal.querySelector("#sub-csv").addEventListener("click", () => exportSubmissionsCsv(ex?.title || "考试", subs));
      }
    });
  });
};

const renderExamRoom = async (container, examId, code = "") => {
  let exam;
  try {
    const res = await apiRequest(`/api/exams/${encodeURIComponent(examId)}?code=${encodeURIComponent(code)}`);
    exam = res.exam;
  } catch (err) {
    if (err.status === 403 && err.data?.needCode) {
      const input = prompt(`「${err.data.title}」需要输入考试密码：`);
      if (input == null) return;
      return renderExamRoom(container, examId, input);
    }
    container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel" style="max-width:480px;margin:20px auto;">
      <h2 style="margin-top:0;">${escapeHtml(exam.title)}</h2>
      <p class="muted-text">题数：${exam.questionsSnapshot.length} 题 · 时长：${exam.durationMinutes} 分钟 · 及格：${exam.passScore} 分 · 最多切屏 ${exam.maxTabSwitches} 次</p>
      <form id="join-exam-form" class="stack-form">
        <label><span>考生姓名</span><input id="stu-name" required placeholder="请输入真实姓名"></label>
        <label><span>学号/工号（可选）</span><input id="stu-no" placeholder="可选"></label>
        <button type="submit" class="btn primary">开始答题</button>
      </form>
    </div>
  `;

  container.querySelector("#join-exam-form").addEventListener("submit", (e) => {
    e.preventDefault();
    startExamSession(container, exam, {
      studentName: container.querySelector("#stu-name").value.trim(),
      studentNo: container.querySelector("#stu-no").value.trim()
    });
  });
};

const startExamSession = (container, exam, student) => {
  const questions = exam.questionsSnapshot || [];
  const answers = {};
  let remainSec = exam.durationMinutes * 60;
  let tabSwitches = 0;
  let finished = false;
  const startTime = Date.now();

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
      const sub = res.submission;
      container.innerHTML = `
        <div class="panel" style="max-width:720px;margin:0 auto;">
          <h2 style="margin-top:0;">交卷成功 · ${escapeHtml(exam.title)}</h2>
          <div class="row-gap" style="margin-bottom:14px;">
            <span class="badge ${sub.passed ? "ok" : "bad"}" style="font-size:16px;">得分：${sub.score} 分（${sub.passed ? "及格" : "不及格"}）</span>
            <span class="badge">答对 ${sub.correctCount} / ${sub.totalCount}</span>
            <span class="badge warn">切屏 ${sub.tabSwitches} 次</span>
          </div>
          ${sub.details.map((d, i) => `
            <div class="panel" style="padding:10px;margin-bottom:8px;">
              <div><strong>${i + 1}. ${escapeHtml(d.title)}</strong> <span class="badge ${d.correct ? "ok" : "bad"}">${d.correct ? "正确" : "错误"}</span></div>
              ${(d.images || []).length ? `<div class="row-gap" style="margin:6px 0;">${d.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;border:1px solid var(--line);">`).join("")}</div>` : ""}
              <div class="muted-text">你的答案：${escapeHtml((d.selected || []).join(" | ") || "未答")} · 正确答案：${escapeHtml((d.expected || []).join(" | "))}</div>
            </div>
          `).join("")}
        </div>
      `;
    } catch (err) {
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
    if (!container.querySelector("#er-submit")) {
      cleanupSession();
      return;
    }
    if (document.hidden && !finished) {
      tabSwitches += 1;
      showToast(`警告：检测到切屏 (${tabSwitches}/${exam.maxTabSwitches})`, "bad");
      if (exam.maxTabSwitches > 0 && tabSwitches > exam.maxTabSwitches) {
        showToast("切屏次数超限，系统自动交卷！", "bad");
        submitNow();
      }
    }
  };
  document.addEventListener("visibilitychange", onVis);
  activeExamCleanup = cleanupSession;

  timer = setInterval(() => {
    if (finished || !container.querySelector("#er-submit")) return cleanupSession();
    remainSec -= 1;
    const el = container.querySelector("#er-clock");
    if (el) el.textContent = `${String(Math.floor(remainSec / 60)).padStart(2, "0")}:${String(remainSec % 60).padStart(2, "0")}`;
    if (remainSec <= 0) submitNow();
  }, 1000);

  container.innerHTML = `
    <div class="panel" style="max-width:860px;margin:0 auto;${exam.disableCopy ? "user-select:none;" : ""}">
      <div class="row-gap" style="justify-content:space-between;position:sticky;top:0;background:var(--surface);padding:8px 0;border-bottom:1px solid var(--line);z-index:10;">
        <div><strong>${escapeHtml(exam.title)}</strong> · ${escapeHtml(student.studentName)}</div>
        <div class="row-gap">
          <span class="badge warn">剩余 <span id="er-clock">${exam.durationMinutes}:00</span></span>
          <button id="er-submit" class="btn primary tiny">交卷</button>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:16px;">
        ${questions.map((q, idx) => `
          <div class="panel" data-qid="${escapeHtml(q.id)}">
            <div><span class="badge">${TYPE_LABELS[q.type] || "其他"}</span> <strong>${idx + 1}. ${escapeHtml(q.title)}</strong></div>
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
            ` : (q.type === "4"
              ? `<textarea class="er-fill" rows="3" placeholder="请输入简答内容..." style="width:100%;margin-top:8px;"></textarea>`
              : `<input class="er-fill" type="text" placeholder="请输入答案（多空用 | 分隔）" style="width:100%;margin-top:8px;">`)}
          </div>
        `).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const qid = inp.closest("[data-qid]").dataset.qid;
      const checked = [...container.querySelectorAll(`[data-qid="${qid}"] input:checked`)].map((i) => i.value);
      answers[qid] = checked;
    });
  });
  container.querySelectorAll(".er-fill").forEach((inp) => {
    inp.addEventListener("input", () => {
      const qid = inp.closest("[data-qid]").dataset.qid;
      answers[qid] = inp.value.split("|").map((s) => s.trim()).filter(Boolean);
    });
  });
  container.querySelector("#er-submit").addEventListener("click", () => {
    if (confirm("确认交卷吗？")) submitNow();
  });
};

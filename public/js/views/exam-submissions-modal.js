import { apiRequest, escapeHtml, showToast, TYPE_LABELS } from "../api.js";
import { openConfirmDialog } from "../dialog.js";

export const exportSubmissionsCsv = (examTitle, subs) => {
  const header = ["姓名", "学号", "得分", "是否及格", "阅卷状态", "答对题数", "总题数", "切屏次数", "用时(秒)", "交卷时间"];
  const rows = subs.map((s) => [
    s.studentName, s.studentNo, s.score, s.passed ? "及格" : "不及格",
    s.manualGraded ? "已阅卷" : "待阅卷", s.correctCount, s.totalCount,
    s.tabSwitches, s.usedSeconds, s.submittedAt
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${examTitle}-成绩单.csv`;
  a.click();
};

const renderGradeDetail = (modal, { exam, sub, onBack, onSaved }) => {
  modal.innerHTML = `
    <div class="modal-card modal-shell" style="max-width:720px;">
      <div class="modal-head">
        <h3>阅卷：${escapeHtml(sub.studentName)}（当前 ${sub.score} 分）</h3>
        <div class="row-gap">
          <button id="gr-back" type="button" class="btn ghost tiny">← 返回成绩单</button>
          <button id="gr-close" type="button" class="btn ghost tiny" data-modal-close>关闭</button>
        </div>
      </div>
      <form id="gr-form">
        <div class="modal-body stack-form">
          ${sub.details.map((d, idx) => `
            <div class="panel" style="padding:10px;background:var(--surface-soft);">
              <div class="row-gap" style="justify-content:space-between;">
                <strong>${idx + 1}. [${TYPE_LABELS[d.type] || "题"}] ${escapeHtml(d.title)}</strong>
                <label class="inline-field" style="font-weight:600;">
                  得分 <input type="number" class="gr-score-inp" data-qid="${escapeHtml(d.questionId)}" min="0" max="${d.maxScore || 100}" step="0.5" value="${d.earnedScore ?? 0}" style="width:72px;"> / ${d.maxScore ?? "-"}
                </label>
              </div>
              <div class="muted-text" style="margin-top:4px;">考生作答：${escapeHtml((d.selected || []).join(" | ") || "未作答")}</div>
              <div style="color:var(--ok);font-size:0.8125rem;margin-top:2px;">参考答案：${escapeHtml((d.expected || []).join(" | "))}</div>
            </div>
          `).join("")}
        </div>
        <div class="modal-foot">
          <span class="muted-text">修改分值后将自动重算总分与及格状态</span>
          <button type="submit" class="btn primary">保存阅卷并重算总分</button>
        </div>
      </form>
    </div>`;
  modal.querySelector("#gr-back").addEventListener("click", onBack);
  modal.querySelector("#gr-close").addEventListener("click", () => { modal.hidden = true; });
  modal.querySelector("#gr-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const itemScores = {};
    modal.querySelectorAll(".gr-score-inp").forEach((inp) => { itemScores[inp.dataset.qid] = Number(inp.value || 0); });
    try {
      await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submissions/${encodeURIComponent(sub.id)}/grade`, {
        method: "POST", body: JSON.stringify({ itemScores })
      });
      showToast("阅卷已保存", "ok");
      await onSaved();
    } catch (err) { showToast(err.message, "bad"); }
  });
};

const renderSubmissionsListHtml = (exam, subs) => `
  <div class="modal-card modal-shell" style="max-width:780px;">
    <div class="modal-head">
      <h3>${escapeHtml(exam.title || "")} · 成绩单 (${subs.length})</h3>
      <div class="row-gap">
        ${subs.length ? '<button id="sub-clear-all" type="button" class="btn ghost-danger tiny">清空记录</button>' : ""}
        <button id="sub-csv" type="button" class="btn primary tiny">导出 CSV</button>
        <button id="sub-close" type="button" class="btn ghost tiny" data-modal-close>关闭</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="table-wrap">
        <table class="data-table" style="margin-top:0;">
          <thead><tr><th>姓名</th><th>学号</th><th>得分/满分</th><th>状态</th><th>切屏</th><th>交卷时间</th><th>操作</th></tr></thead>
          <tbody>
            ${subs.map((s) => `
              <tr>
                <td>${escapeHtml(s.studentName)}</td>
                <td>${escapeHtml(s.studentNo || "-")}</td>
                <td><strong>${s.score}</strong> / ${exam.totalScore || 100}</td>
                <td><span class="badge ${s.passed ? "ok" : "bad"}">${s.passed ? "及格" : "不及格"}</span>${s.manualGraded ? "" : ' <span class="badge warn">待阅卷</span>'}</td>
                <td>${s.tabSwitches}</td>
                <td class="muted-text">${escapeHtml(s.submittedAt.slice(0, 16).replace("T", " "))}</td>
                <td>
                  <div class="row-gap" style="gap:6px;flex-wrap:nowrap;">
                    <button class="btn ghost tiny js-grade-sub" data-sid="${escapeHtml(s.id)}">${s.manualGraded ? "查看/改分" : "去阅卷"}</button>
                    <button class="btn ghost-danger tiny js-del-sub" data-sid="${escapeHtml(s.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `).join("") || '<tr><td colspan="7" class="muted-text">暂无交卷记录</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

export const openSubmissionsModal = async (modal, { exam, onUpdated }) => {
  let subs = [];
  const reload = async () => {
    const res = await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submissions`);
    subs = res.submissions || [];
    renderList();
  };
  const renderList = () => {
    modal.hidden = false;
    modal.innerHTML = renderSubmissionsListHtml(exam, subs);
    modal.querySelector("#sub-close").addEventListener("click", () => { modal.hidden = true; });
    modal.querySelector("#sub-csv").addEventListener("click", () => exportSubmissionsCsv(exam.title || "考试", subs));
    modal.querySelector("#sub-clear-all")?.addEventListener("click", async () => {
      const ok = await openConfirmDialog({ title: "清空考试记录", message: `确定清空「${exam.title}」的全部 ${subs.length} 条交卷成绩吗？清空后学生可重新参加考试。`, confirmText: "确认清空", danger: true });
      if (!ok) return;
      try {
        await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submissions`, { method: "DELETE" });
        showToast("已清空全部交卷记录", "ok");
        await reload();
        onUpdated?.(subs.length);
      } catch (err) { showToast(err.message, "bad"); }
    });
    modal.querySelectorAll(".js-grade-sub").forEach((btn) => btn.addEventListener("click", () => {
      const sub = subs.find((x) => x.id === btn.dataset.sid);
      if (sub) renderGradeDetail(modal, { exam, sub, onBack: renderList, onSaved: async () => { await reload(); onUpdated?.(subs.length); } });
    }));
    modal.querySelectorAll(".js-del-sub").forEach((btn) => btn.addEventListener("click", async () => {
      const sub = subs.find((x) => x.id === btn.dataset.sid);
      if (!sub) return;
      const ok = await openConfirmDialog({ title: "删除交卷记录", message: `确定删除「${sub.studentName}」的交卷记录吗？删除后该考生可释放限考次数。`, confirmText: "确认删除", danger: true });
      if (!ok) return;
      try {
        await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submissions/${encodeURIComponent(sub.id)}`, { method: "DELETE" });
        showToast("已删除交卷记录", "ok");
        await reload();
        onUpdated?.(subs.length);
      } catch (err) { showToast(err.message, "bad"); }
    }));
  };
  await reload();
};

const renderMySubmissionDetail = (modal, sub, onBack) => {
  modal.innerHTML = `
    <div class="modal-card modal-shell" style="max-width:720px;">
      <div class="modal-head">
        <h3>${escapeHtml(sub.examTitle)} · 得分 ${sub.score}/${sub.totalScore}</h3>
        <div class="row-gap">
          <button id="my-sub-back" type="button" class="btn ghost tiny">← 返回列表</button>
          <button id="my-sub-detail-close" type="button" class="btn ghost tiny" data-modal-close>关闭</button>
        </div>
      </div>
      <div class="modal-body stack-form">
        ${sub.details.map((d, idx) => `
          <div class="panel" style="padding:10px;background:var(--surface-soft);">
            <div class="row-gap" style="justify-content:space-between;">
              <strong>${idx + 1}. ${escapeHtml(d.title)}</strong>
              <span><span class="badge">${d.earnedScore ?? 0} / ${d.maxScore ?? "-"} 分</span> <span class="badge ${d.correct ? "ok" : "bad"}">${d.correct ? "正确" : (d.needManual ? "待阅卷" : "错误")}</span></span>
            </div>
            <div class="muted-text" style="margin-top:4px;">你的答案：${escapeHtml((d.selected || []).join(" | ") || "未答")}${d.answerHidden ? " · 暂不公开参考答案" : ` · 参考答案：${escapeHtml((d.expected || []).join(" | "))}`}</div>
          </div>
        `).join("")}
      </div>
    </div>`;
  modal.querySelector("#my-sub-back").addEventListener("click", onBack);
  modal.querySelector("#my-sub-detail-close").addEventListener("click", () => { modal.hidden = true; });
};

export const openMySubmissionsModal = async (modal) => {
  const res = await apiRequest("/api/user/submissions");
  const subs = res.submissions || [];
  const renderMyList = () => {
    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal-card modal-shell" style="max-width:720px;">
        <div class="modal-head"><h3>我的考试成绩单 (${subs.length})</h3><button id="my-sub-close" type="button" class="btn ghost tiny" data-modal-close>关闭</button></div>
        <div class="modal-body">
          <div class="table-wrap">
            <table class="data-table" style="margin-top:0;">
              <thead><tr><th>考试名称</th><th>得分/满分</th><th>状态</th><th>交卷时间</th><th>操作</th></tr></thead>
              <tbody>
                ${subs.map((s) => `
                  <tr>
                    <td>${escapeHtml(s.examTitle)}</td>
                    <td><strong>${s.score}</strong> / ${s.totalScore}</td>
                    <td><span class="badge ${s.passed ? "ok" : "bad"}">${s.passed ? "及格" : "不及格"}</span>${s.manualGraded ? "" : ' <span class="badge warn">待阅卷</span>'}</td>
                    <td class="muted-text">${escapeHtml(s.submittedAt.slice(0, 16).replace("T", " "))}</td>
                    <td><button class="btn ghost tiny js-my-detail" data-sid="${escapeHtml(s.id)}">详情</button></td>
                  </tr>
                `).join("") || '<tr><td colspan="5" class="muted-text">你还没有参加过在线考试。</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
    modal.querySelector("#my-sub-close").addEventListener("click", () => { modal.hidden = true; });
    modal.querySelectorAll(".js-my-detail").forEach((b) => b.addEventListener("click", () => {
      const sub = subs.find((x) => x.id === b.dataset.sid);
      if (sub) renderMySubmissionDetail(modal, sub, renderMyList);
    }));
  };
  renderMyList();
};

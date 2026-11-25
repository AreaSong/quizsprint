import { apiRequest, escapeHtml, fetchBankQuestionsSafe, showToast, TYPE_LABELS } from "../api.js";

const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const localInputToIso = (val) => (val ? new Date(val).toISOString() : "");
const isoToLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

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

export const openCreateExamModal = async (modal, { banks, activeBankId, onCreated }) => {
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card" style="max-width:680px;max-height:90vh;overflow-y:auto;">
      <div class="modal-head"><h3>发起在线考试（精细组卷与防作弊）</h3><button id="ex-m-close" class="btn ghost tiny">关闭</button></div>
      <form id="ex-m-form" class="stack-form">
        <div class="row-gap">
          <label style="flex:1.4;"><span>考试名称</span><input id="ex-title" required placeholder="如：2026 期中摸底测试"></label>
          <label style="flex:1;"><span>选择题库</span>
            <select id="ex-bank">${banks.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === activeBankId ? "selected" : ""}>${escapeHtml(b.name)} (${b.questionCount})</option>`).join("")}</select>
          </label>
        </div>
        <div class="row-gap">
          <label class="row-gap" style="flex-direction:row;cursor:pointer;"><input type="radio" name="ex-pick-mode" value="byType" checked> 按题型抽题配分</label>
          <label class="row-gap" style="flex-direction:row;cursor:pointer;"><input type="radio" name="ex-pick-mode" value="manual"> 手动挑题组固定卷</label>
        </div>
        <div id="ex-type-cfg" class="stack-form" style="padding:10px;background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;">正在加载题库题型分布...</div>
        <div id="ex-manual-cfg" class="stack-form" style="padding:10px;background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;" hidden>
          <div class="row-gap">
            <input id="ex-manual-q" type="search" placeholder="筛选题目关键词..." style="flex:1;">
            <span class="muted-text" style="font-size:12px;">已选 <strong id="ex-manual-cnt">0</strong> 题</span>
          </div>
          <div id="ex-manual-list" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>
        </div>
        <div class="row-gap">
          <label style="flex:1;"><span>时长(分钟)</span><input id="ex-dur" type="number" min="1" value="30"></label>
          <label style="flex:1;"><span>及格分（总分 <span id="ex-total-lbl">0</span>）</span><input id="ex-pass" type="number" min="1" value="60"></label>
          <label style="flex:1;"><span>每人限考次数(0不限)</span><input id="ex-attempts" type="number" min="0" value="0"></label>
        </div>
        <div class="row-gap">
          <label style="flex:1;"><span>开考时间(可选)</span><input id="ex-start" type="datetime-local"></label>
          <label style="flex:1;"><span>截止时间(可选)</span><input id="ex-end" type="datetime-local"></label>
        </div>
        <div class="row-gap">
          <label style="flex:1;"><span>考试密码(可选)</span><input id="ex-code" placeholder="留空则免密"></label>
          <label style="flex:1;"><span>最大切屏次数</span><input id="ex-tab" type="number" min="0" value="3"></label>
        </div>
        <label class="switch-row"><span>禁止复制题目文本</span><input id="ex-nocopy" type="checkbox" checked></label>
        <label class="switch-row"><span>交卷后公开参考答案</span><input id="ex-show-ans" type="checkbox" checked></label>
        <label class="switch-row"><span>多选题/不定项漏选按比例得分</span><input id="ex-mpart" type="checkbox" checked></label>
        <label class="switch-row"><span>填空题按空平均得分</span><input id="ex-fpart" type="checkbox" checked></label>
        <div class="modal-actions"><button type="submit" class="btn primary">创建并发布考试</button></div>
      </form>
    </div>
  `;

  let pool = [];
  const selectedIds = new Set();
  const manualScores = {};
  const bankSel = modal.querySelector("#ex-bank");
  const typeBox = modal.querySelector("#ex-type-cfg");
  const manualBox = modal.querySelector("#ex-manual-cfg");
  const manualListEl = modal.querySelector("#ex-manual-list");
  const totalLbl = modal.querySelector("#ex-total-lbl");
  const passEl = modal.querySelector("#ex-pass");

  const isManualMode = () => modal.querySelector('input[name="ex-pick-mode"]:checked')?.value === "manual";

  const recalcTotal = () => {
    let sum = 0;
    if (isManualMode()) {
      for (const qid of selectedIds) sum += Number(manualScores[qid] || 2);
      modal.querySelector("#ex-manual-cnt").textContent = String(selectedIds.size);
    } else {
      typeBox.querySelectorAll("[data-tc-row]").forEach((row) => {
        sum += Number(row.querySelector(".tc-cnt").value || 0) * Number(row.querySelector(".tc-sc").value || 0);
      });
    }
    const rounded = round1(sum);
    totalLbl.textContent = String(rounded);
    if (rounded > 0) passEl.value = String(Math.max(1, Math.round(rounded * 0.6)));
  };

  const renderManualList = () => {
    const kw = modal.querySelector("#ex-manual-q").value.trim().toLowerCase();
    const visible = pool.filter((q) => !kw || q.title.toLowerCase().includes(kw)).slice(0, 120);
    manualListEl.innerHTML = visible.map((q) => `
      <div class="row-gap" style="justify-content:space-between;padding:4px 6px;border-bottom:1px solid var(--line);">
        <label class="row-gap" style="flex:1;flex-direction:row;font-weight:400;cursor:pointer;">
          <input type="checkbox" class="m-pick-chk" data-qid="${escapeHtml(q.id)}" ${selectedIds.has(q.id) ? "checked" : ""}>
          <span class="badge">${TYPE_LABELS[q.type] || "其他"}</span>
          <span>${escapeHtml(q.title.slice(0, 46))}</span>
        </label>
        <input type="number" class="m-pick-sc" data-qid="${escapeHtml(q.id)}" min="0.5" step="0.5" value="${manualScores[q.id] || 2}" style="width:66px;">
      </div>
    `).join("") || '<p class="muted-text">没有匹配的题目</p>';
  };

  const loadBankPool = async () => {
    selectedIds.clear();
    try {
      const res = await fetchBankQuestionsSafe(bankSel.value);
      pool = res.questions || [];
    } catch {
      pool = [];
    }
    const counts = {};
    for (const q of pool) counts[q.type] = (counts[q.type] || 0) + 1;
    typeBox.innerHTML = Object.entries(TYPE_LABELS)
      .filter(([k]) => counts[k] > 0)
      .map(([k, label]) => `
        <div class="row-gap" style="justify-content:space-between;" data-tc-row="${k}">
          <span style="min-width:110px;">${label}（共 ${counts[k]} 题）</span>
          <label class="row-gap" style="font-weight:400;">抽 <input class="tc-cnt" type="number" min="0" max="${counts[k]}" value="${Math.min(5, counts[k])}" style="width:68px;"> 题</label>
          <label class="row-gap" style="font-weight:400;">每题 <input class="tc-sc" type="number" min="0.5" step="0.5" value="2" style="width:68px;"> 分</label>
        </div>
      `).join("") || '<p class="muted-text">该题库暂无题目</p>';
    renderManualList();
    recalcTotal();
  };

  modal.querySelector("#ex-m-close").addEventListener("click", () => { modal.hidden = true; });
  bankSel.addEventListener("change", loadBankPool);
  typeBox.addEventListener("input", recalcTotal);
  modal.querySelector("#ex-manual-q").addEventListener("input", renderManualList);
  manualListEl.addEventListener("change", (e) => {
    const qid = e.target.dataset?.qid;
    if (!qid) return;
    if (e.target.classList.contains("m-pick-chk")) {
      if (e.target.checked) selectedIds.add(qid); else selectedIds.delete(qid);
    } else if (e.target.classList.contains("m-pick-sc")) {
      manualScores[qid] = Number(e.target.value || 2);
    }
    recalcTotal();
  });
  modal.querySelectorAll('input[name="ex-pick-mode"]').forEach((r) => {
    r.addEventListener("change", () => {
      const manual = isManualMode();
      typeBox.hidden = manual;
      manualBox.hidden = !manual;
      recalcTotal();
    });
  });

  modal.querySelector("#ex-m-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      title: modal.querySelector("#ex-title").value.trim(),
      bankId: bankSel.value,
      durationMinutes: Number(modal.querySelector("#ex-dur").value),
      passScore: Number(passEl.value),
      maxAttempts: Number(modal.querySelector("#ex-attempts").value || 0),
      startTime: localInputToIso(modal.querySelector("#ex-start").value),
      endTime: localInputToIso(modal.querySelector("#ex-end").value),
      accessCode: modal.querySelector("#ex-code").value.trim(),
      maxTabSwitches: Number(modal.querySelector("#ex-tab").value),
      disableCopy: modal.querySelector("#ex-nocopy").checked,
      showAnswerAfterSubmit: modal.querySelector("#ex-show-ans").checked,
      multiPartialScore: modal.querySelector("#ex-mpart").checked,
      fillPartialScore: modal.querySelector("#ex-fpart").checked
    };
    if (isManualMode()) {
      payload.selectedQuestionIds = [...selectedIds];
      payload.questionScores = manualScores;
    } else {
      const typeConfig = {};
      typeBox.querySelectorAll("[data-tc-row]").forEach((row) => {
        typeConfig[row.dataset.tcRow] = {
          count: Number(row.querySelector(".tc-cnt").value || 0),
          score: Number(row.querySelector(".tc-sc").value || 2)
        };
      });
      payload.typeConfig = typeConfig;
    }
    try {
      await apiRequest("/api/exams", { method: "POST", body: JSON.stringify(payload) });
      modal.hidden = true;
      showToast("考试已发布", "ok");
      onCreated?.();
    } catch (err) {
      showToast(err.message, "bad");
    }
  });

  await loadBankPool();
};

const renderEditExamBody = (exam) => `
  <div class="modal-card" style="max-width:600px;max-height:90vh;overflow-y:auto;">
    <div class="modal-head"><h3>编辑考试设置</h3><button id="ex-e-close" class="btn ghost tiny">关闭</button></div>
    <p class="muted-text" style="margin:0 0 10px;">固定试卷共 ${exam.questionCount || 0} 题（满分 ${exam.totalScore || 100} 分），调整规则不影响已抽题目与历史成绩。</p>
    <form id="ex-e-form" class="stack-form">
      <label><span>考试名称</span><input id="ex-e-title" required value="${escapeHtml(exam.title)}"></label>
      <div class="row-gap">
        <label style="flex:1;"><span>时长(分钟)</span><input id="ex-e-dur" type="number" min="1" value="${exam.durationMinutes}"></label>
        <label style="flex:1;"><span>及格分</span><input id="ex-e-pass" type="number" min="1" value="${exam.passScore}"></label>
        <label style="flex:1;"><span>每人限考次数(0不限)</span><input id="ex-e-attempts" type="number" min="0" value="${exam.maxAttempts || 0}"></label>
      </div>
      <div class="row-gap">
        <label style="flex:1;"><span>开考时间(可选)</span><input id="ex-e-start" type="datetime-local" value="${isoToLocalInput(exam.startTime)}"></label>
        <label style="flex:1;"><span>截止时间(可选)</span><input id="ex-e-end" type="datetime-local" value="${isoToLocalInput(exam.endTime)}"></label>
      </div>
      <div class="row-gap">
        <label style="flex:1;"><span>考试密码(留空即取消密码)</span><input id="ex-e-code" value="${escapeHtml(exam.accessCode || "")}" placeholder="留空表示免密"></label>
        <label style="flex:1;"><span>最大切屏次数</span><input id="ex-e-tab" type="number" min="0" value="${exam.maxTabSwitches}"></label>
      </div>
      <label class="switch-row"><span>禁止复制题目文本</span><input id="ex-e-nocopy" type="checkbox" ${exam.disableCopy ? "checked" : ""}></label>
      <label class="switch-row"><span>交卷后公开参考答案</span><input id="ex-e-show-ans" type="checkbox" ${exam.showAnswerAfterSubmit !== false ? "checked" : ""}></label>
      <label class="switch-row"><span>多选题/不定项漏选按比例得分</span><input id="ex-e-mpart" type="checkbox" ${exam.multiPartialScore ? "checked" : ""}></label>
      <label class="switch-row"><span>填空题按空平均得分</span><input id="ex-e-fpart" type="checkbox" ${exam.fillPartialScore ? "checked" : ""}></label>
      <div class="modal-actions"><button type="submit" class="btn primary">保存修改</button></div>
    </form>
  </div>
`;

export const openEditExamModal = (modal, { exam, onUpdated }) => {
  modal.hidden = false;
  modal.innerHTML = renderEditExamBody(exam);
  modal.querySelector("#ex-e-close").addEventListener("click", () => { modal.hidden = true; });
  modal.querySelector("#ex-e-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      title: modal.querySelector("#ex-e-title").value.trim(),
      durationMinutes: Number(modal.querySelector("#ex-e-dur").value),
      passScore: Number(modal.querySelector("#ex-e-pass").value),
      maxAttempts: Number(modal.querySelector("#ex-e-attempts").value || 0),
      startTime: localInputToIso(modal.querySelector("#ex-e-start").value),
      endTime: localInputToIso(modal.querySelector("#ex-e-end").value),
      accessCode: modal.querySelector("#ex-e-code").value.trim(),
      maxTabSwitches: Number(modal.querySelector("#ex-e-tab").value),
      disableCopy: modal.querySelector("#ex-e-nocopy").checked,
      showAnswerAfterSubmit: modal.querySelector("#ex-e-show-ans").checked,
      multiPartialScore: modal.querySelector("#ex-e-mpart").checked,
      fillPartialScore: modal.querySelector("#ex-e-fpart").checked
    };
    try {
      await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      modal.hidden = true;
      showToast("考试设置已更新", "ok");
      onUpdated?.();
    } catch (err) {
      showToast(err.message, "bad");
    }
  });
};

export const openSubmissionsModal = async (modal, { exam, onUpdated }) => {
  let subs = [];
  const reload = async () => {
    const res = await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submissions`);
    subs = res.submissions || [];
    renderList();
  };

  const renderGradeDetail = (sub) => {
    modal.innerHTML = `
      <div class="modal-card" style="max-width:720px;max-height:88vh;overflow-y:auto;">
        <div class="modal-head">
          <h3>阅卷：${escapeHtml(sub.studentName)}（当前 ${sub.score} 分）</h3>
          <button id="gr-back" class="btn ghost tiny">← 返回成绩单</button>
        </div>
        <form id="gr-form" class="stack-form">
          ${sub.details.map((d, idx) => `
            <div class="panel" style="padding:10px;background:var(--surface-soft);">
              <div class="row-gap" style="justify-content:space-between;">
                <strong>${idx + 1}. [${TYPE_LABELS[d.type] || "题"}] ${escapeHtml(d.title)}</strong>
                <label class="row-gap" style="flex-direction:row;font-weight:600;">
                  得分 <input type="number" class="gr-score-inp" data-qid="${escapeHtml(d.questionId)}" min="0" max="${d.maxScore || 100}" step="0.5" value="${d.earnedScore ?? 0}" style="width:72px;"> / ${d.maxScore ?? "-"}
                </label>
              </div>
              <div class="muted-text" style="margin-top:4px;">考生作答：${escapeHtml((d.selected || []).join(" | ") || "未作答")}</div>
              <div style="color:var(--ok);font-size:13px;margin-top:2px;">参考答案：${escapeHtml((d.expected || []).join(" | "))}</div>
            </div>
          `).join("")}
          <div class="modal-actions"><button type="submit" class="btn primary">保存阅卷并重算总分</button></div>
        </form>
      </div>
    `;
    modal.querySelector("#gr-back").addEventListener("click", renderList);
    modal.querySelector("#gr-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const itemScores = {};
      modal.querySelectorAll(".gr-score-inp").forEach((inp) => {
        itemScores[inp.dataset.qid] = Number(inp.value || 0);
      });
      try {
        await apiRequest(`/api/exams/${encodeURIComponent(exam.id)}/submissions/${encodeURIComponent(sub.id)}/grade`, {
          method: "POST",
          body: JSON.stringify({ itemScores })
        });
        showToast("阅卷已保存", "ok");
        await reload();
        onUpdated?.();
      } catch (err) {
        showToast(err.message, "bad");
      }
    });
  };

  const renderList = () => {
    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal-card" style="max-width:740px;max-height:86vh;overflow-y:auto;">
        <div class="modal-head">
          <h3>${escapeHtml(exam.title || "")} · 成绩单 (${subs.length})</h3>
          <div class="row-gap">
            <button id="sub-csv" class="btn primary tiny">导出 CSV</button>
            <button id="sub-close" class="btn ghost tiny">关闭</button>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>姓名</th><th>学号</th><th>得分/满分</th><th>状态</th><th>切屏</th><th>交卷时间</th><th>操作</th></tr></thead>
          <tbody>
            ${subs.map((s) => `
              <tr>
                <td>${escapeHtml(s.studentName)}</td>
                <td>${escapeHtml(s.studentNo || "-")}</td>
                <td><strong>${s.score}</strong> / ${exam.totalScore || 100}</td>
                <td>
                  <span class="badge ${s.passed ? "ok" : "bad"}">${s.passed ? "及格" : "不及格"}</span>
                  ${s.manualGraded ? "" : '<span class="badge warn">待阅卷</span>'}
                </td>
                <td>${s.tabSwitches}</td>
                <td class="muted-text">${escapeHtml(s.submittedAt.slice(0, 16).replace("T", " "))}</td>
                <td><button class="btn ghost tiny js-grade-sub" data-sid="${escapeHtml(s.id)}">${s.manualGraded ? "查看/改分" : "去阅卷"}</button></td>
              </tr>
            `).join("") || '<tr><td colspan="7" class="muted-text">暂无交卷记录</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    modal.querySelector("#sub-close").addEventListener("click", () => { modal.hidden = true; });
    modal.querySelector("#sub-csv").addEventListener("click", () => exportSubmissionsCsv(exam.title || "考试", subs));
    modal.querySelectorAll(".js-grade-sub").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sub = subs.find((x) => x.id === btn.dataset.sid);
        if (sub) renderGradeDetail(sub);
      });
    });
  };

  await reload();
};

export const openMySubmissionsModal = async (modal) => {
  const res = await apiRequest("/api/user/submissions");
  const subs = res.submissions || [];

  const renderMyDetail = (sub) => {
    modal.innerHTML = `
      <div class="modal-card" style="max-width:720px;max-height:88vh;overflow-y:auto;">
        <div class="modal-head">
          <h3>${escapeHtml(sub.examTitle)} · 得分 ${sub.score}/${sub.totalScore}</h3>
          <button id="my-sub-back" class="btn ghost tiny">← 返回列表</button>
        </div>
        <div class="stack-form">
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
      </div>
    `;
    modal.querySelector("#my-sub-back").addEventListener("click", renderMyList);
  };

  const renderMyList = () => {
    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal-card" style="max-width:720px;max-height:86vh;overflow-y:auto;">
        <div class="modal-head"><h3>我的考试成绩单 (${subs.length})</h3><button id="my-sub-close" class="btn ghost tiny">关闭</button></div>
        <table class="data-table">
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
    `;
    modal.querySelector("#my-sub-close").addEventListener("click", () => { modal.hidden = true; });
    modal.querySelectorAll(".js-my-detail").forEach((b) => {
      b.addEventListener("click", () => {
        const sub = subs.find((x) => x.id === b.dataset.sid);
        if (sub) renderMyDetail(sub);
      });
    });
  };

  renderMyList();
};

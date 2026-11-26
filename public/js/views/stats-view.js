import { apiRequest, escapeHtml, getCloudUser, getLocalDailyStats, showToast, TYPE_LABELS } from "../api.js";
import { openConfirmDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";

const computeStatsSummary = (days) => {
  const total30 = days.reduce((s, d) => s + (d.answered || 0), 0);
  const correct30 = days.reduce((s, d) => s + (d.correct || 0), 0);
  const rate30 = total30 ? Math.round((correct30 / total30) * 100) : 0;
  const activeDays = days.filter((d) => (d.answered || 0) > 0).length;
  const todayCount = days.length ? Number(days[days.length - 1].answered || 0) : 0;
  let streakDays = 0;
  let idx = days.length - 1;
  if (idx >= 0 && !(days[idx].answered > 0)) idx -= 1;
  while (idx >= 0 && (days[idx].answered || 0) > 0) {
    streakDays += 1;
    idx -= 1;
  }
  return { total30, correct30, rate30, activeDays, todayCount, streakDays };
};

const formatDayDetail = (d) => {
  if (!d) return "暂无刷题记录";
  const ans = Number(d.answered || 0);
  const cor = Number(d.correct || 0);
  const rate = ans ? Math.round((cor / ans) * 100) : 0;
  return `${d.date} · 刷 ${ans} 题 · 对 ${cor} 题 · 正确率 ${rate}%`;
};

const renderKpiGridHtml = (s, { hotList, examCount, user }) => `
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-head"><span class="muted-text">近 30 天刷题量</span><span class="kpi-icon">${iconSvg("book", 15)}</span></div>
      <div class="kpi-val">${s.total30} <span class="muted-text" style="font-size:0.8125rem;font-weight:500;">题</span></div>
      <div class="kpi-sub">今日 ${s.todayCount} 题 · 活跃 ${s.activeDays} 天 · 连续 ${s.streakDays} 天</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-head"><span class="muted-text">综合正确率</span><span class="kpi-icon">${iconSvg("check", 15)}</span></div>
      <div class="kpi-val" style="color:var(--ok);">${s.rate30}%</div>
      <div class="kpi-sub">累计答对 ${s.correct30} / ${s.total30} 题</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-head"><span class="muted-text">全班高频易错题</span><span class="kpi-icon">${iconSvg("alert", 15)}</span></div>
      <div class="kpi-val" style="color:var(--bad);">${hotList.length} <span class="muted-text" style="font-size:0.8125rem;font-weight:500;">道</span></div>
      <div class="kpi-sub">${hotList.length ? `最高错误率 ${hotList[0].wrongRate}%` : "暂无聚合错题"}</div>
    </div>
    <div id="${user ? "stats-go-subs" : ""}" class="kpi-card ${user ? "is-clickable" : ""}" title="${user ? "点击查看我的考试成绩单" : ""}">
      <div class="kpi-head"><span class="muted-text">历史正式考试</span><span class="kpi-icon">${iconSvg("clock", 15)}</span></div>
      <div class="kpi-val" style="color:var(--accent-fg);">${examCount} <span class="muted-text" style="font-size:0.8125rem;font-weight:500;">场</span></div>
      <div class="kpi-sub">${user ? "点击查看个人成绩单 →" : "登录后记录正式考试成绩"}</div>
    </div>
  </div>
`;

const renderTrendChartHtml = (days, rangeDays, activeIdx) => {
  const slice = days.slice(-rangeDays);
  const maxDay = Math.max(1, ...slice.map((d) => d.answered || 0));
  const midIdx = Math.floor(slice.length / 2);
  const labels = slice.length
    ? [slice[0]?.date.slice(5), slice[midIdx]?.date.slice(5), slice[slice.length - 1]?.date.slice(5)]
    : ["-", "-", "-"];
  return `
    <div class="chart-stage">
      ${slice.map((d, i) => {
        const ans = Number(d.answered || 0);
        const h = ans ? Math.max(12, Math.round((ans / maxDay) * 100)) : 4;
        return `
          <div class="chart-col ${i === activeIdx ? "active" : ""}" data-idx="${i}" title="${escapeHtml(formatDayDetail(d))}">
            <div class="chart-bar ${ans ? "has-val" : ""}" style="height:${h}%;"></div>
          </div>
        `;
      }).join("")}
    </div>
    <div class="chart-axis">${labels.map((l) => `<span>${escapeHtml(l || "")}</span>`).join("")}</div>
  `;
};

const renderLeaderboardHtml = (leaderboard, user) => {
  const maxAns = Math.max(1, ...leaderboard.map((u) => Number(u.totalAnswered || 0)));
  if (!leaderboard.length) return '<p class="muted-text" style="margin:0;">暂无排行数据，快去注册学员账号刷题吧！</p>';
  return `
    <div class="rank-list">
      ${leaderboard.map((u, i) => {
        const isMe = Boolean(user && (u.id === user.id || u.username === user.username || u.nickname === user.nickname));
        const pct = Math.round((Number(u.totalAnswered || 0) / maxAns) * 100);
        return `
          <div class="rank-row ${isMe ? "is-me" : ""}">
            <div class="row-gap" style="justify-content:space-between;">
              <span class="row-gap" style="gap:6px;">
                <span class="badge ${i === 0 ? "warn" : (i < 3 ? "ok" : "")}">#${i + 1}</span>
                <strong>${escapeHtml(u.nickname)}</strong>
                ${isMe ? '<span class="badge">我</span>' : ""}
              </span>
              <span class="muted-text" style="font-variant-numeric:tabular-nums;">${u.totalAnswered} 题 · ${u.rate}%</span>
            </div>
            <div class="rank-track"><span style="width:${pct}%"></span></div>
          </div>
        `;
      }).join("")}
    </div>
  `;
};

const renderHotWrongSectionHtml = (hotList, selectedBankId, isAdmin = false) => {
  const bankMap = new Map();
  hotList.forEach((it) => { if (!bankMap.has(it.bankId)) bankMap.set(it.bankId, it.bankName); });
  const visible = selectedBankId ? hotList.filter((i) => i.bankId === selectedBankId) : hotList;
  const body = !hotList.length
    ? `<div class="empty-state" style="margin:12px auto;"><div class="empty-state-icon">${iconSvg("check", 20)}</div><strong style="font-size:0.875rem;">暂无高频错题</strong><p class="muted-text" style="margin:0;">同学们开始刷题后将自动汇总高错误率题目。</p></div>`
    : `<div class="search-list" style="margin-top:12px;">
        ${visible.map((item, idx) => `
          <div class="hot-row">
            <div style="flex:1;min-width:220px;">
              <div class="row-gap">
                <span class="badge bad">#${idx + 1} 错 ${item.wrongCount} 次 · 错误率 ${item.wrongRate}%</span>
                <span class="type-pill" data-qtype="${escapeHtml(item.type)}">${TYPE_LABELS[item.type] || "其他"}</span>
                <span class="bank-pill">${escapeHtml(item.bankName)}</span>
              </div>
              <div style="margin-top:6px;font-weight:600;">${escapeHtml(item.title)}</div>
            </div>
            <div class="row-gap" style="gap:6px;flex-wrap:nowrap;">
              <button type="button" class="btn ghost tiny js-practice-hot" data-bank="${escapeHtml(item.bankId)}">刷同库错题</button>
              ${isAdmin ? `<button type="button" class="btn ghost-danger tiny js-del-hot" data-bank="${escapeHtml(item.bankId)}" data-qid="${escapeHtml(item.questionId)}">移除</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>`;

  return `
    <section class="panel">
      <div class="row-gap" style="justify-content:space-between;">
        <div>
          <h3 style="margin:0;font-size:1rem;">全班高频易错题 Top ${hotList.length || 20}</h3>
          <span class="muted-text">汇总公开题库中答错最多的题目，建议按题库集中攻克</span>
        </div>
        ${hotList.length ? `
          <div class="row-gap">
            ${bankMap.size > 1 ? `
              <select id="stats-hot-bank">
                <option value="">全部题库 (${hotList.length})</option>
                ${[...bankMap.entries()].map(([id, name]) => `<option value="${escapeHtml(id)}" ${id === selectedBankId ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
              </select>
            ` : ""}
            ${isAdmin ? '<button type="button" id="stats-hot-clear" class="btn ghost-danger tiny">重置错题榜</button>' : ""}
            <button type="button" id="stats-hot-start" class="btn primary tiny">${iconSvg("play", 13)}<span>专项攻克高频错题</span></button>
          </div>
        ` : ""}
      </div>
      ${body}
    </section>
  `;
};

const loadStatsData = async (user, isAdmin) => {
  let data = { days: [], leaderboard: [], hotWrongQuestions: [] };
  let examCount = 0;
  try {
    const reqs = [apiRequest("/api/stats")];
    if (user) reqs.push(apiRequest("/api/user/submissions").catch(() => ({ submissions: [] })));
    const [statsRes, subRes] = await Promise.all(reqs);
    data = statsRes || data;
    examCount = (subRes?.submissions || []).length;
  } catch { /* ignore */ }
  if (!user && isAdmin) {
    const localStats = getLocalDailyStats();
    data.days = data.days.map((d) => ({ date: d.date, ...(localStats[d.date] || { answered: 0, correct: 0, seconds: 0 }) }));
  }
  return { data, examCount };
};

export const renderStatsView = async (container, ctx = {}) => {
  const user = getCloudUser();
  const { isAdmin, onSelectBank, onNavigate } = ctx;
  const { data, examCount } = await loadStatsData(user, isAdmin);
  const days = data.days || [];
  const hotList = data.hotWrongQuestions || [];
  const summary = computeStatsSummary(days);
  const statusLabel = user ? `${escapeHtml(user.nickname)}（云端同步）` : (isAdmin ? "管理员本地记录" : "访客模式");

  let rangeDays = 30;
  let selectedHotBank = "";

  const startHotPractice = (bankId) => {
    const targetBank = bankId || hotList[0]?.bankId;
    if (!targetBank) return;
    const hotIds = hotList.filter((i) => i.bankId === targetBank).map((i) => i.questionId);
    onSelectBank?.(targetBank);
    onNavigate?.("practice", { mode: "hotWrong", hotIds });
  };

  const renderPage = () => {
    const slice = days.slice(-rangeDays);
    const activeIdx = Math.max(0, slice.length - 1);
    container.innerHTML = `
      <div class="view-scroll" style="padding-right:4px;">
        <div style="display:flex;flex-direction:column;gap:14px;">
          ${renderKpiGridHtml(summary, { hotList, examCount, user })}
          <div class="stats-grid">
            <section class="panel">
              <div class="row-gap" style="justify-content:space-between;">
                <div class="row-gap">
                  <h2 style="margin:0;font-size:1.0625rem;">每日练习趋势</h2>
                  <span class="badge">${statusLabel}</span>
                </div>
                <div class="seg-row cols-2" style="width:auto;min-width:156px;">
                  ${[14, 30].map((r) => `<button type="button" class="theme-seg-btn ${rangeDays === r ? "active" : ""} js-stats-range" data-range="${r}">近 ${r} 天</button>`).join("")}
                </div>
              </div>
              <div id="stats-day-detail" class="muted-text" style="margin-top:8px;font-variant-numeric:tabular-nums;">${escapeHtml(formatDayDetail(slice[activeIdx]))}</div>
              ${renderTrendChartHtml(days, rangeDays, activeIdx)}
            </section>
            <aside class="panel">
              <div class="row-gap" style="justify-content:space-between;margin-bottom:10px;">
                <h3 style="margin:0;font-size:1rem;">同学刷题排行榜</h3>
                <span class="muted-text" style="font-size:0.75rem;">${(data.leaderboard || []).length} 人</span>
              </div>
              ${renderLeaderboardHtml(data.leaderboard || [], user)}
            </aside>
          </div>
          ${renderHotWrongSectionHtml(hotList, selectedHotBank, isAdmin)}
        </div>
      </div>
    `;
    bindPageEvents(slice);
  };

  const bindPageEvents = (slice) => {
    const detailEl = container.querySelector("#stats-day-detail");
    const cols = [...container.querySelectorAll(".chart-col")];
    const activateCol = (col) => {
      cols.forEach((c) => c.classList.remove("active"));
      col.classList.add("active");
      if (detailEl) detailEl.textContent = formatDayDetail(slice[Number(col.dataset.idx)]);
    };
    cols.forEach((c) => {
      c.addEventListener("mouseenter", () => activateCol(c));
      c.addEventListener("click", () => activateCol(c));
    });
    container.querySelector("#stats-go-subs")?.addEventListener("click", () => onNavigate?.("exams", { openMySubs: true }));
    container.querySelectorAll(".js-stats-range").forEach((b) => b.addEventListener("click", () => { rangeDays = Number(b.dataset.range || 30); renderPage(); }));
    container.querySelector("#stats-hot-bank")?.addEventListener("change", (e) => { selectedHotBank = e.target.value; renderPage(); });
    container.querySelector("#stats-hot-start")?.addEventListener("click", () => startHotPractice(selectedHotBank));
    container.querySelectorAll(".js-practice-hot").forEach((b) => b.addEventListener("click", () => startHotPractice(b.dataset.bank)));
    container.querySelector("#stats-hot-clear")?.addEventListener("click", async () => {
      const ok = await openConfirmDialog({ title: "重置全班错题榜", message: selectedHotBank ? "确定清空所选题库的全班错题聚合统计吗？" : "确定清空全部公开题库的全班错题统计吗？", confirmText: "确认重置", danger: true });
      if (!ok) return;
      try {
        const qs = selectedHotBank ? `?bankId=${encodeURIComponent(selectedHotBank)}` : "";
        await apiRequest(`/api/admin/wrong-stats${qs}`, { method: "DELETE" });
        showToast("已重置高频错题统计", "ok");
        renderStatsView(container, ctx);
      } catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelectorAll(".js-del-hot").forEach((b) => b.addEventListener("click", async () => {
      const ok = await openConfirmDialog({ title: "移除错题记录", message: "确定从全班高频错题榜中移除该题的累计记录吗？", confirmText: "确认移除", danger: true });
      if (!ok) return;
      try {
        await apiRequest(`/api/admin/wrong-stats?bankId=${encodeURIComponent(b.dataset.bank)}&questionId=${encodeURIComponent(b.dataset.qid)}`, { method: "DELETE" });
        showToast("已移除该题错题统计", "ok");
        renderStatsView(container, ctx);
      } catch (err) { showToast(err.message, "bad"); }
    }));
  };

  renderPage();
};

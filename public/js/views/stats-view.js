import { apiRequest, escapeHtml, getCloudUser, getLocalDailyStats, TYPE_LABELS } from "../api.js";

export const renderStatsView = async (container, ctx = {}) => {
  const user = getCloudUser();
  const { isAdmin, onSelectBank, onNavigate } = ctx;
  let data = { days: [], leaderboard: [], hotWrongQuestions: [] };
  try {
    data = await apiRequest("/api/stats");
  } catch {
    // 忽略
  }

  if (!user && isAdmin) {
    const localStats = getLocalDailyStats();
    data.days = data.days.map((d) => ({
      date: d.date,
      ...(localStats[d.date] || { answered: 0, correct: 0, seconds: 0 })
    }));
  }

  const maxDay = Math.max(1, ...data.days.map((d) => d.answered || 0));
  const total30 = data.days.reduce((s, d) => s + (d.answered || 0), 0);
  const correct30 = data.days.reduce((s, d) => s + (d.correct || 0), 0);
  const rate30 = total30 ? Math.round((correct30 / total30) * 100) : 0;
  const statusLabel = user
    ? `${escapeHtml(user.nickname)}（云端已同步）`
    : (isAdmin ? "管理员本地刷题记录" : "访客模式（登录后开启刷题统计）");
  const hotList = data.hotWrongQuestions || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div class="practice-layout" style="height:auto;">
        <section class="panel" style="grid-column:span 2;">
          <div class="row-gap" style="justify-content:space-between;">
            <h2 style="margin:0;">近 30 天练习统计</h2>
            <span class="badge">${statusLabel}</span>
          </div>
          <div class="row-gap" style="margin:12px 0;">
            <span class="badge ok">近 30 天刷题 ${total30} 题</span>
            <span class="badge">答对 ${correct30} 题</span>
            <span class="badge warn">正确率 ${rate30}%</span>
          </div>
          <div style="display:flex;align-items:flex-end;gap:4px;height:140px;padding:12px 4px;border:1px solid var(--line);border-radius:8px;overflow-x:auto;">
            ${data.days.map((d) => {
              const h = Math.max(4, Math.round(((d.answered || 0) / maxDay) * 100));
              return `
                <div title="${d.date}：${d.answered} 题（对 ${d.correct}）" style="flex:1;min-width:8px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">
                  <div style="width:100%;height:${h}%;background:${d.answered ? "var(--accent)" : "var(--line)"};border-radius:3px 3px 0 0;"></div>
                </div>
              `;
            }).join("")}
          </div>
          <p class="muted-text" style="margin-top:8px;">鼠标悬停柱状条可查看每日明细；点击顶部「账号登录」后自动记录每日刷题量并参与同学排行。</p>
        </section>

        <aside class="panel">
          <h3 style="margin-top:0;">同学刷题排行榜</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${data.leaderboard.map((u, i) => `
              <div class="row-gap" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);">
                <span><strong>#${i + 1}</strong> ${escapeHtml(u.nickname)}</span>
                <span class="muted-text">${u.totalAnswered} 题 · ${u.rate}%</span>
              </div>
            `).join("") || '<p class="muted-text">暂无排行数据，快去注册学员账号刷题吧！</p>'}
          </div>
        </aside>
      </div>

      <section class="panel">
        <div class="row-gap" style="justify-content:space-between;">
          <div>
            <h3 style="margin:0;">全班高频易错题 Top ${hotList.length || 20}</h3>
            <span class="muted-text">汇总公开题库中大家答错最多的题目，考前重点攻克</span>
          </div>
        </div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
          ${hotList.map((item, idx) => `
            <div class="row-gap" style="justify-content:space-between;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft);">
              <div style="flex:1;min-width:220px;">
                <div class="row-gap">
                  <span class="badge bad">#${idx + 1} 错 ${item.wrongCount} 次 · 错误率 ${item.wrongRate}%</span>
                  <span class="badge">${TYPE_LABELS[item.type] || "其他"}</span>
                  <span class="badge warn">${escapeHtml(item.bankName)}</span>
                </div>
                <div style="margin-top:6px;font-weight:600;">${escapeHtml(item.title)}</div>
              </div>
              <button type="button" class="btn primary tiny js-practice-hot" data-bank="${escapeHtml(item.bankId)}">专项开刷该题库高频错题</button>
            </div>
          `).join("") || '<p class="muted-text">暂无高频错题数据，同学们开始刷题后将自动聚合。</p>'}
        </div>
      </section>
    </div>
  `;

  container.querySelectorAll(".js-practice-hot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bid = btn.dataset.bank;
      const hotIds = hotList.filter((i) => i.bankId === bid).map((i) => i.questionId);
      onSelectBank?.(bid);
      onNavigate?.("practice", { mode: "hotWrong", hotIds });
    });
  });
};

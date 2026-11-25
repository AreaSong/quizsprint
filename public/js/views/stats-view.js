import { apiRequest, escapeHtml, getCloudUser, getLocalDailyStats } from "../api.js";

export const renderStatsView = async (container, ctx = {}) => {
  const user = getCloudUser();
  const { isAdmin } = ctx;
  let data = { days: [], leaderboard: [] };
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

  container.innerHTML = `
    <div class="practice-layout">
      <section class="panel">
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
        <p class="muted-text" style="margin-top:8px;">鼠标悬停柱状条可查看每日明细；登录顶部「学员登录」后自动记录每日刷题量并参与同学排行。</p>
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
  `;
};

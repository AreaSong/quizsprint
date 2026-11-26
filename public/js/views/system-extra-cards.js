import { apiRequest, escapeHtml, showToast } from "../api.js";

const formatSize = (bytes) => {
  const n = Number(bytes || 0);
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
};

export const buildAutoBackupListHtml = (backups = []) => `
  <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);">
    <div class="row-gap" style="justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:0.7813rem;font-weight:600;">每日自动滚动备份（保留 7 份含图快照）</span>
      <button type="button" id="sys-auto-backup-btn" class="btn ghost tiny">立即生成快照</button>
    </div>
    <div class="row-gap" style="gap:6px;">
      ${backups.slice(0, 5).map((b) => `
        <a class="badge" href="/api/admin/backups/${encodeURIComponent(b.name)}" style="text-decoration:none;" title="${escapeHtml(b.createdAt)}">
          ${escapeHtml(b.name)} (${formatSize(b.sizeBytes)})
        </a>
      `).join("") || '<span class="muted-text" style="font-size:0.75rem;">暂无自动备份，点击右侧可立即生成</span>'}
    </div>
  </div>
`;

export const buildSiteConfigCardHtml = (cfg = {}) => `
  <section class="panel sys-card">
    <div class="row-gap" style="justify-content:space-between;">
      <h3 style="margin:0;font-size:1rem;">站点基础设置与公告</h3>
      <span class="badge">${cfg.allowGuestBrowse === false ? "仅登录可见" : "允许访客浏览"}</span>
    </div>
    <form id="sys-site-form" class="stack-form">
      <div class="row-gap">
        <label style="flex:1;"><span>站点名称</span><input id="site-cfg-name" value="${escapeHtml(cfg.siteName || "QuizSprint")}" required maxlength="40"></label>
        <label style="flex:1;"><span>副标题</span><input id="site-cfg-sub" value="${escapeHtml(cfg.subtitle ?? "Question Bank")}" maxlength="60"></label>
      </div>
      <label><span>顶部通知公告栏（留空则隐藏）</span><input id="site-cfg-ann" value="${escapeHtml(cfg.announcement || "")}" placeholder="如：期末模拟考将于本周五 20:00 开放" maxlength="300"></label>
      <label class="row-gap" style="flex-direction:row;cursor:pointer;font-weight:500;">
        <input id="site-cfg-guest" type="checkbox" ${cfg.allowGuestBrowse !== false ? "checked" : ""}>
        <span>允许未登录访客浏览公开题库与搜题</span>
      </label>
      <div class="row-gap" style="justify-content:flex-end;">
        <button type="submit" class="btn primary tiny">保存站点设置</button>
      </div>
    </form>
  </section>
`;

export const buildAuditLogsCardHtml = (logs = []) => `
  <section class="panel sys-card full-span">
    <div class="row-gap" style="justify-content:space-between;">
      <div>
        <h3 style="margin:0;font-size:1rem;">高危操作审计日志</h3>
        <span class="muted-text">自动记录删题库、清空试题、权限变更、恢复备份与站点配置操作（保留最近 1000 条）</span>
      </div>
      <span class="badge">${logs.length} 条记录</span>
    </div>
    <div class="table-wrap" style="max-height:240px;overflow-y:auto;">
      <table class="data-table" style="margin-top:0;">
        <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>
          ${logs.map((l) => `
            <tr>
              <td class="muted-text" style="white-space:nowrap;">${escapeHtml(String(l.createdAt || "").slice(0, 19).replace("T", " "))}</td>
              <td>${escapeHtml(l.actor)}</td>
              <td><code>${escapeHtml(l.action)}</code></td>
              <td>${escapeHtml(l.target || "-")}</td>
              <td class="muted-text">${escapeHtml(l.detail || "-")}</td>
              <td class="muted-text">${escapeHtml(l.ip || "-")}</td>
            </tr>
          `).join("") || '<tr><td colspan="6" class="muted-text">暂无审计记录</td></tr>'}
        </tbody>
      </table>
    </div>
  </section>
`;

export const bindSiteConfigCard = (container, onUpdated) => {
  container.querySelector("#sys-site-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest("/api/admin/site", {
        method: "PUT",
        body: JSON.stringify({
          siteName: container.querySelector("#site-cfg-name").value.trim(),
          subtitle: container.querySelector("#site-cfg-sub").value.trim(),
          announcement: container.querySelector("#site-cfg-ann").value.trim(),
          allowGuestBrowse: container.querySelector("#site-cfg-guest").checked
        })
      });
      showToast("站点设置已保存并实时生效", "ok");
      await onUpdated?.(res.siteConfig);
    } catch (err) {
      showToast(err.message, "bad");
    }
  });
};

import { apiRequest, escapeHtml, showToast } from "../api.js";

const formatSize = (bytes) => {
  const n = Number(bytes || 0);
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
};

export const buildAutoBackupListHtml = (backups = [], cfg = {}, resolvedDir = "") => {
  const enabled = cfg.enabled !== false;
  const interval = cfg.intervalHours ?? 24;
  const keep = cfg.keepCount ?? 7;
  const fmt = cfg.format === "db" ? "db" : "full";
  return `
  <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);">
    <div class="row-gap" style="justify-content:space-between;margin-bottom:8px;">
      <div class="row-gap" style="gap:6px;">
        <span style="font-size:0.8125rem;font-weight:700;">服务器定时自动备份</span>
        <span class="badge ${enabled ? "ok" : ""}">${enabled ? `已启用 · 每 ${escapeHtml(String(interval))} 小时` : "已停用"}</span>
      </div>
      <button type="button" id="sys-auto-backup-btn" class="btn ghost tiny">立即生成快照</button>
    </div>
    <form id="sys-bak-cfg-form" class="stack-form" style="gap:8px;padding:10px;border-radius:9px;background:var(--surface-soft);border:1px solid var(--line);margin-bottom:8px;">
      <label class="row-gap" style="flex-direction:row;cursor:pointer;font-weight:500;">
        <input id="bak-cfg-enabled" type="checkbox" ${enabled ? "checked" : ""}>
        <span>开启服务端定时自动备份（按周期自动写入服务器指定目录）</span>
      </label>
      <div class="row-gap">
        <label style="flex:1;min-width:96px;"><span>间隔（小时）</span><input id="bak-cfg-interval" type="number" min="1" max="720" step="1" value="${escapeHtml(String(interval))}" required></label>
        <label style="flex:1;min-width:96px;"><span>最多保留份数</span><input id="bak-cfg-keep" type="number" min="1" max="90" step="1" value="${escapeHtml(String(keep))}" required></label>
        <label style="flex:1.2;min-width:140px;"><span>快照格式</span>
          <select id="bak-cfg-format">
            <option value="full" ${fmt === "full" ? "selected" : ""}>含配图全量包 (.qsbak)</option>
            <option value="db" ${fmt === "db" ? "selected" : ""}>纯数据库 (.db)</option>
          </select>
        </label>
      </div>
      <label><span>服务器存储路径（留空则默认存入数据目录 backups 子目录）</span>
        <input id="bak-cfg-dir" value="${escapeHtml(cfg.backupDir || "")}" placeholder="如：/opt/quizsprint/backups">
      </label>
      <div class="row-gap" style="justify-content:space-between;">
        <span class="muted-text" style="font-size:0.75rem;word-break:break-all;">当前路径：<code>${escapeHtml(resolvedDir || "data/backups")}</code></span>
        <button type="submit" id="sys-bak-cfg-save" class="btn primary tiny">保存备份策略</button>
      </div>
    </form>
    <div class="row-gap" style="gap:6px;">
      ${backups.slice(0, 8).map((b) => `
        <span class="badge" style="gap:6px;padding-right:6px;">
          <a href="/api/admin/backups/${encodeURIComponent(b.name)}" style="color:inherit;text-decoration:none;" title="${escapeHtml(b.createdAt)}">${escapeHtml(b.name)} (${formatSize(b.sizeBytes)})</a>
          <button type="button" class="js-del-auto-bak" data-name="${escapeHtml(b.name)}" title="删除此快照" style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0 2px;font-weight:700;">×</button>
        </span>
      `).join("") || '<span class="muted-text" style="font-size:0.75rem;">该目录下暂无自动备份快照，点击右侧「立即生成快照」即可写入</span>'}
    </div>
  </div>
`;
};

export const bindAutoBackupConfig = (container, { onSaved, onDelete } = {}) => {
  container.querySelector("#sys-bak-cfg-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest("/api/admin/backups/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled: container.querySelector("#bak-cfg-enabled").checked,
          intervalHours: Number(container.querySelector("#bak-cfg-interval").value || 24),
          keepCount: Number(container.querySelector("#bak-cfg-keep").value || 7),
          format: container.querySelector("#bak-cfg-format").value,
          backupDir: container.querySelector("#bak-cfg-dir").value.trim()
        })
      });
      showToast("自动备份策略已保存并生效", "ok");
      await onSaved?.(res);
    } catch (err) { showToast(err.message, "bad"); }
  });
  container.querySelectorAll(".js-del-auto-bak").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await apiRequest(`/api/admin/backups/${encodeURIComponent(btn.dataset.name)}`, { method: "DELETE" });
      showToast("已删除备份快照", "ok");
      await onDelete?.();
    } catch (err) { showToast(err.message, "bad"); }
  }));
};

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
      <table class="data-table mobile-card-table" style="margin-top:0;">
        <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>
          ${logs.map((l) => `
            <tr>
              <td data-label="时间" class="muted-text" style="white-space:nowrap;">${escapeHtml(String(l.createdAt || "").slice(0, 19).replace("T", " "))}</td>
              <td data-label="操作人">${escapeHtml(l.actor)}</td>
              <td data-label="动作"><code>${escapeHtml(l.action)}</code></td>
              <td data-label="对象">${escapeHtml(l.target || "-")}</td>
              <td data-label="详情" class="muted-text">${escapeHtml(l.detail || "-")}</td>
              <td data-label="IP" class="muted-text">${escapeHtml(l.ip || "-")}</td>
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

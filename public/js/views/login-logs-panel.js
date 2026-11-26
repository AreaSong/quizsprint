import { apiRequest, escapeHtml, showToast } from "../api.js";
import { openConfirmDialog } from "../dialog.js";

const renderLoginRowsHtml = (logs) => {
  if (!logs.length) return '<tr><td colspan="6" class="muted-text">暂无匹配的登录记录</td></tr>';
  return logs.map((l) => `
    <tr>
      <td data-label="登录时间" class="muted-text" style="white-space:nowrap;">${escapeHtml(String(l.createdAt || "").slice(0, 19).replace("T", " "))}</td>
      <td data-label="账号与角色">
        <code>${escapeHtml(l.username || "-")}</code>
        ${l.nickname ? `<span class="muted-text" style="margin-left:4px;">(${escapeHtml(l.nickname)})</span>` : ""}
        ${l.role === "admin" ? '<span class="badge warn" style="margin-left:4px;">管理</span>' : ""}
      </td>
      <td data-label="状态 / 说明">
        <span class="badge ${l.status === "success" ? "ok" : "bad"}">${l.status === "success" ? "成功" : "失败"}</span>
        ${l.reason ? `<span class="muted-text" style="font-size:0.75rem;margin-left:4px;">${escapeHtml(l.reason)}</span>` : ""}
      </td>
      <td data-label="IP 地址"><code>${escapeHtml(l.ip || "-")}</code></td>
      <td data-label="归属地 / 网络">${escapeHtml(l.location || "未知")}</td>
      <td data-label="设备与浏览器" class="muted-text">${escapeHtml(l.device || "-")}</td>
    </tr>
  `).join("");
};

/** 挂载管理后台「登录轨迹与 IP 日志」面板 */
export const mountLoginLogsPanel = async (host) => {
  if (!host) return;
  host.innerHTML = `
    <div class="row-gap" style="justify-content:space-between;flex-wrap:wrap;margin-bottom:10px;">
      <div id="ll-stats" class="row-gap"></div>
      <div class="row-gap">
        <select id="ll-status">
          <option value="">全部状态</option>
          <option value="success">仅登录成功</option>
          <option value="failed">仅登录失败</option>
        </select>
        <input id="ll-kw" type="search" placeholder="筛选账号 / IP / 地区 / 设备..." style="flex:1;min-width:160px;">
        <button type="button" id="ll-refresh" class="btn ghost tiny">刷新</button>
        <button type="button" id="ll-clear" class="btn ghost-danger tiny">清空日志</button>
      </div>
    </div>
    <div class="admin-table-wrap view-scroll" style="flex:1;min-height:0;">
      <table class="data-table mobile-card-table" style="margin-top:0;">
        <thead><tr><th>登录时间</th><th>账号与角色</th><th>状态 / 说明</th><th>IP 地址</th><th>归属地 / 网络</th><th>设备与浏览器</th></tr></thead>
        <tbody id="ll-tbody"><tr><td colspan="6" class="muted-text">加载中...</td></tr></tbody>
      </table>
    </div>
  `;

  const statusSel = host.querySelector("#ll-status");
  const kwInput = host.querySelector("#ll-kw");
  const tbody = host.querySelector("#ll-tbody");
  const statsEl = host.querySelector("#ll-stats");

  const reload = async () => {
    try {
      const url = `/api/admin/login-logs?status=${encodeURIComponent(statusSel.value)}&q=${encodeURIComponent(kwInput.value.trim())}&limit=150`;
      const res = await apiRequest(url);
      const logs = res.logs || [];
      const okCnt = logs.filter((l) => l.status === "success").length;
      const failCnt = logs.length - okCnt;
      const uniqIps = new Set(logs.map((l) => l.ip).filter(Boolean)).size;
      statsEl.innerHTML = `
        <span class="badge">记录 ${logs.length} 条</span>
        <span class="badge ok">成功 ${okCnt}</span>
        <span class="badge ${failCnt ? "bad" : ""}">失败 ${failCnt}</span>
        <span class="badge">独立 IP ${uniqIps}</span>
      `;
      tbody.innerHTML = renderLoginRowsHtml(logs);
    } catch (err) {
      showToast(err.message, "bad");
    }
  };

  let timer = null;
  statusSel.addEventListener("change", reload);
  kwInput.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reload, 220); });
  host.querySelector("#ll-refresh").addEventListener("click", reload);
  host.querySelector("#ll-clear").addEventListener("click", async () => {
    const ok = await openConfirmDialog({ title: "清空登录日志", message: "确定清空全部历史登录轨迹与 IP 记录吗？", confirmText: "确认清空", danger: true });
    if (!ok) return;
    try {
      await apiRequest("/api/admin/login-logs", { method: "DELETE" });
      showToast("已清空登录轨迹日志", "ok");
      await reload();
    } catch (err) {
      showToast(err.message, "bad");
    }
  });
  await reload();
};

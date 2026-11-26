import { apiRequest, escapeHtml, showToast } from "../api.js";
import { openConfirmDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import {
  bindAutoBackupConfig,
  bindSiteConfigCard,
  buildAuditLogsCardHtml,
  buildAutoBackupListHtml,
  buildSiteConfigCardHtml
} from "./system-extra-cards.js";

const formatUptime = (sec) => {
  const s = Number(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分 ${s % 60} 秒`;
};

const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
};

const buildCurlExample = (key) =>
`curl -X POST "${location.origin}/api/banks/default/questions" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${key || ""}" \\
  -d '{"title":"示例题目","type":"0","options":["A1","B1"],"answers":["A1"]}'`;

const buildUpdateCardHtml = (st, checkResult, outputText) => {
  const commitsHtml = checkResult?.commits?.length
    ? `<div class="commit-list">${checkResult.commits.map((c) => `
        <div class="row-gap" style="justify-content:space-between;">
          <span><code>${escapeHtml(c.hash)}</code> ${escapeHtml(c.message)}</span>
          <span class="muted-text">${escapeHtml(c.date.slice(0, 10))}</span>
        </div>`).join("")}</div>`
    : (checkResult ? `<p class="muted-text" style="margin:0;">${escapeHtml(checkResult.msg || "当前已是最新版本。")}</p>` : "");

  return `
    <section class="panel sys-card">
      <div class="row-gap" style="justify-content:space-between;">
        <h3 style="margin:0;font-size:1rem;">在线更新与服务管理</h3>
        <span class="badge ${st.dirty ? "bad" : "ok"}">${st.isGitRepo ? (st.dirty ? `未提交修改 (${st.dirtyFiles.length})` : "工作区干净") : "静态模式"}</span>
      </div>
      <div class="sys-meta-box">
        <div class="row-gap" style="margin-bottom:4px;">
          <span class="badge ok">版本 v${escapeHtml(st.appVersion || "1.1.0")}</span>
          <span class="badge">Schema v${escapeHtml(String(st.schemaVersion || 3))}</span>
          <strong>${st.isGitRepo ? `分支：${escapeHtml(st.branch)}` : "非 Git 仓库运行"}</strong>
        </div>
        ${st.isGitRepo ? `
          <div class="muted-text" style="margin-top:4px;">当前版本：<code>${escapeHtml(st.shortCommit)}</code> · ${escapeHtml(st.commitMessage)}</div>
          <div class="muted-text">提交时间：${escapeHtml(st.commitDate.slice(0, 19).replace("T", " "))}</div>
        ` : ""}
        <div class="muted-text" style="margin-top:4px;">Node.js ${escapeHtml(st.nodeVersion || "-")} · 已运行 ${formatUptime(st.uptimeSeconds)}</div>
      </div>
      ${checkResult ? `<div><div style="font-weight:600;font-size:0.8125rem;margin-bottom:6px;">${checkResult.behindCount > 0 ? `发现 ${checkResult.behindCount} 个待拉取补丁：` : "更新检查结果："}</div>${commitsHtml}</div>` : ""}
      <div id="sys-output" class="muted-text" style="font-size:0.75rem;white-space:pre-wrap;" ${outputText ? "" : "hidden"}>${escapeHtml(outputText)}</div>
      <div class="row-gap" style="justify-content:flex-end;">
        <button type="button" id="sys-check-btn" class="btn ghost tiny">检查更新</button>
        <button type="button" id="sys-pull-btn" class="btn primary tiny" ${!st.isGitRepo || st.dirty ? "disabled" : ""}>拉取更新</button>
        <button type="button" id="sys-restart-btn" class="btn ghost-danger tiny">重启服务</button>
      </div>
    </section>
  `;
};

const buildBackupCardHtml = (dbStats, maintainReport, autoBackups = [], backupConfig = {}, backupResolvedDir = "") => {
  const c = dbStats?.counts || {};
  return `
    <section class="panel sys-card">
      <div class="row-gap" style="justify-content:space-between;">
        <h3 style="margin:0;font-size:1rem;">数据库全量灾备与维护</h3>
        <span class="badge ok">${escapeHtml(dbStats?.journalMode || "WAL")} · Schema v${escapeHtml(String(dbStats?.schemaVersion || 3))} · ${formatBytes(dbStats?.dbSizeBytes)}</span>
      </div>
      <div class="sys-meta-box">
        <div class="row-gap" style="font-size:0.75rem;">
          <span class="badge">题库 ${c.banks ?? "-"}</span>
          <span class="badge">试题 ${c.questions ?? "-"}</span>
          <span class="badge">账号 ${c.users ?? "-"}</span>
          <span class="badge">考试 ${c.exams ?? "-"}</span>
          <span class="badge">交卷 ${c.submissions ?? "-"}</span>
          <span class="badge">错题聚合 ${c.wrongStats ?? "-"}</span>
          <span class="badge">上传图片 ${dbStats?.uploadCount ?? "-"}</span>
        </div>
        <p class="muted-text" style="margin:10px 0 0;font-size:0.7813rem;">推荐下载 <code>.qsbak</code> 全量包（同时含 SQLite 快照与上传配图）；恢复前会自动保存 <code>pre-restore.db</code> 快照。</p>
      </div>
      ${maintainReport ? `<div class="muted-text" style="font-size:0.7813rem;color:var(--ok);">${escapeHtml(maintainReport)}</div>` : ""}
      <div class="row-gap" style="justify-content:flex-end;">
        <label class="btn ghost-danger tiny">上传恢复 (.qsbak/.db)<input id="db-restore-file" type="file" accept=".qsbak,.db,.sqlite,.sqlite3" hidden></label>
        <button type="button" id="db-maintain-btn" class="btn ghost tiny">一键清理压缩</button>
        <a class="btn ghost tiny" href="/api/admin/backup.db" style="text-decoration:none;">导出纯库 (.db)</a>
        <a class="btn primary tiny" href="/api/admin/backup/full" style="text-decoration:none;">下载完整备份 (.qsbak)</a>
      </div>
      ${buildAutoBackupListHtml(autoBackups, backupConfig, backupResolvedDir)}
    </section>
  `;
};

const buildApiKeyCardHtml = (apiKey) => `
  <section class="panel sys-card full-span">
    <div class="row-gap" style="justify-content:space-between;">
      <div>
        <h3 style="margin:0;font-size:1rem;">外部调用 API 密钥（CRUD）</h3>
        <span class="muted-text">外部脚本或油猴扩展可在请求头携带 <code>X-API-Key</code> 或 <code>Authorization: Bearer</code> 直接增删改查题库与试题。</span>
      </div>
    </div>
    <div class="row-gap">
      <input id="apikey-value" readonly value="${escapeHtml(apiKey)}" style="flex:1;min-width:220px;font-family:ui-monospace,Menlo,monospace;">
      <button type="button" id="apikey-copy" class="btn primary tiny">${iconSvg("copy", 13)}<span>复制密钥</span></button>
      <button type="button" id="apikey-rotate" class="btn ghost-danger tiny">重置密钥</button>
    </div>
    <pre id="apikey-example" style="margin:0;padding:12px;background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;font-size:0.75rem;overflow-x:auto;">${escapeHtml(buildCurlExample(apiKey))}</pre>
  </section>
`;

const pollUntilReady = async (outputEl) => {
  outputEl.hidden = false;
  outputEl.textContent = "服务正在重启，等待重新上线...";
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const res = await fetch("/health", { cache: "no-store" });
      if (res.ok) {
        showToast("服务已重启上线，即将刷新页面", "ok");
        setTimeout(() => location.reload(), 500);
        return;
      }
    } catch { /* 等待拉起 */ }
  }
  outputEl.textContent = "等待超时：若未使用 pm2 / systemd 托管，请在服务器终端手动重启服务。";
};

export const renderSystemView = async (container, ctx) => {
  const { isAdmin, onRequireLogin } = ctx;
  if (!isAdmin) {
    container.innerHTML = `
      <div class="panel empty-state">
        <div class="empty-state-icon">${iconSvg("lock", 22)}</div>
        <strong style="font-size:1rem;">需要管理员权限</strong>
        <p class="muted-text" style="margin:0;">系统更新、数据库备份与外部 API 密钥仅对管理员开放。</p>
        <button id="sys-go-admin" class="btn primary tiny">管理员账号登录</button>
      </div>
    `;
    container.querySelector("#sys-go-admin")?.addEventListener("click", onRequireLogin);
    return;
  }

  let statusData = {};
  let dbStats = {};
  let apiKey = "";
  let siteConfig = {};
  let autoBackups = [];
  let backupConfig = {};
  let backupResolvedDir = "";
  let auditLogs = [];
  let checkResult = null;
  let outputText = "";
  let maintainReport = "";

  const loadAll = async () => {
    const [st, db, keyRes, siteRes, bakRes, audRes] = await Promise.all([
      apiRequest("/api/admin/system/status"),
      apiRequest("/api/admin/db/stats"),
      apiRequest("/api/admin/apikey"),
      apiRequest("/api/site/info"),
      apiRequest("/api/admin/backups"),
      apiRequest("/api/admin/audit-logs?limit=50")
    ]);
    statusData = st;
    dbStats = db;
    apiKey = keyRes.apiKey || "";
    siteConfig = siteRes.siteConfig || {};
    autoBackups = bakRes.backups || [];
    backupConfig = bakRes.config || {};
    backupResolvedDir = bakRes.resolvedDir || "";
    auditLogs = audRes.logs || [];
  };

  try { await loadAll(); }
  catch (err) { container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`; return; }

  const renderPage = () => {
    container.innerHTML = `
      <div class="panel view-frame">
        <div class="view-head">
          <div class="row-gap" style="justify-content:space-between;">
            <div>
              <h2 style="margin:0;">系统与维护</h2>
              <span class="muted-text">Git 版本更新、SQLite 热备份与压缩、外部 CRUD API 密钥管理</span>
            </div>
            <button type="button" id="sys-refresh-btn" class="btn ghost tiny">${iconSvg("rotate", 14)}<span>刷新状态</span></button>
          </div>
        </div>
        <div class="view-scroll" style="margin-top:14px;">
          <div class="sys-grid">
            ${buildUpdateCardHtml(statusData, checkResult, outputText)}
            ${buildBackupCardHtml(dbStats, maintainReport, autoBackups, backupConfig, backupResolvedDir)}
            ${buildSiteConfigCardHtml(siteConfig)}
            ${buildApiKeyCardHtml(apiKey)}
            ${buildAuditLogsCardHtml(auditLogs)}
          </div>
        </div>
      </div>
    `;
    bindEvents();
  };

  const bindEvents = () => {
    container.querySelector("#sys-refresh-btn").addEventListener("click", async () => {
      try { await loadAll(); checkResult = null; outputText = ""; maintainReport = ""; showToast("状态已刷新", "ok"); renderPage(); }
      catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelector("#sys-check-btn").addEventListener("click", async () => {
      try { showToast("正在连接远端仓库检查更新..."); checkResult = await apiRequest("/api/admin/system/check-update", { method: "POST" }); statusData = checkResult; renderPage(); }
      catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelector("#sys-pull-btn").addEventListener("click", async () => {
      const ok = await openConfirmDialog({ title: "拉取远端更新", message: "确认拉取远端最新代码（git pull --ff-only）吗？", confirmText: "立即拉取" });
      if (!ok) return;
      try {
        showToast("正在拉取最新补丁...");
        const res = await apiRequest("/api/admin/system/update", { method: "POST" });
        statusData = res.status;
        checkResult = null;
        outputText = `${res.updated ? `已更新：${res.beforeCommit} -> ${res.afterCommit}` : "已是最新提交"}${res.depsInstalled ? "\n已自动更新 npm 依赖" : ""}\n${res.output}`;
        showToast(res.updated ? "拉取更新成功，建议重启服务生效" : "当前已是最新版本", "ok");
        renderPage();
      } catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelector("#sys-restart-btn").addEventListener("click", async () => {
      const ok = await openConfirmDialog({ title: "重启服务", message: "确认重启服务吗？需搭配 pm2 / systemd / Docker 重启策略才会自动拉起。", confirmText: "确认重启", danger: true });
      if (!ok) return;
      try { await apiRequest("/api/admin/system/restart", { method: "POST" }); await pollUntilReady(container.querySelector("#sys-output")); }
      catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelector("#db-restore-file").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const ok = await openConfirmDialog({ title: "恢复数据库备份", message: `确定使用「${file.name}」覆盖恢复全部题库、用户与考试数据吗？系统会在恢复前自动保留一份 question-bank.pre-restore.db 快照。`, confirmText: "确认覆盖恢复", danger: true });
      if (!ok) return;
      try {
        showToast("正在校验并恢复数据库...");
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader(); r.onload = () => resolve(String(r.result || "")); r.onerror = reject; r.readAsDataURL(file);
        });
        const res = await apiRequest("/api/admin/db/restore", { method: "POST", body: JSON.stringify({ base64: dataUrl }) });
        dbStats = res.stats;
        maintainReport = `备份恢复成功（已保留 pre-restore 快照）：题库 ${res.stats?.counts?.banks ?? 0} 个 · 试题 ${res.stats?.counts?.questions ?? 0} 道${res.restoredUploads ? ` · 还原图片 ${res.restoredUploads} 张` : ""}`;
        showToast("数据库恢复完成", "ok");
        await ctx.onRefreshBanks?.();
        renderPage();
      } catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelector("#sys-auto-backup-btn")?.addEventListener("click", async () => {
      try {
        const res = await apiRequest("/api/admin/backups/run", { method: "POST" });
        autoBackups = res.backups || autoBackups;
        showToast(`已生成全量快照：${res.name}`, "ok");
        await loadAll();
        renderPage();
      } catch (err) { showToast(err.message, "bad"); }
    });
    bindAutoBackupConfig(container, {
      onSaved: async () => { await loadAll(); renderPage(); },
      onDelete: async () => { await loadAll(); renderPage(); }
    });
    bindSiteConfigCard(container, async (nextCfg) => {
      siteConfig = nextCfg;
      ctx.onSiteUpdated?.(nextCfg);
      await loadAll();
      renderPage();
    });
    container.querySelector("#db-maintain-btn").addEventListener("click", async () => {
      try {
        const res = await apiRequest("/api/admin/db/maintain", { method: "POST" });
        dbStats = res.stats;
        maintainReport = `整理完成：清理孤立进度 ${res.removedProgress} 条、孤立错题 ${res.removedWrongStats} 条、孤立图片 ${res.removedImages} 张；体积 ${formatBytes(res.beforeSizeBytes)} → ${formatBytes(res.afterSizeBytes)}`;
        showToast("数据库整理压缩完成", "ok");
        renderPage();
      } catch (err) { showToast(err.message, "bad"); }
    });
    container.querySelector("#apikey-copy").addEventListener("click", () => {
      navigator.clipboard?.writeText(apiKey).then(() => showToast("已复制 API Key", "ok")).catch(() => {});
    });
    container.querySelector("#apikey-rotate").addEventListener("click", async () => {
      const ok = await openConfirmDialog({ title: "重置 API Key", message: "重置后旧 API Key 将立即失效，确认生成新密钥吗？", confirmText: "确认重置", danger: true });
      if (!ok) return;
      try { apiKey = (await apiRequest("/api/admin/apikey", { method: "POST" })).apiKey; showToast("API Key 已重置", "ok"); renderPage(); }
      catch (err) { showToast(err.message, "bad"); }
    });
  };

  renderPage();
};

import { apiRequest, escapeHtml, showToast } from "../api.js";
import { iconSvg } from "../icons.js";

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
        <h3 style="margin:0;font-size:16px;">在线更新与服务管理</h3>
        <span class="badge ${st.dirty ? "bad" : "ok"}">${st.isGitRepo ? (st.dirty ? `未提交修改 (${st.dirtyFiles.length})` : "工作区干净") : "静态模式"}</span>
      </div>
      <div class="sys-meta-box">
        <div><strong>${st.isGitRepo ? `分支：${escapeHtml(st.branch)}` : "非 Git 仓库运行"}</strong></div>
        ${st.isGitRepo ? `
          <div class="muted-text" style="margin-top:4px;">当前版本：<code>${escapeHtml(st.shortCommit)}</code> · ${escapeHtml(st.commitMessage)}</div>
          <div class="muted-text">提交时间：${escapeHtml(st.commitDate.slice(0, 19).replace("T", " "))}</div>
        ` : ""}
        <div class="muted-text" style="margin-top:4px;">Node.js ${escapeHtml(st.nodeVersion || "-")} · 已运行 ${formatUptime(st.uptimeSeconds)}</div>
      </div>
      ${checkResult ? `<div><div style="font-weight:600;font-size:13px;margin-bottom:6px;">${checkResult.behindCount > 0 ? `发现 ${checkResult.behindCount} 个待拉取补丁：` : "更新检查结果："}</div>${commitsHtml}</div>` : ""}
      <div id="sys-output" class="muted-text" style="font-size:12px;white-space:pre-wrap;" ${outputText ? "" : "hidden"}>${escapeHtml(outputText)}</div>
      <div class="row-gap" style="justify-content:flex-end;">
        <button type="button" id="sys-check-btn" class="btn ghost tiny">检查更新</button>
        <button type="button" id="sys-pull-btn" class="btn primary tiny" ${!st.isGitRepo || st.dirty ? "disabled" : ""}>拉取更新</button>
        <button type="button" id="sys-restart-btn" class="btn ghost-danger tiny">重启服务</button>
      </div>
    </section>
  `;
};

const buildBackupCardHtml = (dbStats, maintainReport) => {
  const c = dbStats?.counts || {};
  return `
    <section class="panel sys-card">
      <div class="row-gap" style="justify-content:space-between;">
        <h3 style="margin:0;font-size:16px;">SQLite 数据库备份与维护</h3>
        <span class="badge ok">${escapeHtml(dbStats?.journalMode || "WAL")} · ${formatBytes(dbStats?.dbSizeBytes)}</span>
      </div>
      <div class="sys-meta-box">
        <div class="row-gap" style="font-size:12px;">
          <span class="badge">题库 ${c.banks ?? "-"}</span>
          <span class="badge">试题 ${c.questions ?? "-"}</span>
          <span class="badge">账号 ${c.users ?? "-"}</span>
          <span class="badge">考试 ${c.exams ?? "-"}</span>
          <span class="badge">交卷 ${c.submissions ?? "-"}</span>
          <span class="badge">错题聚合 ${c.wrongStats ?? "-"}</span>
          <span class="badge">上传图片 ${dbStats?.uploadCount ?? "-"}</span>
        </div>
        <p class="muted-text" style="margin:10px 0 0;font-size:12.5px;">下载备份将通过 <code>VACUUM INTO</code> 生成完整原子快照；一键维护可清理孤立进度、孤立图片并压缩空闲页。</p>
      </div>
      ${maintainReport ? `<div class="muted-text" style="font-size:12.5px;color:var(--ok);">${escapeHtml(maintainReport)}</div>` : ""}
      <div class="row-gap" style="justify-content:flex-end;">
        <button type="button" id="db-maintain-btn" class="btn ghost tiny">一键清理并压缩 (VACUUM)</button>
        <a class="btn primary tiny" href="/api/admin/backup.db" style="text-decoration:none;">下载数据库备份 (.db)</a>
      </div>
    </section>
  `;
};

const buildApiKeyCardHtml = (apiKey) => `
  <section class="panel sys-card full-span">
    <div class="row-gap" style="justify-content:space-between;">
      <div>
        <h3 style="margin:0;font-size:16px;">外部调用 API 密钥（CRUD）</h3>
        <span class="muted-text">外部脚本或油猴扩展可在请求头携带 <code>X-API-Key</code> 或 <code>Authorization: Bearer</code> 直接增删改查题库与试题。</span>
      </div>
    </div>
    <div class="row-gap">
      <input id="apikey-value" readonly value="${escapeHtml(apiKey)}" style="flex:1;min-width:220px;font-family:ui-monospace,Menlo,monospace;">
      <button type="button" id="apikey-copy" class="btn primary tiny">${iconSvg("copy", 13)}<span>复制密钥</span></button>
      <button type="button" id="apikey-rotate" class="btn ghost-danger tiny">重置密钥</button>
    </div>
    <pre id="apikey-example" style="margin:0;padding:12px;background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;font-size:12px;overflow-x:auto;">${escapeHtml(buildCurlExample(apiKey))}</pre>
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
        <strong style="font-size:16px;">需要管理员权限</strong>
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
  let checkResult = null;
  let outputText = "";
  let maintainReport = "";

  const loadAll = async () => {
    const [st, db, keyRes] = await Promise.all([
      apiRequest("/api/admin/system/status"),
      apiRequest("/api/admin/db/stats"),
      apiRequest("/api/admin/apikey")
    ]);
    statusData = st;
    dbStats = db;
    apiKey = keyRes.apiKey || "";
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
            ${buildBackupCardHtml(dbStats, maintainReport)}
            ${buildApiKeyCardHtml(apiKey)}
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
      if (!confirm("确认拉取远端最新代码（git pull --ff-only）吗？")) return;
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
      if (!confirm("确认重启服务吗？需搭配 pm2 / systemd / Docker 重启策略才会自动拉起。")) return;
      try { await apiRequest("/api/admin/system/restart", { method: "POST" }); await pollUntilReady(container.querySelector("#sys-output")); }
      catch (err) { showToast(err.message, "bad"); }
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
      if (!confirm("重置后旧 API Key 将立即失效，确认重置吗？")) return;
      try { apiKey = (await apiRequest("/api/admin/apikey", { method: "POST" })).apiKey; showToast("API Key 已重置", "ok"); renderPage(); }
      catch (err) { showToast(err.message, "bad"); }
    });
  };

  renderPage();
};

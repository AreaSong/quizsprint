import { apiRequest, escapeHtml, showToast } from "./api.js";

const formatUptime = (sec) => {
  const s = Number(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分 ${s % 60} 秒`;
};

const buildTabsBar = (activeTab) => `
  <div class="row-gap" style="border-bottom:1px solid var(--line);padding-bottom:8px;">
    ${[["update", "在线更新"], ["backup", "数据备份"]].map(([k, label]) => `
      <button type="button" class="btn tiny ${activeTab === k ? "primary" : "ghost"} js-sys-tab" data-tab="${k}">${label}</button>
    `).join("")}
  </div>
`;

const buildUpdateHtml = (st, checkResult = null) => {
  const commitsHtml = checkResult?.commits?.length
    ? `<div class="commit-list">${checkResult.commits.map((c) => `
        <div class="row-gap" style="justify-content:space-between;">
          <span><code>${escapeHtml(c.hash)}</code> ${escapeHtml(c.message)}</span>
          <span class="muted-text">${escapeHtml(c.date.slice(0, 10))}</span>
        </div>`).join("")}</div>`
    : (checkResult ? `<p class="muted-text" style="margin:0;">${escapeHtml(checkResult.msg || "当前已是最新版本。")}</p>` : "");

  return `
    <div class="panel" style="padding:12px;background:var(--surface-soft);">
      <div class="row-gap" style="justify-content:space-between;">
        <strong>${st.isGitRepo ? `分支：${escapeHtml(st.branch)}` : "非 Git 仓库运行"}</strong>
        <span class="badge ${st.dirty ? "bad" : "ok"}">${st.isGitRepo ? (st.dirty ? `有未提交修改 (${st.dirtyFiles.length})` : "工作区干净") : "容器/静态模式"}</span>
      </div>
      ${st.isGitRepo ? `
        <div class="muted-text" style="margin-top:6px;">当前版本：<code>${escapeHtml(st.shortCommit)}</code> · ${escapeHtml(st.commitMessage)}</div>
        <div class="muted-text">提交时间：${escapeHtml(st.commitDate.slice(0, 19).replace("T", " "))}</div>
      ` : ""}
      <div class="muted-text" style="margin-top:4px;">Node.js ${escapeHtml(st.nodeVersion)} · 已运行 ${formatUptime(st.uptimeSeconds)}</div>
    </div>
    ${checkResult ? `<div><div style="font-weight:600;margin-bottom:6px;">${checkResult.behindCount > 0 ? `发现 ${checkResult.behindCount} 个待拉取补丁：` : "更新检查结果："}</div>${commitsHtml}</div>` : ""}
    <div id="sys-output" class="muted-text" style="font-size:12px;white-space:pre-wrap;" hidden></div>
    <div class="row-gap" style="justify-content:flex-end;">
      <button type="button" id="sys-check-btn" class="btn ghost">检查更新</button>
      <button type="button" id="sys-pull-btn" class="btn primary" ${!st.isGitRepo || st.dirty ? "disabled" : ""}>拉取更新 (git pull)</button>
      <button type="button" id="sys-restart-btn" class="btn danger">重启服务生效</button>
    </div>
  `;
};

const buildBackupHtml = () => `
  <div class="panel" style="padding:14px;background:var(--surface-soft);">
    <h4 style="margin:0 0 6px;">SQLite 数据库快照备份</h4>
    <p class="muted-text" style="margin:0 0 12px;">一键下载完整的 <code>question-bank.db</code>（包含全部题库、试题、学员账号、练习进度与考试成绩单）。</p>
    <a class="btn primary" href="/api/admin/backup.db" style="display:inline-block;text-decoration:none;">下载数据库备份 (.db)</a>
  </div>
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

export const initSystemAndDisclaimerModals = () => {
  const disclaimerModal = document.getElementById("disclaimer-modal");
  document.addEventListener("click", (e) => {
    if (e.target.closest(".js-open-disclaimer")) { e.preventDefault(); if (disclaimerModal) disclaimerModal.hidden = false; }
  });
  document.getElementById("disclaimer-close")?.addEventListener("click", () => { disclaimerModal.hidden = true; });
  document.getElementById("disclaimer-ok")?.addEventListener("click", () => { disclaimerModal.hidden = true; });

  const sysBtn = document.getElementById("sys-update-btn");
  const sysModal = document.getElementById("sys-modal");
  const sysBody = document.getElementById("sys-body");
  document.getElementById("sys-close")?.addEventListener("click", () => { sysModal.hidden = true; });

  let activeTab = "update";
  let cachedStatus = null;

  const loadTabAndRender = async (tab) => {
    activeTab = tab;
    if (tab === "update" && !cachedStatus) cachedStatus = await apiRequest("/api/admin/system/status");
    renderPanel();
  };

  const renderPanel = (checkResult = null, outputText = "") => {
    const content = activeTab === "update" ? buildUpdateHtml(cachedStatus || {}, checkResult) : buildBackupHtml();
    sysBody.innerHTML = `${buildTabsBar(activeTab)}${content}`;
    sysBody.querySelectorAll(".js-sys-tab").forEach((b) => b.addEventListener("click", () => loadTabAndRender(b.dataset.tab).catch((e) => showToast(e.message, "bad"))));

    const outEl = sysBody.querySelector("#sys-output");
    if (outputText && outEl) { outEl.hidden = false; outEl.textContent = outputText; }

    sysBody.querySelector("#sys-check-btn")?.addEventListener("click", async () => {
      try {
        showToast("正在连接远端仓库检查更新...");
        const res = await apiRequest("/api/admin/system/check-update", { method: "POST" });
        cachedStatus = res;
        renderPanel(res);
      } catch (err) { showToast(err.message, "bad"); }
    });

    sysBody.querySelector("#sys-pull-btn")?.addEventListener("click", async () => {
      if (!confirm("确认拉取远端最新代码（git pull --ff-only）吗？")) return;
      try {
        showToast("正在拉取最新补丁...");
        const res = await apiRequest("/api/admin/system/update", { method: "POST" });
        cachedStatus = res.status;
        const summary = `${res.updated ? `已更新：${res.beforeCommit} -> ${res.afterCommit}` : "已是最新提交"}${res.depsInstalled ? "\n已自动更新 npm 依赖" : ""}\n${res.output}`;
        showToast(res.updated ? "拉取更新成功，建议点击「重启服务生效」" : "当前已是最新版本", "ok");
        renderPanel(null, summary);
      } catch (err) { showToast(err.message, "bad"); }
    });

    sysBody.querySelector("#sys-restart-btn")?.addEventListener("click", async () => {
      if (!confirm("确认重启服务吗？需搭配 pm2 / systemd / Docker 重启策略才会自动拉起。")) return;
      try {
        await apiRequest("/api/admin/system/restart", { method: "POST" });
        await pollUntilReady(sysBody.querySelector("#sys-output"));
      } catch (err) { showToast(err.message, "bad"); }
    });
  };

  sysBtn?.addEventListener("click", async () => {
    sysModal.hidden = false;
    cachedStatus = null;
    sysBody.innerHTML = '<p class="muted-text">正在读取系统状态...</p>';
    try { await loadTabAndRender("update"); } catch (err) { sysBody.innerHTML = `<p class="muted-text">${escapeHtml(err.message)}</p>`; }
  });
};

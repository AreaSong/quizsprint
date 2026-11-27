import { apiRequest, escapeHtml, showToast } from "./api.js";

const renderChangelogHtml = (info) => {
  const lines = String(info?.changelog || "暂无更新日志。").trim().split(/\r?\n/);
  return lines.map((line) => {
    if (line.startsWith("## ")) return `<h4 style="margin:12px 0 4px;color:var(--accent-fg);">${escapeHtml(line.slice(3))}</h4>`;
    if (line.startsWith("### ")) return `<div style="font-weight:700;margin:6px 0 2px;">${escapeHtml(line.slice(4))}</div>`;
    if (line.startsWith("- ")) return `<div style="padding-left:10px;">• ${escapeHtml(line.slice(2))}</div>`;
    return line.trim() ? `<div class="muted-text">${escapeHtml(line)}</div>` : "";
  }).join("");
};

const renderContentUpdatesHtml = (updates = [], isAdmin = false) => `
  <div style="margin-bottom:12px;padding:10px 12px;border-radius:10px;background:var(--surface-soft);border:1px solid var(--line);">
    <div class="row-gap" style="justify-content:space-between;margin-bottom:8px;">
      <strong>题库与内容更新动态</strong>
      <span class="badge">${updates.length} 条记录</span>
    </div>
    ${isAdmin ? `
      <form id="cl-cu-form" class="row-gap" style="gap:6px;margin-bottom:8px;">
        <select id="cl-cu-cat" style="padding:4px 8px;font-size:0.75rem;">
          ${["导题", "题库", "题目", "考试", "公告", "更新"].map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <input id="cl-cu-title" placeholder="记录新增题目、新题库或通知说明..." required maxlength="120" style="flex:1;min-width:140px;padding:4px 8px;font-size:0.75rem;">
        <button type="submit" class="btn primary tiny">发布动态</button>
      </form>
    ` : ""}
    <div style="display:flex;flex-direction:column;gap:5px;max-height:170px;overflow-y:auto;">
      ${updates.map((u) => `
        <div class="row-gap" style="justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed var(--line);">
          <div style="min-width:0;flex:1;">
            <span class="badge">${escapeHtml(u.category || "更新")}</span>
            <span class="muted-text" style="font-size:0.7188rem;margin:0 4px;">${escapeHtml(u.date || "")}</span>
            <span>${escapeHtml(u.title || "")}</span>
            ${u.detail ? `<span class="muted-text" style="font-size:0.7188rem;"> · ${escapeHtml(u.detail)}</span>` : ""}
          </div>
          ${isAdmin ? `<button type="button" class="btn ghost-danger tiny js-del-cu" data-cu-id="${escapeHtml(u.id)}" style="padding:1px 6px;">×</button>` : ""}
        </div>
      `).join("") || '<span class="muted-text" style="font-size:0.75rem;">暂无内容更新记录，后续新建题库、批量导题、录入试题与发布考试将自动记入此处。</span>'}
    </div>
  </div>
`;

let latestSiteInfo = null;
let latestIsAdmin = false;
let changelogClickBound = false;

const bindChangelogAdminEvents = (modal, info, isAdmin) => {
  modal.querySelector("#cl-cu-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = modal.querySelector("#cl-cu-title").value.trim();
    if (!title) return;
    try {
      const res = await apiRequest("/api/admin/content-updates", {
        method: "POST",
        body: JSON.stringify({ category: modal.querySelector("#cl-cu-cat").value, title })
      });
      info.contentUpdates = res.updates || [];
      showToast("已记录到更新动态", "ok");
      openChangelogModal(info, isAdmin);
    } catch (err) { showToast(err.message, "bad"); }
  });
  modal.querySelectorAll(".js-del-cu").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const res = await apiRequest(`/api/admin/content-updates/${encodeURIComponent(btn.dataset.cuId)}`, { method: "DELETE" });
      info.contentUpdates = res.updates || [];
      openChangelogModal(info, isAdmin);
    } catch (err) { showToast(err.message, "bad"); }
  }));
};

export const openChangelogModal = (info, isAdmin = latestIsAdmin) => {
  const modal = document.getElementById("site-modal");
  if (!modal) return;
  delete modal.dataset.lockDismiss;
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card modal-shell" style="max-width:640px;">
      <div class="modal-head">
        <h3>版本与更新日志 · v${escapeHtml(info?.version || "1.2.0")}</h3>
        <button type="button" id="cl-close" class="btn ghost tiny" data-modal-close>关闭</button>
      </div>
      <div class="modal-body" style="font-size:0.8125rem;line-height:1.65;">
        <div class="row-gap" style="margin-bottom:10px;">
          <span class="badge ok">应用版本 v${escapeHtml(info?.version || "1.2.0")}</span>
          <span class="badge">数据库 Schema v${escapeHtml(String(info?.schemaVersion || 3))}</span>
        </div>
        ${renderContentUpdatesHtml(info?.contentUpdates || [], isAdmin)}
        ${renderChangelogHtml(info)}
      </div>
    </div>
  `;
  modal.querySelector("#cl-close").addEventListener("click", () => { modal.hidden = true; });
  if (isAdmin) bindChangelogAdminEvents(modal, info, isAdmin);
};

/** 将站点名称、公告栏与页脚版本应用到全局外壳 */
export const applySiteInfo = (info, isAdmin) => {
  if (isAdmin !== undefined) latestIsAdmin = Boolean(isAdmin);
  if (!info) return;
  latestSiteInfo = info;
  if (!changelogClickBound) {
    changelogClickBound = true;
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".js-open-changelog")) return;
      const appMenu = document.getElementById("appearance-menu");
      if (appMenu) appMenu.hidden = true;
      openChangelogModal(latestSiteInfo, latestIsAdmin);
    });
  }
  const cfg = info.siteConfig || {};
  const name = cfg.siteName || "QuizSprint";
  const sub = cfg.subtitle || "Question Bank";
  const nameEl = document.getElementById("site-brand-name");
  const subEl = document.getElementById("site-brand-sub");
  if (nameEl) nameEl.textContent = name;
  if (subEl) subEl.textContent = sub;
  document.title = `${name} · 自托管题库与在线考试学习平台`;

  const footerNoteEl = document.getElementById("site-footer-note");
  if (footerNoteEl && cfg.footerNote) footerNoteEl.textContent = cfg.footerNote;

  const verBtn = document.getElementById("app-version-btn");
  if (verBtn) {
    verBtn.textContent = `v${info.version || "1.2.0"}`;
    verBtn.onclick = () => openChangelogModal(info, latestIsAdmin);
  }

  const bar = document.getElementById("site-announcement-bar");
  const barText = document.getElementById("site-announcement-text");
  const barClose = document.getElementById("site-announcement-close");
  if (bar && barText) {
    const ann = String(cfg.announcement || "").trim();
    const dismissed = sessionStorage.getItem("qs_dismiss_ann") === ann;
    barText.textContent = ann ? `📢 ${ann}` : "";
    bar.hidden = !ann || dismissed;
    if (barClose) {
      barClose.onclick = () => {
        if (ann) sessionStorage.setItem("qs_dismiss_ann", ann);
        bar.hidden = true;
      };
    }
  }
};

/** 首次空库访问时引导创建管理员与站点名称 */
export const maybeOpenSetupWizard = (info, onCompleted) => {
  if (!info?.needsSetup) return;
  const modal = document.getElementById("site-modal");
  if (!modal) return;
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card modal-shell" style="max-width:460px;">
      <div class="modal-head">
        <h3>首次部署初始化向导</h3>
        <button type="button" id="setup-skip" class="btn ghost tiny" data-modal-close>稍后配置</button>
      </div>
      <form id="setup-form" class="stack-form">
        <div class="modal-body stack-form">
          <p class="muted-text" style="margin:0;">检测到当前系统尚未创建管理员账号，请设置站点名称并创建首个管理员账号（无需再查看终端临时密码）。</p>
          <label><span>站点名称</span><input id="st-site-name" value="${escapeHtml(info.siteConfig?.siteName || "QuizSprint")}" required></label>
          <label><span>管理员用户名（2-24位）</span><input id="st-admin-user" value="admin" required></label>
          <label><span>管理员昵称</span><input id="st-admin-nick" value="管理员" required></label>
          <label><span>管理员登录密码（至少 4 位）</span><input id="st-admin-pass" type="password" required placeholder="请牢记此密码"></label>
        </div>
        <div class="modal-foot">
          <button type="submit" class="btn primary">完成初始化并登录</button>
        </div>
      </form>
    </div>
  `;
  modal.querySelector("#setup-skip").addEventListener("click", () => { modal.hidden = true; });
  modal.querySelector("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          siteName: modal.querySelector("#st-site-name").value.trim(),
          username: modal.querySelector("#st-admin-user").value.trim(),
          nickname: modal.querySelector("#st-admin-nick").value.trim(),
          password: modal.querySelector("#st-admin-pass").value
        })
      });
      modal.hidden = true;
      showToast("系统初始化完成，已自动登录管理员", "ok");
      await onCompleted?.();
    } catch (err) {
      showToast(err.message, "bad");
    }
  });
};

export const exportMyProgressJson = async () => {
  try {
    const data = await apiRequest("/api/user/progress/export");
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quizsprint-progress-${data.username || "user"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    showToast("学习进度与笔记已导出", "ok");
  } catch (err) {
    showToast(err.message, "bad");
  }
};

export const triggerImportMyProgress = (onDone) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const res = await apiRequest("/api/user/progress/import", { method: "POST", body: JSON.stringify(payload) });
      showToast(`已导入 ${res.importedBanks || 0} 个题库的刷题进度与笔记`, "ok");
      await onDone?.();
    } catch (err) {
      showToast(err.message || "进度文件解析失败", "bad");
    }
  };
  input.click();
};

const buildForceChangePwdHtml = (user) => `
  <div class="modal-card modal-shell" style="max-width:440px;">
    <div class="modal-head">
      <h3>首次登录请修改初始密码</h3>
      <span class="badge warn">必须完成</span>
    </div>
    <form id="fcp-form" class="stack-form">
      <div class="modal-body stack-form">
        <p class="muted-text" style="margin:0;line-height:1.6;">账号 <strong>${escapeHtml(user.username)}</strong> 当前仍在使用管理员分配的初始密码，请立即修改为您的个人密码后继续使用。</p>
        <label><span>当前初始密码</span><input id="fcp-old" type="password" required autocomplete="current-password" placeholder="请输入管理员分配的初始密码"></label>
        <label><span>新密码（至少 4 位，不能与初始密码相同）</span><input id="fcp-new" type="password" required autocomplete="new-password" placeholder="请输入新的个人密码"></label>
        <label><span>确认新密码</span><input id="fcp-confirm" type="password" required autocomplete="new-password" placeholder="再次输入新密码"></label>
      </div>
      <div class="modal-foot" style="justify-content:space-between;">
        <button type="button" id="fcp-logout" class="btn ghost tiny">退出登录</button>
        <button type="submit" id="fcp-submit" class="btn primary">确认修改并继续</button>
      </div>
    </form>
  </div>
`;

/** 管理员新建账号首次登录时强制弹出不可跳过的改密弹窗 */
export const ensureForceChangePasswordModal = (user, { onChanged, onLogout } = {}) => {
  const modal = document.getElementById("site-modal");
  if (!modal || !user?.mustChangePassword) return false;
  if (!modal.hidden && modal.querySelector("#fcp-form")) return true;
  modal.dataset.lockDismiss = "1";
  modal.hidden = false;
  modal.innerHTML = buildForceChangePwdHtml(user);

  const cleanup = () => { delete modal.dataset.lockDismiss; modal.hidden = true; modal.innerHTML = ""; };
  modal.querySelector("#fcp-logout").addEventListener("click", async () => { cleanup(); await onLogout?.(); });
  modal.querySelector("#fcp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPassword = modal.querySelector("#fcp-old").value;
    const newPassword = modal.querySelector("#fcp-new").value;
    const confirmPwd = modal.querySelector("#fcp-confirm").value;
    if (newPassword.length < 4) return showToast("新密码至少需要 4 位", "bad");
    if (newPassword !== confirmPwd) return showToast("两次输入的新密码不一致", "bad");
    if (newPassword === oldPassword) return showToast("新密码不能与初始密码相同", "bad");
    const submitBtn = modal.querySelector("#fcp-submit");
    submitBtn.disabled = true;
    try {
      await apiRequest("/api/user/password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) });
      cleanup();
      showToast("密码修改成功，欢迎使用！", "ok");
      await onChanged?.();
    } catch (err) {
      submitBtn.disabled = false;
      showToast(err.message, "bad");
    }
  });
  modal.querySelector("#fcp-old").focus();
  return true;
};

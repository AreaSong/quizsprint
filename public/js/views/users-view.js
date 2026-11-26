import { apiRequest, escapeHtml, getCloudUser, showToast } from "../api.js";
import { openConfirmDialog, openFormDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";

const buildUsersShellHtml = (regPolicy) => `
  <div class="panel view-frame">
    <div class="view-head">
      <div class="row-gap" style="justify-content:space-between;">
        <div>
          <h2 style="margin:0;">用户与门禁</h2>
          <div id="usr-stats" class="row-gap" style="margin-top:6px;"></div>
        </div>
        <button id="usr-add-btn" type="button" class="btn primary tiny">+ 新建账号</button>
      </div>

      <div class="panel" style="margin-top:12px;padding:12px 14px;background:var(--surface-soft);">
        <div class="row-gap" style="justify-content:space-between;flex-wrap:wrap;">
          <div>
            <strong>公网注册门禁</strong>
            <span class="muted-text" style="font-size:0.75rem;margin-left:8px;">控制未登录访客是否可自主注册学员账号</span>
          </div>
          <div class="row-gap" style="flex-wrap:wrap;">
            <div class="exam-seg">
              ${[["open", "开放注册"], ["invite", "凭邀请码"], ["closed", "仅管理员开号"]].map(([v, lbl]) => `
                <label class="exam-seg-opt inline-field"><input type="radio" name="reg-mode-radio" value="${v}" ${regPolicy.mode === v ? "checked" : ""}><span>${lbl}</span></label>
              `).join("")}
            </div>
            <span id="reg-invite-wrap" class="row-gap" ${regPolicy.mode === "invite" ? "" : "hidden"}>
              <input id="reg-invite-code" value="${escapeHtml(regPolicy.inviteCode)}" placeholder="设置注册邀请码" style="width:140px;">
              <button type="button" id="reg-copy-invite" class="btn ghost tiny" title="复制邀请码">${iconSvg("copy", 13)}</button>
              <button type="button" id="reg-gen-invite" class="btn ghost tiny">随机生成</button>
            </span>
            <button type="button" id="reg-save-btn" class="btn primary tiny">保存门禁</button>
          </div>
        </div>
      </div>

      <div class="row-gap" style="margin-top:10px;">
        <select id="usr-role-filter">
          <option value="">全部角色</option>
          <option value="student">学员</option>
          <option value="admin">管理员</option>
        </select>
        <input id="usr-kw" type="search" placeholder="搜索用户名或昵称..." style="flex:1;min-width:180px;">
      </div>
    </div>

    <div class="admin-table-wrap view-scroll" style="margin-top:12px;">
      <table class="data-table">
        <thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody id="usr-tbody"></tbody>
      </table>
    </div>
  </div>
`;

const buildUsersRowsHtml = (filtered, me) => {
  if (!filtered.length) return '<tr><td colspan="5" class="muted-text">没有匹配的账号</td></tr>';
  return filtered.map((u) => {
    const isMe = Boolean(me && (u.id === me.id || u.username === me.username));
    return `
      <tr data-uid="${escapeHtml(u.id)}">
        <td><code>${escapeHtml(u.username)}</code> ${isMe ? '<span class="badge">当前账号</span>' : ""}</td>
        <td>${escapeHtml(u.nickname)}</td>
        <td><span class="badge ${u.role === "admin" ? "warn" : ""}">${u.role === "admin" ? "管理员" : "学员"}</span></td>
        <td class="muted-text">${escapeHtml((u.createdAt || "").slice(0, 16).replace("T", " "))}</td>
        <td>
          <div class="row-gap" style="gap:6px;">
            <button type="button" class="btn ghost tiny js-usr-nick">改昵称</button>
            <button type="button" class="btn ghost tiny js-usr-pwd">重置密码</button>
            <button type="button" class="btn ghost tiny js-usr-role" data-next="${u.role === "admin" ? "student" : "admin"}" ${isMe ? 'disabled title="不能降级当前登录账号"' : ""}>${u.role === "admin" ? "设为学员" : "设为管理"}</button>
            <button type="button" class="btn ghost tiny js-usr-clr">清进度</button>
            <button type="button" class="btn ghost-danger tiny js-usr-del" ${isMe ? 'disabled title="不能删除当前登录账号"' : ""}>删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
};

export const renderUsersView = async (container, ctx) => {
  const { isAdmin, onRequireLogin } = ctx;
  if (!isAdmin) {
    container.innerHTML = `
      <div class="panel empty-state">
        <div class="empty-state-icon">${iconSvg("lock", 22)}</div>
        <strong style="font-size:1rem;">需要管理员权限</strong>
        <p class="muted-text" style="margin:0;">用户管理仅对管理员账号开放，请先使用管理员账号登录。</p>
        <button id="u-go-admin" class="btn primary tiny">管理员账号登录</button>
      </div>
    `;
    container.querySelector("#u-go-admin")?.addEventListener("click", onRequireLogin);
    return;
  }

  let users = [];
  let regPolicy = { mode: "open", inviteCode: "" };
  const state = { keyword: "", role: "" };

  const loadUsers = async () => {
    const [uRes, pRes] = await Promise.all([apiRequest("/api/admin/users"), apiRequest("/api/admin/registration")]);
    users = uRes.users || [];
    regPolicy = { mode: pRes.mode || "open", inviteCode: pRes.inviteCode || "" };
  };

  try { await loadUsers(); }
  catch (err) { container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`; return; }

  container.innerHTML = buildUsersShellHtml(regPolicy);
  const statsEl = container.querySelector("#usr-stats");
  const tbodyEl = container.querySelector("#usr-tbody");
  const regInviteWrap = container.querySelector("#reg-invite-wrap");
  const regInviteInput = container.querySelector("#reg-invite-code");
  const getSelectedRegMode = () => container.querySelector('input[name="reg-mode-radio"]:checked')?.value || "open";

  const renderListPart = () => {
    const adminCnt = users.filter((u) => u.role === "admin").length;
    const studentCnt = users.length - adminCnt;
    const kw = state.keyword.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (state.role && u.role !== state.role) return false;
      if (kw && !`${u.username} ${u.nickname}`.toLowerCase().includes(kw)) return false;
      return true;
    });
    statsEl.innerHTML = `
      <span class="badge">总账号 ${users.length}</span>
      <span class="badge warn">管理员 ${adminCnt}</span>
      <span class="badge ok">学员 ${studentCnt}</span>
    `;
    tbodyEl.innerHTML = buildUsersRowsHtml(filtered, getCloudUser());
  };

  container.querySelector("#usr-role-filter").addEventListener("change", (e) => { state.role = e.target.value; renderListPart(); });
  container.querySelector("#usr-kw").addEventListener("input", (e) => { state.keyword = e.target.value; renderListPart(); });
  container.querySelectorAll('input[name="reg-mode-radio"]').forEach((r) => {
    r.addEventListener("change", () => { regInviteWrap.hidden = getSelectedRegMode() !== "invite"; });
  });
  container.querySelector("#reg-copy-invite").addEventListener("click", () => {
    const code = regInviteInput.value.trim();
    if (!code) return showToast("请先输入或生成邀请码", "bad");
    navigator.clipboard?.writeText(code).then(() => showToast("已复制邀请码", "ok")).catch(() => {});
  });
  container.querySelector("#reg-gen-invite").addEventListener("click", () => {
    regInviteInput.value = Math.random().toString(36).slice(2, 10).toUpperCase();
  });
  container.querySelector("#reg-save-btn").addEventListener("click", async () => {
    try {
      const res = await apiRequest("/api/admin/registration", { method: "PUT", body: JSON.stringify({ mode: getSelectedRegMode(), inviteCode: regInviteInput.value.trim() }) });
      regPolicy = { mode: res.mode, inviteCode: res.inviteCode || "" };
      showToast("注册门禁设置已保存", "ok");
    } catch (err) { showToast(err.message, "bad"); }
  });

  container.querySelector("#usr-add-btn").addEventListener("click", async () => {
    const form = await openFormDialog({
      title: "新建用户账号",
      fields: [
        { name: "username", label: "用户名", required: true, placeholder: "2-24位中英文、数字或下划线" },
        { name: "nickname", label: "昵称（可选）", placeholder: "排行榜展示昵称" },
        { name: "password", label: "初始密码（至少 4 位）", type: "password", required: true },
        { name: "role", label: "账号角色", type: "select", value: "student", options: [{ value: "student", label: "学员" }, { value: "admin", label: "管理员" }] }
      ],
      submitText: "创建账号"
    });
    if (!form) return;
    try { await apiRequest("/api/admin/users", { method: "POST", body: JSON.stringify(form) }); showToast("账号已创建", "ok"); await loadUsers(); renderListPart(); }
    catch (err) { showToast(err.message, "bad"); }
  });

  tbodyEl.addEventListener("click", async (e) => {
    const uid = e.target.closest("tr")?.dataset.uid;
    if (!uid) return;
    if (e.target.closest(".js-usr-nick")) {
      const targetUser = users.find((x) => x.id === uid);
      const form = await openFormDialog({ title: "修改账号信息", fields: [{ name: "nickname", label: "显示昵称", value: targetUser?.nickname || "", required: true }], submitText: "保存修改" });
      if (!form || !form.nickname.trim()) return;
      try { await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/profile`, { method: "PUT", body: JSON.stringify({ nickname: form.nickname.trim() }) }); showToast("账号昵称已更新", "ok"); await loadUsers(); renderListPart(); }
      catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (e.target.closest(".js-usr-clr")) {
      const ok = await openConfirmDialog({ title: "清空刷题进度", message: "确定清空该账号在所有题库的练习记录、笔记与学习统计吗？", confirmText: "确认清空", danger: true });
      if (!ok) return;
      try { await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/progress`, { method: "DELETE" }); showToast("已清空该账号刷题进度", "ok"); }
      catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (e.target.closest(".js-usr-pwd")) {
      const form = await openFormDialog({ title: "重置账号密码", fields: [{ name: "newPassword", label: "新密码（至少 4 位）", type: "password", required: true }], submitText: "保存新密码" });
      if (!form) return;
      try { await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/password`, { method: "POST", body: JSON.stringify(form) }); showToast("密码已重置", "ok"); }
      catch (err) { showToast(err.message, "bad"); }
      return;
    }
    const roleBtn = e.target.closest(".js-usr-role");
    if (roleBtn) {
      try { await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/role`, { method: "PUT", body: JSON.stringify({ role: roleBtn.dataset.next }) }); showToast("角色已更新", "ok"); await loadUsers(); renderListPart(); }
      catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (e.target.closest(".js-usr-del")) {
      const ok = await openConfirmDialog({ title: "删除账号", message: "确定删除该账号及其全部练习进度吗？", confirmText: "确认删除", danger: true });
      if (!ok) return;
      try { await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}`, { method: "DELETE" }); showToast("账号已删除", "ok"); await loadUsers(); renderListPart(); }
      catch (err) { showToast(err.message, "bad"); }
    }
  });

  renderListPart();
};

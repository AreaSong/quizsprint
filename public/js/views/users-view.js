import { apiRequest, escapeHtml, showToast } from "../api.js";
import { openFormDialog } from "../dialog.js";

export const renderUsersView = async (container, ctx) => {
  const { isAdmin, onRequireLogin } = ctx;
  if (!isAdmin) {
    container.innerHTML = `
      <div class="panel" style="max-width:520px;margin:28px auto;text-align:center;">
        <h2 style="margin-top:0;">需要管理员权限</h2>
        <p class="muted-text">用户管理仅对管理员账号开放，请使用管理员账号（如 admin）登录后查看或管理成员账号。</p>
        <button id="u-go-admin" class="btn primary">管理员账号登录</button>
      </div>
    `;
    container.querySelector("#u-go-admin")?.addEventListener("click", onRequireLogin);
    return;
  }

  let users = [];
  let regPolicy = { mode: "open", inviteCode: "" };
  const state = { keyword: "", role: "" };

  const loadUsers = async () => {
    const [uRes, pRes] = await Promise.all([
      apiRequest("/api/admin/users"),
      apiRequest("/api/admin/registration")
    ]);
    users = uRes.users || [];
    regPolicy = { mode: pRes.mode || "open", inviteCode: pRes.inviteCode || "" };
  };

  try {
    await loadUsers();
  } catch (err) {
    container.innerHTML = `<div class="panel"><p class="muted-text">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const renderBody = () => {
    const adminCnt = users.filter((u) => u.role === "admin").length;
    const studentCnt = users.length - adminCnt;
    const kw = state.keyword.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (state.role && u.role !== state.role) return false;
      if (kw && !`${u.username} ${u.nickname}`.toLowerCase().includes(kw)) return false;
      return true;
    });

    container.innerHTML = `
      <div class="panel view-frame">
        <div class="view-head">
          <div class="row-gap" style="justify-content:space-between;">
            <div>
              <h2 style="margin:0;">用户管理</h2>
              <div class="row-gap" style="margin-top:6px;">
                <span class="badge">总账号 ${users.length}</span>
                <span class="badge warn">管理员 ${adminCnt}</span>
                <span class="badge ok">学员 ${studentCnt}</span>
              </div>
            </div>
            <button id="usr-add-btn" class="btn primary">+ 新建账号</button>
          </div>

          <div class="panel" style="margin-top:12px;padding:12px;background:var(--surface-soft);">
            <div class="row-gap" style="justify-content:space-between;flex-wrap:wrap;">
              <div>
                <strong>公网注册门禁</strong>
                <span class="muted-text" style="font-size:12px;margin-left:8px;">控制未登录访客是否可自行注册学员账号</span>
              </div>
              <div class="row-gap" style="flex-wrap:wrap;">
                <select id="reg-mode">
                  <option value="open" ${regPolicy.mode === "open" ? "selected" : ""}>开放自主注册</option>
                  <option value="invite" ${regPolicy.mode === "invite" ? "selected" : ""}>凭邀请码注册</option>
                  <option value="closed" ${regPolicy.mode === "closed" ? "selected" : ""}>仅管理员手动开号</option>
                </select>
                <span id="reg-invite-wrap" class="row-gap" ${regPolicy.mode === "invite" ? "" : "hidden"}>
                  <input id="reg-invite-code" value="${escapeHtml(regPolicy.inviteCode)}" placeholder="设置注册邀请码" style="width:150px;">
                  <button type="button" id="reg-gen-invite" class="btn ghost tiny">随机生成</button>
                </span>
                <button type="button" id="reg-save-btn" class="btn primary tiny">保存门禁设置</button>
              </div>
            </div>
          </div>

          <div class="row-gap" style="margin-top:12px;">
            <select id="usr-role-filter">
              <option value="">全部角色</option>
              <option value="student" ${state.role === "student" ? "selected" : ""}>学员</option>
              <option value="admin" ${state.role === "admin" ? "selected" : ""}>管理员</option>
            </select>
            <input id="usr-kw" type="search" value="${escapeHtml(state.keyword)}" placeholder="搜索用户名或昵称..." style="flex:1;min-width:180px;">
          </div>
        </div>

        <div class="table-wrap view-scroll" style="margin-top:12px;">
          <table class="data-table">
            <thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              ${filtered.map((u) => `
                <tr data-uid="${escapeHtml(u.id)}">
                  <td><code>${escapeHtml(u.username)}</code></td>
                  <td>${escapeHtml(u.nickname)}</td>
                  <td><span class="badge ${u.role === "admin" ? "warn" : ""}">${u.role === "admin" ? "管理员" : "学员"}</span></td>
                  <td class="muted-text">${escapeHtml((u.createdAt || "").slice(0, 16).replace("T", " "))}</td>
                  <td class="row-gap">
                    <button type="button" class="btn ghost tiny js-usr-pwd">重置密码</button>
                    <button type="button" class="btn ghost tiny js-usr-role" data-next="${u.role === "admin" ? "student" : "admin"}">${u.role === "admin" ? "设为学员" : "设为管理"}</button>
                    <button type="button" class="btn danger tiny js-usr-del">删除</button>
                  </td>
                </tr>
              `).join("") || '<tr><td colspan="5" class="muted-text">没有匹配的账号</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelector("#usr-role-filter").addEventListener("change", (e) => { state.role = e.target.value; renderBody(); });
    container.querySelector("#usr-kw").addEventListener("input", (e) => { state.keyword = e.target.value; renderBody(); });

    const regModeSel = container.querySelector("#reg-mode");
    const regInviteWrap = container.querySelector("#reg-invite-wrap");
    const regInviteInput = container.querySelector("#reg-invite-code");
    regModeSel.addEventListener("change", () => { regInviteWrap.hidden = regModeSel.value !== "invite"; });
    container.querySelector("#reg-gen-invite").addEventListener("click", () => {
      regInviteInput.value = Math.random().toString(36).slice(2, 10).toUpperCase();
    });
    container.querySelector("#reg-save-btn").addEventListener("click", async () => {
      try {
        const res = await apiRequest("/api/admin/registration", {
          method: "PUT",
          body: JSON.stringify({ mode: regModeSel.value, inviteCode: regInviteInput.value.trim() })
        });
        regPolicy = { mode: res.mode, inviteCode: res.inviteCode || "" };
        showToast("注册门禁设置已保存", "ok");
      } catch (err) {
        showToast(err.message, "bad");
      }
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
      try {
        await apiRequest("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
        showToast("账号已创建", "ok");
        await loadUsers();
        renderBody();
      } catch (err) {
        showToast(err.message, "bad");
      }
    });

    container.querySelectorAll(".js-usr-pwd").forEach((btn) => btn.addEventListener("click", async () => {
      const uid = btn.closest("tr").dataset.uid;
      const form = await openFormDialog({
        title: "重置账号密码",
        fields: [{ name: "newPassword", label: "新密码（至少 4 位）", type: "password", required: true }],
        submitText: "保存新密码"
      });
      if (!form) return;
      try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/password`, { method: "POST", body: JSON.stringify(form) });
        showToast("密码已重置", "ok");
      } catch (err) {
        showToast(err.message, "bad");
      }
    }));

    container.querySelectorAll(".js-usr-role").forEach((btn) => btn.addEventListener("click", async () => {
      const uid = btn.closest("tr").dataset.uid;
      try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}/role`, { method: "PUT", body: JSON.stringify({ role: btn.dataset.next }) });
        showToast("角色已更新", "ok");
        await loadUsers();
        renderBody();
      } catch (err) {
        showToast(err.message, "bad");
      }
    }));

    container.querySelectorAll(".js-usr-del").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("确定删除该账号及其练习进度吗？")) return;
      const uid = btn.closest("tr").dataset.uid;
      try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}`, { method: "DELETE" });
        showToast("账号已删除", "ok");
        await loadUsers();
        renderBody();
      } catch (err) {
        showToast(err.message, "bad");
      }
    }));
  };

  renderBody();
};

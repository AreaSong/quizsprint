import { apiRequest, escapeHtml, showToast } from "../api.js";

const NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/;
const SEQ_RE = /^(.*?)(\d+)$/;

const buildBatchFormHtml = () => `
  <div class="modal-card modal-shell" style="max-width:520px;">
    <div class="modal-head">
      <h3>批量生成账号（支持学号 / 连续编号）</h3>
      <button type="button" class="btn ghost tiny" data-modal-close>取消</button>
    </div>
    <form id="bu-form" class="stack-form">
      <div class="modal-body stack-form">
        <div class="row-gap">
          <label style="flex:1;min-width:140px;"><span>起始学号 / 编号</span><input id="bu-start" value="100" required placeholder="如 20240715B0101 或 100"></label>
          <label style="flex:1;min-width:140px;"><span>结束学号 / 编号（单次 ≤ 300）</span><input id="bu-end" value="199" required placeholder="如 20240715B0140 或 199"></label>
        </div>
        <div class="row-gap">
          <label style="flex:1;min-width:120px;"><span>统一前缀（可选）</span><input id="bu-prefix" placeholder="若起止已含学号前缀请留空" maxlength="16"></label>
          <label style="flex:1;min-width:120px;"><span>昵称前缀（可选）</span><input id="bu-nick-prefix" placeholder="如：学员（留空同账号）" maxlength="16"></label>
        </div>
        <div id="bu-preview" class="muted-text" style="font-size:0.7813rem;padding:8px 10px;border-radius:8px;background:var(--surface-soft);border:1px solid var(--line);"></div>
        <div class="row-gap">
          <label style="flex:1.2;min-width:140px;"><span>密码生成方式</span>
            <select id="bu-pwd-mode">
              <option value="fixed" selected>统一初始密码</option>
              <option value="random">每号随机 6 位密码</option>
              <option value="same">与用户名相同（≥4位）</option>
            </select>
          </label>
          <label id="bu-fixed-wrap" style="flex:1;min-width:130px;"><span>统一初始密码</span><input id="bu-fixed-pwd" value="123456" placeholder="至少 4 位"></label>
          <label style="flex:0.9;min-width:100px;"><span>账号角色</span>
            <select id="bu-role">
              <option value="student" selected>学员</option>
              <option value="admin">管理员</option>
            </select>
          </label>
        </div>
        <label class="row-gap" style="flex-direction:row;cursor:pointer;font-weight:500;">
          <input id="bu-must-change" type="checkbox" checked>
          <span>新账号首次登录时要求修改初始密码</span>
        </label>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-modal-close>取消</button>
        <button type="submit" id="bu-submit" class="btn primary">开始生成账号</button>
      </div>
    </form>
  </div>
`;

const formatPreview = (prefix, startStr, endStr) => {
  const sMatch = startStr.match(SEQ_RE);
  const eMatch = endStr.match(SEQ_RE);
  if (!sMatch || !eMatch) return { err: "起止学号/编号必须以连续数字结尾（如 20240715B0101 或 100）" };
  const [, sHead, sDigits] = sMatch;
  const [, eHead, eDigits] = eMatch;
  if (sHead !== eHead) return { err: "起止学号/编号的前缀部分不一致，请仅让末尾数字递增" };
  const start = BigInt(sDigits);
  const end = BigInt(eDigits);
  if (start > end) return { err: "起始学号/编号不能大于结束学号/编号" };
  const count = Number(end - start + 1n);
  if (count > 300) return { err: `共 ${count} 个，超出单次最多 300 个限制` };
  const pad = sDigits.length > 1 && sDigits.startsWith("0") ? sDigits.length : 0;
  const fullPrefix = `${prefix}${sHead}`;
  const fmt = (n) => `${fullPrefix}${pad ? String(n).padStart(pad, "0") : String(n)}`;
  if (!NAME_RE.test(fmt(start)) || !NAME_RE.test(fmt(end))) {
    return { err: "生成的用户名需为 2-24 位中英文、数字或下划线" };
  }
  const samples = count <= 4 ? Array.from({ length: count }, (_, idx) => fmt(start + BigInt(idx))) : [fmt(start), fmt(start + 1n), fmt(start + 2n), "…", fmt(end)];
  return { count, text: `预计生成 ${count} 个账号：${samples.join("、")}` };
};

const downloadAccountsCsv = (accounts) => {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = ["用户名,昵称,初始密码,角色", ...accounts.map((a) => [esc(a.username), esc(a.nickname), esc(a.password), esc(a.role === "admin" ? "管理员" : "学员")].join(","))];
  const blob = new Blob([`\uFEFF${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `quizsprint-users-${accounts[0]?.username || "batch"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
};

const renderResultModal = (backdrop, res, close) => {
  const accounts = res.accounts || [];
  const previewRows = accounts.slice(0, 50);
  backdrop.innerHTML = `
    <div class="modal-card modal-shell" style="max-width:600px;">
      <div class="modal-head">
        <h3>批量生成完成</h3>
        <button type="button" class="btn ghost tiny" id="bu-res-close">关闭</button>
      </div>
      <div class="modal-body stack-form">
        <div class="row-gap">
          <span class="badge ok">成功创建 ${res.createdCount || 0} 个</span>
          ${res.skippedCount ? `<span class="badge warn">已跳过重名 ${res.skippedCount} 个</span>` : ""}
        </div>
        ${accounts.length ? `
          <div class="admin-table-wrap" style="max-height:280px;overflow-y:auto;">
            <table class="data-table" style="margin-top:0;">
              <thead><tr><th>用户名</th><th>昵称</th><th>初始密码</th><th>角色</th></tr></thead>
              <tbody>
                ${previewRows.map((a) => `<tr><td><code>${escapeHtml(a.username)}</code></td><td>${escapeHtml(a.nickname)}</td><td><code>${escapeHtml(a.password)}</code></td><td>${a.role === "admin" ? "管理员" : "学员"}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
          ${accounts.length > 50 ? `<div class="muted-text" style="font-size:0.75rem;">表格仅预览前 50 条，全部 ${accounts.length} 条请点击下方按钮导出 CSV 或复制。</div>` : ""}
        ` : '<p class="muted-text" style="margin:0;">本次区间内的用户名已全部存在，未新建账号。</p>'}
      </div>
      <div class="modal-foot">
        <div class="row-gap">
          ${accounts.length ? '<button type="button" id="bu-copy-all" class="btn ghost tiny">复制全部账号密码</button><button type="button" id="bu-export-csv" class="btn primary tiny">导出 CSV 表格</button>' : ""}
          <button type="button" id="bu-done-btn" class="btn ghost tiny">完成</button>
        </div>
      </div>
    </div>
  `;
  backdrop.querySelector("#bu-res-close").addEventListener("click", close);
  backdrop.querySelector("#bu-done-btn").addEventListener("click", close);
  backdrop.querySelector("#bu-export-csv")?.addEventListener("click", () => {
    downloadAccountsCsv(accounts);
    showToast("已导出账号表格 (.csv)", "ok");
  });
  backdrop.querySelector("#bu-copy-all")?.addEventListener("click", () => {
    const text = accounts.map((a) => `${a.username}\t${a.password}\t${a.nickname}`).join("\n");
    navigator.clipboard?.writeText(text).then(() => showToast("已复制全部账号与密码", "ok")).catch(() => showToast("复制失败，请使用导出 CSV", "bad"));
  });
};

const bindBatchModalEvents = (backdrop, close, onCreated) => {
  const prefixEl = backdrop.querySelector("#bu-prefix");
  const startEl = backdrop.querySelector("#bu-start");
  const endEl = backdrop.querySelector("#bu-end");
  const previewEl = backdrop.querySelector("#bu-preview");
  const modeEl = backdrop.querySelector("#bu-pwd-mode");
  const fixedWrap = backdrop.querySelector("#bu-fixed-wrap");

  const syncPreview = () => {
    const res = formatPreview(prefixEl.value.trim(), startEl.value.trim(), endEl.value.trim());
    previewEl.textContent = res.err || res.text;
    previewEl.style.color = res.err ? "var(--bad)" : "";
  };
  const syncPwdMode = () => { fixedWrap.hidden = modeEl.value !== "fixed"; };

  [prefixEl, startEl, endEl].forEach((el) => el.addEventListener("input", syncPreview));
  modeEl.addEventListener("change", syncPwdMode);
  syncPreview();
  syncPwdMode();

  backdrop.querySelector("#bu-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = backdrop.querySelector("#bu-submit");
    submitBtn.disabled = true;
    try {
      const res = await apiRequest("/api/admin/users/batch", {
        method: "POST",
        body: JSON.stringify({
          prefix: prefixEl.value.trim(),
          nicknamePrefix: backdrop.querySelector("#bu-nick-prefix").value.trim(),
          startNum: startEl.value.trim(),
          endNum: endEl.value.trim(),
          passwordMode: modeEl.value,
          fixedPassword: backdrop.querySelector("#bu-fixed-pwd").value,
          role: backdrop.querySelector("#bu-role").value,
          mustChangePassword: Boolean(backdrop.querySelector("#bu-must-change")?.checked)
        })
      });
      showToast(`批量生成完成：新增 ${res.createdCount} 个`, "ok");
      await onCreated?.(res);
      renderResultModal(backdrop, res, close);
    } catch (err) {
      submitBtn.disabled = false;
      showToast(err.message, "bad");
    }
  });
};

export const openBatchCreateUsersModal = ({ onCreated } = {}) => {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = buildBatchFormHtml();
  document.body.appendChild(backdrop);

  const close = () => {
    if (backdrop._isClosing) return;
    backdrop._isClosing = true;
    backdrop.remove();
  };
  backdrop._closeModal = close;
  backdrop.querySelectorAll("[data-modal-close]").forEach((b) => b.addEventListener("click", close));
  bindBatchModalEvents(backdrop, close, onCreated);
};

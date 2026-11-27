import { apiRequest, escapeHtml } from "./api.js";

const pad2 = (n) => String(n).padStart(2, "0");

/** 将更新记录时间格式化为本地时区 YYYY-MM-DD HH:mm:ss */
export const formatUpdateDateTime = (item) => {
  const raw = item?.createdAt || item?.date || "";
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return String(raw);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(item?.date || raw);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const localKeyFor = (user) => `qs_seen_updates_${user?.id || "guest"}`;

const readLocalSeen = (user) => {
  try {
    const arr = JSON.parse(localStorage.getItem(localKeyFor(user)) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeLocalSeen = (user, ids) => {
  const prev = readLocalSeen(user);
  const merged = [...new Set([...ids, ...prev])].slice(0, 120);
  try { localStorage.setItem(localKeyFor(user), JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
};

/** 过滤出当前账号/访客尚未阅读过的最新更新动态 */
export const getUnreadContentUpdates = (siteInfo, user) => {
  const list = Array.isArray(siteInfo?.contentUpdates) ? siteInfo.contentUpdates : [];
  if (!list.length) return [];
  const seen = new Set([
    ...(Array.isArray(siteInfo?.seenUpdateIds) ? siteInfo.seenUpdateIds : []),
    ...readLocalSeen(user)
  ]);
  return list.filter((item) => item?.id && !seen.has(item.id));
};

const commitUpdatesRead = async (siteInfo, user, ids) => {
  if (!ids.length) return;
  writeLocalSeen(user, ids);
  if (siteInfo) {
    siteInfo.seenUpdateIds = [...new Set([...ids, ...(siteInfo.seenUpdateIds || [])])];
  }
  if (user?.id) {
    await apiRequest("/api/user/updates/read", {
      method: "POST",
      body: JSON.stringify({ ids })
    }).catch(() => {});
  }
};

/** 存在未读更新时自动弹出提示公告；若已有更高优先级弹窗（首装/改密）则自动避让 */
export const maybeShowUnreadUpdatesModal = (siteInfo, user, { onOpenChangelog } = {}) => {
  if (!siteInfo || siteInfo.needsSetup || user?.mustChangePassword) return false;
  if (siteInfo.siteConfig?.allowGuestBrowse === false && !user) return false;
  const modal = document.getElementById("site-modal");
  if (!modal || !modal.hidden) return false;

  const unread = getUnreadContentUpdates(siteInfo, user);
  if (!unread.length) return false;

  const unreadIds = unread.map((u) => u.id);
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card modal-shell" style="max-width:560px;">
      <div class="modal-head">
        <div class="row-gap" style="gap:8px;">
          <h3 style="margin:0;">最新更新公告</h3>
          <span class="badge ok">${unread.length} 条未读</span>
        </div>
        <button type="button" id="un-later-top" class="btn ghost tiny" data-modal-close>稍后查看</button>
      </div>
      <div class="modal-body" style="font-size:0.8125rem;line-height:1.6;">
        <p class="muted-text" style="margin:0 0 10px;">上次访问后平台新增以下更新，点击「我知道了」后不再重复提示（仅对你本人生效）：</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;">
          ${unread.map((u) => `
            <div style="padding:9px 11px;border-radius:10px;background:var(--surface-soft);border:1px solid var(--line);">
              <div class="row-gap" style="justify-content:space-between;gap:8px;margin-bottom:4px;">
                <span class="badge">${escapeHtml(u.category || "更新")}</span>
                <span class="muted-text" style="font-size:0.7188rem;font-variant-numeric:tabular-nums;">${escapeHtml(formatUpdateDateTime(u))}</span>
              </div>
              <div style="font-weight:700;color:var(--ink);">${escapeHtml(u.title || "")}</div>
              ${u.detail ? `<div class="muted-text" style="margin-top:3px;font-size:0.75rem;">${escapeHtml(u.detail)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="modal-foot" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <button type="button" id="un-open-all" class="btn ghost tiny">查看完整更新日志</button>
        <div class="row-gap" style="gap:8px;">
          <button type="button" id="un-later" class="btn ghost tiny">稍后提醒</button>
          <button type="button" id="un-ack" class="btn primary tiny">我知道了（不再提示）</button>
        </div>
      </div>
    </div>
  `;

  const closeModal = () => { modal.hidden = true; };
  modal.querySelector("#un-later-top").addEventListener("click", closeModal);
  modal.querySelector("#un-later").addEventListener("click", closeModal);
  modal.querySelector("#un-ack").addEventListener("click", async () => {
    closeModal();
    await commitUpdatesRead(siteInfo, user, unreadIds);
  });
  modal.querySelector("#un-open-all").addEventListener("click", async () => {
    await commitUpdatesRead(siteInfo, user, unreadIds);
    onOpenChangelog?.();
  });
  return true;
};

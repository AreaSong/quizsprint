import { apiRequest, showToast } from "./api.js";

const NOTIFIED_HASH_KEY = "qs_notified_update_hash";
const POLL_INTERVAL_MS = 120_000;

/** 绑定全局页脚与注册框中的免责声明弹窗交互 */
export const initSystemAndDisclaimerModals = () => {
  const disclaimerModal = document.getElementById("disclaimer-modal");
  if (!disclaimerModal) return;
  document.addEventListener("click", (e) => {
    if (e.target.closest(".js-open-disclaimer")) {
      e.preventDefault();
      disclaimerModal.hidden = false;
    }
  });
  document.getElementById("disclaimer-close")?.addEventListener("click", () => { disclaimerModal.hidden = true; });
  document.getElementById("disclaimer-ok")?.addEventListener("click", () => { disclaimerModal.hidden = true; });
};

const syncNavBadge = (btn, count) => {
  if (!btn) return;
  const old = btn.querySelector(".nav-update-badge");
  if (count <= 0) { old?.remove(); return; }
  const text = count > 99 ? "99+" : String(count);
  if (old) { old.textContent = text; return; }
  const badge = document.createElement("span");
  badge.className = "nav-update-badge";
  badge.textContent = text;
  badge.title = `发现 ${count} 个待更新提交`;
  btn.appendChild(badge);
};

/** 管理员后台自动探测远端更新状态，并更新导航红点与会话通知 */
export const createAdminUpdateWatcher = () => {
  let active = false;
  let timer = null;
  let lastPollAt = 0;

  const setProbe = (probe) => {
    const count = active ? Number(probe?.behindCount || 0) : 0;
    syncNavBadge(document.getElementById("top-admin-btn"), count);
    syncNavBadge(document.querySelector('#admin-subbar [data-route="system"]'), count);
    if (count > 0) {
      const latestHash = String(probe?.commits?.[0]?.hash || "");
      const prevHash = sessionStorage.getItem(NOTIFIED_HASH_KEY) || "";
      if (latestHash && latestHash !== prevHash) {
        sessionStorage.setItem(NOTIFIED_HASH_KEY, latestHash);
        showToast(`检测到远端有 ${count} 个新提交，可前往「系统与维护」一键更新`, "ok");
      }
    } else if (probe && !probe.error) {
      sessionStorage.removeItem(NOTIFIED_HASH_KEY);
    }
  };

  const pollOnce = async () => {
    if (!active || document.hidden) return;
    lastPollAt = Date.now();
    try {
      const st = await apiRequest("/api/admin/system/status", { fresh: true });
      if (st?.updateProbe) setProbe(st.updateProbe);
    } catch { /* 静默探测失败不影响正常操作 */ }
  };

  document.addEventListener("visibilitychange", () => {
    if (active && !document.hidden && Date.now() - lastPollAt >= POLL_INTERVAL_MS) pollOnce();
  });

  const sync = (isAdmin) => {
    active = Boolean(isAdmin);
    clearInterval(timer);
    timer = null;
    if (!active) { setProbe(null); return; }
    pollOnce();
    timer = setInterval(pollOnce, POLL_INTERVAL_MS);
  };

  return { sync, setProbe };
};

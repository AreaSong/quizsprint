import { initAiConfigModal } from "./ai-modal.js";
import {
  apiRequest,
  escapeHtml,
  fetchBankQuestionsSafe,
  getCloudUser,
  getGlobalSettings,
  getLocalAiConfig,
  setCloudSession,
  showToast
} from "./api.js";
import { applyAppearance, cycleTheme, initAppearanceControl } from "./appearance.js";
import { initGlobalModalDismiss, openFormDialog } from "./dialog.js";
import { applySiteInfo, exportMyProgressJson, maybeOpenSetupWizard, triggerImportMyProgress } from "./site-shell.js";
import { initSystemAndDisclaimerModals } from "./system-modal.js";
import { renderBanksView } from "./views/banks-view.js";
import { renderExamsView } from "./views/exams-view.js";
import { renderImportView } from "./views/import-view.js";
import { renderManageView } from "./views/manage-view.js";
import { renderPracticeView } from "./views/practice-view.js";
import { renderSearchView } from "./views/search-view.js";
import { renderStatsView } from "./views/stats-view.js";
import { renderSystemView } from "./views/system-view.js";
import { renderUsersView } from "./views/users-view.js";

const ROUTE_TITLES = {
  banks: "题库中心",
  practice: "在线刷题",
  exams: "在线考试",
  search: "搜题中心",
  stats: "学习统计",
  manage: "试题管理",
  import: "批量导题",
  users: "用户管理",
  system: "系统与维护"
};
const ADMIN_ROUTES = new Set(["manage", "import", "users", "system"]);

const appMain = document.getElementById("app-main");
const topAdminBtn = document.getElementById("top-admin-btn");
const adminSubbar = document.getElementById("admin-subbar");
const focusBarLeft = document.getElementById("focus-bar-left");
const focusTitleEl = document.getElementById("focus-title");
const focusBackBtn = document.getElementById("focus-back-btn");
const appearanceMenu = document.getElementById("appearance-menu");
const userMenuWrap = document.getElementById("user-menu-wrap");
const userModal = document.getElementById("user-modal");
const aiModal = document.getElementById("ai-modal");

const appState = {
  route: "banks",
  routeParams: {},
  banks: [],
  subjects: [],
  activeBankId: localStorage.getItem("as_qb_active_bank") || "",
  isAdmin: false,
  registrationMode: "open",
  siteInfo: null
};

let userRegisterMode = false;
let requireAdminPrompt = false;
let userDropdownOpen = false;
let focusBackTarget = "banks";

const syncBankSelection = () => {
  if (!appState.banks.length) {
    appState.activeBankId = "";
    return;
  }
  if (!appState.banks.some((b) => b.id === appState.activeBankId)) {
    appState.activeBankId = appState.banks[0].id;
    localStorage.setItem("as_qb_active_bank", appState.activeBankId);
  }
};

const renderUserMenu = () => {
  const user = getCloudUser();
  const loggedIn = Boolean(user || appState.isAdmin);
  const hasAiKey = Boolean(getLocalAiConfig().apiKey);
  if (topAdminBtn) topAdminBtn.hidden = !appState.isAdmin;

  if (!loggedIn) {
    userMenuWrap.innerHTML = `
      <div class="row-gap">
        <button type="button" class="btn ghost tiny js-open-ai-cfg">${hasAiKey ? "AI 已配置" : "AI 设置"}</button>
        <button type="button" id="user-login-btn" class="btn primary tiny">账号登录</button>
      </div>
    `;
    userMenuWrap.querySelector("#user-login-btn").addEventListener("click", () => openAccountModal(false));
    userMenuWrap.querySelector(".js-open-ai-cfg").addEventListener("click", openAiModal);
    return;
  }

  const displayName = user ? (user.nickname || user.username) : "管理员";
  const initial = displayName.slice(0, 1).toUpperCase();
  userMenuWrap.innerHTML = `
    <button type="button" id="user-avatar-btn" class="avatar-btn">
      <span class="avatar-circle">${escapeHtml(initial)}</span>
      <span>${escapeHtml(displayName)}${appState.isAdmin ? " · 管理" : ""}</span>
      <span class="muted-text">▾</span>
    </button>
    <div id="user-dropdown" class="dropdown-menu" ${userDropdownOpen ? "" : "hidden"}>
      <button type="button" class="dropdown-item js-menu-exams">我的成绩单</button>
      <button type="button" class="dropdown-item js-menu-ai">AI 模型设置 ${hasAiKey ? "✓" : "(未填)"}</button>
      ${user ? `<button type="button" class="dropdown-item js-menu-nick">修改个人昵称</button><button type="button" class="dropdown-item js-menu-pwd">修改登录密码</button><button type="button" class="dropdown-item js-menu-exp-prog">导出学习进度</button><button type="button" class="dropdown-item js-menu-imp-prog">导入学习进度</button>` : ""}
      ${appState.isAdmin ? `
        <div class="dropdown-sep"></div>
        <button type="button" class="dropdown-item js-menu-manage">试题管理</button>
        <button type="button" class="dropdown-item js-menu-import">批量导题</button>
        <button type="button" class="dropdown-item js-menu-users">用户与门禁</button>
        <button type="button" class="dropdown-item js-menu-system">系统与维护</button>
      ` : ""}
      <div class="dropdown-sep"></div>
      <button type="button" class="dropdown-item danger js-menu-logout">退出登录</button>
    </div>
  `;

  const setUserDropdown = (open) => {
    userDropdownOpen = Boolean(open);
    const dd = document.getElementById("user-dropdown");
    if (dd) dd.hidden = !userDropdownOpen;
  };

  userMenuWrap.querySelector("#user-avatar-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    setUserDropdown(!userDropdownOpen);
  });
  userMenuWrap.querySelector(".js-menu-exams").addEventListener("click", () => {
    setUserDropdown(false);
    navigate("exams", { openMySubs: true });
  });
  userMenuWrap.querySelector(".js-menu-ai").addEventListener("click", () => { setUserDropdown(false); openAiModal(); });
  userMenuWrap.querySelector(".js-menu-nick")?.addEventListener("click", () => { setUserDropdown(false); openChangeNickDialog(); });
  userMenuWrap.querySelector(".js-menu-pwd")?.addEventListener("click", () => { setUserDropdown(false); openChangePwdDialog(); });
  userMenuWrap.querySelector(".js-menu-exp-prog")?.addEventListener("click", () => { setUserDropdown(false); exportMyProgressJson(); });
  userMenuWrap.querySelector(".js-menu-imp-prog")?.addEventListener("click", () => {
    setUserDropdown(false);
    triggerImportMyProgress(async () => { await refreshAuth(); renderCurrentView(); });
  });
  userMenuWrap.querySelector(".js-menu-manage")?.addEventListener("click", () => { setUserDropdown(false); navigate("manage"); });
  userMenuWrap.querySelector(".js-menu-import")?.addEventListener("click", () => { setUserDropdown(false); navigate("import"); });
  userMenuWrap.querySelector(".js-menu-users")?.addEventListener("click", () => { setUserDropdown(false); navigate("users"); });
  userMenuWrap.querySelector(".js-menu-system")?.addEventListener("click", () => { setUserDropdown(false); navigate("system"); });
  userMenuWrap.querySelector(".js-menu-logout").addEventListener("click", doLogout);
};

const refreshBanks = async (fresh = false) => {
  const [bankData, subData] = await Promise.all([
    apiRequest("/api/banks", { fresh }).catch(() => ({ banks: [] })),
    apiRequest("/api/subjects", { fresh }).catch(() => ({ subjects: [] }))
  ]);
  appState.banks = bankData.banks || [];
  appState.subjects = subData.subjects || [];
  syncBankSelection();
};

const prefetchActiveBank = () => {
  if (!(appState.isAdmin || getCloudUser())) return;
  const bank = appState.banks.find((b) => b.id === appState.activeBankId);
  if (!bank || bank.locked) return;
  setTimeout(() => {
    if (appState.route === "banks") fetchBankQuestionsSafe(bank.id, { silent: true }).catch(() => {});
  }, 320);
};

const refreshSiteInfo = async () => {
  const info = await apiRequest("/api/site/info").catch(() => null);
  if (info) {
    appState.siteInfo = info;
    applySiteInfo(info);
  }
};

const refreshAuth = async () => {
  const [adminRes, userRes] = await Promise.all([apiRequest("/api/auth/me"), apiRequest("/api/user/me")]);
  appState.isAdmin = Boolean(adminRes.admin);
  appState.registrationMode = userRes.registrationMode || "open";
  if (userRes.user) {
    const prog = await apiRequest("/api/user/progress").catch(() => ({ progress: null }));
    setCloudSession(userRes.user, prog.progress);
  } else {
    setCloudSession(null, null);
  }
  renderUserMenu();
};

const openAccountModal = (requireAdmin = false) => {
  userRegisterMode = false;
  requireAdminPrompt = requireAdmin;
  syncUserModalMode();
  document.getElementById("u-pass").value = "";
  document.getElementById("u-invite").value = "";
  userModal.hidden = false;
  document.getElementById("u-name").focus();
};

const VALID_ROUTES = new Set(Object.keys(ROUTE_TITLES));

const setFocusMode = (enabled, label = "", backRoute = "banks") => {
  document.body.classList.toggle("focus-mode", Boolean(enabled));
  if (focusBarLeft) focusBarLeft.hidden = !enabled;
  if (focusTitleEl && label) focusTitleEl.textContent = label;
  focusBackTarget = backRoute;
};

const syncShellMode = (nextRoute, params = {}) => {
  const loggedIn = Boolean(appState.isAdmin || getCloudUser());
  if (adminSubbar) adminSubbar.hidden = !(appState.isAdmin && ADMIN_ROUTES.has(nextRoute));
  if (topAdminBtn) topAdminBtn.classList.toggle("active", ADMIN_ROUTES.has(nextRoute));
  if (nextRoute === "exams" && params.examId && loggedIn) setFocusMode(true, "在线考场", "exams");
  else setFocusMode(false);
};

let hasNavigatedOnce = false;
const preSyncRouteFromHash = () => {
  const h = location.hash.replace(/^#/, "");
  const r = location.hash.startsWith("#exam=") ? "exams" : (VALID_ROUTES.has(h) ? h : "banks");
  appMain.classList.toggle("practice-full", r === "practice");
  document.querySelectorAll("[data-route]").forEach((btn) => btn.classList.toggle("active", btn.dataset.route === r));
};
preSyncRouteFromHash();

const navigate = (route, params = {}) => {
  const nextRoute = VALID_ROUTES.has(route) ? route : "banks";
  if (hasNavigatedOnce && nextRoute === appState.route && !Object.keys(params).length && !Object.keys(appState.routeParams || {}).length) {
    return;
  }
  hasNavigatedOnce = true;
  appState.route = nextRoute;
  appState.routeParams = params;
  appMain.classList.toggle("practice-full", nextRoute === "practice");
  if (nextRoute !== "practice") document.body.classList.remove("immersive-mode");
  if (!(nextRoute === "exams" && params.examId)) {
    const targetHash = `#${nextRoute}`;
    if (location.hash !== targetHash) history.replaceState(null, "", targetHash);
  }
  document.querySelectorAll("[data-route]").forEach((btn) => btn.classList.toggle("active", btn.dataset.route === nextRoute));
  renderCurrentView();
};

const renderCurrentView = () => {
  syncShellMode(appState.route, appState.routeParams);
  const ctx = {
    banks: appState.banks,
    subjects: appState.subjects,
    activeBankId: appState.activeBankId,
    isAdmin: appState.isAdmin,
    isLoggedIn: Boolean(appState.isAdmin || getCloudUser()),
    siteInfo: appState.siteInfo,
    routeParams: appState.routeParams,
    onSelectBank: (id) => {
      appState.activeBankId = id;
      localStorage.setItem("as_qb_active_bank", id);
    },
    onNavigate: navigate,
    setFocusMode,
    onRefreshBanks: async () => { await refreshBanks(); renderCurrentView(); },
    onAuthChanged: async () => { await refreshAuth(); renderCurrentView(); },
    onSiteUpdated: (cfg) => { if (appState.siteInfo) { appState.siteInfo.siteConfig = cfg; applySiteInfo(appState.siteInfo); } },
    onRequireLogin: () => openAccountModal(true),
    onRequireUserLogin: () => openAccountModal(false),
    onToggleTheme: cycleTheme
  };

  if (appState.siteInfo?.siteConfig?.allowGuestBrowse === false && !ctx.isLoggedIn) {
    appMain.innerHTML = `<div class="panel empty-state"><strong style="font-size:1rem;">站点已开启仅登录访问</strong><p class="muted-text" style="margin:0;">管理员关闭了访客浏览，请先登录账号后查看题库与练习。</p><button type="button" id="guest-go-login" class="btn primary tiny">立即登录</button></div>`;
    appMain.querySelector("#guest-go-login")?.addEventListener("click", () => openAccountModal(false));
    return;
  }

  if (appState.route === "banks") renderBanksView(appMain, ctx);
  else if (appState.route === "practice") renderPracticeView(appMain, ctx);
  else if (appState.route === "exams") renderExamsView(appMain, ctx);
  else if (appState.route === "search") renderSearchView(appMain, ctx);
  else if (appState.route === "stats") renderStatsView(appMain, ctx);
  else if (appState.route === "manage") renderManageView(appMain, ctx);
  else if (appState.route === "import") renderImportView(appMain, ctx);
  else if (appState.route === "users") renderUsersView(appMain, ctx);
  else if (appState.route === "system") renderSystemView(appMain, ctx);
};

const doLogout = async () => {
  userDropdownOpen = false;
  await Promise.all([
    apiRequest("/api/user/logout", { method: "POST" }).catch(() => {}),
    apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {})
  ]);
  await refreshAuth();
  await refreshBanks(true);
  showToast("已退出账号");
  renderCurrentView();
};

const openChangeNickDialog = async () => {
  const user = getCloudUser();
  const form = await openFormDialog({
    title: "修改个人昵称",
    fields: [{ name: "nickname", label: "新昵称（1-24 个字符）", value: user?.nickname || "", required: true }],
    submitText: "保存昵称"
  });
  if (!form || !form.nickname.trim()) return;
  try {
    await apiRequest("/api/user/profile", { method: "PUT", body: JSON.stringify({ nickname: form.nickname.trim() }) });
    await refreshAuth();
    showToast("昵称修改成功", "ok");
    renderCurrentView();
  } catch (err) {
    showToast(err.message, "bad");
  }
};

const openChangePwdDialog = async () => {
  const form = await openFormDialog({
    title: "修改登录密码",
    fields: [
      { name: "oldPassword", label: "当前密码", type: "password", required: true },
      { name: "newPassword", label: "新密码（至少 4 位）", type: "password", required: true }
    ],
    submitText: "确认修改"
  });
  if (!form) return;
  try {
    await apiRequest("/api/user/password", { method: "POST", body: JSON.stringify(form) });
    showToast("密码修改成功", "ok");
  } catch (err) {
    showToast(err.message, "bad");
  }
};

const { openAiModal } = initAiConfigModal({ aiModal, onUpdated: renderUserMenu });

const syncUserModalMode = () => {
  const regMode = appState.registrationMode || "open";
  if (regMode === "closed") userRegisterMode = false;
  document.getElementById("user-modal-title").textContent = userRegisterMode
    ? "注册学员账号"
    : (requireAdminPrompt ? "管理员账号登录" : "账号登录");
  document.getElementById("user-modal-desc").textContent = requireAdminPrompt && !userRegisterMode
    ? "当前操作需要管理员权限，请使用管理员账号（如 admin）登录。"
    : "访客仅支持查看题库与搜题；登录后可刷题、考试与云端同步，管理员账号自动解锁建库、导题与发考权限。";
  document.getElementById("u-nick-wrap").hidden = !userRegisterMode;
  const needInvite = userRegisterMode && regMode === "invite";
  document.getElementById("u-invite-wrap").hidden = !needInvite;
  document.getElementById("u-invite").required = needInvite;
  document.getElementById("u-reg-closed-tip").hidden = regMode !== "closed";
  document.getElementById("u-toggle-mode").hidden = regMode === "closed";
  const regDisc = document.getElementById("u-reg-disclaimer");
  if (regDisc) regDisc.hidden = !userRegisterMode;
  document.getElementById("u-submit-btn").textContent = userRegisterMode ? "注册并登录" : "登录";
  document.getElementById("u-toggle-mode").textContent = userRegisterMode ? "已有账号？去登录" : "没有账号？去注册";
};

document.addEventListener("click", (e) => {
  if (userDropdownOpen && !e.target.closest("#user-menu-wrap")) {
    userDropdownOpen = false;
    const dd = document.getElementById("user-dropdown");
    if (dd) dd.hidden = true;
  }
  if (appearanceMenu && !appearanceMenu.hidden && !e.target.closest("#appearance-wrap")) {
    appearanceMenu.hidden = true;
  }
  const routeBtn = e.target.closest("[data-route]");
  if (routeBtn) navigate(routeBtn.dataset.route);
});
const goHomeEl = document.getElementById("go-home");
goHomeEl.addEventListener("click", () => navigate("banks"));
goHomeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("banks"); }
});
focusBackBtn?.addEventListener("click", () => navigate(focusBackTarget));
document.getElementById("appearance-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (appearanceMenu) appearanceMenu.hidden = !appearanceMenu.hidden;
});

document.getElementById("user-close").addEventListener("click", () => { userModal.hidden = true; });
document.getElementById("u-toggle-mode").addEventListener("click", () => {
  userRegisterMode = !userRegisterMode;
  if (userRegisterMode) requireAdminPrompt = false;
  syncUserModalMode();
});
document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("u-name").value.trim();
  const password = document.getElementById("u-pass").value;
  try {
    if (userRegisterMode) {
      await apiRequest("/api/user/register", {
        method: "POST",
        body: JSON.stringify({ username, password, nickname: document.getElementById("u-nick").value.trim(), inviteCode: document.getElementById("u-invite").value.trim() })
      });
    } else {
      try {
        await apiRequest("/api/user/login", { method: "POST", body: JSON.stringify({ username, password }) });
      } catch (loginErr) {
        if (loginErr.status === 401 && username.toLowerCase() === "admin") {
          await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
        } else throw loginErr;
      }
    }
    await refreshAuth();
    await refreshBanks(true);
    userModal.hidden = true;
    showToast(appState.isAdmin ? "管理员登录成功" : "登录成功，已启用云端同步", "ok");
    renderCurrentView();
    prefetchActiveBank();
  } catch (err) { showToast(err.message, "bad"); }
});

const syncRouteFromHash = () => {
  const examMatch = location.hash.match(/^#exam=([^&]+)/);
  if (examMatch) return navigate("exams", { examId: decodeURIComponent(examMatch[1]) });
  const hashRoute = location.hash.replace(/^#/, "");
  navigate(VALID_ROUTES.has(hashRoute) ? hashRoute : "banks");
};

const bootstrap = async () => {
  initSystemAndDisclaimerModals();
  initGlobalModalDismiss();
  initAppearanceControl(appearanceMenu);
  applyAppearance();
  await Promise.all([refreshBanks(), refreshAuth(), refreshSiteInfo()]);
  window.addEventListener("hashchange", syncRouteFromHash);
  syncRouteFromHash();
  prefetchActiveBank();
  maybeOpenSetupWizard(appState.siteInfo, async () => {
    await Promise.all([refreshAuth(), refreshSiteInfo()]);
    await refreshBanks(true);
    renderCurrentView();
  });
};

bootstrap().catch((err) => {
  appMain.innerHTML = `<div class="panel"><p class="muted-text">初始化失败：${escapeHtml(err.message)}</p></div>`;
});

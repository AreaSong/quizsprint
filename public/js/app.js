import {
  apiRequest,
  escapeHtml,
  getCloudUser,
  getGlobalSettings,
  getLocalAiConfig,
  saveGlobalSettings,
  saveLocalAiConfig,
  setCloudSession,
  showToast
} from "./api.js";
import { initGlobalModalDismiss, openFormDialog } from "./dialog.js";
import { initSystemAndDisclaimerModals } from "./system-modal.js";
import { renderBanksView } from "./views/banks-view.js";
import { renderExamsView } from "./views/exams-view.js";
import { renderImportView } from "./views/import-view.js";
import { renderManageView } from "./views/manage-view.js";
import { renderPracticeView } from "./views/practice-view.js";
import { renderSearchView } from "./views/search-view.js";
import { renderStatsView } from "./views/stats-view.js";
import { renderUsersView } from "./views/users-view.js";

const ROUTE_TITLES = {
  banks: "题库中心",
  practice: "在线刷题",
  exams: "在线考试",
  search: "搜题中心",
  stats: "学习统计",
  manage: "试题管理",
  import: "批量导题",
  users: "用户管理"
};
const ADMIN_ROUTES = new Set(["manage", "import", "users"]);
const THEME_CYCLE = ["light", "paper", "dark"];
const ACCENT_LIST = ["indigo", "emerald", "amber", "violet", "slate"];

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
const apiKeyModal = document.getElementById("apikey-modal");

const appState = {
  route: "banks",
  routeParams: {},
  banks: [],
  activeBankId: localStorage.getItem("as_qb_active_bank") || "",
  isAdmin: false,
  registrationMode: "open"
};

let userRegisterMode = false;
let requireAdminPrompt = false;
let userDropdownOpen = false;
let focusBackTarget = "banks";

const applyAppearance = () => {
  const settings = getGlobalSettings();
  const theme = THEME_CYCLE.includes(settings.theme) ? settings.theme : "light";
  const accent = ACCENT_LIST.includes(settings.accent) ? settings.accent : "indigo";
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  appearanceMenu?.querySelectorAll("[data-set-theme]").forEach((b) => b.classList.toggle("active", b.dataset.setTheme === theme));
  appearanceMenu?.querySelectorAll("[data-set-accent]").forEach((b) => b.classList.toggle("active", b.dataset.setAccent === accent));
};

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
      ${user ? `<button type="button" class="dropdown-item js-menu-pwd">修改登录密码</button>` : ""}
      ${appState.isAdmin ? `
        <div class="dropdown-sep"></div>
        <button type="button" class="dropdown-item js-menu-users">用户管理</button>
        <button type="button" class="dropdown-item js-menu-apikey">外部 API 密钥</button>
        <button type="button" class="dropdown-item js-open-sys-modal">系统更新与备份</button>
      ` : ""}
      <div class="dropdown-sep"></div>
      <button type="button" class="dropdown-item danger js-menu-logout">退出登录</button>
    </div>
  `;

  userMenuWrap.querySelector("#user-avatar-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    userDropdownOpen = !userDropdownOpen;
    renderUserMenu();
  });
  userMenuWrap.querySelector(".js-menu-exams").addEventListener("click", () => {
    userDropdownOpen = false;
    renderUserMenu();
    navigate("exams", { openMySubs: true });
  });
  userMenuWrap.querySelector(".js-menu-ai").addEventListener("click", () => { userDropdownOpen = false; renderUserMenu(); openAiModal(); });
  userMenuWrap.querySelector(".js-menu-pwd")?.addEventListener("click", () => { userDropdownOpen = false; renderUserMenu(); openChangePwdDialog(); });
  userMenuWrap.querySelector(".js-menu-users")?.addEventListener("click", () => { userDropdownOpen = false; renderUserMenu(); navigate("users"); });
  userMenuWrap.querySelector(".js-menu-apikey")?.addEventListener("click", () => { userDropdownOpen = false; renderUserMenu(); openApiKeyModal(); });
  userMenuWrap.querySelector(".js-menu-logout").addEventListener("click", doLogout);
};

const refreshBanks = async () => {
  const data = await apiRequest("/api/banks");
  appState.banks = data.banks || [];
  syncBankSelection();
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

const navigate = (route, params = {}) => {
  const nextRoute = VALID_ROUTES.has(route) ? route : "banks";
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
    activeBankId: appState.activeBankId,
    isAdmin: appState.isAdmin,
    isLoggedIn: Boolean(appState.isAdmin || getCloudUser()),
    routeParams: appState.routeParams,
    onSelectBank: (id) => {
      appState.activeBankId = id;
      localStorage.setItem("as_qb_active_bank", id);
    },
    onNavigate: navigate,
    setFocusMode,
    onRefreshBanks: async () => { await refreshBanks(); renderCurrentView(); },
    onRequireLogin: () => openAccountModal(true),
    onRequireUserLogin: () => openAccountModal(false),
    onToggleTheme: cycleTheme
  };

  if (appState.route === "banks") renderBanksView(appMain, ctx);
  else if (appState.route === "practice") renderPracticeView(appMain, ctx);
  else if (appState.route === "exams") renderExamsView(appMain, ctx);
  else if (appState.route === "search") renderSearchView(appMain, ctx);
  else if (appState.route === "stats") renderStatsView(appMain, ctx);
  else if (appState.route === "manage") renderManageView(appMain, ctx);
  else if (appState.route === "import") renderImportView(appMain, ctx);
  else if (appState.route === "users") renderUsersView(appMain, ctx);
};

const cycleTheme = () => {
  const settings = getGlobalSettings();
  const idx = THEME_CYCLE.indexOf(settings.theme);
  settings.theme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  settings.eyeCare = settings.theme === "paper";
  saveGlobalSettings(settings);
  applyAppearance();
};

const doLogout = async () => {
  userDropdownOpen = false;
  await Promise.all([
    apiRequest("/api/user/logout", { method: "POST" }).catch(() => {}),
    apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {})
  ]);
  await refreshAuth();
  showToast("已退出账号");
  renderCurrentView();
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

const renderApiKeyExample = (key) => {
  document.getElementById("apikey-value").value = key;
  document.getElementById("apikey-example").textContent =
`curl -X POST "${location.origin}/api/banks/default/questions" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${key}" \\
  -d '{"title":"示例题目","type":"0","options":["A1","B1"],"answers":["A1"]}'`;
};

const openApiKeyModal = async () => {
  try {
    const res = await apiRequest("/api/admin/apikey");
    renderApiKeyExample(res.apiKey);
    apiKeyModal.hidden = false;
  } catch (err) {
    showToast(err.message, "bad");
  }
};

const aiModelSelect = document.getElementById("ai-model-select");
const aiModelInput = document.getElementById("ai-model");
const aiKeyInput = document.getElementById("ai-key");

const openAiModal = () => {
  const cfg = getLocalAiConfig();
  document.getElementById("ai-url").value = cfg.baseUrl || "https://api.openai.com/v1";
  aiModelInput.value = cfg.model || "gpt-4o-mini";
  aiKeyInput.value = cfg.apiKey || "";
  aiKeyInput.placeholder = "sk-...";
  aiModelSelect.hidden = true;
  aiModal.hidden = false;
};

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
    renderUserMenu();
  }
  if (appearanceMenu && !appearanceMenu.hidden && !e.target.closest("#appearance-wrap")) {
    appearanceMenu.hidden = true;
  }
  const routeBtn = e.target.closest("[data-route]");
  if (routeBtn) navigate(routeBtn.dataset.route);
});
document.getElementById("go-home").addEventListener("click", () => navigate("banks"));
focusBackBtn?.addEventListener("click", () => navigate(focusBackTarget));
document.getElementById("appearance-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (appearanceMenu) appearanceMenu.hidden = !appearanceMenu.hidden;
});
appearanceMenu?.addEventListener("click", (e) => {
  const themePick = e.target.closest("[data-set-theme]");
  const accentPick = e.target.closest("[data-set-accent]");
  if (!themePick && !accentPick) return;
  const settings = getGlobalSettings();
  if (themePick) {
    settings.theme = themePick.dataset.setTheme;
    settings.eyeCare = settings.theme === "paper";
  }
  if (accentPick) settings.accent = accentPick.dataset.setAccent;
  saveGlobalSettings(settings);
  applyAppearance();
});

document.getElementById("user-close").addEventListener("click", () => { userModal.hidden = true; });
document.getElementById("u-toggle-mode").addEventListener("click", () => {
  userRegisterMode = !userRegisterMode;
  if (userRegisterMode) requireAdminPrompt = false;
  syncUserModalMode();
});
document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const endpoint = userRegisterMode ? "/api/user/register" : "/api/user/login";
    await apiRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("u-name").value.trim(),
        password: document.getElementById("u-pass").value,
        nickname: document.getElementById("u-nick").value.trim(),
        inviteCode: document.getElementById("u-invite").value.trim()
      })
    });
    await refreshAuth();
    userModal.hidden = true;
    showToast(appState.isAdmin ? "管理员登录成功" : "登录成功，已启用云端同步", "ok");
    renderCurrentView();
  } catch (err) {
    showToast(err.message, "bad");
  }
});

document.getElementById("apikey-close").addEventListener("click", () => { apiKeyModal.hidden = true; });
document.getElementById("apikey-copy").addEventListener("click", () => {
  navigator.clipboard?.writeText(document.getElementById("apikey-value").value).catch(() => {});
  showToast("已复制 API Key", "ok");
});
document.getElementById("apikey-rotate").addEventListener("click", async () => {
  if (!confirm("重置后旧 API Key 将立即失效，确认重置吗？")) return;
  try { renderApiKeyExample((await apiRequest("/api/admin/apikey", { method: "POST" })).apiKey); showToast("API Key 已重置", "ok"); }
  catch (err) { showToast(err.message, "bad"); }
});

document.getElementById("ai-close").addEventListener("click", () => { aiModal.hidden = true; });
document.getElementById("ai-fetch-models").addEventListener("click", async () => {
  try {
    showToast("正在拉取模型列表...");
    const res = await apiRequest("/api/ai/models", {
      method: "POST",
      body: JSON.stringify({ aiConfig: { baseUrl: document.getElementById("ai-url").value.trim(), apiKey: aiKeyInput.value.trim() } })
    });
    const models = res.models || [];
    if (!models.length) return showToast("接口未返回可用模型", "bad");
    aiModelSelect.innerHTML = models.map((m) => `<option value="${escapeHtml(m)}" ${m === aiModelInput.value ? "selected" : ""}>${escapeHtml(m)}</option>`).join("");
    aiModelSelect.hidden = false;
    if (!aiModelInput.value) aiModelInput.value = models[0];
    saveLocalAiConfig({ baseUrl: document.getElementById("ai-url").value.trim(), apiKey: aiKeyInput.value.trim(), model: aiModelInput.value.trim() });
    renderUserMenu();
    showToast(`已拉取 ${models.length} 个模型并保存配置`, "ok");
  } catch (err) { showToast(err.message, "bad"); }
});
aiModelSelect.addEventListener("change", () => { if (aiModelSelect.value) aiModelInput.value = aiModelSelect.value; });
document.getElementById("ai-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveLocalAiConfig({ baseUrl: document.getElementById("ai-url").value.trim(), apiKey: aiKeyInput.value.trim(), model: aiModelInput.value.trim() });
  renderUserMenu();
  aiModal.hidden = true;
  showToast("本地 AI 配置已保存（仅当前浏览器可用）", "ok");
});

const bootstrap = async () => {
  initSystemAndDisclaimerModals();
  initGlobalModalDismiss();
  applyAppearance();
  await Promise.all([refreshBanks(), refreshAuth()]);
  const examMatch = location.hash.match(/^#exam=([^&]+)/);
  if (examMatch) return navigate("exams", { examId: decodeURIComponent(examMatch[1]) });
  const hashRoute = location.hash.replace(/^#/, "");
  navigate(VALID_ROUTES.has(hashRoute) ? hashRoute : "banks");
};

bootstrap().catch((err) => {
  appMain.innerHTML = `<div class="panel"><p class="muted-text">初始化失败：${escapeHtml(err.message)}</p></div>`;
});

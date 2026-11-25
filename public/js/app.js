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
import { renderBanksView } from "./views/banks-view.js";
import { renderExamsView } from "./views/exams-view.js";
import { renderImportView } from "./views/import-view.js";
import { renderManageView } from "./views/manage-view.js";
import { renderPracticeView } from "./views/practice-view.js";
import { renderSearchView } from "./views/search-view.js";
import { renderStatsView } from "./views/stats-view.js";
import { renderUsersView } from "./views/users-view.js";
import { initSystemAndDisclaimerModals } from "./system-modal.js";
import { openFormDialog } from "./dialog.js";

const appMain = document.getElementById("app-main");
const bankSelect = document.getElementById("active-bank-select");
const navBtns = document.querySelectorAll(".nav-btn");
const navUsersBtn = document.getElementById("nav-users-btn");
const userAuthBtn = document.getElementById("user-auth-btn");
const userPwdBtn = document.getElementById("user-pwd-btn");
const sysUpdateBtn = document.getElementById("sys-update-btn");
const apiKeyBtn = document.getElementById("api-key-btn");
const aiCfgBtn = document.getElementById("ai-cfg-btn");
const eyeCareBtn = document.getElementById("eye-care-btn");
const userModal = document.getElementById("user-modal");
const aiModal = document.getElementById("ai-modal");
const apiKeyModal = document.getElementById("apikey-modal");

const appState = {
  route: "banks",
  routeParams: {},
  banks: [],
  activeBankId: localStorage.getItem("as_qb_active_bank") || "",
  isAdmin: false
};

let userRegisterMode = false;
let requireAdminPrompt = false;

const applyEyeCare = () => {
  const settings = getGlobalSettings();
  document.body.classList.toggle("eye-care", Boolean(settings.eyeCare));
  eyeCareBtn.textContent = settings.eyeCare ? "退出护眼" : "护眼模式";
};

const syncBankSelect = () => {
  if (!appState.banks.length) {
    bankSelect.innerHTML = '<option value="">暂无题库</option>';
    appState.activeBankId = "";
    return;
  }
  if (!appState.banks.some((b) => b.id === appState.activeBankId)) {
    appState.activeBankId = appState.banks[0].id;
    localStorage.setItem("as_qb_active_bank", appState.activeBankId);
  }
  bankSelect.innerHTML = appState.banks
    .map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === appState.activeBankId ? "selected" : ""}>${escapeHtml(b.name)} (${b.questionCount || 0})</option>`)
    .join("");
};

const syncAuthBtns = () => {
  apiKeyBtn.hidden = !appState.isAdmin;
  if (sysUpdateBtn) sysUpdateBtn.hidden = !appState.isAdmin;
  if (navUsersBtn) navUsersBtn.hidden = !appState.isAdmin;

  const hasAiKey = Boolean(getLocalAiConfig().apiKey);
  aiCfgBtn.textContent = hasAiKey ? "AI 已配置" : "AI 设置(未填Key)";
  aiCfgBtn.classList.toggle("ok", hasAiKey);

  const user = getCloudUser();
  if (userPwdBtn) userPwdBtn.hidden = !Boolean(user);
  const loggedIn = Boolean(user || appState.isAdmin);
  userAuthBtn.textContent = !loggedIn
    ? "账号登录"
    : (appState.isAdmin ? `${user ? (user.nickname || user.username) : "管理员"}(管理员·退出)` : `${user.nickname || user.username}(退出)`);
  userAuthBtn.classList.toggle("primary", loggedIn);
  userAuthBtn.classList.toggle("ghost", !loggedIn);
};

const refreshBanks = async () => {
  const data = await apiRequest("/api/banks");
  appState.banks = data.banks || [];
  syncBankSelect();
};

const refreshAuth = async () => {
  const [adminRes, userRes] = await Promise.all([
    apiRequest("/api/auth/me"),
    apiRequest("/api/user/me")
  ]);
  appState.isAdmin = Boolean(adminRes.admin);
  if (userRes.user) {
    const prog = await apiRequest("/api/user/progress").catch(() => ({ progress: null }));
    setCloudSession(userRes.user, prog.progress);
  } else {
    setCloudSession(null, null);
  }
  syncAuthBtns();
};

const openAccountModal = (requireAdmin = false) => {
  userRegisterMode = false;
  requireAdminPrompt = requireAdmin;
  syncUserModalMode();
  document.getElementById("u-pass").value = "";
  userModal.hidden = false;
  document.getElementById("u-name").focus();
};

const VALID_ROUTES = new Set(["banks", "practice", "exams", "search", "stats", "manage", "import", "users"]);

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
  navBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.route === nextRoute));
  renderCurrentView();
};

const renderCurrentView = () => {
  const ctx = {
    banks: appState.banks,
    activeBankId: appState.activeBankId,
    isAdmin: appState.isAdmin,
    isLoggedIn: Boolean(appState.isAdmin || getCloudUser()),
    routeParams: appState.routeParams,
    onSelectBank: (id) => {
      appState.activeBankId = id;
      localStorage.setItem("as_qb_active_bank", id);
      syncBankSelect();
    },
    onNavigate: navigate,
    onRefreshBanks: async () => {
      await refreshBanks();
      renderCurrentView();
    },
    onRequireLogin: () => openAccountModal(true),
    onRequireUserLogin: () => openAccountModal(false)
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

navBtns.forEach((btn) => btn.addEventListener("click", () => navigate(btn.dataset.route)));
document.getElementById("go-home").addEventListener("click", () => navigate("banks"));

bankSelect.addEventListener("change", (e) => {
  appState.activeBankId = e.target.value;
  localStorage.setItem("as_qb_active_bank", appState.activeBankId);
  renderCurrentView();
});

eyeCareBtn.addEventListener("click", () => {
  const settings = getGlobalSettings();
  settings.eyeCare = !settings.eyeCare;
  saveGlobalSettings(settings);
  applyEyeCare();
});

// 统一账号注册/登录（按数据库 role 自动区分管理员与学员）
const syncUserModalMode = () => {
  document.getElementById("user-modal-title").textContent = userRegisterMode
    ? "注册学员账号"
    : (requireAdminPrompt ? "管理员账号登录" : "账号登录");
  document.getElementById("user-modal-desc").textContent = requireAdminPrompt && !userRegisterMode
    ? "当前操作需要管理员权限，请使用管理员账号（如 admin）登录。"
    : "访客仅支持查看题库与搜题；登录后可刷题、考试与云端同步，管理员账号自动解锁建库、导题与发考权限。";
  document.getElementById("u-nick-wrap").hidden = !userRegisterMode;
  const regDisc = document.getElementById("u-reg-disclaimer");
  if (regDisc) regDisc.hidden = !userRegisterMode;
  document.getElementById("u-submit-btn").textContent = userRegisterMode ? "注册并登录" : "登录";
  document.getElementById("u-toggle-mode").textContent = userRegisterMode ? "已有账号？去登录" : "没有账号？去注册";
};

userAuthBtn.addEventListener("click", async () => {
  if (getCloudUser() || appState.isAdmin) {
    await Promise.all([
      apiRequest("/api/user/logout", { method: "POST" }).catch(() => {}),
      apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {})
    ]);
    await refreshAuth();
    showToast("已退出账号");
    renderCurrentView();
  } else {
    openAccountModal(false);
  }
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
        nickname: document.getElementById("u-nick").value.trim()
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

userPwdBtn?.addEventListener("click", async () => {
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
});

// API 密钥弹窗
const renderApiKeyExample = (key) => {
  document.getElementById("apikey-value").value = key;
  document.getElementById("apikey-example").textContent =
`curl -X POST "${location.origin}/api/banks/default/questions" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${key}" \\
  -d '{"title":"示例题目","type":"0","options":["A1","B1"],"answers":["A1"]}'`;
};
apiKeyBtn.addEventListener("click", async () => {
  try {
    const res = await apiRequest("/api/admin/apikey");
    renderApiKeyExample(res.apiKey);
    apiKeyModal.hidden = false;
  } catch (err) {
    showToast(err.message, "bad");
  }
});
document.getElementById("apikey-close").addEventListener("click", () => { apiKeyModal.hidden = true; });
document.getElementById("apikey-copy").addEventListener("click", () => {
  const val = document.getElementById("apikey-value").value;
  navigator.clipboard?.writeText(val).catch(() => {});
  showToast("已复制 API Key", "ok");
});
document.getElementById("apikey-rotate").addEventListener("click", async () => {
  if (!confirm("重置后旧 API Key 将立即失效，确认重置吗？")) return;
  try {
    const res = await apiRequest("/api/admin/apikey", { method: "POST" });
    renderApiKeyExample(res.apiKey);
    showToast("API Key 已重置", "ok");
  } catch (err) {
    showToast(err.message, "bad");
  }
});

// 本地 AI 配置弹窗（仅保存在当前浏览器 localStorage）
const aiModelSelect = document.getElementById("ai-model-select");
const aiModelInput = document.getElementById("ai-model");
const aiKeyInput = document.getElementById("ai-key");

aiCfgBtn.addEventListener("click", () => {
  const cfg = getLocalAiConfig();
  document.getElementById("ai-url").value = cfg.baseUrl || "https://api.openai.com/v1";
  aiModelInput.value = cfg.model || "gpt-4o-mini";
  aiKeyInput.value = cfg.apiKey || "";
  aiKeyInput.placeholder = "sk-...";
  aiModelSelect.hidden = true;
  aiModal.hidden = false;
});
document.getElementById("ai-close").addEventListener("click", () => { aiModal.hidden = true; });
document.getElementById("ai-fetch-models").addEventListener("click", async () => {
  try {
    showToast("正在拉取模型列表...");
    const res = await apiRequest("/api/ai/models", {
      method: "POST",
      body: JSON.stringify({
        aiConfig: {
          baseUrl: document.getElementById("ai-url").value.trim(),
          apiKey: aiKeyInput.value.trim()
        }
      })
    });
    const models = res.models || [];
    if (!models.length) return showToast("接口未返回可用模型", "bad");
    aiModelSelect.innerHTML = models
      .map((m) => `<option value="${escapeHtml(m)}" ${m === aiModelInput.value ? "selected" : ""}>${escapeHtml(m)}</option>`)
      .join("");
    aiModelSelect.hidden = false;
    if (!aiModelInput.value) aiModelInput.value = models[0];
    saveLocalAiConfig({
      baseUrl: document.getElementById("ai-url").value.trim(),
      apiKey: aiKeyInput.value.trim(),
      model: aiModelInput.value.trim()
    });
    syncAuthBtns();
    showToast(`已拉取 ${models.length} 个模型并保存配置`, "ok");
  } catch (err) {
    showToast(err.message, "bad");
  }
});
aiModelSelect.addEventListener("change", () => {
  if (aiModelSelect.value) aiModelInput.value = aiModelSelect.value;
});
document.getElementById("ai-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveLocalAiConfig({
    baseUrl: document.getElementById("ai-url").value.trim(),
    apiKey: aiKeyInput.value.trim(),
    model: aiModelInput.value.trim()
  });
  syncAuthBtns();
  aiModal.hidden = true;
  showToast("本地 AI 配置已保存（仅当前浏览器可用）", "ok");
});

const bootstrap = async () => {
  initSystemAndDisclaimerModals();
  applyEyeCare();
  await Promise.all([refreshBanks(), refreshAuth()]);
  const examMatch = location.hash.match(/^#exam=([^&]+)/);
  if (examMatch) {
    navigate("exams", { examId: decodeURIComponent(examMatch[1]) });
    return;
  }
  const hashRoute = location.hash.replace(/^#/, "");
  if (VALID_ROUTES.has(hashRoute)) {
    navigate(hashRoute);
  } else {
    navigate("banks");
  }
};

bootstrap().catch((err) => {
  appMain.innerHTML = `<div class="panel"><p class="muted-text">初始化失败：${escapeHtml(err.message)}</p></div>`;
});

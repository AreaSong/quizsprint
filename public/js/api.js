import { openFormDialog } from "./dialog.js";

export const BANK_CATEGORIES = {
  theory: "理论",
  practice: "实践",
  comprehensive: "综合",
  exam: "真题"
};

export const buildBankOptionsHtml = (banks, selectedId = "", opts = {}) => {
  const { includeAllLabel = "", prefix = "", showCount = false } = opts;
  const groupOrder = [];
  const groups = new Map();
  for (const b of banks || []) {
    const key = b.subjectName ? `${b.term ? `[${b.term}] ` : ""}${b.subjectName}` : "未分类题库";
    if (!groups.has(key)) { groups.set(key, []); groupOrder.push(key); }
    groups.get(key).push(b);
  }
  const useOptgroup = groupOrder.length > 1 || (groupOrder.length === 1 && groupOrder[0] !== "未分类题库");
  const optHtml = (b) => {
    const countPart = showCount ? ` (${b.questionCount || 0})` : "";
    return `<option value="${escapeHtml(b.id)}" ${b.id === selectedId ? "selected" : ""}>${escapeHtml(`${prefix}${b.name}${countPart}`)}</option>`;
  };
  const body = useOptgroup
    ? groupOrder.map((g) => `<optgroup label="${escapeHtml(g)}">${groups.get(g).map(optHtml).join("")}</optgroup>`).join("")
    : (banks || []).map(optHtml).join("");
  return (includeAllLabel ? `<option value="">${escapeHtml(includeAllLabel)}</option>` : "") + body;
};

export const TYPE_LABELS = {
  "0": "单选题",
  "1": "多选题",
  "2": "填空题",
  "3": "判断题",
  "4": "简答题",
  "5": "不定项选择题",
  "6": "实操题",
  "7": "排序题",
  "8": "配对题"
};

export const parseMatchPair = (raw) => {
  const s = String(raw || "");
  const m = s.match(/^(.*?)\s*(?:=>|->|::)\s*(.+)$/);
  if (!m) return { left: s.trim(), right: "" };
  return { left: m[1].trim(), right: m[2].trim() };
};

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export const showToast = (msg, kind = "") => {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`.trim();
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.classList.add("toast-out"), 2400);
  setTimeout(() => el.remove(), 2640);
};

export const apiRequest = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.msg || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

const STORAGE_PREFIX = "as_qb_v2_";
let currentCloudUser = null;
let cloudBanksCache = {};

export const setCloudSession = (user, progress = null) => {
  currentCloudUser = user || null;
  cloudBanksCache = progress?.banks || {};
};

export const getCloudUser = () => currentCloudUser;

const readJsonStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJsonStorage = (key, value) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // 忽略配额异常
  }
};

export const getGlobalSettings = () => {
  const s = readJsonStorage("settings", {
    reciteMode: false,
    autoNext: true,
    shuffleOptions: false,
    eyeCare: false,
    theme: "",
    accent: "indigo",
    immersive: false,
    asideCollapsed: false,
    notesCollapsed: null,
    strategy: "default",
    wrongClearStreak: 1
  });
  if (!s.theme) s.theme = s.eyeCare ? "paper" : "light";
  if (!s.accent) s.accent = "indigo";
  return s;
};

export const saveGlobalSettings = (next) => writeJsonStorage("settings", next);

export const getLocalAiConfig = () => readJsonStorage("ai_config", {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini"
});

export const saveLocalAiConfig = (cfg) => writeJsonStorage("ai_config", {
  baseUrl: String(cfg.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
  apiKey: String(cfg.apiKey || "").trim(),
  model: String(cfg.model || "gpt-4o-mini").trim()
});

export const aiRequest = async (url, payload = {}) => {
  const aiConfig = getLocalAiConfig();
  if (!aiConfig.apiKey) {
    throw new Error("请先点击右上角「AI 设置」填入你自己的 API Key（仅保存在你本地）");
  }
  return apiRequest(url, {
    method: "POST",
    body: JSON.stringify({ ...payload, aiConfig })
  });
};

export const getBankPracticeState = (bankId) => {
  if (currentCloudUser && cloudBanksCache[bankId]) {
    return { wrongStreaks: {}, ...cloudBanksCache[bankId] };
  }
  return readJsonStorage(`bank_${bankId}`, {
    records: {},
    wrongIds: [],
    wrongStreaks: {},
    favoriteIds: [],
    masteredIds: [],
    notes: {},
    lastIndex: 0
  });
};

const recordLocalDailyDelta = (dailyDelta) => {
  if (!dailyDelta || (!dailyDelta.answered && !dailyDelta.seconds)) return;
  const stats = readJsonStorage("daily_stats", {});
  const today = new Date().toISOString().slice(0, 10);
  const cur = stats[today] || { answered: 0, correct: 0, seconds: 0 };
  stats[today] = {
    answered: cur.answered + Number(dailyDelta.answered || 0),
    correct: cur.correct + Number(dailyDelta.correct || 0),
    seconds: cur.seconds + Number(dailyDelta.seconds || 0)
  };
  writeJsonStorage("daily_stats", stats);
};

export const getLocalDailyStats = () => readJsonStorage("daily_stats", {});

export const saveBankPracticeState = (bankId, state, dailyDelta = null) => {
  writeJsonStorage(`bank_${bankId}`, state);
  recordLocalDailyDelta(dailyDelta);
  if (currentCloudUser) {
    cloudBanksCache[bankId] = state;
    apiRequest("/api/user/progress", {
      method: "POST",
      body: JSON.stringify({ bankId, bankData: state, dailyDelta })
    }).catch(() => {});
  }
};

export const getBankPassword = (bankId) => sessionStorage.getItem(`as_qb_pwd_${bankId}`) || "";
export const setBankPassword = (bankId, pwd) => sessionStorage.setItem(`as_qb_pwd_${bankId}`, pwd);

export const fetchBankQuestionsSafe = async (bankId) => {
  const pwd = getBankPassword(bankId);
  const headers = pwd ? { "x-bank-password": pwd } : {};
  try {
    return await apiRequest(`/api/banks/${encodeURIComponent(bankId)}/questions`, { headers });
  } catch (err) {
    if (err.status === 403 && err.data?.locked) {
      const form = await openFormDialog({
        title: "题库访问验证",
        description: "该题库已加密，请输入访问密码：",
        fields: [{ name: "password", label: "访问密码", type: "password", required: true }]
      });
      if (!form) throw err;
      setBankPassword(bankId, form.password);
      return apiRequest(`/api/banks/${encodeURIComponent(bankId)}/questions`, {
        headers: { "x-bank-password": form.password }
      });
    }
    throw err;
  }
};

export const downloadBankFileSafe = async (bank, format = "xlsx") => {
  const suffix = format === "xlsx" ? "export.xlsx" : "export";
  const ext = format === "xlsx" ? ".xlsx" : ".json";
  const tryFetch = async (pwd) => {
    const headers = pwd ? { "x-bank-password": pwd } : {};
    return fetch(`/api/banks/${encodeURIComponent(bank.id)}/${suffix}`, {
      credentials: "same-origin",
      headers
    });
  };

  let res = await tryFetch(getBankPassword(bank.id));
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    if (data.locked) {
      const form = await openFormDialog({
        title: "导出加密题库",
        description: "该题库已加密，请输入访问密码后再导出：",
        fields: [{ name: "password", label: "访问密码", type: "password", required: true }]
      });
      if (!form) return;
      setBankPassword(bank.id, form.password);
      res = await tryFetch(form.password);
    }
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.msg || `导出失败 (${res.status})`);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  a.download = `${bank.name || "题库导出"}${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

export const printQuestionsDocument = (title, questions, withAnswers = true) => {
  const win = window.open("", "_blank");
  if (!win) return showToast("请允许弹窗以打印/导出 PDF", "bad");
  const rows = questions.map((q, idx) => `
    <div style="margin-bottom:14px;page-break-inside:avoid;">
      <div style="font-weight:600;">${idx + 1}. ${escapeHtml(q.title)}</div>
      ${(q.images || []).map((src) => `<img src="${escapeHtml(src)}" style="max-width:260px;max-height:160px;margin:6px 6px 4px 0;border:1px solid #ddd;border-radius:4px;">`).join("")}
      ${(q.options || []).map((o, i) => `<div style="margin-left:16px;">${LETTERS[i] || i + 1}. ${escapeHtml(o)}</div>`).join("")}
      ${withAnswers ? `<div style="color:#16a34a;margin-top:4px;white-space:pre-wrap;">答案：${escapeHtml((q.answers || []).join(" | "))}</div>` : ""}
      ${withAnswers && (q.answerImages || []).length ? `<div style="margin-top:6px;"><div style="font-size:12px;color:#666;">参考答案配图：</div>${q.answerImages.map((src) => `<img src="${escapeHtml(src)}" style="max-width:300px;max-height:200px;margin:4px 6px 4px 0;border:1px solid #ddd;border-radius:4px;">`).join("")}</div>` : ""}
      ${withAnswers && q.analysis ? `<div style="color:#555;font-size:13px;white-space:pre-wrap;margin-top:4px;">解析：${escapeHtml(q.analysis)}</div>` : ""}
    </div>
  `).join("");
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:sans-serif;padding:24px;line-height:1.6;color:#111;}h1{border-bottom:1px solid #ccc;padding-bottom:8px;}</style>
    </head><body><h1>${escapeHtml(title)}（共 ${questions.length} 题）</h1>${rows}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
};

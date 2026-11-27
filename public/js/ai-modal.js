import {
  apiRequest,
  clearLocalAiConfig,
  escapeHtml,
  getLocalAiConfig,
  saveLocalAiConfig,
  showToast
} from "./api.js";

/** 初始化本地 AI 模型配置弹窗（支持拉取后直接下拉列表选取与手动输入切换） */
export const initAiConfigModal = ({ aiModal, onUpdated } = {}) => {
  const aiModelSelect = document.getElementById("ai-model-select");
  const aiModelInput = document.getElementById("ai-model");
  const aiKeyInput = document.getElementById("ai-key");
  const aiUrlInput = document.getElementById("ai-url");
  const aiModelModeBtn = document.getElementById("ai-model-mode-btn");
  let cachedModels = [];
  let manualMode = false;

  const syncModelPicker = (models, preferred, forceManual = false) => {
    cachedModels = Array.isArray(models) ? models : [];
    manualMode = Boolean(forceManual || !cachedModels.length);
    if (!manualMode) {
      const picked = cachedModels.includes(preferred) ? preferred : cachedModels[0];
      aiModelSelect.innerHTML = cachedModels
        .map((m) => `<option value="${escapeHtml(m)}" ${m === picked ? "selected" : ""}>${escapeHtml(m)}</option>`)
        .join("");
      aiModelSelect.value = picked;
      aiModelInput.value = picked;
    }
    aiModelSelect.hidden = manualMode;
    aiModelInput.hidden = !manualMode;
    aiModelInput.required = manualMode;
    if (aiModelModeBtn) {
      aiModelModeBtn.hidden = !cachedModels.length;
      aiModelModeBtn.textContent = manualMode ? "从列表选择" : "手动输入";
    }
  };

  const openAiModal = () => {
    const cfg = getLocalAiConfig();
    aiUrlInput.value = cfg.baseUrl || "https://api.openai.com/v1";
    aiKeyInput.value = cfg.apiKey || "";
    aiKeyInput.placeholder = "sk-...";
    const curModel = cfg.model || "gpt-4o-mini";
    aiModelInput.value = curModel;
    const list = Array.isArray(cfg.models) ? cfg.models : [];
    syncModelPicker(list, curModel, list.length > 0 && curModel && !list.includes(curModel));
    aiModal.hidden = false;
  };

  document.getElementById("ai-close")?.addEventListener("click", () => { aiModal.hidden = true; });
  document.getElementById("ai-clear-btn")?.addEventListener("click", () => {
    clearLocalAiConfig();
    openAiModal();
    onUpdated?.();
    showToast("已清除本地 AI 密钥与配置");
  });
  aiModelModeBtn?.addEventListener("click", () => syncModelPicker(cachedModels, aiModelInput.value.trim(), !manualMode));

  document.getElementById("ai-fetch-models")?.addEventListener("click", async () => {
    try {
      showToast("正在拉取模型列表...");
      const baseUrl = aiUrlInput.value.trim();
      const apiKey = aiKeyInput.value.trim();
      const res = await apiRequest("/api/ai/models", { method: "POST", body: JSON.stringify({ aiConfig: { baseUrl, apiKey } }) });
      const models = res.models || [];
      if (!models.length) return showToast("接口未返回可用模型", "bad");
      syncModelPicker(models, aiModelInput.value.trim(), false);
      saveLocalAiConfig({ baseUrl, apiKey, model: aiModelSelect.value, models });
      onUpdated?.();
      aiModelSelect.focus();
      showToast(`已拉取 ${models.length} 个模型，请从列表选择`, "ok");
    } catch (err) {
      showToast(err.message, "bad");
    }
  });

  aiModelSelect?.addEventListener("change", () => {
    if (aiModelSelect.value) aiModelInput.value = aiModelSelect.value;
  });

  document.getElementById("ai-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const model = (manualMode ? aiModelInput.value : aiModelSelect.value).trim();
    saveLocalAiConfig({
      baseUrl: aiUrlInput.value.trim(),
      apiKey: aiKeyInput.value.trim(),
      model,
      models: cachedModels
    });
    onUpdated?.();
    aiModal.hidden = true;
    showToast("本地 AI 配置已保存（仅当前浏览器可用）", "ok");
  });

  return { openAiModal };
};

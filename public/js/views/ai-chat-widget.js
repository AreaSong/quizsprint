import { aiRequest, escapeHtml, getCloudUser, showToast } from "../api.js";
import { renderRichMarkdown } from "../markdown.js";

export { renderRichMarkdown as renderLightMarkdown };

const QUICK_PROMPTS = [
  "详细讲讲这题",
  "为什么不选其他项？",
  "通俗举例说明",
  "总结易错点"
];

const getChatStorageKey = () => `qs_ai_chat_v1_${getCloudUser()?.id || "anon"}`;

const readLocalStore = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(getChatStorageKey()) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeLocalStore = (store) => {
  const entries = Object.entries(store || {})
    .filter(([, v]) => Array.isArray(v?.messages) && v.messages.length > 0)
    .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
    .slice(0, 100);
  const compact = (limit) => Object.fromEntries(
    entries.slice(0, limit).map(([k, v]) => [k, { updatedAt: v.updatedAt || Date.now(), messages: v.messages.slice(-30) }])
  );
  try {
    localStorage.setItem(getChatStorageKey(), JSON.stringify(compact(100)));
  } catch {
    try { localStorage.setItem(getChatStorageKey(), JSON.stringify(compact(40))); } catch { /* ignore */ }
  }
};

const getQuestionMessages = (qid, cloudFallback = []) => {
  const entry = readLocalStore()[qid];
  if (Array.isArray(entry?.messages) && entry.messages.length) return entry.messages.map((m) => ({ ...m }));
  return Array.isArray(cloudFallback) ? cloudFallback.map((m) => ({ ...m })) : [];
};

const persistQuestionMessages = (qid, messages) => {
  const store = readLocalStore();
  if (messages.length) store[qid] = { updatedAt: Date.now(), messages: messages.slice(-30) };
  else delete store[qid];
  writeLocalStore(store);
};

const renderMessagesBodyHtml = (messages, sending, elapsedSec, hasNoteHook) => {
  if (!messages.length && !sending) {
    return `
      <div class="ai-empty-state">
        <div class="muted-text" style="font-size:12.5px;">点击快捷问题，或直接在下方输入疑问</div>
        <div class="ai-quick-row">
          ${QUICK_PROMPTS.map((p) => `<button type="button" class="btn ghost tiny js-ai-quick" data-q="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}
        </div>
      </div>
    `;
  }
  const items = messages.map((m, idx) => {
    const isUser = m.role === "user";
    const bodyHtml = isUser ? escapeHtml(m.content) : renderRichMarkdown(m.content);
    const actionsHtml = !isUser ? `
      <div class="ai-msg-actions">
        <button type="button" class="ai-act-btn js-ai-copy" data-idx="${idx}">复制</button>
        ${hasNoteHook ? `<button type="button" class="ai-act-btn js-ai-to-note" data-idx="${idx}">写入笔记</button>` : ""}
      </div>
    ` : "";
    return `<div class="ai-msg ${m.role}"><div class="ai-msg-bubble">${bodyHtml}${actionsHtml}</div></div>`;
  }).join("");
  const thinkingHtml = sending ? `
    <div class="ai-msg assistant"><div class="ai-msg-bubble">
      <div class="ai-thinking">
        <span class="ai-spinner" aria-hidden="true"></span>
        <span>AI 正在思考</span>
        <span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="ai-elapsed">${elapsedSec}s</span>
      </div>
    </div></div>` : "";
  return items + thinkingHtml;
};

export const mountAiChatWidget = (rootEl, question, options = {}) => {
  if (!rootEl || !question) return;
  const qid = question.id;
  const { isWide = false, onToggleWide = null, onAppendNote = null, autoPrompt = "", initialMessages = [], onHistoryChange = null } = options;
  const messages = getQuestionMessages(qid, initialMessages);
  let sending = false;
  let elapsedSec = 0;
  let elapsedTimer = null;

  const stopElapsed = () => { if (elapsedTimer) clearInterval(elapsedTimer); elapsedTimer = null; };
  const syncHistory = () => {
    persistQuestionMessages(qid, messages);
    onHistoryChange?.([...messages]);
  };

  const sendQuestion = async (text) => {
    const content = String(text || "").trim();
    if (!content || sending) return;
    messages.push({ role: "user", content });
    syncHistory();
    sending = true;
    elapsedSec = 0;
    stopElapsed();
    render();
    elapsedTimer = setInterval(() => {
      if (!document.body.contains(rootEl) || !sending) return stopElapsed();
      elapsedSec += 1;
      const el = rootEl.querySelector(".ai-elapsed");
      if (el) el.textContent = `${elapsedSec}s`;
    }, 1000);
    try {
      const res = await aiRequest("/api/ai/chat", { question, messages });
      messages.push({ role: "assistant", content: res.reply || "暂无回复" });
    } catch (err) {
      messages.push({ role: "assistant", content: `请求失败：${err.message}` });
      showToast(err.message, "bad");
    } finally {
      sending = false;
      stopElapsed();
      syncHistory();
      render();
    }
  };

  const render = () => {
    const canWide = typeof onToggleWide === "function";
    const hasNoteHook = typeof onAppendNote === "function";
    rootEl.innerHTML = `
      <div class="ai-chat-card">
        <div class="ai-head-bar">
          <span class="muted-text" style="font-size:12px;">${messages.length ? `对话 ${messages.length} 条（已自动保存）` : "围绕本题随时追问"}</span>
          <div class="row-gap" style="gap:6px;">
            ${canWide ? `<button type="button" class="btn ghost tiny js-ai-wide">${isWide ? "还原" : "加宽"}</button>` : ""}
            ${messages.length ? `<button type="button" class="btn ghost tiny js-ai-clear">清空</button>` : ""}
          </div>
        </div>
        <div class="ai-msg-list">${renderMessagesBodyHtml(messages, sending, elapsedSec, hasNoteHook)}</div>
        <form class="ai-input-row js-ai-form">
          <input class="js-ai-input" type="text" placeholder="针对本题向 AI 提问..." ${sending ? "disabled" : ""}>
          <button type="submit" class="btn primary tiny" ${sending ? "disabled" : ""}>${sending ? "思考中" : "发送"}</button>
        </form>
      </div>
    `;

    const msgList = rootEl.querySelector(".ai-msg-list");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;

    rootEl.querySelector(".js-ai-wide")?.addEventListener("click", () => onToggleWide?.());
    rootEl.querySelector(".js-ai-clear")?.addEventListener("click", () => { messages.length = 0; syncHistory(); render(); });
    rootEl.querySelectorAll(".js-ai-quick").forEach((btn) => btn.addEventListener("click", () => sendQuestion(btn.dataset.q)));
    rootEl.querySelectorAll(".js-ai-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msg = messages[Number(btn.dataset.idx)];
        if (msg) navigator.clipboard?.writeText(msg.content).then(() => showToast("已复制回答", "ok")).catch(() => {});
      });
    });
    rootEl.querySelectorAll(".js-ai-to-note").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msg = messages[Number(btn.dataset.idx)];
        if (msg) onAppendNote?.(msg.content);
      });
    });
    rootEl.querySelector(".js-ai-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = rootEl.querySelector(".js-ai-input");
      const text = input.value;
      input.value = "";
      sendQuestion(text);
    });
  };

  render();
  if (autoPrompt) sendQuestion(autoPrompt);
};

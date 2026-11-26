import { aiRequest, escapeHtml, showToast } from "../api.js";

const chatHistoryByQid = new Map();

const QUICK_PROMPTS = [
  "详细讲讲这题",
  "为什么不选其他项？",
  "通俗举例说明",
  "总结易错点"
];

const formatInlineMd = (text) =>
  text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

export const renderLightMarkdown = (rawText) => {
  const safe = escapeHtml(String(rawText || ""));
  const codeBlocks = [];
  const withPlaceholders = safe.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
    return `\n@@CODEBLOCK_${idx}@@\n`;
  });

  const lines = withPlaceholders.split("\n");
  const out = [];
  let listTag = "";
  const closeList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = ""; } };

  for (const line of lines) {
    const trimmed = line.trim();
    const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
    if (codeMatch) { closeList(); out.push(codeBlocks[Number(codeMatch[1])] || ""); continue; }
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (listTag !== "ul") { closeList(); listTag = "ul"; out.push("<ul>"); }
      out.push(`<li>${formatInlineMd(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (listTag !== "ol") { closeList(); listTag = "ol"; out.push("<ol>"); }
      out.push(`<li>${formatInlineMd(olMatch[1])}</li>`);
      continue;
    }
    closeList();
    if (!trimmed) continue;
    const hMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    out.push(hMatch ? `<h4>${formatInlineMd(hMatch[1])}</h4>` : `<p>${formatInlineMd(trimmed)}</p>`);
  }
  closeList();
  return out.join("") || "<p></p>";
};

const renderMessagesBodyHtml = (messages, sending, hasNoteHook) => {
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
    const bodyHtml = isUser ? escapeHtml(m.content) : renderLightMarkdown(m.content);
    const actionsHtml = !isUser ? `
      <div class="ai-msg-actions">
        <button type="button" class="ai-act-btn js-ai-copy" data-idx="${idx}">复制</button>
        ${hasNoteHook ? `<button type="button" class="ai-act-btn js-ai-to-note" data-idx="${idx}">写入笔记</button>` : ""}
      </div>
    ` : "";
    return `<div class="ai-msg ${m.role}"><div class="ai-msg-bubble">${bodyHtml}${actionsHtml}</div></div>`;
  }).join("");
  return items + (sending ? '<div class="ai-msg assistant"><div class="ai-msg-bubble"><p>AI 正在思考...</p></div></div>' : "");
};

export const mountAiChatWidget = (rootEl, question, options = {}) => {
  if (!rootEl || !question) return;
  const qid = question.id;
  if (!chatHistoryByQid.has(qid)) chatHistoryByQid.set(qid, []);
  const messages = chatHistoryByQid.get(qid);
  const { isWide = false, onToggleWide = null, onAppendNote = null, autoPrompt = "" } = options;
  let sending = false;

  const sendQuestion = async (text) => {
    const content = String(text || "").trim();
    if (!content || sending) return;
    messages.push({ role: "user", content });
    sending = true;
    render();
    try {
      const res = await aiRequest("/api/ai/chat", { question, messages });
      messages.push({ role: "assistant", content: res.reply || "暂无回复" });
    } catch (err) {
      messages.push({ role: "assistant", content: `请求失败：${err.message}` });
      showToast(err.message, "bad");
    } finally {
      sending = false;
      render();
    }
  };

  const render = () => {
    const canWide = typeof onToggleWide === "function";
    const hasNoteHook = typeof onAppendNote === "function";
    rootEl.innerHTML = `
      <div class="ai-chat-card">
        <div class="ai-head-bar">
          <span class="muted-text" style="font-size:12px;">${messages.length ? `对话 ${messages.length} 条` : "围绕本题随时追问"}</span>
          <div class="row-gap" style="gap:6px;">
            ${canWide ? `<button type="button" class="btn ghost tiny js-ai-wide">${isWide ? "还原" : "加宽"}</button>` : ""}
            ${messages.length ? `<button type="button" class="btn ghost tiny js-ai-clear">清空</button>` : ""}
          </div>
        </div>
        <div class="ai-msg-list">${renderMessagesBodyHtml(messages, sending, hasNoteHook)}</div>
        <form class="ai-input-row js-ai-form">
          <input class="js-ai-input" type="text" placeholder="针对本题向 AI 提问..." ${sending ? "disabled" : ""}>
          <button type="submit" class="btn primary tiny" ${sending ? "disabled" : ""}>发送</button>
        </form>
      </div>
    `;

    const msgList = rootEl.querySelector(".ai-msg-list");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;

    rootEl.querySelector(".js-ai-wide")?.addEventListener("click", () => onToggleWide?.());
    rootEl.querySelector(".js-ai-clear")?.addEventListener("click", () => { messages.length = 0; render(); });
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

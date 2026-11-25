import { aiRequest, escapeHtml, showToast } from "../api.js";

const chatHistoryByQid = new Map();

const QUICK_PROMPTS = [
  "详细讲讲这题",
  "为什么不选其他项？",
  "通俗举例说明",
  "总结易错点"
];

export const mountAiChatWidget = (rootEl, question) => {
  if (!rootEl || !question) return;
  const qid = question.id;
  if (!chatHistoryByQid.has(qid)) chatHistoryByQid.set(qid, []);
  const messages = chatHistoryByQid.get(qid);
  let sending = false;

  const render = () => {
    rootEl.innerHTML = `
      <div class="ai-chat-card">
        <div class="row-gap" style="justify-content:space-between;">
          <strong>AI 助教问答</strong>
          ${messages.length ? `<button type="button" class="btn ghost tiny js-ai-clear">清空</button>` : `<span class="muted-text" style="font-size:12px;">围绕本题随时追问</span>`}
        </div>
        <div class="ai-quick-row">
          ${QUICK_PROMPTS.map((p) => `<button type="button" class="btn ghost tiny js-ai-quick" data-q="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}
        </div>
        <div class="ai-msg-list">
          ${messages.map((m) => `
            <div class="ai-msg ${m.role}">
              <div class="ai-msg-bubble">${escapeHtml(m.content)}</div>
            </div>
          `).join("") || `<div class="muted-text" style="font-size:12px;text-align:center;padding:12px 0;">点击上方快捷问题，或在下方输入你的疑问</div>`}
          ${sending ? `<div class="ai-msg assistant"><div class="ai-msg-bubble">AI 正在思考...</div></div>` : ""}
        </div>
        <form class="ai-input-row js-ai-form">
          <input class="js-ai-input" type="text" placeholder="针对本题向 AI 提问..." ${sending ? "disabled" : ""}>
          <button type="submit" class="btn primary tiny" ${sending ? "disabled" : ""}>发送</button>
        </form>
      </div>
    `;

    const msgList = rootEl.querySelector(".ai-msg-list");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;

    rootEl.querySelector(".js-ai-clear")?.addEventListener("click", () => {
      messages.length = 0;
      render();
    });

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

    rootEl.querySelectorAll(".js-ai-quick").forEach((btn) => {
      btn.addEventListener("click", () => sendQuestion(btn.dataset.q));
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
};

import { aiRequest, escapeHtml, getCloudUser, showToast } from "../api.js";
import { openConfirmDialog, openFormDialog } from "../dialog.js";
import { renderRichMarkdown } from "../markdown.js";

export { renderRichMarkdown as renderLightMarkdown };

const QUICK_PROMPTS = ["详细讲讲这题", "为什么不选其他项？", "通俗举例说明", "总结易错点"];
const newSessionId = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const getChatStorageKey = () => `qs_ai_chat_v1_${getCloudUser()?.id || "anon"}`;

const formatChatTime = (ts) => {
  if (!ts) return "";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return hhmm;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm}`;
};

const sessionTitleOf = (sess) => {
  if (sess?.customTitle && String(sess.title || "").trim()) return String(sess.title).trim();
  const firstUser = (sess?.messages || []).find((m) => m.role === "user" && String(m.content || "").trim());
  if (!firstUser) return "新对话";
  const txt = String(firstUser.content).trim().replace(/\s+/g, " ");
  return txt.length > 12 ? `${txt.slice(0, 12)}…` : txt;
};

const makeSession = (messages = [], updatedAt = Date.now(), meta = {}) => {
  const clean = Array.isArray(messages)
    ? messages.map((m) => ({ ...m, role: m?.role === "user" ? "user" : "assistant" })).slice(-30)
    : [];
  const customTitle = Boolean(meta.customTitle && String(meta.title || "").trim());
  const base = { id: meta.id || newSessionId(), customTitle, title: meta.title || "", updatedAt, messages: clean };
  base.title = sessionTitleOf(base);
  return base;
};

const normalizeQuestionState = (raw) => {
  let sessions = [];
  if (Array.isArray(raw)) {
    if (raw.length) sessions = [makeSession(raw)];
  } else if (raw && Array.isArray(raw.sessions)) {
    sessions = raw.sessions
      .filter((s) => s && Array.isArray(s.messages))
      .map((s) => makeSession(s.messages, Number(s.updatedAt || Date.now()), { id: String(s.id || newSessionId()), customTitle: s.customTitle, title: s.title }));
  } else if (raw && Array.isArray(raw.messages) && raw.messages.length) {
    sessions = [makeSession(raw.messages, raw.updatedAt)];
  }
  if (!sessions.length) sessions = [makeSession([])];
  const activeId = sessions.some((s) => s.id === raw?.activeId) ? raw.activeId : sessions[0].id;
  return { activeId, updatedAt: Number(raw?.updatedAt || Date.now()), sessions };
};

const readLocalStore = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(getChatStorageKey()) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
};

const writeLocalStore = (store) => {
  const entries = Object.entries(store || {})
    .filter(([, v]) => normalizeQuestionState(v).sessions.some((s) => s.messages.length > 0))
    .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
    .slice(0, 80);
  const compact = (limit) => Object.fromEntries(entries.slice(0, limit).map(([k, v]) => [k, v]));
  try { localStorage.setItem(getChatStorageKey(), JSON.stringify(compact(80))); }
  catch { try { localStorage.setItem(getChatStorageKey(), JSON.stringify(compact(30))); } catch { /* ignore */ } }
};

const loadQuestionState = (qid, cloudFallback = null) => {
  const localRaw = readLocalStore()[qid];
  if (localRaw) return normalizeQuestionState(localRaw);
  return normalizeQuestionState(cloudFallback);
};

const persistQuestionState = (qid, qState) => {
  const kept = qState.sessions
    .filter((s) => s.messages.length > 0 || s.id === qState.activeId)
    .slice(0, 10);
  const saved = { activeId: qState.activeId, updatedAt: Date.now(), sessions: kept };
  const store = readLocalStore();
  if (saved.sessions.some((s) => s.messages.length > 0)) store[qid] = saved;
  else delete store[qid];
  writeLocalStore(store);
};

const compactForCloud = (qState) => {
  const nonEmpty = qState.sessions
    .filter((s) => s.messages.length > 0)
    .slice(0, 5)
    .map((s) => ({ ...s, title: sessionTitleOf(s), customTitle: Boolean(s.customTitle), messages: s.messages.slice(-12) }));
  if (!nonEmpty.length) return null;
  const activeId = nonEmpty.some((s) => s.id === qState.activeId) ? qState.activeId : nonEmpty[0].id;
  return { activeId, updatedAt: Date.now(), sessions: nonEmpty };
};

const renderMessagesBodyHtml = (sess, sending, elapsedSec, hasNoteHook) => {
  const messages = sess?.messages || [];
  if (!messages.length && !sending) {
    return `
      <div class="ai-empty-state">
        <div class="muted-text" style="font-size:0.7813rem;">点击快捷问题，或直接在下方输入疑问</div>
        <div class="ai-quick-row">
          ${QUICK_PROMPTS.map((p) => `<button type="button" class="btn ghost tiny js-ai-quick" data-q="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}
        </div>
      </div>
    `;
  }
  const timeBanner = sess?.updatedAt
    ? `<div class="muted-text" style="text-align:center;font-size:0.6875rem;opacity:.8;">最近活跃 · ${escapeHtml(formatChatTime(sess.updatedAt))}</div>`
    : "";
  const items = messages.map((m, idx) => {
    const safeRole = m.role === "user" ? "user" : "assistant";
    const isUser = safeRole === "user";
    const bodyHtml = isUser ? escapeHtml(m.content) : renderRichMarkdown(m.content);
    const tLabel = formatChatTime(m.ts);
    const actionsHtml = `
      <div class="ai-msg-actions" style="justify-content:space-between;align-items:center;">
        <div class="row-gap" style="gap:10px;">
          ${!isUser ? `<button type="button" class="ai-act-btn js-ai-copy" data-idx="${idx}">复制</button>` : ""}
          ${!isUser && hasNoteHook ? `<button type="button" class="ai-act-btn js-ai-to-note" data-idx="${idx}">写入笔记</button>` : ""}
          <button type="button" class="ai-act-btn js-ai-del-msg" data-idx="${idx}">删除</button>
        </div>
        ${tLabel ? `<span class="muted-text" style="font-size:0.6875rem;font-variant-numeric:tabular-nums;">${escapeHtml(tLabel)}</span>` : ""}
      </div>
    `;
    return `<div class="ai-msg ${safeRole}"><div class="ai-msg-bubble">${bodyHtml}${actionsHtml}</div></div>`;
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
  return timeBanner + items + thinkingHtml;
};

const buildAiHeadHtml = (qState, canWide) => {
  const cur = qState.sessions.find((s) => s.id === qState.activeId) || qState.sessions[0];
  const hasAnyContent = qState.sessions.length > 1 || (cur?.messages?.length || 0) > 0;
  const leftHtml = hasAnyContent
    ? `<select class="ai-session-sel" title="切换本题的历史 AI 对话">
        ${qState.sessions.map((s) => {
          const tStr = formatChatTime(s.updatedAt);
          return `<option value="${escapeHtml(s.id)}" ${s.id === qState.activeId ? "selected" : ""}>${escapeHtml(sessionTitleOf(s))}${tStr ? ` · ${tStr}` : ""} (${s.messages.length})</option>`;
        }).join("")}
      </select>`
    : '<span class="muted-text" style="font-size:0.75rem;">围绕本题随时追问</span>';
  return `
    <div class="ai-head-bar">
      ${leftHtml}
      <div class="row-gap" style="gap:4px;flex-wrap:nowrap;">
        <button type="button" class="btn ghost tiny js-ai-new" title="保留旧记录，开启新对话">+ 新建</button>
        ${hasAnyContent ? '<button type="button" class="btn ghost tiny js-ai-rename" title="修改当前对话标题">改名</button><button type="button" class="btn ghost-danger tiny js-ai-del" title="删除当前对话">删</button>' : ""}
        ${canWide ? `<button type="button" class="btn ghost tiny js-ai-wide">${qState.isWide ? "还原" : "加宽"}</button>` : ""}
      </div>
    </div>
  `;
};

export const mountAiChatWidget = (rootEl, question, options = {}) => {
  if (!rootEl || !question) return;
  const qid = question.id;
  const { isWide = false, onToggleWide = null, onAppendNote = null, autoPrompt = "", initialState = null, initialMessages = null, onHistoryChange = null } = options;
  const qState = loadQuestionState(qid, initialState || initialMessages);
  let sending = false;
  let elapsedSec = 0;
  let elapsedTimer = null;

  const stopElapsed = () => { if (elapsedTimer) clearInterval(elapsedTimer); elapsedTimer = null; };
  const getActiveSession = () => qState.sessions.find((s) => s.id === qState.activeId) || qState.sessions[0];
  const syncHistory = () => {
    const cur = getActiveSession();
    cur.title = sessionTitleOf(cur);
    cur.updatedAt = Date.now();
    persistQuestionState(qid, qState);
    onHistoryChange?.(compactForCloud(qState));
  };

  const sendQuestion = async (text) => {
    const content = String(text || "").trim();
    if (!content || sending) return;
    const cur = getActiveSession();
    cur.messages.push({ role: "user", content, ts: Date.now() });
    syncHistory();
    sending = true; elapsedSec = 0; stopElapsed(); render();
    elapsedTimer = setInterval(() => {
      if (!document.body.contains(rootEl) || !sending) return stopElapsed();
      elapsedSec += 1;
      const el = rootEl.querySelector(".ai-elapsed");
      if (el) el.textContent = `${elapsedSec}s`;
    }, 1000);
    try {
      const apiMessages = cur.messages.map(({ role, content: c }) => ({ role, content: c }));
      const res = await aiRequest("/api/ai/chat", { question, messages: apiMessages });
      cur.messages.push({ role: "assistant", content: res.reply || "暂无回复", ts: Date.now() });
    } catch (err) {
      cur.messages.push({ role: "assistant", content: `请求失败：${err.message}`, ts: Date.now() });
      showToast(err.message, "bad");
    } finally {
      sending = false; stopElapsed(); syncHistory(); render();
    }
  };

  const startNewSession = () => {
    if (sending) return;
    const cur = getActiveSession();
    if (!cur.messages.length) { showToast("当前已是新对话"); rootEl.querySelector(".js-ai-input")?.focus(); return; }
    const fresh = makeSession([]);
    qState.sessions.unshift(fresh);
    qState.activeId = fresh.id;
    persistQuestionState(qid, qState);
    render();
    rootEl.querySelector(".js-ai-input")?.focus();
  };

  const renameActiveSession = async () => {
    if (sending) return;
    const cur = getActiveSession();
    const form = await openFormDialog({
      title: "修改对话标题",
      description: "便于区分同一道题的不同追问思路；留空保存则恢复自动标题。",
      fields: [{ name: "title", label: "对话标题", value: sessionTitleOf(cur), placeholder: "如：银行家矩阵手动推导" }],
      submitText: "保存标题"
    });
    if (!form) return;
    const nextTitle = String(form.title || "").trim();
    cur.customTitle = Boolean(nextTitle);
    cur.title = nextTitle || sessionTitleOf({ ...cur, customTitle: false });
    syncHistory();
    render();
  };

  const deleteActiveSession = async () => {
    if (sending) return;
    const cur = getActiveSession();
    if (!cur.messages.length && qState.sessions.length <= 1) return;
    const ok = await openConfirmDialog({ title: "删除对话", message: "确定删除当前这段 AI 对话记录吗？", confirmText: "确认删除", danger: true });
    if (!ok) return;
    if (qState.sessions.length > 1) {
      qState.sessions = qState.sessions.filter((s) => s.id !== qState.activeId);
      qState.activeId = qState.sessions[0].id;
    } else {
      qState.sessions[0].messages = [];
      qState.sessions[0].customTitle = false;
    }
    syncHistory();
    render();
  };

  const render = () => {
    const cur = getActiveSession();
    const canWide = typeof onToggleWide === "function";
    const hasNoteHook = typeof onAppendNote === "function";
    rootEl.innerHTML = `
      <div class="ai-chat-card">
        ${buildAiHeadHtml({ ...qState, isWide }, canWide)}
        <div class="ai-msg-list">${renderMessagesBodyHtml(cur, sending, elapsedSec, hasNoteHook)}</div>
        <form class="ai-input-row js-ai-form">
          <input class="js-ai-input" type="text" placeholder="针对本题向 AI 提问..." ${sending ? "disabled" : ""}>
          <button type="submit" class="btn primary tiny" ${sending ? "disabled" : ""}>${sending ? "思考中" : "发送"}</button>
        </form>
      </div>
    `;
    const msgList = rootEl.querySelector(".ai-msg-list");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;

    rootEl.querySelector(".ai-session-sel")?.addEventListener("change", (e) => { if (!sending) { qState.activeId = e.target.value; persistQuestionState(qid, qState); render(); } });
    rootEl.querySelector(".js-ai-new")?.addEventListener("click", startNewSession);
    rootEl.querySelector(".js-ai-rename")?.addEventListener("click", renameActiveSession);
    rootEl.querySelector(".js-ai-del")?.addEventListener("click", deleteActiveSession);
    rootEl.querySelector(".js-ai-wide")?.addEventListener("click", () => onToggleWide?.());
    rootEl.querySelectorAll(".js-ai-quick").forEach((btn) => btn.addEventListener("click", () => sendQuestion(btn.dataset.q)));
    rootEl.querySelectorAll(".js-ai-copy").forEach((btn) => btn.addEventListener("click", () => {
      const msg = cur.messages[Number(btn.dataset.idx)];
      if (msg) navigator.clipboard?.writeText(msg.content).then(() => showToast("已复制回答", "ok")).catch(() => {});
    }));
    rootEl.querySelectorAll(".js-ai-to-note").forEach((btn) => btn.addEventListener("click", () => {
      const msg = cur.messages[Number(btn.dataset.idx)];
      if (msg) onAppendNote?.(msg.content);
    }));
    rootEl.querySelectorAll(".js-ai-del-msg").forEach((btn) => btn.addEventListener("click", () => {
      if (sending) return;
      cur.messages.splice(Number(btn.dataset.idx), 1);
      syncHistory();
      render();
    }));
    rootEl.querySelector(".js-ai-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = rootEl.querySelector(".js-ai-input");
      const text = input.value;
      input.value = "";
      sendQuestion(text);
    });
  };

  if (autoPrompt && getActiveSession().messages.length > 0) {
    const fresh = makeSession([]);
    qState.sessions.unshift(fresh);
    qState.activeId = fresh.id;
  }
  render();
  if (autoPrompt) sendQuestion(autoPrompt);
};

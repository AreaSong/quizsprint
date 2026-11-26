import { aiRequest, apiRequest, buildBankOptionsHtml, escapeHtml, LETTERS, showToast, TYPE_LABELS } from "../api.js";
import { openConfirmDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import { renderRichMarkdown } from "../markdown.js";
import { openQuestionEditorModal } from "./question-editor-modal.js";

const highlightText = (text, keyword) => {
  const raw = String(text ?? "");
  const kw = String(keyword || "").trim();
  if (!kw) return escapeHtml(raw);
  const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return raw.split(re).map((part, idx) => (idx % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join("");
};

const renderSearchItemHtml = (item, q, idx, isAdmin = false) => {
  const ansList = (item.answers || []).map((a) => String(a).trim()).filter(Boolean);
  const ansSet = new Set(ansList);
  const ansText = ansList.join(" / ");
  const previewText = ansText.split(/\r?\n/)[0].replace(/[#`*]/g, "").trim();
  const isRich = item.type === "4" || item.type === "6";
  const optsHtml = (item.options || []).map((opt, oi) => {
    const isCorrect = ansSet.has(String(opt).trim()) || ansSet.has(LETTERS[oi]);
    return `
      <div class="search-opt ${isCorrect ? "is-correct" : ""}">
        <span>${LETTERS[oi] || oi + 1}. ${highlightText(opt, q)}</span>
        ${isCorrect ? `<span>${iconSvg("check", 14)}</span>` : ""}
      </div>
    `;
  }).join("");

  return `
    <details class="search-item">
      <summary class="search-summary">
        <div class="search-sum-main">
          <span class="type-pill" data-qtype="${escapeHtml(item.type)}">${TYPE_LABELS[item.type] || "其他"}</span>
          <span class="bank-pill">${escapeHtml(item.bankName || "")}</span>
          <span class="search-q-title">${highlightText(item.title, q)}</span>
        </div>
        <div class="search-sum-right">
          ${previewText ? `<span class="search-ans-preview" title="${escapeHtml(ansText)}">${escapeHtml(previewText)}</span>` : ""}
          <button type="button" class="btn ghost tiny js-copy-ans" data-idx="${idx}" title="复制答案">${iconSvg("copy", 13)}</button>
          <span class="search-chevron">${iconSvg("chevronRight", 14)}</span>
        </div>
      </summary>
      <div class="search-detail-body">
        ${(item.images || []).length ? `<div class="row-gap">${item.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;border:1px solid var(--line);">`).join("")}</div>` : ""}
        ${optsHtml ? `<div style="display:flex;flex-direction:column;gap:6px;">${optsHtml}</div>` : ""}
        <div>
          <strong style="color:var(--ok);">正确答案：</strong>
          ${isRich ? `<div class="md-content" style="margin-top:4px;">${renderRichMarkdown(ansList.join("\n\n"))}</div>` : escapeHtml(ansText || "暂无")}
        </div>
        ${(item.answerImages || []).length ? `<div class="row-gap">${item.answerImages.map((src) => `<img src="${escapeHtml(src)}" style="max-width:260px;max-height:180px;border-radius:6px;border:1px solid var(--line);">`).join("")}</div>` : ""}
        ${item.analysis ? `<div><strong>解析：</strong><div class="md-content" style="margin-top:4px;">${renderRichMarkdown(item.analysis)}</div></div>` : ""}
        ${isAdmin ? `
          <div class="row-gap" style="justify-content:flex-end;padding-top:6px;border-top:1px dashed var(--line);">
            <button type="button" class="btn ghost tiny js-search-edit" data-idx="${idx}">编辑试题</button>
            <button type="button" class="btn ghost-danger tiny js-search-del" data-idx="${idx}">删除试题</button>
          </div>
        ` : ""}
      </div>
    </details>
  `;
};

const renderEmptySearchHtml = (q) => `
  <div class="empty-state">
    <div class="empty-state-icon">${iconSvg("search", 22)}</div>
    <strong style="font-size:0.9375rem;">${q ? "未在题库中匹配到相关题目" : "当前筛选条件下暂无题目"}</strong>
    <p class="muted-text" style="margin:0;">${q ? "可以缩短关键词重试，或直接交给 AI 解答该题目。" : "可切换题库、题型或输入关键词开始搜索。"}</p>
    ${q ? `<button type="button" id="search-empty-ai" class="btn soft-active tiny" style="margin-top:4px;">${iconSvg("sparkles", 14)}<span>交给 AI 解答</span></button>` : ""}
  </div>
`;

const buildSearchViewShell = (banks, activeBankId) => `
  <div class="panel view-frame">
    <div class="view-head">
      <div class="row-gap" style="justify-content:space-between;">
        <h2 style="margin:0;">搜题中心</h2>
        <span class="muted-text">输入即搜，支持跨题库检索题干、选项与解析</span>
      </div>
      <div class="row-gap" style="margin-top:12px;">
        <select id="search-bank">
          ${buildBankOptionsHtml(banks, activeBankId, { includeAllLabel: "全部题库" })}
        </select>
        <select id="search-type">
          <option value="">全部题型</option>
          ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <input id="search-input" type="search" placeholder="输入题目关键词，或粘贴整道题..." style="flex:1;min-width:220px;">
        <button id="search-paste-btn" type="button" class="btn ghost" title="读取剪贴板并立即搜索">粘贴即搜</button>
        <button id="search-submit-btn" type="button" class="btn primary">${iconSvg("search", 15)}<span>搜索</span></button>
        <button id="search-ai-btn" type="button" class="btn soft-active">${iconSvg("sparkles", 15)}<span>AI 搜题</span></button>
      </div>
      <div class="row-gap" style="justify-content:space-between;margin-top:10px;">
        <span id="search-meta" class="muted-text"></span>
        <button id="search-toggle-all" type="button" class="btn ghost tiny" hidden>全部展开</button>
      </div>
    </div>
    <div class="view-scroll" style="margin-top:10px;">
      <div id="search-ai-box" class="search-ai-card" hidden></div>
      <div id="search-results"></div>
    </div>
  </div>
  <div id="search-edit-modal" class="modal-backdrop" hidden></div>
`;

export const renderSearchView = (container, ctx) => {
  const { banks, activeBankId, isLoggedIn, isAdmin, onRequireUserLogin, onRefreshBanks } = ctx;
  container.innerHTML = buildSearchViewShell(banks, activeBankId);
  const editModal = container.querySelector("#search-edit-modal");

  const inputEl = container.querySelector("#search-input");
  const bankEl = container.querySelector("#search-bank");
  const typeEl = container.querySelector("#search-type");
  const metaEl = container.querySelector("#search-meta");
  const toggleAllBtn = container.querySelector("#search-toggle-all");
  const aiBox = container.querySelector("#search-ai-box");
  const listEl = container.querySelector("#search-results");

  let currentItems = [];
  let debounceTimer = null;
  let searchSeq = 0;

  const syncToggleLabel = () => {
    const items = [...listEl.querySelectorAll(".search-item")];
    const allOpen = items.length > 0 && items.every((d) => d.open);
    toggleAllBtn.textContent = allOpen ? "全部收起" : "全部展开";
  };

  const runSearch = async () => {
    const seq = ++searchSeq;
    const q = inputEl.value.trim();
    const params = new URLSearchParams({ q, bankId: bankEl.value, type: typeEl.value });
    try {
      const data = await apiRequest(`/api/search?${params.toString()}`);
      if (seq !== searchSeq) return;
      currentItems = data.items || [];
      metaEl.textContent = `共找到 ${data.total} 条匹配试题${data.total >= 200 ? "（仅展示前 200 条）" : ""}`;
      toggleAllBtn.hidden = currentItems.length === 0;
      if (!currentItems.length) {
        listEl.innerHTML = renderEmptySearchHtml(q);
        return;
      }
      listEl.innerHTML = `<div class="search-list">${currentItems.map((it, idx) => renderSearchItemHtml(it, q, idx, Boolean(isAdmin))).join("")}</div>`;
      syncToggleLabel();
    } catch (err) {
      if (seq === searchSeq) showToast(err.message, "bad");
    }
  };

  const scheduleSearch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 220);
  };

  const runAiSolve = async () => {
    if (!isLoggedIn) {
      showToast("请先登录账号后再使用 AI 搜题", "bad");
      return onRequireUserLogin();
    }
    const q = inputEl.value.trim();
    if (!q) return showToast("请先输入题目", "bad");
    aiBox.hidden = false;
    aiBox.innerHTML = `
      <div class="ai-thinking">
        <span class="ai-spinner" aria-hidden="true"></span>
        <span>AI 正在分析并生成解答</span>
        <span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>`;
    try {
      const res = await aiRequest("/api/ai/solve", { query: q });
      const answerText = String(res.answer || "");
      aiBox.innerHTML = `
        <div class="row-gap" style="justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--line);">
          <div class="row-gap" style="gap:6px;color:var(--accent-fg);">${iconSvg("sparkles", 15)}<strong>AI 解答</strong></div>
          <div class="row-gap">
            <button type="button" id="search-ai-copy" class="btn ghost tiny">${iconSvg("copy", 13)}<span>复制解答</span></button>
            <button type="button" id="search-ai-hide" class="btn ghost tiny">收起</button>
          </div>
        </div>
        <div class="ai-msg-bubble">${renderRichMarkdown(answerText)}</div>
      `;
      aiBox.querySelector("#search-ai-copy")?.addEventListener("click", () => {
        navigator.clipboard?.writeText(answerText).then(() => showToast("已复制解答", "ok")).catch(() => {});
      });
      aiBox.querySelector("#search-ai-hide")?.addEventListener("click", () => { aiBox.hidden = true; });
    } catch (err) {
      aiBox.innerHTML = `<span style="color:var(--bad);">${escapeHtml(err.message)}</span>`;
    }
  };

  bankEl.addEventListener("change", runSearch);
  typeEl.addEventListener("change", runSearch);
  inputEl.addEventListener("input", scheduleSearch);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (debounceTimer) clearTimeout(debounceTimer);
      runSearch();
    }
  });
  container.querySelector("#search-submit-btn").addEventListener("click", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    runSearch();
  });
  container.querySelector("#search-ai-btn").addEventListener("click", runAiSolve);
  toggleAllBtn.addEventListener("click", () => {
    const items = [...listEl.querySelectorAll(".search-item")];
    const shouldOpen = !items.every((d) => d.open);
    items.forEach((d) => { d.open = shouldOpen; });
    syncToggleLabel();
  });
  container.querySelector("#search-paste-btn").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      inputEl.value = text.trim();
      runSearch();
    } catch {
      inputEl.value = "";
      inputEl.focus();
      showToast("浏览器未授权读取剪贴板，请直接 Ctrl/Cmd+V 粘贴");
    }
  });
  listEl.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest(".js-copy-ans");
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const item = currentItems[Number(copyBtn.dataset.idx)];
      const ans = (item?.answers || []).join(" / ");
      if (!ans) return showToast("该题暂无答案", "bad");
      navigator.clipboard?.writeText(ans).then(() => showToast("已复制答案", "ok")).catch(() => {});
      return;
    }
    const editBtn = e.target.closest(".js-search-edit");
    if (editBtn) {
      const item = currentItems[Number(editBtn.dataset.idx)];
      if (item && editModal) {
        openQuestionEditorModal(editModal, {
          bankId: item.bankId,
          item,
          onSaved: async () => { await onRefreshBanks?.(); await runSearch(); }
        });
      }
      return;
    }
    const delBtn = e.target.closest(".js-search-del");
    if (delBtn) {
      const item = currentItems[Number(delBtn.dataset.idx)];
      if (!item) return;
      const ok = await openConfirmDialog({ title: "删除试题", message: `确定从「${item.bankName || "题库"}」中永久删除该试题吗？`, confirmText: "确认删除", danger: true });
      if (!ok) return;
      try {
        await apiRequest(`/api/banks/${encodeURIComponent(item.bankId)}/questions/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        showToast("已删除试题", "ok");
        await onRefreshBanks?.();
        await runSearch();
      } catch (err) { showToast(err.message, "bad"); }
      return;
    }
    if (e.target.closest("#search-empty-ai")) runAiSolve();
  });
  listEl.addEventListener("toggle", syncToggleLabel, true);

  runSearch();
};

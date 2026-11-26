import { aiRequest, apiRequest, escapeHtml, LETTERS, showToast, TYPE_LABELS } from "../api.js";

const highlightText = (text, keyword) => {
  const safe = escapeHtml(text);
  const kw = String(keyword || "").trim();
  if (!kw) return safe;
  const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${escapedKw})`, "gi"), "<mark>$1</mark>");
};

export const renderSearchView = (container, ctx) => {
  const { banks, activeBankId, isLoggedIn, onRequireUserLogin } = ctx;

  container.innerHTML = `
    <div class="panel view-frame">
      <div class="view-head">
        <div class="row-gap" style="justify-content:space-between;">
          <h2 style="margin:0;">搜题中心</h2>
          <span class="muted-text">支持跨题库检索题干、选项与解析</span>
        </div>
        <div class="row-gap" style="margin-top:12px;">
          <select id="search-bank">
            <option value="">全部题库</option>
            ${banks.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === activeBankId ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
          </select>
          <select id="search-type">
            <option value="">全部题型</option>
            ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
          <input id="search-input" type="search" placeholder="输入题目关键词..." style="flex:1;min-width:220px;">
          <button id="search-paste-btn" class="btn ghost">清除并粘贴</button>
          <button id="search-submit-btn" class="btn primary">搜索</button>
          <button id="search-ai-btn" class="btn ok">AI 搜题</button>
        </div>
        <div id="search-meta" class="muted-text" style="margin-top:10px;"></div>
      </div>
      <div class="view-scroll" style="margin-top:10px;">
        <div id="search-ai-box" class="answer-box" style="margin-top:0;margin-bottom:10px;" hidden></div>
        <div id="search-results" style="display:flex;flex-direction:column;gap:10px;"></div>
      </div>
    </div>
  `;

  const inputEl = container.querySelector("#search-input");
  const bankEl = container.querySelector("#search-bank");
  const typeEl = container.querySelector("#search-type");
  const metaEl = container.querySelector("#search-meta");
  const listEl = container.querySelector("#search-results");

  const runSearch = async () => {
    const q = inputEl.value.trim();
    const params = new URLSearchParams({ q, bankId: bankEl.value, type: typeEl.value });
    try {
      const data = await apiRequest(`/api/search?${params.toString()}`);
      metaEl.textContent = `共找到 ${data.total} 条匹配试题${data.total >= 200 ? "（仅展示前 200 条）" : ""}`;
      if (!data.items.length) {
        listEl.innerHTML = '<p class="muted-text">未找到匹配的题目。</p>';
        return;
      }
      listEl.innerHTML = data.items.map((item) => {
        const optsHtml = (item.options || []).map((opt, idx) =>
          `<div>${LETTERS[idx] || idx + 1}. ${highlightText(opt, q)}</div>`
        ).join("");
        return `
          <details class="panel" style="padding:12px;">
            <summary style="cursor:pointer;list-style:none;">
              <div class="row-gap" style="justify-content:space-between;">
                <div>
                  <span class="badge">${TYPE_LABELS[item.type] || "其他"}</span>
                  <span class="badge warn">${escapeHtml(item.bankName || "")}</span>
                  <strong style="margin-left:6px;">${highlightText(item.title, q)}</strong>
                </div>
                <span class="muted-text" style="font-size:12px;">点击展开答案</span>
              </div>
            </summary>
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">
              ${(item.images || []).length ? `<div class="row-gap" style="margin-bottom:8px;">${item.images.map((src) => `<img src="${escapeHtml(src)}" style="max-width:220px;max-height:140px;border-radius:6px;border:1px solid var(--line);">`).join("")}</div>` : ""}
              ${optsHtml ? `<div style="margin-bottom:8px;">${optsHtml}</div>` : ""}
              <div><strong style="color:var(--ok);">正确答案：</strong>${escapeHtml((item.answers || []).join(" / "))}</div>
              ${item.analysis ? `<div class="muted-text" style="margin-top:6px;"><strong>解析：</strong>${highlightText(item.analysis, q)}</div>` : ""}
            </div>
          </details>
        `;
      }).join("");
    } catch (err) {
      showToast(err.message, "bad");
    }
  };

  container.querySelector("#search-submit-btn").addEventListener("click", runSearch);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
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

  container.querySelector("#search-ai-btn").addEventListener("click", async () => {
    if (!isLoggedIn) {
      showToast("请先登录账号后再使用 AI 搜题", "bad");
      return onRequireUserLogin();
    }
    const q = inputEl.value.trim();
    if (!q) return showToast("请先输入题目", "bad");
    const box = container.querySelector("#search-ai-box");
    box.hidden = false;
    box.innerHTML = "<strong>AI 正在解答...</strong>";
    try {
      const res = await aiRequest("/api/ai/solve", { query: q });
      box.innerHTML = `<strong>AI 解答：</strong><div style="white-space:pre-wrap;margin-top:6px;">${escapeHtml(res.answer)}</div>`;
    } catch (err) {
      box.innerHTML = `<span style="color:var(--bad);">${escapeHtml(err.message)}</span>`;
    }
  });

  runSearch();
};

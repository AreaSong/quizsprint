import { CLEAN_TOOLS, parseExamTextDetailed, SAMPLE_TEXT } from "../../exam-parse.js";
import { aiRequest, apiRequest, buildBankOptionsHtml, escapeHtml, LETTERS, showToast, TYPE_LABELS } from "../api.js";
import { openFormDialog } from "../dialog.js";
import { iconSvg } from "../icons.js";
import { describeLabSpec } from "../labs/lab-grader.js";

const CLEAN_EXTRA_ITEMS = [
  ["mergeTrailingAnswers", "文末答案回填"],
  ["expandCompactAnswers", "1-5 ABCDE 转换"],
  ["splitInlineOptions", "横排选项转竖排"],
  ["fullToHalf", "全角转半角"],
  ["replaceBlankUnderscore", "下划线转括号"],
  ["removeEmptyLines", "删除空白行"]
];

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const buildImportShellHtml = (banks, targetBank, isAdmin) => `
  <div class="panel view-frame">
    <div class="view-head">
      <div class="row-gap" style="justify-content:space-between;">
        <div>
          <h2 style="margin:0;">批量导题工作台</h2>
          <span class="muted-text">支持纯文本、Word (.docx)、Excel (.xlsx)、JSON 与 AI 智能导题</span>
        </div>
        <div class="row-gap">
          <select id="imp-bank">
            ${buildBankOptionsHtml(banks, targetBank.id, { prefix: "导入到：" })}
          </select>
          <input id="imp-chapter" type="text" placeholder="默认章节（可选）" style="width:134px;">
          <label class="row-gap" style="font-size:0.8125rem;cursor:pointer;"><input id="imp-skip" type="checkbox" checked> 跳过已有题</label>
          <button id="imp-submit" type="button" class="btn primary">${isAdmin ? "确认导入 (0)" : "登录后导入"}</button>
        </div>
      </div>
      <div class="row-gap" style="justify-content:space-between;margin-top:10px;">
        <div class="row-gap">
          <label class="btn ghost tiny">导入 Word / Excel / JSON<input id="imp-doc-file" type="file" accept=".docx,.xlsx,.xls,.csv,.json" hidden></label>
          <a class="btn ghost tiny" href="/api/template.xlsx" style="text-decoration:none;">下载 Excel 模板</a>
          <a class="btn ghost tiny" href="/api/template.json" style="text-decoration:none;">下载 JSON 模板</a>
        </div>
        <div class="row-gap">
          <button id="imp-ai-parse" type="button" class="btn soft-active tiny">${iconSvg("sparkles", 14)}<span>AI 智能识别文本</span></button>
          <button id="imp-ai-gen" type="button" class="btn soft-active tiny">${iconSvg("sparkles", 14)}<span>AI 一键出题</span></button>
        </div>
      </div>
    </div>

    <div class="split-workbench" style="margin-top:12px;">
      <div class="split-col">
        <div class="workbench-pane-head">
          <div class="row-gap">
            <button type="button" class="btn ghost tiny" data-tool="autoFormat">一键整理格式</button>
            <div class="clean-menu-wrap" id="imp-clean-wrap">
              <button type="button" id="imp-clean-btn" class="btn ghost tiny">更多清洗 ▾</button>
              <div id="imp-clean-menu" class="dropdown-menu clean-menu" hidden>
                ${CLEAN_EXTRA_ITEMS.map(([k, lbl]) => `<button type="button" class="dropdown-item" data-tool="${k}">${lbl}</button>`).join("")}
              </div>
            </div>
          </div>
          <div class="row-gap">
            <button type="button" id="imp-sample" class="btn ghost tiny">填入示例</button>
            <button type="button" id="imp-clear" class="btn ghost tiny">清空</button>
          </div>
        </div>
        <textarea id="imp-textarea" class="workbench-textarea" placeholder="在此粘贴任意格式试题文本，或从上方导入 Word / Excel / JSON 文件..."></textarea>
      </div>
      <div class="split-col">
        <div class="workbench-pane-head"><div id="imp-summary" class="row-gap"></div></div>
        <div id="imp-preview" class="preview-scroll"></div>
      </div>
    </div>
  </div>
`;

const buildPreviewHtml = ({ questions, errors }) => {
  if (!questions.length && !errors.length) {
    return `
      <div class="empty-state" style="margin:auto;">
        <div class="empty-state-icon">${iconSvg("note", 22)}</div>
        <strong style="font-size:0.875rem;">等待输入或导入试题</strong>
        <p class="muted-text" style="margin:0;">在左侧粘贴文本，或点上方导入 Word / Excel / JSON，此处实时校验并预览。</p>
      </div>
    `;
  }
  const errorHtml = errors.map((err) => `
    <div class="panel" style="padding:10px;border-color:var(--bad);background:var(--bad-soft);">
      <strong style="color:var(--bad);">第 ${err.index} 块错误：${escapeHtml(err.message)}</strong>
      <div class="muted-text">${escapeHtml(err.title)}</div>
    </div>
  `).join("");
  const cardsHtml = questions.slice(0, 80).map((q, idx) => `
    <div class="panel" style="padding:10px;">
      <div class="row-gap" style="justify-content:space-between;">
        <span class="type-pill" data-qtype="${escapeHtml(q.type)}">${TYPE_LABELS[q.type] || "其他"}</span>
        <span class="muted-text" style="font-size:0.75rem;">#${idx + 1}</span>
      </div>
      <div style="font-weight:600;margin:6px 0;">${escapeHtml(q.title)}</div>
      ${String(q.type) === "9"
        ? `<div class="muted-text">🧪 交互实验：${escapeHtml(describeLabSpec(q))}</div>`
        : (q.options || []).map((o, i) => `<div class="muted-text">${LETTERS[i] || i + 1}. ${escapeHtml(o)}</div>`).join("")}
      <div style="margin-top:6px;color:var(--ok);font-weight:600;">答案：${escapeHtml((q.answers || []).join(" | "))}</div>
      ${q.analysis ? `<div class="muted-text" style="margin-top:4px;">解析：${escapeHtml(q.analysis)}</div>` : ""}
    </div>
  `).join("");
  return errorHtml + cardsHtml;
};

export const renderImportView = (container, ctx) => {
  const { banks, activeBankId, isAdmin, onRequireLogin, onRefreshBanks, onSelectBank } = ctx;
  const targetBank = banks.find((b) => b.id === activeBankId) || banks[0];
  if (!targetBank) {
    container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”创建一个题库。</p></div>';
    return;
  }

  container.innerHTML = buildImportShellHtml(banks, targetBank, isAdmin);
  const textarea = container.querySelector("#imp-textarea");
  const summaryEl = container.querySelector("#imp-summary");
  const previewEl = container.querySelector("#imp-preview");
  const chapterEl = container.querySelector("#imp-chapter");
  const bankEl = container.querySelector("#imp-bank");
  const submitBtn = container.querySelector("#imp-submit");
  const cleanMenu = container.querySelector("#imp-clean-menu");
  let parsed = { questions: [], errors: [] };
  let sourceMode = "text";

  const applyDefaultChapter = (res) => {
    const chap = chapterEl.value.trim();
    if (!chap) return res;
    return {
      ...res,
      questions: (res.questions || []).map((q) => (q.chapter ? q : { ...q, chapter: chap }))
    };
  };

  const renderPreview = (overrideResult = null) => {
    if (overrideResult) {
      sourceMode = "external";
      parsed = applyDefaultChapter(overrideResult);
    } else if (sourceMode === "external" && parsed.questions.length && !textarea.value.trim()) {
      parsed = applyDefaultChapter(parsed);
    } else {
      sourceMode = "text";
      parsed = parseExamTextDetailed(textarea.value, { chapter: chapterEl.value.trim() });
    }
    const { questions, errors } = parsed;
    const typeCounts = questions.reduce((acc, q) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc; }, {});
    const countTags = Object.entries(typeCounts).map(([k, v]) => `<span class="type-pill" data-qtype="${escapeHtml(k)}">${TYPE_LABELS[k] || "其他"} ${v}</span>`).join("");
    summaryEl.innerHTML = `
      <span class="badge ok">识别 ${questions.length} 题</span>
      ${errors.length ? `<span class="badge bad">错误 ${errors.length} 处</span>` : ""}
      ${countTags}
    `;
    if (isAdmin) submitBtn.textContent = `确认导入 (${questions.length})`;
    previewEl.innerHTML = buildPreviewHtml(parsed);
  };

  textarea.addEventListener("input", () => renderPreview());
  chapterEl.addEventListener("input", () => renderPreview());
  container.querySelector("#imp-clean-btn").addEventListener("click", (e) => { e.stopPropagation(); cleanMenu.hidden = !cleanMenu.hidden; });
  container.addEventListener("click", (e) => { if (!cleanMenu.hidden && !e.target.closest("#imp-clean-wrap")) cleanMenu.hidden = true; });
  container.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fn = CLEAN_TOOLS[btn.dataset.tool];
      if (!fn) return;
      textarea.value = fn(textarea.value);
      cleanMenu.hidden = true;
      renderPreview();
      showToast("已应用文本整理");
    });
  });
  container.querySelector("#imp-sample").addEventListener("click", () => { sourceMode = "text"; textarea.value = SAMPLE_TEXT; renderPreview(); });
  container.querySelector("#imp-clear").addEventListener("click", () => { sourceMode = "text"; textarea.value = ""; renderPreview(); });

  container.querySelector("#imp-doc-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAdmin) return onRequireLogin();
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".json")) {
        const json = JSON.parse(await file.text());
        const items = Array.isArray(json) ? json : (Array.isArray(json.questions) ? json.questions : []);
        renderPreview({ questions: items, errors: [] });
        showToast(`已从 JSON 解析 ${items.length} 题，请点击确认导入`, "ok");
      } else {
        const endpoint = name.endsWith(".docx") ? "/api/parse/word" : "/api/parse/excel";
        const res = await apiRequest(endpoint, { method: "POST", body: JSON.stringify({ base64: await fileToBase64(file), chapter: chapterEl.value.trim() }) });
        renderPreview({ questions: res.questions || [], errors: res.errors || [] });
        showToast(`文档解析完成：${res.questions?.length || 0} 题`, "ok");
      }
    } catch (err) { showToast(err.message, "bad"); }
    e.target.value = "";
  });

  container.querySelector("#imp-ai-parse").addEventListener("click", async () => {
    if (!isAdmin) return onRequireLogin();
    if (!textarea.value.trim()) return showToast("请先在左侧粘贴文本", "bad");
    showToast("AI 正在智能解析文本...");
    try {
      const res = await aiRequest("/api/ai/parse", { text: textarea.value });
      renderPreview({ questions: res.questions || [], errors: [] });
      showToast(`AI 解析成功：${res.questions?.length || 0} 题`, "ok");
    } catch (err) { showToast(err.message, "bad"); }
  });

  container.querySelector("#imp-ai-gen").addEventListener("click", async () => {
    if (!isAdmin) return onRequireLogin();
    const form = await openFormDialog({
      title: "AI 一键智能出题",
      fields: [
        { name: "topic", label: "出题主题", required: true, placeholder: "如：计算机网络 TCP 协议" },
        { name: "count", label: "生成题数（1-20）", type: "number", min: 1, max: 20, value: 5, required: true }
      ],
      submitText: "开始生成"
    });
    if (!form || !form.topic.trim()) return;
    showToast("AI 正在出题...");
    try {
      const res = await aiRequest("/api/ai/generate", { topic: form.topic.trim(), count: form.count });
      renderPreview({ questions: res.questions || [], errors: [] });
      showToast(`AI 已生成 ${res.questions?.length || 0} 题，请点击确认导入`, "ok");
    } catch (err) { showToast(err.message, "bad"); }
  });

  submitBtn.addEventListener("click", async () => {
    if (!isAdmin) return onRequireLogin();
    if (!parsed.questions.length) return showToast("没有可导入的有效题目", "bad");
    try {
      const res = await apiRequest(`/api/banks/${encodeURIComponent(bankEl.value)}/import`, {
        method: "POST", body: JSON.stringify({ questions: parsed.questions, skipIfExists: container.querySelector("#imp-skip").checked })
      });
      showToast(res.msg || "导入完成", "ok");
      onSelectBank(bankEl.value);
      await onRefreshBanks();
    } catch (err) { showToast(err.message, "bad"); }
  });

  renderPreview();
};

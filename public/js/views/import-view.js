import { CLEAN_TOOLS, parseExamTextDetailed, SAMPLE_TEXT } from "../../exam-parse.js";
import { aiRequest, apiRequest, escapeHtml, LETTERS, showToast, TYPE_LABELS } from "../api.js";
import { openFormDialog } from "../dialog.js";

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export const renderImportView = (container, ctx) => {
  const { banks, activeBankId, isAdmin, onRequireLogin, onRefreshBanks, onSelectBank } = ctx;
  const targetBank = banks.find((b) => b.id === activeBankId) || banks[0];

  if (!targetBank) {
    container.innerHTML = '<div class="panel"><p class="muted-text">请先在“题库中心”创建一个题库。</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="panel view-frame">
      <div class="view-head">
        <div class="row-gap" style="justify-content:space-between;">
          <div>
            <h2 style="margin:0;">批量导题与整理工作台</h2>
            <span class="muted-text">支持纯文本、Word (.docx)、Excel (.xlsx)、JSON 与 AI 智能导题/出题</span>
          </div>
          <div class="row-gap">
            <select id="imp-bank">
              ${banks.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === targetBank.id ? "selected" : ""}>导入到：${escapeHtml(b.name)}</option>`).join("")}
            </select>
            <input id="imp-chapter" type="text" placeholder="默认章节（可选）" style="width:130px;">
            <label class="row-gap" style="font-size:13px;"><input id="imp-skip" type="checkbox" checked> 跳过已有题</label>
            <button id="imp-submit" class="btn primary">${isAdmin ? "确认导入" : "登录后导入"}</button>
          </div>
        </div>

        <div class="row-gap" style="margin:12px 0;">
          <button class="btn ghost tiny" data-tool="autoFormat">一键整理格式</button>
          <button class="btn ghost tiny" data-tool="mergeTrailingAnswers">文末答案回填</button>
          <button class="btn ghost tiny" data-tool="expandCompactAnswers">1-5 ABCDE转换</button>
          <button class="btn ghost tiny" data-tool="splitInlineOptions">横排选项转竖排</button>
          <button class="btn ghost tiny" data-tool="fullToHalf">全角转半角</button>
          <button class="btn ghost tiny" data-tool="replaceBlankUnderscore">下划线转括号</button>
          <button class="btn ghost tiny" data-tool="removeEmptyLines">删除空白行</button>
          <button class="btn ghost tiny" id="imp-sample">填入示例</button>
          <button class="btn ghost tiny" id="imp-clear">清空</button>
        </div>

        <div class="row-gap" style="margin-bottom:12px;">
          <label class="btn ghost tiny">导入 Word/Excel/JSON
            <input id="imp-doc-file" type="file" accept=".docx,.xlsx,.xls,.csv,.json" hidden>
          </label>
          <a class="btn ghost tiny" href="/api/template.xlsx" style="text-decoration:none;">下载 Excel 模板</a>
          <a class="btn ghost tiny" href="/api/template.json" style="text-decoration:none;">下载 JSON 模板</a>
          <button id="imp-ai-parse" class="btn primary tiny">AI 智能识别左侧文本</button>
          <button id="imp-ai-gen" class="btn ok tiny">AI 一键出题</button>
        </div>
      </div>

      <div class="split-workbench">
        <div class="split-col">
          <textarea id="imp-textarea" class="workbench-textarea" placeholder="在此粘贴任意格式试题文本，或上传 Word/Excel/JSON 文件..."></textarea>
        </div>
        <div class="split-col">
          <div id="imp-summary" class="row-gap" style="margin-bottom:8px;flex:none;"></div>
          <div id="imp-preview" class="preview-scroll"></div>
        </div>
      </div>
    </div>
  `;

  const textarea = container.querySelector("#imp-textarea");
  const summaryEl = container.querySelector("#imp-summary");
  const previewEl = container.querySelector("#imp-preview");
  const chapterEl = container.querySelector("#imp-chapter");
  const bankEl = container.querySelector("#imp-bank");

  let parsed = { questions: [], errors: [] };

  const renderPreview = (overrideResult = null) => {
    parsed = overrideResult || parseExamTextDetailed(textarea.value, { chapter: chapterEl.value.trim() });
    const { questions, errors } = parsed;
    const typeCounts = questions.reduce((acc, q) => {
      acc[q.type] = (acc[q.type] || 0) + 1;
      return acc;
    }, {});
    const countTags = Object.entries(typeCounts)
      .map(([k, v]) => `<span class="type-pill" data-qtype="${escapeHtml(k)}">${TYPE_LABELS[k] || "其他"} ${v}</span>`)
      .join("");

    summaryEl.innerHTML = `
      <span class="badge ok">识别成功 ${questions.length} 题</span>
      ${errors.length ? `<span class="badge bad">检测到 ${errors.length} 处错误</span>` : ""}
      ${countTags}
    `;

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
          <span class="muted-text" style="font-size:12px;">#${idx + 1}</span>
        </div>
        <div style="font-weight:600;margin:6px 0;">${escapeHtml(q.title)}</div>
        ${(q.options || []).map((o, i) => `<div class="muted-text">${LETTERS[i] || i + 1}. ${escapeHtml(o)}</div>`).join("")}
        <div style="margin-top:6px;color:var(--ok);font-weight:600;">答案：${escapeHtml((q.answers || []).join(" | "))}</div>
        ${q.analysis ? `<div class="muted-text" style="margin-top:4px;">解析：${escapeHtml(q.analysis)}</div>` : ""}
      </div>
    `).join("");

    previewEl.innerHTML = errorHtml + (cardsHtml || '<p class="muted-text">在左侧粘贴文本或上传文档后，此处实时展示解析结果。</p>');
  };

  textarea.addEventListener("input", () => renderPreview());
  chapterEl.addEventListener("input", () => renderPreview());

  container.querySelectorAll("button[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fn = CLEAN_TOOLS[btn.dataset.tool];
      if (!fn) return;
      textarea.value = fn(textarea.value);
      renderPreview();
      showToast("已应用文本整理");
    });
  });

  container.querySelector("#imp-sample").addEventListener("click", () => {
    textarea.value = SAMPLE_TEXT;
    renderPreview();
  });

  container.querySelector("#imp-clear").addEventListener("click", () => {
    textarea.value = "";
    renderPreview();
  });

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
      } else if (name.endsWith(".docx")) {
        const base64 = await fileToBase64(file);
        const res = await apiRequest("/api/parse/word", {
          method: "POST",
          body: JSON.stringify({ base64, chapter: chapterEl.value.trim() })
        });
        renderPreview({ questions: res.questions || [], errors: res.errors || [] });
        showToast(`Word 解析完成：${res.questions?.length || 0} 题`, "ok");
      } else {
        const base64 = await fileToBase64(file);
        const res = await apiRequest("/api/parse/excel", {
          method: "POST",
          body: JSON.stringify({ base64, chapter: chapterEl.value.trim() })
        });
        renderPreview({ questions: res.questions || [], errors: res.errors || [] });
        showToast(`Excel 解析完成：${res.questions?.length || 0} 题`, "ok");
      }
    } catch (err) {
      showToast(err.message, "bad");
    }
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
    } catch (err) {
      showToast(err.message, "bad");
    }
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
    } catch (err) {
      showToast(err.message, "bad");
    }
  });

  container.querySelector("#imp-submit").addEventListener("click", async () => {
    if (!isAdmin) return onRequireLogin();
    if (!parsed.questions.length) return showToast("没有可导入的有效题目", "bad");
    try {
      const res = await apiRequest(`/api/banks/${encodeURIComponent(bankEl.value)}/import`, {
        method: "POST",
        body: JSON.stringify({
          questions: parsed.questions,
          skipIfExists: container.querySelector("#imp-skip").checked
        })
      });
      showToast(res.msg || "导入完成", "ok");
      onSelectBank(bankEl.value);
      await onRefreshBanks();
    } catch (err) {
      showToast(err.message, "bad");
    }
  });

  renderPreview();
};

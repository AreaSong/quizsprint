import { escapeHtml } from "./api.js";

const formatInlineMd = (text) =>
  text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const renderTableHtml = (rows) => {
  if (rows.length < 2) return rows.map((r) => `<p>${formatInlineMd(r)}</p>`).join("");
  const parseCells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => formatInlineMd(c.trim()));
  const headers = parseCells(rows[0]);
  const isSep = /^[\s|:-]+$/.test(rows[1].replace(/\|/g, "").trim());
  const bodyRows = (isSep ? rows.slice(2) : rows.slice(1)).map(parseCells);
  return `
    <div class="table-wrap">
      <table class="md-table">
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${bodyRows.map((cols) => `<tr>${cols.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
};

/** 将题干、答案与 AI 回复中的 Markdown（含代码块与表格）转为安全 HTML */
export const renderRichMarkdown = (rawText) => {
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
  let tableRows = [];

  const flushList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = ""; } };
  const flushTable = () => { if (tableRows.length) { out.push(renderTableHtml(tableRows)); tableRows = []; } };

  for (const line of lines) {
    const trimmed = line.trim();
    const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
    if (codeMatch) { flushList(); flushTable(); out.push(codeBlocks[Number(codeMatch[1])] || ""); continue; }
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|")) {
      flushList(); tableRows.push(trimmed); continue;
    }
    flushTable();
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (listTag !== "ul") { flushList(); listTag = "ul"; out.push("<ul>"); }
      out.push(`<li>${formatInlineMd(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (listTag !== "ol") { flushList(); listTag = "ol"; out.push("<ol>"); }
      out.push(`<li>${formatInlineMd(olMatch[1])}</li>`);
      continue;
    }
    flushList();
    if (!trimmed) continue;
    const bqMatch = trimmed.match(/^&gt;\s*(.+)$/);
    if (bqMatch) { out.push(`<blockquote>${formatInlineMd(bqMatch[1])}</blockquote>`); continue; }
    const hMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    out.push(hMatch ? `<h4>${formatInlineMd(hMatch[1])}</h4>` : `<p>${formatInlineMd(trimmed)}</p>`);
  }
  flushList();
  flushTable();
  return out.join("") || "<p></p>";
};

import { escapeHtml } from "./api.js";

const prettifyMath = (expr) => String(expr || "")
  .replace(/\\(?:rightarrow|to)\b/g, "→")
  .replace(/\\leftarrow\b/g, "←")
  .replace(/\\leftrightarrow\b/g, "↔")
  .replace(/\\(?:leq|le)\b/g, "≤")
  .replace(/\\(?:geq|ge)\b/g, "≥")
  .replace(/\\(?:neq|ne)\b/g, "≠")
  .replace(/\\times\b/g, "×")
  .replace(/\\cdot\b/g, "·")
  .replace(/\\approx\b/g, "≈")
  .replace(/\\infty\b/g, "∞")
  .replace(/\\pm\b/g, "±")
  .replace(/\\[,;! ]/g, " ")
  .replace(/\\text\{([^}]*)\}/g, "$1")
  .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
  .trim();

const formatInlineMd = (text) =>
  text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\\\((.+?)\\\)/g, (_m, expr) => `<code>${prettifyMath(expr)}</code>`);

const renderTableHtml = (rows) => {
  if (rows.length < 2) return rows.map((r) => `<p>${formatInlineMd(r)}</p>`).join("");
  const parseCells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => formatInlineMd(c.trim()));
  const headers = parseCells(rows[0]);
  const isSep = /^[\s|:-]+$/.test(rows[1].replace(/\|/g, "").trim());
  const bodyRows = (isSep ? rows.slice(2) : rows.slice(1)).map(parseCells);
  const thHtml = headers.map((h) => `<th>${h}</th>`).join("");
  const trHtml = bodyRows.map((cols) => `<tr>${cols.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="md-table"><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table></div>`;
};

/** 将题干、答案与 AI 回复中的 Markdown（含代码块、表格与公式块）转为安全 HTML */
export const renderRichMarkdown = (rawText) => {
  const safe = escapeHtml(String(rawText || ""));
  const blocks = [];
  const pushBlock = (html) => {
    const idx = blocks.length;
    blocks.push(html);
    return `\n@@BLOCK_${idx}@@\n`;
  };
  const withPlaceholders = safe
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => pushBlock(`<pre><code>${code.trimEnd()}</code></pre>`))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr) => pushBlock(`<div class="md-math">${prettifyMath(expr)}</div>`));

  const lines = withPlaceholders.split("\n");
  const out = [];
  let listTag = "";
  let tableRows = [];

  const flushList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = ""; } };
  const flushTable = () => { if (tableRows.length) { out.push(renderTableHtml(tableRows)); tableRows = []; } };

  for (const line of lines) {
    const trimmed = line.trim();
    const blkMatch = trimmed.match(/^@@BLOCK_(\d+)@@$/);
    if (blkMatch) { flushList(); flushTable(); out.push(blocks[Number(blkMatch[1])] || ""); continue; }
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

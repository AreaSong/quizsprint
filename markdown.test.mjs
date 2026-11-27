import assert from "node:assert/strict";
import test from "node:test";

// 为纯 Node 测试环境提供最小 document / window 桩，以便导入 public/js/api.js 依赖链
globalThis.document = globalThis.document || { createElement: () => ({}) };

const { renderRichMarkdown, stripInlineImages } = await import("./public/js/markdown.js");

test("独立行与行内 /uploads/ 图片正确渲染且仅放行同源安全路径", () => {
  const blockHtml = renderRichMarkdown("如下表所示：\n![题干配图](/uploads/demo_1.png)\n此时的安全序列是（ ）。");
  assert.match(blockHtml, /<div class="md-img-wrap"><img class="q-img" src="\/uploads\/demo_1\.png" alt="题干配图" loading="lazy"><\/div>/);
  assert.match(blockHtml, /<p>如下表所示：<\/p>/);
  assert.match(blockHtml, /<p>此时的安全序列是（ ）。<\/p>/);

  const inlineHtml = renderRichMarkdown("请参考 ![示意图](/uploads/inline-2.webp) 作答");
  assert.match(inlineHtml, /<img class="q-img md-img-inline" src="\/uploads\/inline-2\.webp" alt="示意图" loading="lazy">/);
});

test("拦截外链、路径穿越与非法协议图片，防止 XSS 或信息泄露", () => {
  const evil = [
    "![evil](https://evil.example/a.png)",
    "![traversal](/uploads/../secret.png)",
    "![xss](javascript:alert(1))",
    "![data](data:image/png;base64,AAAA)"
  ].join("\n");
  const html = renderRichMarkdown(evil);
  assert.doesNotMatch(html, /<img\b/i);
});

test("stripInlineImages 将内联图片标记折叠为简洁文本占位符", () => {
  const raw = "某进程资源分配如下图所示：\n![资源分配图](/uploads/res_01.png)\n请问安全序列为（ ）";
  assert.equal(stripInlineImages(raw), "某进程资源分配如下图所示： [图] 请问安全序列为（ ）");
});

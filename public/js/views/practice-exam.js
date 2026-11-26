import { showToast } from "../api.js";
import { buildExamSetupHtml, shuffleArray } from "./practice-templates.js";

const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

const pickExamQuestions = (container, allQuestions) => {
  const isByType = container.querySelector('input[name="ex-mode"]:checked')?.value === "byType";
  const scoreMap = {};
  if (!isByType) {
    const count = Math.min(allQuestions.length, Math.max(1, Number(container.querySelector("#ex-count").value)));
    const list = shuffleArray(allQuestions).slice(0, count);
    for (const q of list) scoreMap[q.id] = 100 / list.length;
    return { list, scoreMap };
  }
  const list = [];
  container.querySelectorAll("[data-type-row]").forEach((row) => {
    const cnt = Math.max(0, Number(row.querySelector(".ex-tc-cnt").value || 0));
    const sc = Math.max(0.5, Number(row.querySelector(".ex-tc-score").value || 2));
    const picked = shuffleArray(allQuestions.filter((q) => String(q.type) === row.dataset.typeRow)).slice(0, cnt);
    for (const q of picked) { list.push(q); scoreMap[q.id] = sc; }
  });
  return { list, scoreMap };
};

/** 渲染模拟考试组卷配置界面并处理抽题提交 */
export const mountExamSetup = ({ container, bankName, allQuestions, onCancel, onStart }) => {
  container.innerHTML = `<div class="view-scroll">${buildExamSetupHtml(bankName, allQuestions)}</div>`;
  const quickBox = container.querySelector("#ex-quick-box");
  const typeBox = container.querySelector("#ex-type-box");
  const totalEl = container.querySelector("#ex-total-preview");
  const passEl = container.querySelector("#ex-pass");

  const calcTypePreview = () => {
    let sum = 0;
    container.querySelectorAll("[data-type-row]").forEach((row) => {
      sum += Number(row.querySelector(".ex-tc-cnt").value || 0) * Number(row.querySelector(".ex-tc-score").value || 0);
    });
    const rounded = round1(sum);
    if (totalEl) totalEl.textContent = String(rounded);
    return rounded;
  };

  container.querySelectorAll('input[name="ex-mode"]').forEach((r) => r.addEventListener("change", () => {
    const byType = r.value === "byType" && r.checked;
    quickBox.hidden = byType; typeBox.hidden = !byType;
    passEl.value = String(Math.max(1, Math.round((byType ? calcTypePreview() : 100) * 0.6)));
  }));
  typeBox?.addEventListener("input", () => { passEl.value = String(Math.max(1, Math.round(calcTypePreview() * 0.6))); });
  container.querySelector("#ex-cancel")?.addEventListener("click", onCancel);
  container.querySelector("#exam-setup-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const { list, scoreMap } = pickExamQuestions(container, allQuestions);
    if (!list.length) return showToast("请至少抽取 1 道题", "bad");
    const totalScore = round1(list.reduce((s, q) => s + Number(scoreMap[q.id] || 0), 0));
    const mins = Math.max(1, Number(container.querySelector("#ex-mins").value));
    onStart({ list, scoreMap, totalScore, passScore: Math.max(1, Number(passEl.value)), mins });
  });
};

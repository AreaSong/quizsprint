import { saveBankPracticeState, showToast } from "../api.js";
import { buildNoteHistoryItemsHtml } from "./practice-templates.js";

export const createNotesController = ({ container, bankId, bankState, getList, onJump }) => {
  let saveTimer = null;
  let pending = null;

  const syncUi = (statusText) => {
    const stEl = container.querySelector("#note-save-status");
    if (stEl && statusText) stEl.textContent = statusText;
    const { count, html } = buildNoteHistoryItemsHtml(getList(), bankState.notes || {});
    const cntEl = container.querySelector("#note-history-count");
    const wrapEl = container.querySelector("#note-history-wrap");
    if (cntEl) cntEl.textContent = String(count);
    if (wrapEl) wrapEl.innerHTML = html;
  };

  const flush = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!pending) return;
    const { qid, val } = pending;
    pending = null;
    bankState.notes = bankState.notes || {};
    bankState.notes[qid] = String(val || "").trim();
    saveBankPracticeState(bankId, bankState);
    syncUi("已保存");
  };

  const append = (qid, text) => {
    flush();
    const clean = String(text || "").trim();
    if (!clean) return;
    bankState.notes = bankState.notes || {};
    const prev = String(bankState.notes[qid] || "").trim();
    const next = prev ? `${prev}\n\n${clean}` : clean;
    bankState.notes[qid] = next;
    saveBankPracticeState(bankId, bankState);
    ["#aside-note-input", "#modal-note-input"].forEach((sel) => {
      const el = container.querySelector(sel);
      if (el) el.value = next;
    });
    syncUi("已保存");
    showToast("已写入本题笔记", "ok");
  };

  const bind = (qid, onOpenDesktop) => {
    const schedule = (val) => {
      pending = { qid, val };
      const stEl = container.querySelector("#note-save-status");
      if (stEl) stEl.textContent = "保存中...";
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 600);
    };
    ["#aside-note-input", "#modal-note-input"].forEach((sel) => {
      const el = container.querySelector(sel);
      el?.addEventListener("input", (e) => schedule(e.target.value));
      el?.addEventListener("change", flush);
    });
    const modal = container.querySelector("#notes-modal");
    container.querySelectorAll(".js-open-notes-modal").forEach((b) => b.addEventListener("click", () => { if (modal) modal.hidden = false; }));
    container.querySelector("#notes-modal-close")?.addEventListener("click", () => { flush(); if (modal) modal.hidden = true; });
    container.querySelector("#btn-jump-note")?.addEventListener("click", () => {
      if (window.innerWidth <= 960 || document.body.classList.contains("immersive-mode")) {
        if (modal) { modal.hidden = false; container.querySelector("#modal-note-input")?.focus(); }
        return;
      }
      onOpenDesktop?.();
    });
    container.querySelectorAll(".note-history-list").forEach((wrap) => {
      wrap.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-jump]");
        if (!btn) return;
        flush();
        if (modal) modal.hidden = true;
        onJump?.(Number(btn.dataset.jump));
      });
    });
  };

  return { flush, append, bind };
};

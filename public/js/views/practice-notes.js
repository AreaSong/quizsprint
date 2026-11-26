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

  let currentQid = "";
  let currentOnOpenDesktop = null;

  const bindOnce = (el, handler) => {
    if (!el || el.dataset.noteBound === "1") return;
    el.dataset.noteBound = "1";
    handler(el);
  };

  const bind = (qid, onOpenDesktop) => {
    currentQid = qid;
    currentOnOpenDesktop = onOpenDesktop;
    const schedule = (val) => {
      pending = { qid: currentQid, val };
      const stEl = container.querySelector("#note-save-status");
      if (stEl) stEl.textContent = "保存中...";
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 600);
    };
    ["#aside-note-input", "#modal-note-input"].forEach((sel) => {
      bindOnce(container.querySelector(sel), (el) => {
        el.addEventListener("input", (e) => schedule(e.target.value));
        el.addEventListener("change", flush);
      });
    });
    const modal = container.querySelector("#notes-modal");
    container.querySelectorAll(".js-open-notes-modal").forEach((b) => bindOnce(b, (el) => el.addEventListener("click", () => { if (modal) modal.hidden = false; })));
    bindOnce(container.querySelector("#notes-modal-close"), (el) => el.addEventListener("click", () => { flush(); if (modal) modal.hidden = true; }));
    bindOnce(container.querySelector("#btn-jump-note"), (el) => el.addEventListener("click", () => {
      if (window.innerWidth <= 960 || document.body.classList.contains("immersive-mode")) {
        if (modal) { modal.hidden = false; container.querySelector("#modal-note-input")?.focus(); }
        return;
      }
      currentOnOpenDesktop?.();
    }));
    container.querySelectorAll(".note-history-list").forEach((wrap) => {
      bindOnce(wrap, (el) => el.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-jump]");
        if (!btn) return;
        flush();
        if (modal) modal.hidden = true;
        onJump?.(Number(btn.dataset.jump));
      }));
    });
  };

  const setQid = (qid) => { currentQid = qid; };

  return { flush, append, bind, setQid };
};

export const bindSwipeNav = (el, onPrev, onNext) => {
  let tx = 0; let ty = 0;
  el?.addEventListener("touchstart", (e) => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
  el?.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - tx; const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) onNext?.(); else onPrev?.(); }
  }, { passive: true });
};

/** 绑定刷题页三栏之间的拖拽调整宽度与双击恢复默认宽度 */
export const bindPaneResizers = ({ container, settings, onSave }) => {
  const shell = container.querySelector(".practice-shell");
  const layout = container.querySelector(".practice-layout");
  if (!shell || !layout) return;

  const applyWidths = () => {
    shell.style.setProperty("--notes-w", `${Number(settings.notesWidth || 280)}px`);
    shell.style.setProperty("--aside-w", `${Number(settings.asideWidth || 332)}px`);
  };
  applyWidths();

  container.querySelectorAll(".pane-resizer[data-resize]").forEach((handle) => {
    const side = handle.dataset.resize;
    handle.addEventListener("dblclick", () => {
      const defW = side === "notes" ? 280 : 332;
      onSave?.(side, defW);
      applyWidths();
      showToast("已恢复默认栏宽");
    });

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = side === "notes" ? Number(settings.notesWidth || 280) : Number(settings.asideWidth || 332);
      const totalW = layout.getBoundingClientRect().width;
      const otherW = side === "notes"
        ? (shell.classList.contains("aside-collapsed") ? 0 : Number(settings.asideWidth || 332) + 12)
        : (shell.classList.contains("notes-collapsed") ? 0 : Number(settings.notesWidth || 280) + 12);
      const maxAllow = Math.max(240, totalW - otherW - 392);
      const minW = side === "notes" ? 220 : 280;
      const maxW = Math.min(side === "notes" ? 480 : 620, maxAllow);
      let latestW = startW;

      handle.classList.add("dragging");
      document.body.classList.add("is-resizing");

      const onMove = (ev) => {
        const delta = side === "notes" ? (ev.clientX - startX) : (startX - ev.clientX);
        latestW = Math.round(Math.min(maxW, Math.max(minW, startW + delta)));
        shell.style.setProperty(side === "notes" ? "--notes-w" : "--aside-w", `${latestW}px`);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        handle.classList.remove("dragging");
        document.body.classList.remove("is-resizing");
        onSave?.(side, latestW);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
};

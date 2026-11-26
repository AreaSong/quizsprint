import { escapeHtml } from "./api.js";

const renderFieldHtml = (f) => {
  const id = `dlg_f_${f.name}`;
  if (f.type === "select") {
    return `
      <label><span>${escapeHtml(f.label)}</span>
        <select id="${id}" name="${escapeHtml(f.name)}">
          ${(f.options || []).map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (f.type === "checkboxes") {
    const selected = new Set((f.value || []).map(String));
    return `
      <div>
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${escapeHtml(f.label)}</div>
        <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--surface-soft);">
          ${(f.options || []).map((o) => `
            <label class="row-gap" style="flex-direction:row;font-weight:400;cursor:pointer;">
              <input type="checkbox" name="${escapeHtml(f.name)}" value="${escapeHtml(o.value)}" ${selected.has(String(o.value)) ? "checked" : ""}>
              <span>${escapeHtml(o.label)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }
  const type = f.type || "text";
  const attrs = [
    f.required ? "required" : "",
    f.min != null ? `min="${f.min}"` : "",
    f.max != null ? `max="${f.max}"` : "",
    f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : ""
  ].filter(Boolean).join(" ");
  return `
    <label><span>${escapeHtml(f.label)}</span>
      <input id="${id}" name="${escapeHtml(f.name)}" type="${escapeHtml(type)}" value="${escapeHtml(f.value ?? "")}" ${attrs}>
    </label>
  `;
};

export const openFormDialog = ({ title = "输入信息", description = "", fields = [], submitText = "确定" }) =>
  new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-card" style="max-width:460px;">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button type="button" class="btn ghost tiny js-dlg-cancel">取消</button>
        </div>
        ${description ? `<p class="muted-text" style="margin:0 0 10px;">${escapeHtml(description)}</p>` : ""}
        <form class="stack-form js-dlg-form">
          ${fields.map(renderFieldHtml).join("")}
          <div class="modal-actions">
            <button type="button" class="btn ghost js-dlg-cancel">取消</button>
            <button type="submit" class="btn primary">${escapeHtml(submitText)}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (val) => {
      backdrop.remove();
      resolve(val);
    };
    backdrop._closeModal = () => close(null);

    backdrop.querySelectorAll(".js-dlg-cancel").forEach((b) => b.addEventListener("click", () => close(null)));
    backdrop.querySelector(".js-dlg-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        if (f.type === "checkboxes") {
          out[f.name] = [...backdrop.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value);
        } else {
          const el = backdrop.querySelector(`#dlg_f_${f.name}`);
          out[f.name] = f.type === "number" ? Number(el.value) : el.value;
        }
      }
      close(out);
    });

    const first = backdrop.querySelector("input, select");
    first?.focus();
  });

let modalDismissInited = false;

const closeBackdrop = (backdrop) => {
  if (!backdrop) return;
  if (typeof backdrop._closeModal === "function") {
    backdrop._closeModal();
    return;
  }
  const closeBtn = backdrop.querySelector("[data-modal-close]");
  if (closeBtn) {
    closeBtn.click();
    return;
  }
  backdrop.hidden = true;
};

/** 统一支持全站弹窗点击遮罩空白处与按 Esc 退出 */
export const initGlobalModalDismiss = () => {
  if (modalDismissInited) return;
  modalDismissInited = true;
  let mouseDownBackdrop = null;

  document.addEventListener("mousedown", (e) => {
    const t = e.target;
    mouseDownBackdrop = t instanceof Element && t.classList.contains("modal-backdrop") && !t.hidden ? t : null;
  });

  document.addEventListener("click", (e) => {
    const target = mouseDownBackdrop;
    mouseDownBackdrop = null;
    if (target && e.target === target && !target.hidden) closeBackdrop(target);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.isComposing) return;
    const openModals = [...document.querySelectorAll(".modal-backdrop")].filter((el) => !el.hidden);
    if (!openModals.length) return;
    e.preventDefault();
    e.stopPropagation();
    closeBackdrop(openModals[openModals.length - 1]);
  });
};

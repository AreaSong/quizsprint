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
      window.removeEventListener("keydown", onEsc);
      backdrop.remove();
      resolve(val);
    };
    const onEsc = (e) => { if (e.key === "Escape") close(null); };
    window.addEventListener("keydown", onEsc);

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

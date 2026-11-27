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
        <div style="font-size:0.8125rem;font-weight:600;margin-bottom:6px;">${escapeHtml(f.label)}</div>
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
  if (f.type === "checkbox") {
    return `
      <label class="switch-row" style="cursor:pointer;">
        <span>${escapeHtml(f.label)}</span>
        <input id="${id}" name="${escapeHtml(f.name)}" type="checkbox" ${f.value ? "checked" : ""}>
      </label>
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

const closeAnimatedBackdrop = (backdrop, done) => {
  if (backdrop._isClosing) return;
  backdrop._isClosing = true;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { backdrop.remove(); done(); return; }
  backdrop.classList.add("modal-closing");
  setTimeout(() => { backdrop.remove(); done(); }, 150);
};

export const openConfirmDialog = ({
  title = "确认操作",
  message = "",
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
  threeState = false
} = {}) =>
  new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-card" style="max-width:420px;">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button type="button" class="btn ghost tiny js-dlg-dismiss">关闭</button>
        </div>
        ${message ? `<p class="muted-text" style="margin:4px 0 14px;line-height:1.65;">${escapeHtml(message)}</p>` : ""}
        <div class="modal-actions">
          <button type="button" class="btn ghost js-dlg-no">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? "danger" : "primary"} js-dlg-yes">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const finish = (val) => closeAnimatedBackdrop(backdrop, () => resolve(val));
    backdrop._closeModal = () => finish(threeState ? null : false);
    backdrop.querySelector(".js-dlg-dismiss").addEventListener("click", () => finish(threeState ? null : false));
    backdrop.querySelector(".js-dlg-no").addEventListener("click", () => finish(false));
    backdrop.querySelector(".js-dlg-yes").addEventListener("click", () => finish(true));
    backdrop.querySelector(".js-dlg-yes").focus();
  });

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

    const close = (val) => closeAnimatedBackdrop(backdrop, () => resolve(val));
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
          out[f.name] = f.type === "checkbox" ? Boolean(el.checked) : (f.type === "number" ? Number(el.value) : el.value);
        }
      }
      close(out);
    });

    const first = backdrop.querySelector("input, select");
    first?.focus();
  });

let modalDismissInited = false;
const LIGHTBOX_IMG_SELECTOR = "img.q-img, .md-content img, .answer-img-wrap img, .search-detail-body img, .q-table-detail-box img";

/** 打开全屏图片放大灯箱，支持适应屏幕与 1:1 原图尺寸切换 */
export const openImageLightbox = (src, alt = "") => {
  const cleanSrc = String(src || "").trim();
  if (!cleanSrc || /^javascript:/i.test(cleanSrc)) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card img-lightbox-card">
      <div class="modal-head">
        <h3 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw;">${escapeHtml(alt || "试题配图预览")}</h3>
        <div class="row-gap" style="gap:6px;">
          <button type="button" class="btn ghost tiny js-lb-zoom">原图尺寸</button>
          <button type="button" class="btn ghost tiny js-lb-close">关闭</button>
        </div>
      </div>
      <div class="img-lightbox-stage">
        <img src="${escapeHtml(cleanSrc)}" alt="${escapeHtml(alt || "试题配图预览")}">
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const img = backdrop.querySelector("img");
  const zoomBtn = backdrop.querySelector(".js-lb-zoom");
  const toggleZoom = () => {
    const actual = img.classList.toggle("is-actual");
    zoomBtn.textContent = actual ? "适应屏幕" : "原图尺寸";
  };
  backdrop._closeModal = () => closeAnimatedBackdrop(backdrop, () => {});
  backdrop.querySelector(".js-lb-close").addEventListener("click", () => backdrop._closeModal());
  zoomBtn.addEventListener("click", toggleZoom);
  img.addEventListener("click", toggleZoom);
};

const closeBackdrop = (backdrop) => {
  if (!backdrop || backdrop.dataset.lockDismiss === "1") return;
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
    if (target && e.target === target && !target.hidden) {
      closeBackdrop(target);
      return;
    }
    const img = e.target instanceof Element ? e.target.closest(LIGHTBOX_IMG_SELECTOR) : null;
    if (img && !img.closest(".img-lightbox-stage")) {
      e.preventDefault();
      openImageLightbox(img.getAttribute("src"), img.alt || "");
    }
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

import { escapeHtml } from "../api.js";
import { mountDfdLab, mountDecisionLab } from "./dfd-decision-labs.js";
import { mountPertLab } from "./pert-lab.js";
import { mountBlackboxLab, mountWhiteboxLab } from "./testing-labs.js";

const LAB_TABS = [
  { id: "pert", label: "工程网络图 PERT/CPM", mount: mountPertLab },
  { id: "dfd", label: "数据流图 DFD", mount: mountDfdLab },
  { id: "decision", label: "判定表与判定树", mount: mountDecisionLab },
  { id: "blackbox", label: "黑盒等价类/边界值", mount: mountBlackboxLab },
  { id: "whitebox", label: "白盒逻辑覆盖", mount: mountWhiteboxLab }
];

let activeBackdrop = null;

/** 打开软件工程 5 合 1 交互式实验台模态窗 */
export const openSeLabModal = (initialTab = "pert") => {
  activeBackdrop?.remove();
  let currentTab = LAB_TABS.some((t) => t.id === initialTab) ? initialTab : "pert";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card se-lab-card">
      <div class="modal-head">
        <div class="row-gap">
          <h3 style="margin:0;">软件工程交互式实验台</h3>
          <span class="tag-pill">老师重点实操演练</span>
        </div>
        <button type="button" class="btn ghost tiny js-lab-close">关闭</button>
      </div>
      <div class="se-lab-tabs" role="tablist">
        ${LAB_TABS.map((t) => `<button type="button" class="btn tiny ${t.id === currentTab ? "soft-active" : "ghost"}" data-lab-tab="${t.id}">${escapeHtml(t.label)}</button>`).join("")}
      </div>
      <div id="se-lab-stage" class="se-lab-stage"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;

  const close = () => {
    backdrop.remove();
    if (activeBackdrop === backdrop) activeBackdrop = null;
  };
  backdrop._closeModal = close;
  backdrop.querySelector(".js-lab-close")?.addEventListener("click", close);

  const stage = backdrop.querySelector("#se-lab-stage");
  const switchTab = (tabId) => {
    currentTab = tabId;
    backdrop.querySelectorAll("[data-lab-tab]").forEach((btn) => {
      const on = btn.dataset.labTab === currentTab;
      btn.classList.toggle("soft-active", on);
      btn.classList.toggle("ghost", !on);
    });
    const def = LAB_TABS.find((t) => t.id === currentTab) || LAB_TABS[0];
    def.mount(stage);
  };

  backdrop.querySelectorAll("[data-lab-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.labTab));
  });
  switchTab(currentTab);
};

import { escapeHtml } from "../api.js";
import { mountDecisionLab, mountDfdLab } from "./dfd-decision-labs.js";
import { mountOsDiskLab, mountOsMemLab, mountOsPagingLab } from "./os-mem-io-labs.js";
import { mountOsBankerLab, mountOsSchedLab } from "./os-proc-labs.js";
import { mountPertLab } from "./pert-lab.js";
import { mountBlackboxLab, mountWhiteboxLab } from "./testing-labs.js";

const SE_TABS = [
  { id: "pert", label: "工程网络图 PERT/CPM", mount: mountPertLab },
  { id: "dfd", label: "数据流图 DFD", mount: mountDfdLab },
  { id: "decision", label: "判定表与判定树", mount: mountDecisionLab },
  { id: "blackbox", label: "黑盒等价类/边界值", mount: mountBlackboxLab },
  { id: "whitebox", label: "白盒逻辑覆盖", mount: mountWhiteboxLab }
];

const OS_TABS = [
  { id: "os_sched", label: "进程调度与甘特图", mount: mountOsSchedLab },
  { id: "os_banker", label: "银行家算法", mount: mountOsBankerLab },
  { id: "os_paging", label: "页面置换矩阵", mount: mountOsPagingLab },
  { id: "os_disk", label: "磁盘调度轨迹", mount: mountOsDiskLab },
  { id: "os_mem", label: "地址变换/分区/位示图", mount: mountOsMemLab }
];

let activeBackdrop = null;

/** 打开软件工程 / 操作系统 交互式实验台模态窗 */
export const openSeLabModal = (initialTab = "pert") => {
  activeBackdrop?.remove();
  const isOs = OS_TABS.some((t) => t.id === initialTab);
  const tabs = isOs ? OS_TABS : SE_TABS;
  let currentTab = tabs.some((t) => t.id === initialTab) ? initialTab : tabs[0].id;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card se-lab-card">
      <div class="modal-head">
        <div class="row-gap">
          <h3 style="margin:0;">${isOs ? "操作系统交互式实验台" : "软件工程交互式实验台"}</h3>
          <span class="tag-pill">${isOs ? "60 分应用题沙盒演练" : "老师重点实操演练"}</span>
        </div>
        <button type="button" class="btn ghost tiny js-lab-close">关闭</button>
      </div>
      <div class="se-lab-tabs" role="tablist">
        ${tabs.map((t) => `<button type="button" class="btn tiny ${t.id === currentTab ? "soft-active" : "ghost"}" data-lab-tab="${t.id}">${escapeHtml(t.label)}</button>`).join("")}
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
    const def = tabs.find((t) => t.id === currentTab) || tabs[0];
    def.mount(stage);
  };

  backdrop.querySelectorAll("[data-lab-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.labTab));
  });
  switchTab(currentTab);
};

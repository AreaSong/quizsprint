import { escapeHtml } from "../api.js";
import { mountDecisionLab, mountDfdLab } from "./dfd-decision-labs.js";
import { mountOsMemLab } from "./os-mem-lab.js";
import { mountOsDiskLab, mountOsPagingLab } from "./os-mem-io-labs.js";
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

/** 绑定画布工作台缩放控钮（- / 100% / +），通过 CSS 变量持久保持缩放比例 */
export const bindStudioZoom = (container, initialPct = 100) => {
  let zoomPct = initialPct;
  const apply = () => {
    const pane = container.querySelector(".lab-studio-canvas-pane") || container;
    pane.style.setProperty("--studio-zoom", `${zoomPct}%`);
    const lbl = container.querySelector(".js-lab-zoom-val");
    if (lbl) lbl.textContent = `${zoomPct}%`;
  };
  container.querySelectorAll(".js-lab-zoom").forEach((b) => b.addEventListener("click", () => {
    const dz = Number(b.dataset.z || 0);
    zoomPct = dz === 0 ? 100 : Math.max(85, Math.min(160, zoomPct + dz));
    apply();
  }));
  apply();
  return apply;
};

/** 打开全宽双栏画布工作台弹窗（共用于独立实验台沙盒与题卡弹窗放大） */
export const openStudioCanvasModal = ({ title, tag, tabs = null, initialTab = "", mountFn = null, mountOpts = {}, summaryBanner = "", closeLabel = "关闭", closePrimary = false, onCloseSync = null }) => {
  activeBackdrop?.remove();
  let currentTab = tabs ? (tabs.some((t) => t.id === initialTab) ? initialTab : tabs[0].id) : "";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card se-lab-card is-studio-modal">
      <div class="modal-head">
        <div class="row-gap">
          <h3 style="margin:0;">${escapeHtml(title)}</h3>
          ${tag ? `<span class="tag-pill">${escapeHtml(tag)}</span>` : ""}
        </div>
        <div class="row-gap" style="gap:4px;">
          <button type="button" class="btn ghost tiny js-lab-zoom" data-z="-15" title="缩小画布">－</button>
          <button type="button" class="btn ghost tiny js-lab-zoom js-lab-zoom-val" data-z="0" title="重置缩放">100%</button>
          <button type="button" class="btn ghost tiny js-lab-zoom" data-z="15" title="放大画布">＋</button>
          <button type="button" class="btn ${closePrimary ? "primary" : "ghost"} tiny js-lab-close">${escapeHtml(closeLabel)}</button>
        </div>
      </div>
      ${tabs ? `<div class="se-lab-tabs" role="tablist">${tabs.map((t) => `<button type="button" class="btn tiny ${t.id === currentTab ? "soft-active" : "ghost"}" data-lab-tab="${escapeHtml(t.id)}">${escapeHtml(t.label)}</button>`).join("")}</div>` : ""}
      <div class="se-lab-stage">
        <div class="lab-studio-grid">
          <div class="lab-studio-canvas-pane"></div>
          <div class="lab-studio-side-pane">
            <div class="lab-studio-engine-side"></div>
            ${summaryBanner ? `<div class="lab-studio-foot">${summaryBanner}</div>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;

  const canvasPane = backdrop.querySelector(".lab-studio-canvas-pane");
  const sidePane = backdrop.querySelector(".lab-studio-engine-side");
  const applyZoom = bindStudioZoom(backdrop);
  let ctrl = null;

  const close = () => {
    const latest = ctrl?.getPayload?.();
    backdrop.remove();
    if (activeBackdrop === backdrop) activeBackdrop = null;
    if (latest) onCloseSync?.(latest);
  };
  backdrop._closeModal = close;
  backdrop.querySelector(".js-lab-close")?.addEventListener("click", close);

  const mountActive = (fn) => {
    canvasPane.innerHTML = "";
    sidePane.innerHTML = "";
    ctrl = fn(canvasPane, { ...mountOpts, studio: true, sideSlot: sidePane });
    applyZoom();
  };

  if (tabs) {
    const switchTab = (tabId) => {
      currentTab = tabId;
      backdrop.querySelectorAll("[data-lab-tab]").forEach((btn) => {
        const on = btn.dataset.labTab === currentTab;
        btn.classList.toggle("soft-active", on);
        btn.classList.toggle("ghost", !on);
      });
      const def = tabs.find((t) => t.id === currentTab) || tabs[0];
      mountActive(def.mount);
    };
    backdrop.querySelectorAll("[data-lab-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.labTab)));
    switchTab(currentTab);
  } else if (mountFn) {
    mountActive(mountFn);
  }
};

/** 打开软件工程 / 操作系统 交互式实验台工作台 */
export const openSeLabModal = (initialTab = "pert") => {
  const isOs = OS_TABS.some((t) => t.id === initialTab);
  openStudioCanvasModal({
    title: isOs ? "操作系统交互式实验台" : "软件工程交互式实验台",
    tag: isOs ? "60 分应用题画布工作台" : "老师重点实操画布工作台",
    tabs: isOs ? OS_TABS : SE_TABS,
    initialTab
  });
};

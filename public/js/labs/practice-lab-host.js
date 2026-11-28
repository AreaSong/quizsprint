import { escapeHtml, showToast } from "../api.js";
import { mountDecisionLab, mountDfdLab } from "./dfd-decision-labs.js";
import { buildSolutionPayload, gradeInteractiveLab, LAB_KIND_META, parseLabSpec } from "./lab-grader.js";
import { mountOsDiskLab, mountOsMemLab, mountOsPagingLab } from "./os-mem-io-labs.js";
import { mountOsBankerLab, mountOsSchedLab } from "./os-proc-labs.js";
import { mountPertLab } from "./pert-lab.js";
import { mountBlackboxLab, mountWhiteboxLab } from "./testing-labs.js";

const MOUNT_MAP = {
  pert: mountPertLab,
  dfd: mountDfdLab,
  decision: mountDecisionLab,
  blackbox: mountBlackboxLab,
  whitebox: mountWhiteboxLab,
  os_sched: mountOsSchedLab,
  os_banker: mountOsBankerLab,
  os_paging: mountOsPagingLab,
  os_disk: mountOsDiskLab,
  os_mem: mountOsMemLab
};

const parseSavedPayload = (arr) => {
  const raw = Array.isArray(arr) ? arr[0] : arr;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
};

const openLabFullscreenModal = ({ spec, label, initialPayload, readOnly, gradeResult, onCloseSync }) => {
  const mountFn = MOUNT_MAP[spec.kind];
  if (!mountFn) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card se-lab-card">
      <div class="modal-head">
        <div class="row-gap">
          <h3 style="margin:0;">交互实验画布</h3>
          <span class="tag-pill">${escapeHtml(label)}</span>
        </div>
        <button type="button" class="btn primary tiny js-lab-fs-done">${readOnly ? "关闭" : "收起并同步作答"}</button>
      </div>
      <div id="fs-lab-stage" class="se-lab-stage"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const fullCtrl = mountFn(backdrop.querySelector("#fs-lab-stage"), {
    embedded: true,
    spec,
    initialPayload,
    readOnly,
    gradeResult
  });
  const close = () => {
    const latest = fullCtrl?.getPayload?.();
    backdrop.remove();
    if (!readOnly && latest) onCloseSync?.(latest);
  };
  backdrop._closeModal = close;
  backdrop.querySelector(".js-lab-fs-done")?.addEventListener("click", close);
};

const renderInvalidSlot = (slot) => {
  slot.innerHTML = `<div class="lab-feedback warn">该交互实验题尚未配置有效的实验参数（options[0] 需包含合法 JSON 规格）。</div>`;
};

const buildFootHtml = ({ gradeResult, isReciteSol, examSession, readOnly }) => {
  if (gradeResult) {
    return `<div class="lab-feedback ${gradeResult.correct ? "ok" : "warn"}" style="margin-top:0;flex:1;">自动判分：${escapeHtml(gradeResult.summary)}</div>`;
  }
  if (isReciteSol) {
    return `<div class="lab-feedback ok" style="margin-top:0;flex:1;">背题模式 · 左侧画布已填入标准参考解</div>`;
  }
  if (examSession && !readOnly) {
    return `<span class="muted-text" style="font-size:0.75rem;">模考作答实时保存，交卷后自动评分</span>`;
  }
  if (!readOnly) {
    return `<span class="muted-text" style="font-size:0.75rem;">完成后提交核对并计入错题统计</span><button type="button" id="btn-confirm-lab" class="btn primary">提交核对</button>`;
  }
  return "";
};

/** 挂载刷题页「全宽画布工作台」交互实验题（type=9） */
export const mountPracticeInteractiveLab = ({ container, q, record, showAnswerNow, examSession, draftMap, onDraft, onSubmit }) => {
  const isLab = String(q?.type) === "9";
  document.body.classList.toggle("lab-studio-mode", isLab);
  container.querySelector(".practice-shell")?.classList.toggle("is-lab-studio", isLab);
  if (!isLab) return;

  const slot = container.querySelector("#interactive-lab-slot");
  if (!slot) return;
  const spec = parseLabSpec(q);
  const mountFn = spec && MOUNT_MAP[spec.kind];
  if (!spec || !mountFn) return renderInvalidSlot(slot);

  const meta = LAB_KIND_META[spec.kind];
  const savedPayload = parseSavedPayload(record?.selected);
  const isReciteSol = Boolean(!savedPayload && showAnswerNow && !examSession);
  const initialPayload = savedPayload || (isReciteSol ? buildSolutionPayload(spec) : (draftMap.get(q.id) || null));
  const gradeResult = (savedPayload && showAnswerNow) ? gradeInteractiveLab(spec, savedPayload) : null;
  const readOnly = Boolean(showAnswerNow);
  const footHtml = buildFootHtml({ gradeResult, isReciteSol, examSession, readOnly });
  let zoomPct = 100;
  let ctrl = null;

  const applyZoom = () => {
    const svg = slot.querySelector(".lab-studio-canvas-pane svg");
    if (svg) { svg.style.width = `${zoomPct}%`; svg.style.minWidth = `${zoomPct}%`; }
    const lbl = slot.querySelector(".js-lab-zoom-val");
    if (lbl) lbl.textContent = `${zoomPct}%`;
  };

  const mountBody = (payload) => {
    slot.className = "lab-studio-shell";
    slot.innerHTML = `
      <div class="lab-studio-head">
        <div class="row-gap">
          <span class="badge">🧪 ${escapeHtml(meta.name)}</span>
          <span class="muted-text" style="font-size:0.75rem;">${escapeHtml(meta.hint)}</span>
        </div>
        <div class="row-gap" style="gap:4px;">
          <button type="button" class="btn ghost tiny js-lab-zoom" data-z="-15" title="缩小画布">－</button>
          <button type="button" class="btn ghost tiny js-lab-zoom js-lab-zoom-val" data-z="0" title="重置缩放">100%</button>
          <button type="button" class="btn ghost tiny js-lab-zoom" data-z="15" title="放大画布">＋</button>
          <button type="button" class="btn ghost tiny js-lab-expand">⛶ 弹窗放大</button>
        </div>
      </div>
      <div class="lab-studio-grid">
        <div class="lab-studio-canvas-pane"></div>
        <div class="lab-studio-side-pane">
          <div class="lab-studio-engine-side"></div>
          ${footHtml ? `<div class="lab-studio-foot">${footHtml}</div>` : ""}
          <div class="lab-studio-ans-slot"></div>
        </div>
      </div>
    `;
    const canvasPane = slot.querySelector(".lab-studio-canvas-pane");
    const sidePane = slot.querySelector(".lab-studio-engine-side");
    ctrl = mountFn(canvasPane, {
      embedded: true,
      studio: true,
      sideSlot: sidePane,
      spec,
      initialPayload: payload,
      readOnly,
      gradeResult,
      onChange: (nextPayload) => {
        draftMap.set(q.id, nextPayload);
        if (examSession && !readOnly) {
          const g = gradeInteractiveLab(spec, nextPayload);
          onDraft?.([JSON.stringify(nextPayload)], g.correct);
        }
      }
    });
    const ansBox = container.querySelector("#p-q-body > .answer-box");
    const ansSlot = slot.querySelector(".lab-studio-ans-slot");
    if (ansBox && ansSlot) ansSlot.appendChild(ansBox);
    applyZoom();

    slot.querySelectorAll(".js-lab-zoom").forEach((b) => b.addEventListener("click", () => {
      const dz = Number(b.dataset.z || 0);
      zoomPct = dz === 0 ? 100 : Math.max(85, Math.min(160, zoomPct + dz));
      applyZoom();
    }));
    slot.querySelector(".js-lab-expand")?.addEventListener("click", () => {
      openLabFullscreenModal({
        spec,
        label: meta.name,
        initialPayload: ctrl?.getPayload?.() || payload,
        readOnly,
        gradeResult,
        onCloseSync: (latest) => {
          draftMap.set(q.id, latest);
          if (examSession && !readOnly) {
            const g = gradeInteractiveLab(spec, latest);
            onDraft?.([JSON.stringify(latest)], g.correct);
          }
          mountBody(latest);
        }
      });
    });
    slot.querySelector("#btn-confirm-lab")?.addEventListener("click", () => {
      const latest = ctrl?.getPayload?.();
      const res = gradeInteractiveLab(spec, latest);
      showToast(res.summary, res.correct ? "ok" : "bad");
      draftMap.set(q.id, latest);
      onSubmit?.([JSON.stringify(latest)], res.correct);
    });
  };

  mountBody(initialPayload);
};

/** 挂载正式在线考场中的原生交互实验题（type=9） */
export const mountExamRoomInteractiveLab = ({ card, q, savedList, onChange }) => {
  const slot = card.querySelector(".er-lab-slot");
  if (!slot) return;
  const spec = parseLabSpec(q);
  const mountFn = spec && MOUNT_MAP[spec.kind];
  if (!spec || !mountFn) return renderInvalidSlot(slot);

  const meta = LAB_KIND_META[spec.kind];
  let currentPayload = parseSavedPayload(savedList);
  const syncOut = (next) => { currentPayload = next; onChange?.([JSON.stringify(next)]); };

  const mountBody = (payload) => {
    slot.innerHTML = `
      <div class="embedded-lab-head">
        <div class="row-gap">
          <span class="badge">🧪 ${escapeHtml(meta.name)}</span>
          <span class="muted-text" style="font-size:0.75rem;">${escapeHtml(meta.hint)}</span>
        </div>
        <button type="button" class="btn ghost tiny js-lab-expand">⛶ 全屏展开</button>
      </div>
      <div class="embedded-lab-body"></div>
      <div class="embedded-lab-foot"><span class="muted-text" style="font-size:0.75rem;">实时保存草稿，交卷后由系统自动评分</span></div>
    `;
    const ctrl = mountFn(slot.querySelector(".embedded-lab-body"), {
      embedded: true,
      spec,
      initialPayload: payload,
      readOnly: false,
      onChange: syncOut
    });
    slot.querySelector(".js-lab-expand")?.addEventListener("click", () => {
      openLabFullscreenModal({
        spec,
        label: meta.name,
        initialPayload: ctrl?.getPayload?.() || currentPayload,
        readOnly: false,
        onCloseSync: (latest) => { syncOut(latest); mountBody(latest); }
      });
    });
  };

  mountBody(currentPayload);
};

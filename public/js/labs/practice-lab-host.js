import { escapeHtml, showToast } from "../api.js";
import { mountDecisionLab, mountDfdLab } from "./dfd-decision-labs.js";
import { buildSolutionPayload, gradeInteractiveLab, LAB_KIND_META, parseLabSpec } from "./lab-grader.js";
import { mountPertLab } from "./pert-lab.js";
import { mountBlackboxLab, mountWhiteboxLab } from "./testing-labs.js";

const MOUNT_MAP = {
  pert: mountPertLab,
  dfd: mountDfdLab,
  decision: mountDecisionLab,
  blackbox: mountBlackboxLab,
  whitebox: mountWhiteboxLab
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
          <h3 style="margin:0;">交互实验作答</h3>
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

const renderSlotShell = (slot, { meta, footerHtml }) => {
  slot.innerHTML = `
    <div class="embedded-lab-head">
      <div class="row-gap">
        <span class="badge">🧪 ${escapeHtml(meta.name)}</span>
        <span class="muted-text" style="font-size:0.75rem;">${escapeHtml(meta.hint)}</span>
      </div>
      <button type="button" class="btn ghost tiny js-lab-expand">⛶ 全屏展开</button>
    </div>
    <div class="embedded-lab-body"></div>
    ${footerHtml ? `<div class="embedded-lab-foot">${footerHtml}</div>` : ""}
  `;
};

/** 挂载刷题页 / 模拟考场中的原生交互实验题（type=9） */
export const mountPracticeInteractiveLab = ({ container, q, record, showAnswerNow, examSession, draftMap, onDraft, onSubmit }) => {
  if (String(q?.type) !== "9") return;
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

  let footerHtml = "";
  if (gradeResult) {
    footerHtml = `<div class="lab-feedback ${gradeResult.correct ? "ok" : "warn"}" style="margin-top:0;flex:1;">自动判分：${escapeHtml(gradeResult.summary)}</div>`;
  } else if (isReciteSol) {
    footerHtml = `<div class="lab-feedback ok" style="margin-top:0;flex:1;">背题模式 · 画布已填入标准参考解</div>`;
  } else if (examSession && !readOnly) {
    footerHtml = `<span class="muted-text" style="font-size:0.75rem;">模考作答状态：实时自动保存，交卷后统一自动判分</span>`;
  } else if (!readOnly) {
    footerHtml = `
      <span class="muted-text" style="font-size:0.75rem;">完成实验交互后点击「提交核对」计入成绩与错题本</span>
      <button type="button" id="btn-confirm-lab" class="btn primary">提交核对</button>
    `;
  }

  let ctrl = null;
  const mountBody = (payload) => {
    renderSlotShell(slot, { meta, footerHtml });
    const bodyEl = slot.querySelector(".embedded-lab-body");
    ctrl = mountFn(bodyEl, {
      embedded: true,
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
  const syncOut = (next) => {
    currentPayload = next;
    onChange?.([JSON.stringify(next)]);
  };

  const mountBody = (payload) => {
    renderSlotShell(slot, {
      meta,
      footerHtml: `<span class="muted-text" style="font-size:0.75rem;">实时保存草稿，交卷后由系统自动评分</span>`
    });
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
        onCloseSync: (latest) => {
          syncOut(latest);
          mountBody(latest);
        }
      });
    });
  };

  mountBody(currentPayload);
};

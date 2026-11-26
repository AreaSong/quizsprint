import { apiRequest, escapeHtml, showToast, TYPE_LABELS } from "../api.js";

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const ANS_HINTS = {
  "0": "填正确选项正文或字母（如 A）",
  "1": "多个选项用 | 分隔，也可直接填字母如 AB",
  "2": "多个空用 | 分隔，按空顺序判分",
  "3": "填 正确 或 错误",
  "4": "支持多行与 Markdown（加粗/列表/代码块）",
  "5": "多个选项用 | 分隔，或填字母组合",
  "6": "支持多行与 Markdown 代码块（```）、表格（| col |），不拆 | 符号",
  "7": "每行一步，按【正确顺序】依次录入（刷题时自动打乱供拖动）",
  "8": "每行一组配对，格式：左侧项目 => 右侧对应项（刷题时自动打乱右侧）"
};

const buildEditorShellHtml = (item, imageCount, ansImgCount) => {
  const t = item?.type || "0";
  const ansVal = (t === "4" || t === "6") ? (item?.answers || []).join("\n\n") : (t === "7" || t === "8" ? (item?.answers || []).join("\n") : (item?.answers || []).join(" | "));
  return `
  <div class="modal-card modal-shell" style="max-width:640px;">
    <div class="modal-head"><h3>${item ? "编辑试题" : "单题录入"}</h3><button id="ed-close" type="button" class="btn ghost tiny" data-modal-close>关闭</button></div>
    <form id="ed-form">
      <div class="modal-body stack-form">
        <div class="row-gap">
          <label style="flex:1;"><span>题型</span><select id="ed-type">${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${t === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label style="flex:1;"><span>章节</span><input id="ed-chapter" value="${escapeHtml(item?.chapter || "")}" placeholder="可选"></label>
          <label style="flex:1;"><span>难度</span><select id="ed-diff">${["简单", "中等", "困难"].map((d) => `<option ${item?.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        </div>
        <label><span>题干（支持 Markdown 与直接 Ctrl/Cmd+V 粘贴题干截图）</span><textarea id="ed-title" rows="3" required>${escapeHtml(item?.title || "")}</textarea></label>
        <div>
          <div class="row-gap" style="justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:0.8125rem;font-weight:600;">题干配图（<span id="ed-img-cnt">${imageCount}</span> 张，看题可见）</span>
            <label class="btn ghost tiny">上传题干图<input id="ed-img-file" type="file" accept="image/*" hidden></label>
          </div>
          <div id="ed-img-list" class="row-gap"></div>
        </div>
        <label id="ed-opt-wrap"><span>选项（每行一个；填空/简答/实操/拖动题留空）</span><textarea id="ed-options" rows="3">${escapeHtml((item?.options || []).join("\n"))}</textarea></label>
        <label>
          <span id="ed-ans-label">答案</span>
          <textarea id="ed-answers" rows="4" required placeholder="输入标准答案...">${escapeHtml(ansVal)}</textarea>
          <span id="ed-ans-hint" class="muted-text" style="font-size:0.7188rem;font-weight:400;"></span>
        </label>
        <div>
          <div class="row-gap" style="justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:0.8125rem;font-weight:600;">答案配图（<span id="ed-ans-img-cnt">${ansImgCount}</span> 张，流程图/运行图，翻看答案后显示 · 支持答案框粘贴截图）</span>
            <label class="btn ghost tiny">上传答案图<input id="ed-ans-img-file" type="file" accept="image/*" hidden></label>
          </div>
          <div id="ed-ans-img-list" class="row-gap"></div>
        </div>
        <label><span>解析（支持 Markdown 代码与表格）</span><textarea id="ed-analysis" rows="2">${escapeHtml(item?.analysis || "")}</textarea></label>
      </div>
      <div class="modal-foot">
        <span class="muted-text">支持截图粘贴自动上传</span>
        <div class="row-gap">
          <button type="button" id="ed-cancel" class="btn ghost">取消</button>
          <button type="submit" class="btn primary">保存试题</button>
        </div>
      </div>
    </form>
  </div>`;
};

const parseAnswersForType = (typeVal, rawAns) => {
  if (typeVal === "4" || typeVal === "6") return rawAns.trim() ? [rawAns.trim()] : [];
  if (typeVal === "7" || typeVal === "8") return rawAns.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return rawAns.split("|").map((s) => s.trim()).filter(Boolean);
};

const renderEditorThumbs = (modal, arr, listSel, cntSel, cls) => {
  modal.querySelector(cntSel).textContent = String(arr.length);
  modal.querySelector(listSel).innerHTML = arr.map((src, i) => `
    <div style="position:relative;">
      <img src="${escapeHtml(src)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--line);">
      <button type="button" class="btn danger tiny ${cls}" data-idx="${i}" style="position:absolute;top:-6px;right:-6px;padding:1px 5px;">×</button>
    </div>
  `).join("");
};

const createEditorImageUploader = (modal, images, answerImages) => {
  const syncAllThumbs = () => {
    renderEditorThumbs(modal, images, "#ed-img-list", "#ed-img-cnt", "js-rm-img");
    renderEditorThumbs(modal, answerImages, "#ed-ans-img-list", "#ed-ans-img-cnt", "js-rm-ans-img");
  };
  const uploadDataUrl = async (dataUrl, targetArr) => {
    try {
      const res = await apiRequest("/api/upload/image", { method: "POST", body: JSON.stringify({ dataUrl }) });
      targetArr.push(res.url);
      syncAllThumbs();
      showToast("图片已上传", "ok");
    } catch (err) { showToast(err.message, "bad"); }
  };
  const bindPasteUpload = (el, targetArr) => el.addEventListener("paste", async (e) => {
    const imgItem = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
    if (imgItem) { e.preventDefault(); await uploadDataUrl(await fileToDataUrl(imgItem.getAsFile()), targetArr); }
  });
  syncAllThumbs();
  modal.querySelector("#ed-img-list").addEventListener("click", (e) => { const rm = e.target.closest(".js-rm-img"); if (rm) { images.splice(Number(rm.dataset.idx), 1); syncAllThumbs(); } });
  modal.querySelector("#ed-ans-img-list").addEventListener("click", (e) => { const rm = e.target.closest(".js-rm-ans-img"); if (rm) { answerImages.splice(Number(rm.dataset.idx), 1); syncAllThumbs(); } });
  modal.querySelector("#ed-img-file").addEventListener("change", async (e) => { const f = e.target.files?.[0]; if (f) await uploadDataUrl(await fileToDataUrl(f), images); e.target.value = ""; });
  modal.querySelector("#ed-ans-img-file").addEventListener("change", async (e) => { const f = e.target.files?.[0]; if (f) await uploadDataUrl(await fileToDataUrl(f), answerImages); e.target.value = ""; });
  bindPasteUpload(modal.querySelector("#ed-title"), images);
  bindPasteUpload(modal.querySelector("#ed-answers"), answerImages);
};

export const openQuestionEditorModal = (modal, { bankId, item, onSaved }) => {
  const isNew = !item;
  const images = [...(item?.images || [])];
  const answerImages = [...(item?.answerImages || [])];
  modal.hidden = false;
  modal.innerHTML = buildEditorShellHtml(item, images.length, answerImages.length);

  const syncTypeHint = () => {
    const t = modal.querySelector("#ed-type").value;
    modal.querySelector("#ed-ans-hint").textContent = ANS_HINTS[t] || "";
    modal.querySelector("#ed-opt-wrap").hidden = ["2", "3", "4", "6", "7", "8"].includes(t);
  };
  createEditorImageUploader(modal, images, answerImages);
  syncTypeHint();
  const closeModal = () => { modal.hidden = true; };
  modal.querySelector("#ed-close").addEventListener("click", closeModal);
  modal.querySelector("#ed-cancel").addEventListener("click", closeModal);
  modal.querySelector("#ed-type").addEventListener("change", syncTypeHint);

  modal.querySelector("#ed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const typeVal = modal.querySelector("#ed-type").value;
    const isChoiceType = !["2", "3", "4", "6", "7", "8"].includes(typeVal);
    const payload = {
      type: typeVal, chapter: modal.querySelector("#ed-chapter").value.trim(),
      difficulty: modal.querySelector("#ed-diff").value, title: modal.querySelector("#ed-title").value.trim(),
      images, answerImages,
      options: isChoiceType ? modal.querySelector("#ed-options").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [],
      answers: parseAnswersForType(typeVal, modal.querySelector("#ed-answers").value),
      analysis: modal.querySelector("#ed-analysis").value.trim()
    };
    try {
      const url = `/api/banks/${encodeURIComponent(bankId)}/questions${isNew ? "" : `/${encodeURIComponent(item.id)}`}`;
      await apiRequest(url, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) });
      modal.hidden = true;
      showToast("保存成功", "ok");
      await onSaved?.();
    } catch (err) { showToast(err.message, "bad"); }
  });
};

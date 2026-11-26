import { apiRequest, BANK_CATEGORIES, showToast } from "../api.js";
import { openFormDialog } from "../dialog.js";

const CATEGORY_OPTIONS = Object.entries(BANK_CATEGORIES).map(([value, label]) => ({ value, label }));

const buildSubjectOptions = (subjects) => [
  { value: "", label: "暂不归类（未分类）" },
  ...(subjects || []).map((s) => ({
    value: s.id,
    label: s.term ? `[${s.term}] ${s.name}` : s.name
  }))
];

export const openSubjectModal = async ({ subject = null, defaultTerm = "", onSaved }) => {
  const isEdit = Boolean(subject);
  const form = await openFormDialog({
    title: isEdit ? "编辑科目" : "新建科目",
    description: "按学期和科目归类理论、实践与真题题库，并支持配置考试日期倒计时。",
    fields: [
      { name: "name", label: "科目名称", required: true, value: subject?.name || "", placeholder: "如：操作系统 / 软件工程" },
      { name: "term", label: "所属学期 / 年份（可选）", value: subject ? subject.term : defaultTerm, placeholder: "如：2026 春 / 2025-2026 第一学期" },
      { name: "examDate", label: "考试日期（可选，用于倒计时）", type: "date", value: subject?.examDate || "" },
      { name: "description", label: "科目备注（可选）", value: subject?.description || "" }
    ],
    submitText: isEdit ? "保存修改" : "创建科目"
  });
  if (!form || !form.name.trim()) return;
  try {
    const url = isEdit ? `/api/subjects/${encodeURIComponent(subject.id)}` : "/api/subjects";
    const res = await apiRequest(url, {
      method: isEdit ? "PUT" : "POST",
      body: JSON.stringify({
        name: form.name.trim(),
        term: form.term.trim(),
        examDate: form.examDate.trim(),
        description: form.description.trim()
      })
    });
    showToast(isEdit ? "科目已更新" : "科目已创建", "ok");
    await onSaved?.(res.subject);
  } catch (err) {
    showToast(err.message, "bad");
  }
};

export const openBankCreateModal = async ({ subjects, defaultSubjectId = "", onCreated }) => {
  const form = await openFormDialog({
    title: "新建题库",
    fields: [
      { name: "name", label: "题库名称", required: true, placeholder: "如：操作系统 · PV 与调度实操" },
      { name: "subjectId", label: "所属科目", type: "select", value: defaultSubjectId, options: buildSubjectOptions(subjects) },
      { name: "category", label: "题库性质", type: "select", value: "theory", options: CATEGORY_OPTIONS },
      { name: "description", label: "题库简介（可选）" }
    ],
    submitText: "创建题库"
  });
  if (!form || !form.name.trim()) return;
  try {
    const data = await apiRequest("/api/banks", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.trim(),
        subjectId: form.subjectId,
        category: form.category || "theory",
        description: form.description.trim()
      })
    });
    showToast("题库已创建", "ok");
    await onCreated?.(data.bank);
  } catch (err) {
    showToast(err.message, "bad");
  }
};

export const openBankConfigModal = async ({ bank, subjects, onSaved }) => {
  const fields = [
    { name: "name", label: "题库名称", value: bank?.name || "", required: true },
    { name: "subjectId", label: "所属科目", type: "select", value: bank?.subjectId || "", options: buildSubjectOptions(subjects) },
    { name: "category", label: "题库性质", type: "select", value: bank?.category || "theory", options: CATEGORY_OPTIONS },
    { name: "description", label: "题库简介（可选）", value: bank?.description || "" },
    { name: "password", label: "访问密码（留空表示不修改）", type: "password", placeholder: bank?.locked ? "输入新密码以修改，留空保持原密码" : "输入密码以加密，留空公开" }
  ];
  if (bank?.locked) {
    fields.push({ name: "clearPassword", type: "checkbox", label: "取消访问密码（恢复公开题库）", value: false });
  }
  const form = await openFormDialog({ title: "题库设置与加密", fields, submitText: "保存设置" });
  if (!form || !form.name.trim()) return;
  try {
    const payload = {
      name: form.name.trim(),
      subjectId: form.subjectId,
      category: form.category || "theory",
      description: form.description.trim()
    };
    if (form.clearPassword) {
      payload.password = "";
      try { sessionStorage.removeItem(`as_qb_pwd_${bank.id}`); } catch { /* ignore */ }
    } else if (form.password !== "") {
      payload.password = form.password;
    }
    await apiRequest(`/api/banks/${encodeURIComponent(bank.id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    showToast("题库设置已更新", "ok");
    await onSaved?.();
  } catch (err) {
    showToast(err.message, "bad");
  }
};

export const openBankMergeModal = async ({ banks, subjects, defaultSubjectId = "", onMerged }) => {
  if (banks.length < 2) return showToast("至少需要 2 个题库才能合并", "bad");
  const form = await openFormDialog({
    title: "合并多个题库",
    description: "将所选题库去重合并为一个新题库（原题库保留不受影响）。",
    fields: [
      { name: "sourceIds", label: "选择要合并的题库（至少 2 个）", type: "checkboxes", options: banks.map((b) => ({ value: b.id, label: `${b.name} (${b.questionCount || 0} 题)` })) },
      { name: "targetName", label: "合并后的新题库名称", value: "合并综合题库", required: true },
      { name: "subjectId", label: "归属科目", type: "select", value: defaultSubjectId, options: buildSubjectOptions(subjects) },
      { name: "category", label: "题库性质", type: "select", value: "comprehensive", options: CATEGORY_OPTIONS }
    ],
    submitText: "开始合并"
  });
  if (!form || (form.sourceIds || []).length < 2) return;
  try {
    const res = await apiRequest("/api/banks/merge", {
      method: "POST",
      body: JSON.stringify({
        sourceIds: form.sourceIds,
        targetName: form.targetName.trim() || "合并题库",
        subjectId: form.subjectId,
        category: form.category || "comprehensive"
      })
    });
    showToast(`合并成功，共 ${res.created} 题`, "ok");
    await onMerged?.(res.bank);
  } catch (err) {
    showToast(err.message, "bad");
  }
};

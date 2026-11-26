import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { parseExamTextDetailed } from "../public/exam-parse.js";

const TYPE_TEXT_TO_CODE = {
  单选题: "0",
  单选: "0",
  "0": "0",
  多选题: "1",
  多选: "1",
  "1": "1",
  填空题: "2",
  填空: "2",
  "2": "2",
  判断题: "3",
  判断: "3",
  "3": "3",
  简答题: "4",
  简答: "4",
  论述题: "4",
  "4": "4",
  不定项选择题: "5",
  不定项: "5",
  "5": "5",
  实操题: "6",
  实操: "6",
  "6": "6",
  排序题: "7",
  排序拖动题: "7",
  排序: "7",
  "7": "7",
  配对题: "8",
  拖拽配对题: "8",
  配对: "8",
  "8": "8"
};

const CODE_TO_TYPE_TEXT = {
  "0": "单选题",
  "1": "多选题",
  "2": "填空题",
  "3": "判断题",
  "4": "简答题",
  "5": "不定项选择题",
  "6": "实操题",
  "7": "排序拖动题",
  "8": "拖拽配对题"
};

const decodeBase64Payload = (base64) => {
  const clean = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(clean, "base64");
};

export const parseWordBase64 = async (base64, defaults = {}) => {
  const buf = decodeBase64Payload(base64);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return parseExamTextDetailed(value || "", defaults);
};

export const parseExcelBase64 = (base64, defaults = {}) => {
  const buf = decodeBase64Payload(base64);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { questions: [], errors: [{ index: 1, message: "Excel 无有效工作表", title: "空文件" }] };
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const questions = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const title = String(row["题干"] ?? row["题目"] ?? row.title ?? row.question ?? "").trim();
    const rawType = String(row["题型"] ?? row.type ?? "0").trim();
    const type = TYPE_TEXT_TO_CODE[rawType] ?? "0";
    const options = ["A", "B", "C", "D", "E", "F"]
      .map((l) => String(row[`选项${l}`] ?? row[l] ?? "").trim())
      .filter(Boolean);
    const ansRaw = String(row["答案"] ?? row["正确答案"] ?? row.answers ?? row.answer ?? "").trim();
    if (!title || !ansRaw) {
      errors.push({ index: idx + 2, message: !title ? "缺少题干" : "缺少答案", title: title || `第 ${idx + 2} 行` });
      return;
    }
    const answers = (type === "4" || type === "6")
      ? [ansRaw]
      : (ansRaw.includes("|") ? ansRaw.split("|").map((s) => s.trim()).filter(Boolean) : [ansRaw]);
    questions.push({
      title,
      type,
      options,
      answers,
      analysis: String(row["解析"] ?? row.analysis ?? "").trim(),
      chapter: String(row["章节"] ?? row.chapter ?? defaults.chapter ?? "").trim(),
      difficulty: String(row["难度"] ?? row["难易程度"] ?? row.difficulty ?? "中等").trim()
    });
  });
  return { questions, errors };
};

export const buildExcelTemplateBuffer = () => {
  const rows = [
    {
      题型: "单选题",
      题干: "绿色植物在光照下释放氧气，主要是因为",
      选项A: "呼吸作用",
      选项B: "光合作用",
      选项C: "蒸腾作用",
      选项D: "渗透作用",
      选项E: "",
      选项F: "",
      答案: "B",
      解析: "光合作用吸收二氧化碳并释放氧气。",
      章节: "生物基础",
      难度: "简单"
    },
    {
      题型: "多选题",
      题干: "下列属于可再生资源的是",
      选项A: "煤炭",
      选项B: "太阳能",
      选项C: "风能",
      选项D: "石油",
      选项E: "",
      选项F: "",
      答案: "BC",
      解析: "太阳能和风能属于可再生能源。",
      章节: "地理",
      难度: "中等"
    }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "试题模板");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

export const exportBankToExcelBuffer = (questions) => {
  const rows = questions.map((q) => {
    const opts = q.options || [];
    return {
      题型: CODE_TO_TYPE_TEXT[q.type] || "单选题",
      题干: q.title || "",
      选项A: opts[0] || "",
      选项B: opts[1] || "",
      选项C: opts[2] || "",
      选项D: opts[3] || "",
      选项E: opts[4] || "",
      选项F: opts[5] || "",
      答案: (q.answers || []).join(" | "),
      解析: q.analysis || "",
      章节: q.chapter || "",
      难度: q.difficulty || "中等"
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "题库导出");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

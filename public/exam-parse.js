const SECTION_TYPE = {
  单选题: "0",
  单选: "0",
  多选题: "1",
  多选: "1",
  填空题: "2",
  填空: "2",
  判断题: "3",
  判断: "3",
  简答题: "4",
  简答: "4",
  论述题: "4",
  名词解释: "4",
  计算题: "4",
  不定项选择题: "5",
  不定项: "5"
};

const JUDGE_MAP = {
  对: "正确",
  正确: "正确",
  是: "正确",
  "√": "正确",
  y: "正确",
  yes: "正确",
  t: "正确",
  true: "正确",
  错: "错误",
  错误: "错误",
  否: "错误",
  "×": "错误",
  n: "错误",
  no: "错误",
  f: "错误",
  false: "错误"
};

export const SAMPLE_TEXT = `单选题
1.绿色植物在光照下释放氧气，主要是因为（B）
A. 呼吸作用
B. 光合作用
C. 蒸腾作用
D. 渗透作用
解析：光合作用吸收二氧化碳并释放氧气。

2.一年中白昼最长的节气是
A、春分
B、夏至
C、秋分
D、冬至
答案:B
解析：夏至日太阳直射北回归线，北半球白昼最长。

多选题
3.下列属于可再生资源的是
A、煤炭
B、太阳能（正确答案）
C、风能（正确答案）
D、石油
解析：太阳能和风能属于可再生能源。

判断题
4.地球绕太阳公转一周大约是一年
答案:对

填空题
5.中国的首都是（）
答案:北京
`;

const isSection = (line) => SECTION_TYPE[line.replace(/[:：]\s*$/, "")] != null;
const isQuestionStart = (line) => /^\d+\s*[.、．)）\s]\s*\S/.test(line);
const isOption = (line) => /^[A-Za-z]\s*[、.．:：)）]\s*\S/.test(line);
const isAnswerLine = (line) => /^(?:【?(?:答案|正确答案|参考答案|标准答案|试题答案)】?)\s*[:：]?\s*/.test(line);
const isAnalysisLine = (line) => /^(?:【?(?:解析|答案解析|试题解析)】?)\s*[:：]?\s*/.test(line);

const stripAnswerPrefix = (line) => line.replace(/^(?:【?(?:答案|正确答案|参考答案|标准答案|试题答案)】?)\s*[:：]?\s*/, "").trim();
const stripAnalysisPrefix = (line) => line.replace(/^(?:【?(?:解析|答案解析|试题解析)】?)\s*[:：]?\s*/, "").trim();

const lettersToAnswers = (raw, options) => {
  const compact = String(raw).replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!compact || !options.length) return null;
  if (![...compact].every((letter) => letter.charCodeAt(0) - 65 < options.length)) return null;
  return [...compact].map((letter) => options[letter.charCodeAt(0) - 65]);
};

const extractInlineAnswerFromTitle = (title) => {
  const parenMatch = title.match(/[（(]\s*([A-Za-z]{1,8}(?:[、,.，\s]*[A-Za-z])*)\s*[)）]/);
  if (parenMatch) {
    const letters = parenMatch[1].replace(/[^A-Za-z]/g, "").toUpperCase();
    return {
      cleanedTitle: title.replace(parenMatch[0], "（）").trim(),
      inlineAnswer: letters
    };
  }
  const tailMatch = title.match(/\s+([A-Za-z]{1,6})$/);
  if (tailMatch) {
    return {
      cleanedTitle: title.slice(0, tailMatch.index).trim(),
      inlineAnswer: tailMatch[1].toUpperCase()
    };
  }
  return { cleanedTitle: title, inlineAnswer: "" };
};

const parseBlock = (lines, sectionType, defaults = {}) => {
  const titleParts = [];
  const options = [];
  const optionCorrectLetters = [];
  const analysisParts = [];
  let answerRaw = "";
  let standaloneLetter = "";
  let no = "";
  let inAnalysis = false;

  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;
    if (isAnalysisLine(line)) {
      inAnalysis = true;
      const body = stripAnalysisPrefix(line);
      if (body) analysisParts.push(body);
      continue;
    }
    if (isAnswerLine(line)) {
      inAnalysis = false;
      answerRaw = stripAnswerPrefix(line);
      continue;
    }
    if (inAnalysis) {
      analysisParts.push(line);
      continue;
    }
    const optMatch = line.match(/^([A-Za-z])\s*[、.．:：)）]\s*(.*)$/);
    if (optMatch) {
      let optText = optMatch[2].trim();
      if (/[（(]\s*正确答案\s*[)）]/.test(optText)) {
        optText = optText.replace(/[（(]\s*正确答案\s*[)）]/g, "").trim();
        optionCorrectLetters.push(optMatch[1].toUpperCase());
      }
      options.push(optText);
      continue;
    }
    if (!options.length && /^[A-Za-z]{1,8}$/.test(line) && titleParts.length > 0) {
      standaloneLetter = line.toUpperCase();
      continue;
    }
    const numbered = line.match(/^(\d+)\s*[.、．)）\s]\s*(.*)$/);
    if (numbered && !no && !titleParts.length) {
      no = numbered[1];
      titleParts.push(numbered[2]);
    } else {
      titleParts.push(line);
    }
  }

  let title = titleParts.join(" ").trim();
  if (!title) {
    return { error: "题干为空", raw: lines.join("\n") };
  }

  if (!answerRaw && optionCorrectLetters.length) {
    answerRaw = optionCorrectLetters.join("");
  }
  if (!answerRaw && standaloneLetter) {
    answerRaw = standaloneLetter;
  }
  if (!answerRaw && options.length >= 2) {
    const inline = extractInlineAnswerFromTitle(title);
    if (inline.inlineAnswer) {
      title = inline.cleanedTitle;
      answerRaw = inline.inlineAnswer;
    }
  }

  if (!answerRaw) {
    return { error: "试题没有答案", title, no, raw: lines.join("\n") };
  }

  const letterAnswers = lettersToAnswers(answerRaw, options);
  const judge = JUDGE_MAP[answerRaw.replace(/\s+/g, "").toLowerCase()];
  let type = sectionType;
  let answers;
  let nextOptions = options;

  if (letterAnswers?.length) {
    type = sectionType === "0" || sectionType === "1" || sectionType === "5"
      ? sectionType
      : (letterAnswers.length > 1 ? "1" : "0");
    answers = letterAnswers;
  } else if (judge && (!options.length || options.every((o) => ["正确", "错误", "对", "错"].includes(o)))) {
    type = "3";
    nextOptions = ["正确", "错误"];
    answers = [judge];
  } else if (answerRaw.includes("|")) {
    type = "2";
    nextOptions = [];
    answers = answerRaw.split("|").map((item) => item.trim()).filter(Boolean);
  } else if (options.length >= 2) {
    type = sectionType === "1" || sectionType === "5" ? sectionType : "0";
    answers = [answerRaw];
  } else {
    type = sectionType === "2" ? "2" : (sectionType === "4" ? "4" : (title.includes("（）") || title.includes("()") ? "2" : "4"));
    nextOptions = [];
    answers = [answerRaw];
  }

  return {
    question: {
      no,
      title,
      type,
      options: nextOptions,
      answers,
      analysis: analysisParts.join("\n").trim(),
      chapter: defaults.chapter || "",
      difficulty: defaults.difficulty || "中等"
    }
  };
};

export const parseExamTextDetailed = (text, defaults = {}) => {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const questions = [];
  const errors = [];
  let sectionType = "";
  let current = [];

  const flush = () => {
    if (!current.some((l) => l.trim())) {
      current = [];
      return;
    }
    const res = parseBlock(current, sectionType, defaults);
    if (res.question) {
      questions.push(res.question);
    } else if (res.error) {
      errors.push({
        index: questions.length + errors.length + 1,
        message: res.error,
        title: res.title || current[0]?.trim() || "未知题目"
      });
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && isSection(trimmed) && !isQuestionStart(trimmed) && !isOption(trimmed)) {
      flush();
      sectionType = SECTION_TYPE[trimmed.replace(/[:：]\s*$/, "")];
      continue;
    }
    if (trimmed && isQuestionStart(trimmed) && current.some((l) => l.trim())) {
      flush();
    }
    current.push(line);
  }
  flush();

  return { questions, errors };
};

export const parseExamText = (text, defaults = {}) => parseExamTextDetailed(text, defaults).questions;

export const CLEAN_TOOLS = {
  trimLines: (text) => text.split(/\r?\n/).map((l) => l.trim()).join("\n"),
  removeEmptyLines: (text) => text.split(/\r?\n/).filter((l) => l.trim()).join("\n"),
  fullToHalf: (text) => text.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " "),
  splitInlineOptions: (text) => text.replace(/([^\n])\s+([A-H]\s*[.、．:：])/g, "$1\n$2"),
  replaceBlankUnderscore: (text) => text.replace(/_{2,}/g, "（）"),
  normalizeJudgeSymbols: (text) => text
    .replace(/^((?:答案|正确答案)\s*[:：]\s*)√$/gm, "$1正确")
    .replace(/^((?:答案|正确答案)\s*[:：]\s*)×$/gm, "$1错误"),
  fixNumberAndOptionDots: (text) => text
    .replace(/^(\d+)\s+([^\s.、．])/gm, "$1.$2")
    .replace(/^([A-Ha-h])\s+([^\s.、．:：])/gm, (_, l, rest) => `${l.toUpperCase()}.${rest}`),
  expandCompactAnswers: (text) => text.replace(/(\d+)\s*[-~～]\s*(\d+)\s*[:：]?\s*([A-Za-z]{2,})/g, (_, s, e, letters) => {
    const start = Number(s);
    return [...letters.toUpperCase()].map((l, idx) => `${start + idx}.${l}`).join(" ");
  }),
  mergeTrailingAnswers: (text) => {
    const lines = text.split(/\r?\n/);
    const ansMap = new Map();
    const bodyLines = [];
    let inTrailing = false;
    for (const line of lines) {
      if (/^(?:参考答案|标准答案|答案汇总)\s*[:：]?$/.test(line.trim())) {
        inTrailing = true;
        continue;
      }
      if (inTrailing) {
        const matches = [...line.matchAll(/(\d+)\s*[.、．:：\s]\s*([A-Za-z]+|对|错|正确|错误)/g)];
        matches.forEach((m) => ansMap.set(m[1], m[2]));
      } else {
        bodyLines.push(line);
      }
    }
    if (!ansMap.size) return text;
    const out = [];
    let curNo = "";
    for (const line of bodyLines) {
      const qm = line.trim().match(/^(\d+)\s*[.、．]/);
      if (qm) {
        if (curNo && ansMap.has(curNo)) out.push(`答案:${ansMap.get(curNo)}`);
        curNo = qm[1];
      }
      out.push(line);
    }
    if (curNo && ansMap.has(curNo)) out.push(`答案:${ansMap.get(curNo)}`);
    return out.join("\n");
  },
  autoFormat: (text) => {
    let out = CLEAN_TOOLS.fullToHalf(text);
    out = CLEAN_TOOLS.trimLines(out);
    out = CLEAN_TOOLS.mergeTrailingAnswers(out);
    out = CLEAN_TOOLS.fixNumberAndOptionDots(out);
    out = CLEAN_TOOLS.splitInlineOptions(out);
    out = CLEAN_TOOLS.replaceBlankUnderscore(out);
    out = CLEAN_TOOLS.normalizeJudgeSymbols(out);
    return out;
  }
};

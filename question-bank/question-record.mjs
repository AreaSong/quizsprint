const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const JUDGE_MAP = {
  对: "正确",
  正确: "正确",
  是: "正确",
  "√": "正确",
  true: "正确",
  True: "正确",
  TRUE: "正确",
  错: "错误",
  错误: "错误",
  否: "错误",
  "×": "错误",
  false: "错误",
  False: "错误",
  FALSE: "错误"
};

export const normalizeTitle = (text) => String(text || "")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/gi, " ")
  .replace(/^\s*\d+\s*[.、．)）]\s*/, "")
  .replace(/^【[^】]*】\s*/, "")
  .replace(/[（(]\s*\d+\s*分\s*[)）]/g, "")
  .replace(/[\s\u00a0]+/g, "")
  .replace(/[,.，。、：；？！'""''「」【】《》（）()[\]{}<>]/g, "")
  .toLowerCase();

export const normalizeAnswers = (answers) => {
  if (!Array.isArray(answers)) return [];
  return answers.map((item) => String(item || "").trim()).filter(Boolean);
};

const lettersToOptions = (raw, options) => {
  const compact = String(raw).replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!compact || !options.length) return null;
  if (![...compact].every((letter) => letter.charCodeAt(0) - 65 < options.length)) return null;
  return [...compact].map((letter) => String(options[LETTERS.indexOf(letter)] || "").trim()).filter(Boolean);
};

export const expandStoredAnswers = (answers, options) => {
  const texts = normalizeAnswers(answers);
  const optionTexts = Array.isArray(options) ? options.map((item) => String(item ?? "")) : [];
  if (!texts.length) return texts;
  if (optionTexts.some((item) => item.trim())) {
    if (texts.length === 1) {
      const mapped = lettersToOptions(texts[0], optionTexts);
      if (mapped?.length) return mapped;
    }
    if (texts.every((text) => /^[A-Za-z]$/.test(text))) {
      const mapped = lettersToOptions(texts.join(""), optionTexts);
      if (mapped?.length) return mapped;
    }
  }
  return texts.map((text) => JUDGE_MAP[text.replace(/\s+/g, "")] || text);
};

export const hasCompleteAnswers = (item) => normalizeAnswers(item?.answers).length > 0;

export const addQuestion = (questions, body) => {
  const title = String(body.title || body.question || "").trim();
  const options = Array.isArray(body.options) ? body.options.map((item) => String(item)) : [];
  const answers = expandStoredAnswers(body.answers || body.answer, options);
  if (!title || !answers.length) {
    return {
      wrote: false,
      status: 400,
      created: false,
      skipped: false,
      answers: [],
      msg: "title 和 answers 必填"
    };
  }
  const next = {
    title,
    no: body.no == null ? "" : String(body.no).trim(),
    type: body.type == null ? "" : String(body.type),
    options,
    answers
  };
  const skipIfExists = Boolean(body.skipIfExists);
  const existingIndex = questions.findIndex((item) => normalizeTitle(item.title) === normalizeTitle(title));
  if (existingIndex < 0) {
    questions.push(next);
    return { wrote: true, status: 200, created: true, skipped: false, answers: next.answers };
  }
  if (skipIfExists && hasCompleteAnswers(questions[existingIndex])) {
    return {
      wrote: false,
      status: 200,
      created: false,
      skipped: true,
      answers: normalizeAnswers(questions[existingIndex].answers)
    };
  }
  questions[existingIndex] = { ...questions[existingIndex], ...next };
  return { wrote: true, status: 200, created: false, skipped: false, answers: next.answers };
};

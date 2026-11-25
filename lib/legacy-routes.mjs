import { getUserFromRequest, isAdminRequest } from "./auth.mjs";
import { normalizeAnswers, normalizeTitle } from "../question-record.mjs";

const MATCH_THRESHOLD = 75;

const TYPE_MAP = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
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
  不定项选择题: "5",
  不定项: "5"
};

const missPayload = (msg) => ({
  code: 10003,
  data: { answer: [], num: "", usenum: "" },
  msg
});

const okPayload = (answers, total, extra = {}) => {
  const { msg, question, ...rest } = extra;
  return {
    code: 200,
    data: {
      answer: answers,
      num: String(total),
      usenum: "1",
      ...(question ? { question } : {})
    },
    msg: msg || "ok",
    ...rest
  };
};

const levenshtein = (left, right) => {
  const distances = Array.from({ length: left.length + 1 }, (_, i) => i);
  for (let r = 0; r < right.length; r += 1) {
    let prev = distances[0];
    distances[0] = r + 1;
    for (let l = 0; l < left.length; l += 1) {
      const cur = distances[l + 1];
      distances[l + 1] = left[l] === right[r] ? prev : Math.min(prev, distances[l], cur) + 1;
      prev = cur;
    }
  }
  return distances[left.length];
};

const similarity = (left, right) => {
  if (!left || !right) return 0;
  if (left === right) return 100;
  const maxLen = Math.max(left.length, right.length);
  return Math.round((1 - levenshtein(Array.from(left), Array.from(right)) / maxLen) * 100);
};

export const scoreQuestionTitle = (needle, hay) => {
  if (hay === needle) return 100;
  if (needle.length >= 6 && (hay.includes(needle) || needle.includes(hay))) {
    const ratio = Math.min(hay.length, needle.length) / Math.max(hay.length, needle.length);
    return Math.round(80 * ratio + 15);
  }
  return similarity(hay, needle);
};

const isLoopbackRequest = (req) => {
  if (req.headers["x-forwarded-for"]) return false;
  const ip = String(req.socket?.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
};

const checkLegacyKey = (req, body, apiKey, requireWriteAuth = false) => {
  const envKey = process.env.QUESTION_BANK_KEY || "";
  const passedKey = String(body?.key || "").trim();
  if (isAdminRequest(req, apiKey)) return true;
  if (envKey) return passedKey === envKey;
  if (passedKey && apiKey && passedKey === apiKey) return true;
  return requireWriteAuth ? isLoopbackRequest(req) : true;
};

const loadAllPublicQuestions = (store) => {
  const banks = store.listBanks().filter((b) => !b.password);
  banks.sort((a, b) => (a.id === "default" ? -1 : b.id === "default" ? 1 : 0));
  return banks.flatMap((b) => store.loadBankQuestions(b.id));
};

const findBestMatch = (questions, rawTitle, rawType) => {
  const needle = normalizeTitle(rawTitle);
  const normType = TYPE_MAP[String(rawType ?? "").trim()] || "";
  if (!needle) return { item: null, score: -1 };
  let best = null;
  let bestScore = -1;
  for (const item of questions) {
    const hay = normalizeTitle(item.title);
    if (!hay) continue;
    let score = scoreQuestionTitle(needle, hay);
    if (normType && String(item.type) === normType && score >= MATCH_THRESHOLD) {
      score = Math.min(100, score + 3);
    }
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return { item: best, score: bestScore };
};

export const handleLegacyRoutes = async (req, res, url, ctx) => {
  const method = req.method || "GET";
  const pathname = url.pathname;
  const { store, userStore, readBody, sendJson, sendDownload, template } = ctx;
  const apiKey = userStore.getApiKey();

  if (method === "GET" && pathname === "/template.json") {
    sendDownload(res, "quizsprint-question-template.json", template);
    return true;
  }
  if (method === "GET" && pathname === "/questions") {
    const def = store.ensureDefaultBank();
    if (def.password && !checkLegacyKey(req, {}, apiKey, true)) {
      sendJson(res, 403, missPayload("默认题库已加密"));
      return true;
    }
    sendJson(res, 200, store.loadBankQuestions(def.id));
    return true;
  }
  if (method === "GET" && (pathname === "/export" || pathname === "/export.json")) {
    if (!getUserFromRequest(req) && !checkLegacyKey(req, {}, apiKey, true)) {
      sendJson(res, 401, missPayload("请先登录账号后再导出题库"));
      return true;
    }
    const def = store.ensureDefaultBank();
    if (def.password && !checkLegacyKey(req, {}, apiKey, true)) {
      sendJson(res, 403, missPayload("默认题库已加密"));
      return true;
    }
    sendDownload(res, "quizsprint-questions.json", store.loadBankQuestions(def.id));
    return true;
  }
  if (method === "POST" && pathname === "/search") {
    const body = await readBody(req);
    if (!checkLegacyKey(req, body, apiKey, false)) {
      sendJson(res, 401, missPayload("题库密钥错误"));
      return true;
    }
    const pool = loadAllPublicQuestions(store);
    const title = body.question || body.title || "";
    const { item, score } = findBestMatch(pool, title, body.type);
    const answers = normalizeAnswers(item?.answers);
    if (!item || score < MATCH_THRESHOLD || !answers.length) {
      sendJson(res, 200, missPayload("未找到匹配题目"));
      return true;
    }
    sendJson(res, 200, okPayload(answers, pool.length, { score, question: item }));
    return true;
  }
  if (method === "POST" && pathname === "/probe") {
    const body = await readBody(req);
    if (!checkLegacyKey(req, body, apiKey, false)) {
      sendJson(res, 401, missPayload("题库密钥错误"));
      return true;
    }
    const pool = loadAllPublicQuestions(store);
    const list = Array.isArray(body.questions) ? body.questions : [body];
    const items = list.map((q) => {
      const { item, score } = findBestMatch(pool, q?.question || q?.title || "", q?.type);
      const answers = normalizeAnswers(item?.answers);
      const hit = Boolean(item && score >= MATCH_THRESHOLD && answers.length);
      return { hit, score: Math.max(0, score), answers: hit ? answers : [], matchedTitle: hit ? item.title : "" };
    });
    sendJson(res, 200, { code: 200, total: items.length, hitCount: items.filter((i) => i.hit).length, items });
    return true;
  }
  if (method === "POST" && pathname === "/questions") {
    const body = await readBody(req);
    if (!checkLegacyKey(req, body, apiKey, true)) {
      sendJson(res, 401, missPayload("需要管理员权限、有效密钥或本机访问"));
      return true;
    }
    const def = store.ensureDefaultBank();
    const normType = TYPE_MAP[String(body.type ?? "").trim()];
    const payload = normType ? { ...body, type: normType } : body;
    const result = store.upsertQuestion(def.id, payload);
    if (result.status !== 200) {
      sendJson(res, result.status, missPayload(result.msg || "写入失败"));
      return true;
    }
    sendJson(res, 200, okPayload(result.answers, result.total, {
      wrote: result.wrote,
      created: result.created,
      skipped: result.skipped,
      total: result.total
    }));
    return true;
  }
  if (method === "POST" && pathname === "/questions/import") {
    const body = await readBody(req);
    if (!checkLegacyKey(req, body, apiKey, true)) {
      sendJson(res, 401, missPayload("需要管理员权限或有效密钥"));
      return true;
    }
    const items = Array.isArray(body) ? body : (Array.isArray(body.questions) ? body.questions : []);
    if (!items.length) {
      sendJson(res, 400, missPayload("没有可导入的题目"));
      return true;
    }
    const def = store.ensureDefaultBank();
    const resImp = store.importQuestions(def.id, items, Boolean(body.skipIfExists));
    sendJson(res, 200, { code: 200, ...resImp, msg: "ok" });
    return true;
  }
  return false;
};

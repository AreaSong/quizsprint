import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_META_HOSTS = new Set(["metadata.google.internal", "metadata.goog", "0.0.0.0"]);

export const isPrivateOrMetaHost = (hostname) => {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { meta: true, priv: true };
  if (BLOCKED_META_HOSTS.has(host)) return { meta: true, priv: true };
  const ipVer = net.isIP(host);
  if (ipVer === 4) {
    const [a, b] = host.split(".").map(Number);
    if (a === 169 && b === 254) return { meta: true, priv: true };
    if (a === 100 && b >= 64 && b <= 127) return { meta: true, priv: true };
    const priv = a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return { meta: false, priv };
  }
  if (ipVer === 6) {
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice(7);
      if (net.isIP(mapped) === 4) return isPrivateOrMetaHost(mapped);
      const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hexMatch) {
        const hi = parseInt(hexMatch[1], 16);
        const lo = parseInt(hexMatch[2], 16);
        return isPrivateOrMetaHost(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
      }
    }
    if (/^fe[89ab][0-9a-f]?:/i.test(host) || host === "::" || host === "::1") {
      return { meta: /^fe[89ab]/i.test(host), priv: true };
    }
    if (host.startsWith("fc") || host.startsWith("fd")) return { meta: false, priv: true };
  }
  return { meta: false, priv: host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") };
};

export const resolveSafeAiUrl = async (baseUrl, suffix, allowPrivate = false) => {
  let parsed;
  try {
    parsed = new URL(`${String(baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "")}${suffix}`);
  } catch {
    throw new Error("AI Base URL 格式无效");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("AI Base URL 仅支持 http/https 协议");
  }
  const cleanHost = parsed.hostname.replace(/^\[|\]$/g, "");
  const checkHost = isPrivateOrMetaHost(cleanHost);
  if (checkHost.meta) throw new Error("禁止访问云元数据或链路本地地址");
  if (checkHost.priv && !allowPrivate) throw new Error("普通账号禁止访问内网 AI 地址，请联系管理员或使用公网 HTTPS 接口");
  if (!net.isIP(cleanHost)) {
    let records = [];
    try { records = await dns.lookup(cleanHost, { all: true }); } catch {
      throw new Error("AI 服务域名解析失败，请检查 Base URL");
    }
    for (const rec of records) {
      const resCheck = isPrivateOrMetaHost(rec.address);
      if (resCheck.meta) throw new Error("目标域名解析至受限链路本地/元数据地址，已拦截");
      if (resCheck.priv && !allowPrivate) throw new Error("普通账号禁止解析至内网 AI 地址，已拦截");
    }
  }
  return parsed.toString();
};

const callChatMessages = async (cfg, messages) => {
  if (!cfg?.apiKey) {
    throw new Error("未配置 AI API Key，请先在管理员设置中配置");
  }
  const url = await resolveSafeAiUrl(cfg.baseUrl, "/chat/completions", Boolean(cfg.allowPrivate));
  const res = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(45000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model || "gpt-4o-mini",
      messages
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `AI 请求失败 (${res.status})`);
  }
  return String(data.choices?.[0]?.message?.content || "").trim();
};

const callChat = (cfg, systemPrompt, userPrompt) =>
  callChatMessages(cfg, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ]);

const extractJsonBlock = (text) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
};

export const aiParseText = async (cfg, text) => {
  const sys = `你是专业的试题结构化助手。把用户粘贴的任意格式试题文本转为严格 JSON 数组。
每个元素字段：{"title":"题干","type":"0单选/1多选/2填空/3判断/4简答/5不定项/6实操/7排序/8配对","options":["选项1","选项2"],"answers":["正确答案正文"],"analysis":"解析","chapter":"章节","difficulty":"简单/中等/困难"}。
只输出 JSON 数组，不要多余解释。`;
  const content = await callChat(cfg, sys, String(text || "").slice(0, 12000));
  const parsed = extractJsonBlock(content);
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
};

export const aiExplainQuestion = async (cfg, q) => {
  const sys = "你是严谨的考试辅导老师，请给出清晰、分步骤的题目深度解析（包含易错点提醒）。";
  const prompt = `题干：${q.title}\n选项：${(q.options || []).join(" / ")}\n参考答案：${(q.answers || []).join(" | ")}`;
  return callChat(cfg, sys, prompt);
};

export const aiSolveQuestion = async (cfg, queryText) => {
  const sys = "你是全科搜题解答助手，请直接给出答案并附简明解析。";
  return callChat(cfg, sys, String(queryText || "").slice(0, 4000));
};

export const aiGenerateQuestions = async (cfg, topic, count = 5) => {
  const safeCount = Math.min(20, Math.max(1, Number(count || 5)));
  const sys = `你是专业命题老师。围绕用户指定主题生成 ${safeCount} 道高质量试题（混合单选、多选、判断），严格输出 JSON 数组。
格式：[{"title":"...","type":"0","options":["..."],"answers":["..."],"analysis":"...","chapter":"${topic}","difficulty":"中等"}]。只输出 JSON 数组。`;
  const content = await callChat(cfg, sys, `出题主题：${topic}`);
  const parsed = extractJsonBlock(content);
  return Array.isArray(parsed) ? parsed : [];
};

export const aiListModels = async (cfg) => {
  if (!cfg?.apiKey) {
    throw new Error("请先填写 API Key 再拉取模型列表");
  }
  const url = await resolveSafeAiUrl(cfg.baseUrl, "/models", Boolean(cfg.allowPrivate));
  const res = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${cfg.apiKey}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `拉取模型失败 (${res.status})`);
  }
  const list = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
  return [...new Set(list.map((m) => String(m?.id || m || "").trim()).filter(Boolean))].sort();
};

export const aiChatWithQuestion = async (cfg, question, messages = []) => {
  const q = question || {};
  const opts = (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  const sys = `你是贴心的 1对1 考试辅导助教，正在针对下面这道题回答学员的追问。请结合题目上下文，用清晰易懂的中文直接解答，不要偏题。
【当前试题】
题干：${q.title || ""}
${opts ? `选项：\n${opts}` : ""}
参考答案：${(q.answers || []).join(" | ")}
${q.analysis ? `已有解析：${q.analysis}` : ""}`;
  const safeHistory = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  return callChatMessages(cfg, [{ role: "system", content: sys }, ...safeHistory]);
};

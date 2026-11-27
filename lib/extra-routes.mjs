import fs from "node:fs";
import path from "node:path";
import { aiChatWithQuestion, aiExplainQuestion, aiGenerateQuestions, aiListModels, aiParseText, aiSolveQuestion } from "./ai.mjs";
import {
  buildClearUserCookie,
  buildUserCookie,
  createUserToken,
  getUserFromRequest,
  isAdminRequest
} from "./auth.mjs";
import {
  buildExcelTemplateBuffer,
  exportBankToExcelBuffer,
  parseExcelBase64,
  parseWordBase64
} from "./doc-import.mjs";
import { saveDataUrlImage } from "./fs-utils.mjs";
import { handleAdminCrudRoutes } from "./admin-crud-routes.mjs";
import { createBackupBuffer, getDatabaseStats, maintainDatabase } from "./db.mjs";
import { getLatestLoginByUserMap, recordLoginEvent } from "./login-log.mjs";
import { handleSiteRoutes } from "./site-routes.mjs";
import { checkRemoteUpdate, getSystemStatus, getUpdateProbeSnapshot, pullRemoteUpdate } from "./system-updater.mjs";

export const handleExtraRoutes = async (req, res, url, ctx) => {
  const { method, pathname } = { method: req.method || "GET", pathname: url.pathname };
  const { store, userStore, examStore, uploadsDir, readBody, sendJson, requireAdmin } = ctx;

  const requireLoggedIn = () => {
    if (getUserFromRequest(req, userStore) || isAdminRequest(req, userStore.getApiKey(), userStore)) return true;
    sendJson(res, 401, { code: 401, msg: "请先登录账号后再进行操作" });
    return false;
  };

  const pickLocalAiConfig = (body) => {
    const cfg = body?.aiConfig || {};
    return {
      baseUrl: String(cfg.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
      apiKey: String(cfg.apiKey || "").trim(),
      model: String(cfg.model || "gpt-4o-mini").trim(),
      allowPrivate: isAdminRequest(req, userStore.getApiKey(), userStore) || process.env.ALLOW_LOCAL_AI === "1"
    };
  };

  // 普通用户注册 / 登录 / 同步 / 统计
  if (method === "GET" && pathname === "/api/user/me") {
    return sendJson(res, 200, {
      code: 200,
      user: getUserFromRequest(req, userStore),
      registrationMode: userStore.getRegistrationPolicy().mode
    }), true;
  }
  if (method === "POST" && pathname === "/api/user/register") {
    const body = await readBody(req);
    const policyCheck = userStore.verifyRegistrationPolicy(body.inviteCode);
    if (policyCheck.error) return sendJson(res, 403, { code: 403, msg: policyCheck.error }), true;
    const out = userStore.register({ ...body, role: "student" });
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    recordLoginEvent(ctx.dataDir, req, { userId: out.user.id, username: out.user.username, nickname: out.user.nickname, role: out.user.role, status: "success", reason: "新用户注册登录" });
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    return sendJson(
      res,
      200,
      { code: 200, user: out.user },
      { "Set-Cookie": buildUserCookie(createUserToken(out.user), isHttps) }
    ), true;
  }
  if (method === "POST" && pathname === "/api/user/login") {
    const body = await readBody(req);
    const out = userStore.authenticate(body);
    if (out.error) {
      recordLoginEvent(ctx.dataDir, req, { username: String(body?.username || ""), status: "failed", reason: out.error });
      return sendJson(res, 401, { code: 401, msg: out.error }), true;
    }
    recordLoginEvent(ctx.dataDir, req, { userId: out.user.id, username: out.user.username, nickname: out.user.nickname, role: out.user.role, status: "success" });
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    return sendJson(
      res,
      200,
      { code: 200, user: out.user },
      { "Set-Cookie": buildUserCookie(createUserToken(out.user), isHttps) }
    ), true;
  }
  if (method === "POST" && pathname === "/api/user/logout") {
    return sendJson(res, 200, { code: 200, ok: true }, { "Set-Cookie": buildClearUserCookie() }), true;
  }
  if (method === "GET" && pathname === "/api/user/progress") {
    const user = getUserFromRequest(req, userStore);
    if (!user) return sendJson(res, 401, { code: 401, msg: "未登录用户" }), true;
    return sendJson(res, 200, { code: 200, progress: userStore.loadProgress(user.id) }), true;
  }
  if (method === "POST" && pathname === "/api/user/progress") {
    const user = getUserFromRequest(req, userStore);
    if (!user) return sendJson(res, 401, { code: 401, msg: "未登录用户" }), true;
    const body = await readBody(req);
    const progress = userStore.saveBankProgress(user.id, body.bankId, body.bankData, body.dailyDelta);
    return sendJson(res, 200, { code: 200, progress }), true;
  }
  if (method === "GET" && pathname === "/api/stats") {
    if (ctx.requireGuestAllowed && !ctx.requireGuestAllowed(req, res)) return true;
    const user = getUserFromRequest(req, userStore);
    const data = userStore.getStatsAndLeaderboard(user?.id || "");
    return sendJson(res, 200, { code: 200, ...data }), true;
  }
  if (method === "POST" && pathname === "/api/user/password") {
    const user = getUserFromRequest(req, userStore);
    if (!user) return sendJson(res, 401, { code: 401, msg: "请先登录账号" }), true;
    const body = await readBody(req);
    const out = userStore.changePassword(user.id, body);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    const headers = out.user ? { "Set-Cookie": buildUserCookie(createUserToken(out.user), isHttps) } : {};
    return sendJson(res, 200, { code: 200, msg: "密码修改成功" }, headers), true;
  }
  if (method === "GET" && pathname === "/api/user/submissions") {
    const user = getUserFromRequest(req, userStore);
    if (!user) {
      if (isAdminRequest(req, userStore.getApiKey(), userStore)) {
        return sendJson(res, 200, { code: 200, submissions: [] }), true;
      }
      return sendJson(res, 401, { code: 401, msg: "请先登录账号" }), true;
    }
    return sendJson(res, 200, { code: 200, submissions: examStore.getUserSubmissions(user.id) }), true;
  }

  // 图片上传 & 题库合并
  if (method === "POST" && pathname === "/api/upload/image") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const saved = saveDataUrlImage(uploadsDir, body.dataUrl);
    if (saved.error) return sendJson(res, 400, { code: 400, msg: saved.error }), true;
    return sendJson(res, 200, { code: 200, url: saved.url }), true;
  }
  if (method === "POST" && pathname === "/api/banks/merge") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = store.mergeBanks(body);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, ...out }), true;
  }

  // Excel / Word 导入与导出
  if (method === "GET" && pathname === "/api/template.xlsx") {
    const buf = buildExcelTemplateBuffer();
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("quizsprint-template.xlsx")}`
    });
    res.end(buf);
    return true;
  }
  const excelExportMatch = pathname.match(/^\/api\/banks\/([^/]+)\/export\.xlsx$/);
  if (excelExportMatch && method === "GET") {
    if (!requireLoggedIn()) return true;
    const bank = store.getBank(decodeURIComponent(excelExportMatch[1]));
    if (!bank) return sendJson(res, 404, { code: 404, msg: "题库不存在" }), true;
    const bankPwd = url.searchParams.get("pwd") || req.headers["x-bank-password"] || "";
    if (bank.password && bankPwd !== bank.password && !isAdminRequest(req, userStore.getApiKey(), userStore)) {
      return sendJson(res, 403, { code: 403, locked: true, msg: "该题库已加密，请输入访问密码" }), true;
    }
    const buf = exportBankToExcelBuffer(store.loadBankQuestions(bank.id));
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${bank.name}.xlsx`)}`
    });
    res.end(buf);
    return true;
  }
  const docParseMatch = pathname.match(/^\/api\/parse\/(word|excel)$/);
  if (docParseMatch && method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const parsed = docParseMatch[1] === "word"
      ? await parseWordBase64(body.base64, { chapter: body.chapter || "" })
      : parseExcelBase64(body.base64, { chapter: body.chapter || "" });
    return sendJson(res, 200, { code: 200, ...parsed }), true;
  }

  // API Key 管理（供外部脚本直接 CRUD 调用）
  if (method === "GET" && pathname === "/api/admin/apikey") {
    if (!requireAdmin(req, res)) return true;
    return sendJson(res, 200, { code: 200, apiKey: userStore.getApiKey() }), true;
  }
  if (method === "POST" && pathname === "/api/admin/apikey") {
    if (!requireAdmin(req, res)) return true;
    const next = userStore.rotateApiKey();
    if (next?.error) return sendJson(res, 400, { code: 400, msg: next.error }), true;
    ctx.audit?.("apikey.rotate", "api_key", "重置外部 CRUD API 密钥");
    return sendJson(res, 200, { code: 200, apiKey: next }), true;
  }

  // AI 能力（完全使用请求方自带的本地 aiConfig，服务端绝不持久化保存）
  if (method === "POST" && pathname === "/api/ai/models") {
    if (!requireLoggedIn()) return true;
    const body = await readBody(req);
    const models = await aiListModels(pickLocalAiConfig(body));
    return sendJson(res, 200, { code: 200, models }), true;
  }
  if (method === "POST" && pathname === "/api/ai/parse") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const questions = await aiParseText(pickLocalAiConfig(body), body.text);
    return sendJson(res, 200, { code: 200, questions }), true;
  }
  if (method === "POST" && pathname === "/api/ai/generate") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const questions = await aiGenerateQuestions(pickLocalAiConfig(body), body.topic, body.count);
    return sendJson(res, 200, { code: 200, questions }), true;
  }
  if (method === "POST" && pathname === "/api/ai/explain") {
    if (!requireLoggedIn()) return true;
    const body = await readBody(req);
    const explanation = await aiExplainQuestion(pickLocalAiConfig(body), body.question || {});
    return sendJson(res, 200, { code: 200, explanation }), true;
  }
  if (method === "POST" && pathname === "/api/ai/solve") {
    if (!requireLoggedIn()) return true;
    const body = await readBody(req);
    const answer = await aiSolveQuestion(pickLocalAiConfig(body), body.query);
    return sendJson(res, 200, { code: 200, answer }), true;
  }
  if (method === "POST" && pathname === "/api/ai/chat") {
    if (!requireLoggedIn()) return true;
    const body = await readBody(req);
    const reply = await aiChatWithQuestion(pickLocalAiConfig(body), body.question, body.messages);
    return sendJson(res, 200, { code: 200, reply }), true;
  }

  // 管理员系统状态与 Git 在线更新
  if (method === "GET" && pathname === "/api/admin/system/status") {
    if (!requireAdmin(req, res)) return true;
    const st = await getSystemStatus(ctx.repoDir);
    return sendJson(res, 200, { code: 200, ...st, updateProbe: getUpdateProbeSnapshot(ctx.repoDir) }), true;
  }
  if (method === "POST" && pathname === "/api/admin/system/check-update") {
    if (!requireAdmin(req, res)) return true;
    try {
      const checked = await checkRemoteUpdate(ctx.repoDir);
      return sendJson(res, 200, { code: 200, ...checked, updateProbe: getUpdateProbeSnapshot(ctx.repoDir) }), true;
    } catch (err) {
      return sendJson(res, 500, { code: 500, msg: err instanceof Error ? err.message : "检查更新失败" }), true;
    }
  }
  if (method === "POST" && pathname === "/api/admin/system/update") {
    if (!requireAdmin(req, res)) return true;
    try {
      const body = await readBody(req).catch(() => ({}));
      const out = await pullRemoteUpdate(ctx.repoDir);
      if (out.error) return sendJson(res, 409, { code: 409, msg: out.error }), true;
      const restarting = Boolean(out.updated && body?.autoRestart);
      if (restarting) {
        ctx.audit?.("system.update", out.afterCommit || "", "拉取更新并自动重启");
        sendJson(res, 200, { code: 200, ...out, restarting: true });
        ctx.onRequestRestart?.();
        return true;
      }
      return sendJson(res, 200, { code: 200, ...out, restarting: false }), true;
    } catch (err) {
      return sendJson(res, 500, { code: 500, msg: err instanceof Error ? err.message : "拉取更新失败" }), true;
    }
  }
  if (method === "POST" && pathname === "/api/admin/system/restart") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, { code: 200, restarting: true, msg: "正在优雅重启服务，请稍候..." });
    ctx.onRequestRestart?.();
    return true;
  }
  if (method === "GET" && pathname === "/api/admin/backup.db") {
    if (!requireAdmin(req, res)) return true;
    const dbPath = path.join(ctx.dataDir || "", "question-bank.db");
    if (!fs.existsSync(dbPath)) return sendJson(res, 404, { code: 404, msg: "数据库文件不存在" }), true;
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = createBackupBuffer(ctx.dataDir);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="quizsprint-backup-${day}.db"`
    });
    res.end(buf);
    return true;
  }
  if (method === "GET" && pathname === "/api/admin/db/stats") {
    if (!requireAdmin(req, res)) return true;
    return sendJson(res, 200, { code: 200, ...getDatabaseStats(ctx.dataDir, uploadsDir) }), true;
  }
  if (method === "POST" && pathname === "/api/admin/db/maintain") {
    if (!requireAdmin(req, res)) return true;
    const out = maintainDatabase(ctx.dataDir, uploadsDir);
    ctx.audit?.("db.maintain", "question-bank.db", `清理图片 ${out.removedImages}，孤立进度 ${out.removedProgress}`);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  if (method === "GET" && pathname === "/api/admin/registration") {
    if (!requireAdmin(req, res)) return true;
    return sendJson(res, 200, { code: 200, ...userStore.getRegistrationPolicy() }), true;
  }
  if (method === "PUT" && pathname === "/api/admin/registration") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = userStore.setRegistrationPolicy(body);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    ctx.audit?.("registration.update", out.mode);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  if (method === "GET" && pathname === "/api/admin/users") {
    if (!requireAdmin(req, res)) return true;
    const lastMap = getLatestLoginByUserMap(ctx.dataDir);
    const users = userStore.listUsers().map((u) => ({ ...u, lastLogin: lastMap[u.id] || null }));
    return sendJson(res, 200, { code: 200, users }), true;
  }
  if (method === "POST" && pathname === "/api/admin/users") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = userStore.register({
      username: body.username,
      password: body.password,
      nickname: body.nickname,
      role: body.role === "admin" ? "admin" : "student",
      mustChangePassword: body.mustChangePassword !== false
    });
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    ctx.audit?.("user.create", out.user.username, `角色 ${out.user.role}`);
    return sendJson(res, 200, { code: 200, user: out.user }), true;
  }
  const userPwdMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (userPwdMatch && method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = userStore.adminResetPassword(decodeURIComponent(userPwdMatch[1]), body.newPassword);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    ctx.audit?.("user.password_reset", decodeURIComponent(userPwdMatch[1]));
    return sendJson(res, 200, { code: 200, msg: "密码已重置" }), true;
  }
  const userRoleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (userRoleMatch && method === "PUT") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = userStore.adminUpdateRole(decodeURIComponent(userRoleMatch[1]), body.role);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    ctx.audit?.("user.role", decodeURIComponent(userRoleMatch[1]), `变更为 ${out.role}`);
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  const userDelMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userDelMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const actor = getUserFromRequest(req, userStore);
    const uid = decodeURIComponent(userDelMatch[1]);
    const out = userStore.adminDeleteUser(uid, actor?.id || "");
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    ctx.audit?.("user.delete", uid);
    return sendJson(res, 200, { code: 200, ok: true }), true;
  }

  // B 端在线考试
  if (method === "GET" && pathname === "/api/exams") {
    if (ctx.requireGuestAllowed && !ctx.requireGuestAllowed(req, res)) return true;
    const admin = isAdminRequest(req, userStore.getApiKey(), userStore);
    const counts = examStore.countSubmissionsMap();
    const list = examStore.listExams().map(({ questionsSnapshot, accessCode, questionIds, questionScores, ...meta }) => ({
      ...meta,
      ...(admin ? { accessCode, questionIds, questionScores } : {}),
      hasAccessCode: Boolean(accessCode),
      questionCount: questionsSnapshot?.length || 0,
      submissionCount: counts[meta.id] || 0
    }));
    return sendJson(res, 200, { code: 200, exams: list }), true;
  }
  if (method === "POST" && pathname === "/api/exams") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const bank = store.getBank(body.bankId);
    if (!bank) return sendJson(res, 404, { code: 404, msg: "题库不存在" }), true;
    const pool = store.loadBankQuestions(bank.id);
    if (!pool.length) return sendJson(res, 400, { code: 400, msg: "题库为空，无法组卷" }), true;
    const out = examStore.createExam({ ...body, bankName: bank.name }, pool);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    const { accessCode, ...safeExam } = out.exam;
    return sendJson(res, 200, { code: 200, exam: { ...safeExam, hasAccessCode: Boolean(accessCode) } }), true;
  }
  const examMatch = pathname.match(/^\/api\/exams\/([^/]+)$/);
  if (examMatch) {
    const examId = decodeURIComponent(examMatch[1]);
    if (method === "GET") {
      if (!requireLoggedIn()) return true;
      const exam = examStore.getExam(examId);
      if (!exam) return sendJson(res, 404, { code: 404, msg: "考试不存在" }), true;
      const code = url.searchParams.get("code") || "";
      const admin = isAdminRequest(req, userStore.getApiKey(), userStore);
      if (exam.accessCode && code !== exam.accessCode && !admin) {
        return sendJson(res, 403, { code: 403, needCode: true, title: exam.title, msg: "需要考试密码" }), true;
      }
      if (!admin) {
        const user = getUserFromRequest(req, userStore);
        const elig = examStore.checkExamEligibility(exam, user?.id || "");
        if (elig.error) return sendJson(res, 403, { code: 403, msg: elig.error }), true;
      }
      const { accessCode, questionsSnapshot, ...safeExam } = exam;
      const safeQuestions = examStore.sanitizeQuestionsForExam(questionsSnapshot || []);
      return sendJson(res, 200, {
        code: 200,
        exam: { ...safeExam, hasAccessCode: Boolean(accessCode), questionsSnapshot: safeQuestions }
      }), true;
    }
    if (method === "PUT") {
      if (!requireAdmin(req, res)) return true;
      const body = await readBody(req);
      const out = examStore.updateExam(examId, body);
      if (out.error) return sendJson(res, out.notFound ? 404 : 400, { code: out.notFound ? 404 : 400, msg: out.error }), true;
      return sendJson(res, 200, { code: 200, exam: { ...out.exam, hasAccessCode: Boolean(out.exam.accessCode) } }), true;
    }
    if (method === "DELETE") {
      if (!requireAdmin(req, res)) return true;
      const out = examStore.deleteExam(examId);
      if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
      ctx.audit?.("exam.delete", examId);
      return sendJson(res, 200, { code: 200, ok: true }), true;
    }
  }
  const examSubMatch = pathname.match(/^\/api\/exams\/([^/]+)\/(submit|submissions)$/);
  if (examSubMatch) {
    const examId = decodeURIComponent(examSubMatch[1]);
    if (examSubMatch[2] === "submit" && method === "POST") {
      if (!requireLoggedIn()) return true;
      const exam = examStore.getExam(examId);
      if (!exam) return sendJson(res, 404, { code: 404, msg: "考试不存在" }), true;
      const body = await readBody(req);
      if (exam.accessCode && String(body.code || "").trim() !== exam.accessCode && !isAdminRequest(req, userStore.getApiKey(), userStore)) {
        return sendJson(res, 403, { code: 403, msg: "考试密码校验失败，无法交卷" }), true;
      }
      const user = getUserFromRequest(req, userStore);
      const out = examStore.submitExam(examId, { ...body, userId: user?.id || "" });
      if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
      return sendJson(res, 200, { code: 200, submission: out.submission }), true;
    }
    if (examSubMatch[2] === "submissions" && method === "GET") {
      if (!requireAdmin(req, res)) return true;
      return sendJson(res, 200, { code: 200, submissions: examStore.getSubmissions(examId) }), true;
    }
  }
  const gradeMatch = pathname.match(/^\/api\/exams\/([^/]+)\/submissions\/([^/]+)\/grade$/);
  if (gradeMatch && method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = examStore.gradeSubmission(
      decodeURIComponent(gradeMatch[1]),
      decodeURIComponent(gradeMatch[2]),
      body.itemScores || {}
    );
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, submission: out.submission }), true;
  }

  // 科目管理接口
  if (method === "GET" && pathname === "/api/subjects") {
    if (ctx.requireGuestAllowed && !ctx.requireGuestAllowed(req, res)) return true;
    return sendJson(res, 200, { code: 200, subjects: store.listSubjects() }), true;
  }
  if (method === "POST" && pathname === "/api/subjects") {
    if (!requireAdmin(req, res)) return true;
    const out = store.createSubject(await readBody(req));
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, subject: out.subject }), true;
  }
  const subjectMatch = pathname.match(/^\/api\/subjects\/([^/]+)$/);
  if (subjectMatch) {
    const subjectId = decodeURIComponent(subjectMatch[1]);
    if (method === "PUT") {
      if (!requireAdmin(req, res)) return true;
      const out = store.updateSubject(subjectId, await readBody(req));
      if (out.error) {
        const st = out.error.includes("不存在") ? 404 : 400;
        return sendJson(res, st, { code: st, msg: out.error }), true;
      }
      return sendJson(res, 200, { code: 200, subject: out.subject }), true;
    }
    if (method === "DELETE") {
      if (!requireAdmin(req, res)) return true;
      const out = store.deleteSubject(subjectId);
      if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
      return sendJson(res, 200, { code: 200, ok: true }), true;
    }
  }

  if (await handleSiteRoutes(req, res, url, ctx)) return true;
  if (await handleAdminCrudRoutes(req, res, url, ctx)) return true;

  return false;
};

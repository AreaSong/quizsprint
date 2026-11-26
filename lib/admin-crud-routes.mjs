import { buildUserCookie, createUserToken, getUserFromRequest } from "./auth.mjs";
import { restoreDatabaseFromBase64 } from "./db-restore.mjs";

const handleUserCrud = async (req, res, pathname, ctx) => {
  const { userStore, readBody, sendJson, requireAdmin } = ctx;
  const method = req.method || "GET";
  const isHttps = req.headers["x-forwarded-proto"] === "https";

  if (method === "PUT" && pathname === "/api/user/profile") {
    const user = getUserFromRequest(req);
    if (!user) return sendJson(res, 401, { code: 401, msg: "请先登录账号" }), true;
    const out = userStore.updateProfile(user.id, await readBody(req));
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, user: out.user }, { "Set-Cookie": buildUserCookie(createUserToken(out.user), isHttps) }), true;
  }

  const adminProfMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/profile$/);
  if (adminProfMatch && method === "PUT") {
    if (!requireAdmin(req, res)) return true;
    const uid = decodeURIComponent(adminProfMatch[1]);
    const out = userStore.adminUpdateUser(uid, await readBody(req));
    if (out.error) {
      const status = out.error.includes("不存在") ? 404 : 400;
      return sendJson(res, status, { code: status, msg: out.error }), true;
    }
    const curActor = getUserFromRequest(req);
    const headers = curActor?.id === out.user.id ? { "Set-Cookie": buildUserCookie(createUserToken(out.user), isHttps) } : {};
    return sendJson(res, 200, { code: 200, user: out.user }, headers), true;
  }

  const adminProgMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/progress$/);
  if (adminProgMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const out = userStore.adminClearUserProgress(decodeURIComponent(adminProgMatch[1]));
    if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, ok: true }), true;
  }
  return false;
};

const handleExamAndStatsCrud = async (req, res, url, ctx) => {
  const { examStore, userStore, uploadsDir, readBody, sendJson, requireAdmin } = ctx;
  const method = req.method || "GET";
  const pathname = url.pathname;

  const dupMatch = pathname.match(/^\/api\/exams\/([^/]+)\/duplicate$/);
  if (dupMatch && method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const out = examStore.duplicateExam(decodeURIComponent(dupMatch[1]));
    if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
    const { accessCode, ...safeExam } = out.exam;
    return sendJson(res, 200, { code: 200, exam: { ...safeExam, hasAccessCode: Boolean(accessCode) } }), true;
  }

  const subItemMatch = pathname.match(/^\/api\/exams\/([^/]+)\/submissions\/([^/]+)$/);
  if (subItemMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const out = examStore.deleteSubmission(decodeURIComponent(subItemMatch[1]), decodeURIComponent(subItemMatch[2]));
    if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, ok: true }), true;
  }

  const subClearMatch = pathname.match(/^\/api\/exams\/([^/]+)\/submissions$/);
  if (subClearMatch && method === "DELETE") {
    if (!requireAdmin(req, res)) return true;
    const out = examStore.clearSubmissions(decodeURIComponent(subClearMatch[1]));
    if (out.error) return sendJson(res, 404, { code: 404, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, ...out }), true;
  }

  if (method === "DELETE" && pathname === "/api/admin/wrong-stats") {
    if (!requireAdmin(req, res)) return true;
    const out = userStore.deleteWrongStats({
      bankId: url.searchParams.get("bankId") || "",
      questionId: url.searchParams.get("questionId") || ""
    });
    return sendJson(res, 200, { code: 200, ...out }), true;
  }

  if (method === "POST" && pathname === "/api/admin/db/restore") {
    if (!requireAdmin(req, res)) return true;
    const body = await readBody(req);
    const out = restoreDatabaseFromBase64(ctx.dataDir, body?.base64, uploadsDir);
    if (out.error) return sendJson(res, 400, { code: 400, msg: out.error }), true;
    return sendJson(res, 200, { code: 200, ...out }), true;
  }
  return false;
};

export const handleAdminCrudRoutes = async (req, res, url, ctx) => {
  if (await handleUserCrud(req, res, url.pathname, ctx)) return true;
  return handleExamAndStatsCrud(req, res, url, ctx);
};

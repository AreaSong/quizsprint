import crypto from "node:crypto";

const ADMIN_COOKIE = "as_qb_session";
const USER_COOKIE = "as_qb_user";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const generatedSecret = crypto.randomBytes(32).toString("hex");
const generatedPassword = crypto.randomBytes(6).toString("base64url");

export const getAdminPassword = () => process.env.ADMIN_PASSWORD || generatedPassword;
export const isUsingGeneratedPassword = () => !process.env.ADMIN_PASSWORD;
const getSecret = () => process.env.AUTH_SECRET || generatedSecret;

const signPayload = (payloadB64) => crypto
  .createHmac("sha256", getSecret())
  .update(payloadB64)
  .digest("base64url");

const createToken = (data) => {
  const payload = { ...data, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${signPayload(payloadB64)}`;
};

const verifyToken = (token) => {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = signPayload(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return Number(payload.exp) > Date.now() ? payload : null;
  } catch {
    return null;
  }
};

export const createSessionToken = () => createToken({ role: "admin" });
export const createUserToken = (user) =>
  createToken({
    role: "user",
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    userRole: user.role || user.userRole || "student",
    tv: Number(user.tokenVersion ?? user.token_version ?? 1)
  });

const safeEqualStr = (a, b) => {
  const actualBuf = Buffer.from(String(a || ""), "utf8");
  const expectedBuf = Buffer.from(String(b || ""), "utf8");
  if (!expectedBuf.length || actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
};

export const verifyPassword = (input) => safeEqualStr(input, getAdminPassword());

const parseCookies = (cookieHeader) => {
  const result = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const rawVal = part.slice(idx + 1).trim();
    try {
      result[part.slice(0, idx).trim()] = decodeURIComponent(rawVal);
    } catch {
      result[part.slice(0, idx).trim()] = rawVal;
    }
  }
  return result;
};

export const getUserFromRequest = (req, userStore = null) => {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifyToken(cookies[USER_COOKIE]);
  if (payload?.role === "user" && payload.id) {
    if (userStore?.getUserById) {
      const dbUser = userStore.getUserById(payload.id);
      if (!dbUser || dbUser.disabled || Number(payload.tv || 1) !== Number(dbUser.tokenVersion || 1)) {
        return null;
      }
      return dbUser;
    }
    return {
      id: payload.id,
      username: payload.username,
      nickname: payload.nickname,
      userRole: payload.userRole || "student",
      tokenVersion: Number(payload.tv || 1)
    };
  }
  return null;
};

export const isAdminRequest = (req, expectedApiKey = "", userStore = null) => {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifyToken(cookies[ADMIN_COOKIE]);
  if (payload?.role === "admin") return true;
  if (getUserFromRequest(req, userStore)?.userRole === "admin") return true;
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  if (expectedApiKey && xApiKey && safeEqualStr(xApiKey, expectedApiKey)) return true;
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (verifyToken(bearer)?.role === "admin") return true;
    if (expectedApiKey && safeEqualStr(bearer, expectedApiKey)) return true;
  }
  return false;
};

const buildCookie = (name, value, maxAge, secure) => {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
};

export const buildSessionCookie = (token, secure = false) =>
  buildCookie(ADMIN_COOKIE, token, Math.floor(TOKEN_TTL_MS / 1000), secure);
export const buildClearSessionCookie = () => buildCookie(ADMIN_COOKIE, "", 0, false);

export const buildUserCookie = (token, secure = false) =>
  buildCookie(USER_COOKIE, token, Math.floor(TOKEN_TTL_MS / 1000), secure);
export const buildClearUserCookie = () => buildCookie(USER_COOKIE, "", 0, false);

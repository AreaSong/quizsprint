const LEGACY_CORS_PATHS = new Set(["/search", "/probe", "/questions", "/questions/import"]);
const RATE_LIMITED_PATHS = new Set(["/api/user/login", "/api/auth/login", "/api/user/register", "/api/setup", "/api/user/password"]);

export const getClientIp = (req) => {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || String(req.socket?.remoteAddress || "").trim();
  return ip.replace(/^::ffff:/, "") || "unknown";
};

export const applySecurityHeaders = (headers = {}) => ({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...headers
});

/** 为油猴脚本接口开放跨域，常规业务 API 按 CORS_ORIGIN 或同源策略收紧 */
export const resolveCorsHeaders = (req, pathname) => {
  const allowEnv = String(process.env.CORS_ORIGIN || "").trim();
  const isLegacy = LEGACY_CORS_PATHS.has(pathname) || pathname.startsWith("/questions");
  const origin = isLegacy ? "*" : allowEnv;
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Bank-Password, referer, u, t",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  };
};

/** 滑动窗口内存限流器，防护暴力破解与刷接口 */
export const createRateLimiter = ({
  max = Number(process.env.RATE_LIMIT_MAX || 25),
  windowMs = 5 * 60 * 1000
} = {}) => {
  const hits = new Map();
  return {
    check(key) {
      if (process.env.RATE_LIMIT_DISABLED === "1") return { allowed: true };
      const now = Date.now();
      const cutoff = now - windowMs;
      const prev = (hits.get(key) || []).filter((ts) => ts > cutoff);
      if (prev.length >= max) {
        hits.set(key, prev);
        const retryAfterSec = Math.max(1, Math.ceil((prev[0] + windowMs - now) / 1000));
        return { allowed: false, retryAfterSec };
      }
      prev.push(now);
      hits.set(key, prev);
      if (hits.size > 5000) {
        for (const [k, arr] of hits.entries()) {
          if (!arr.length || arr[arr.length - 1] <= cutoff) hits.delete(k);
        }
      }
      return { allowed: true };
    }
  };
};

export const isRateLimitedEndpoint = (method, pathname) =>
  method === "POST" && RATE_LIMITED_PATHS.has(pathname);

/** 精简结构化访问与异常日志（默认记录错误/慢请求/关键写操作） */
export const attachRequestLogger = (req, res, pathname) => {
  if (process.env.NODE_ENV === "test") return;
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode || 200;
    const method = req.method || "GET";
    const isImportant = status >= 400 || ms >= 800 || (method !== "GET" && method !== "OPTIONS");
    if (process.env.LOG_ALL === "1" || (isImportant && pathname !== "/health")) {
      console.log(`[http] ${new Date().toISOString()} ${getClientIp(req)} ${method} ${pathname} -> ${status} (${ms}ms)`);
    }
  });
};

export const registerGracefulShutdown = (server, onCleanup) => {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[system] 收到 ${signal}，正在安全刷盘并停止服务...`);
    server.close(() => {
      try { onCleanup?.(); } finally { process.exit(0); }
    });
    setTimeout(() => {
      try { onCleanup?.(); } finally { process.exit(0); }
    }, 3000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

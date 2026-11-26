import crypto from "node:crypto";
import net from "node:net";
import { getDb } from "./db.mjs";
import { getClientIp } from "./http-guard.mjs";

const MAX_LOGIN_ROWS = 2000;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Map();

export const parseUserAgent = (ua = "") => {
  const s = String(ua || "");
  if (!s) return "未知设备";
  let os = "其他系统";
  if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Linux/i.test(s)) os = "Linux";

  let browser = "浏览器";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) browser = "Safari";
  else if (/curl|node|python|Tampermonkey/i.test(s)) browser = "脚本/接口";
  return `${os} · ${browser}`;
};

export const classifyIpLocal = (rawIp = "") => {
  const ip = String(rawIp || "").trim().replace(/^::ffff:/, "");
  if (!ip || ip === "unknown") return "未知来源";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return "本机回环";
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "局域网 / 内网";
    if (a === 169 && b === 254) return "链路本地";
    return "";
  }
  const low = ip.toLowerCase();
  if (low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80:")) return "局域网 / 内网";
  return "";
};

const lookupGeoAsync = (dataDir, rowId, ip) => {
  if (process.env.NODE_ENV === "test" || process.env.IP_GEO_DISABLED === "1") return;
  const cached = geoCache.get(ip);
  if (cached && cached.exp > Date.now()) {
    try { getDb(dataDir).prepare("UPDATE login_logs SET location = ? WHERE id = ?").run(cached.loc, rowId); } catch { /* ignore */ }
    return;
  }
  fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,regionName,city,isp`, {
    signal: AbortSignal.timeout(2500)
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || d.status !== "success") return;
      const area = [d.country, d.regionName, d.city].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" ");
      const loc = d.isp ? `${area} · ${d.isp}` : (area || "公网 IP");
      if (geoCache.size >= 500) geoCache.clear();
      geoCache.set(ip, { loc: loc.slice(0, 80), exp: Date.now() + GEO_TTL_MS });
      getDb(dataDir).prepare("UPDATE login_logs SET location = ? WHERE id = ?").run(loc.slice(0, 80), rowId);
    })
    .catch(() => { /* 归属地超时静默降级 */ });
};

/** 记录用户登录成功/失败轨迹（含 IP、归属地与设备类型） */
export const recordLoginEvent = (dataDir, req, { userId = "", username = "", nickname = "", role = "student", status = "success", reason = "" } = {}) => {
  try {
    const ip = getClientIp(req);
    const ua = String(req?.headers?.["user-agent"] || "").slice(0, 240);
    const localLabel = classifyIpLocal(ip);
    const cached = !localLabel ? geoCache.get(ip) : null;
    const initLoc = localLabel || (cached && cached.exp > Date.now() ? cached.loc : "公网 IP");
    const id = `log_${crypto.randomUUID().slice(0, 8)}`;
    const db = getDb(dataDir);
    db.prepare(`
      INSERT INTO login_logs (id, user_id, username, nickname, role, ip, location, device, user_agent, status, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, String(userId || ""), String(username || "").slice(0, 64), String(nickname || "").slice(0, 64),
      String(role || "student"), ip, initLoc, parseUserAgent(ua), ua,
      status === "failed" ? "failed" : "success", String(reason || "").slice(0, 120),
      new Date().toISOString()
    );
    db.prepare("DELETE FROM login_logs WHERE id NOT IN (SELECT id FROM login_logs ORDER BY created_at DESC LIMIT ?)").run(MAX_LOGIN_ROWS);
    if (!localLabel && (!cached || cached.exp <= Date.now())) lookupGeoAsync(dataDir, id, ip);
  } catch { /* 登录日志失败不阻断登录 */ }
};

export const listLoginLogs = (dataDir, { limit = 100, keyword = "", status = "" } = {}) => {
  const db = getDb(dataDir);
  const clauses = ["1=1"];
  const params = [];
  if (status === "success" || status === "failed") {
    clauses.push("status = ?");
    params.push(status);
  }
  const kw = String(keyword || "").trim().toLowerCase();
  if (kw) {
    clauses.push("LOWER(username || ' ' || nickname || ' ' || ip || ' ' || location || ' ' || device) LIKE ?");
    params.push(`%${kw}%`);
  }
  const safeLimit = Math.min(500, Math.max(1, Number(limit || 100)));
  return db.prepare(`
    SELECT id, user_id AS userId, username, nickname, role, ip, location, device, status, reason, created_at AS createdAt
    FROM login_logs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?
  `).all(...params, safeLimit);
};

export const getLatestLoginByUserMap = (dataDir) => {
  const db = getDb(dataDir);
  const rows = db.prepare(`
    SELECT user_id AS userId, ip, location, device, created_at AS createdAt
    FROM login_logs WHERE user_id != '' AND status = 'success'
    ORDER BY created_at DESC LIMIT 1000
  `).all();
  const map = {};
  for (const r of rows) {
    if (!map[r.userId]) map[r.userId] = { ip: r.ip, location: r.location, device: r.device, createdAt: r.createdAt };
  }
  return map;
};

export const clearLoginLogs = (dataDir) => {
  const res = getDb(dataDir).prepare("DELETE FROM login_logs").run();
  return { ok: true, removed: Number(res.changes || 0) };
};

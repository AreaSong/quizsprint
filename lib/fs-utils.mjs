import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sanitizeId = (raw) => String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "");

export const writeJsonAtomic = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
};

export const readJsonSafe = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
};

const ALLOWED_IMAGE_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

export const saveDataUrlImage = (uploadsDir, dataUrl) => {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return { error: "仅支持 PNG/JPG/WEBP/GIF Base64 图片" };
  const ext = ALLOWED_IMAGE_EXT[match[1].toLowerCase()];
  if (!ext) return { error: "不支持的图片格式" };
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > 5 * 1024 * 1024) return { error: "单张图片不能超过 5MB" };
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  return { url: `/uploads/${filename}` };
};

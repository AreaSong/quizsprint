import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const readPackageVersion = () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
    return String(pkg.version || "1.1.0").trim() || "1.1.0";
  } catch {
    return "1.1.0";
  }
};

export const APP_VERSION = readPackageVersion();
export const DB_SCHEMA_VERSION = 3;

/** 读取 CHANGELOG.md 摘要供前端版本日志弹窗展示 */
export const readChangelogPreview = (repoDir = ROOT_DIR) => {
  const file = path.join(path.resolve(repoDir || ROOT_DIR), "CHANGELOG.md");
  if (!fs.existsSync(file)) return "";
  try {
    return fs.readFileSync(file, "utf8").slice(0, 6000);
  } catch {
    return "";
  }
};

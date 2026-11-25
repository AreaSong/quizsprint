import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30000;

const runCmd = async (cmd, args, cwd) => {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024
  });
  return `${stdout || ""}${stderr || ""}`.trim();
};

const runGit = (args, cwd) => runCmd("git", args, cwd);

const sha256File = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
};

export const getSystemStatus = async (repoDir) => {
  const base = {
    isGitRepo: false,
    branch: "",
    commit: "",
    shortCommit: "",
    commitMessage: "",
    commitDate: "",
    dirty: false,
    dirtyFiles: [],
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime())
  };

  if (!fs.existsSync(path.join(repoDir, ".git"))) return base;
  try {
    const [branch, logLine, statusText] = await Promise.all([
      runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoDir),
      runGit(["log", "-1", "--format=%H%x09%h%x09%s%x09%cI"], repoDir),
      runGit(["status", "--porcelain", "--untracked-files=no"], repoDir)
    ]);
    const [commit = "", shortCommit = "", commitMessage = "", commitDate = ""] = logLine.split("\t");
    const dirtyFiles = statusText ? statusText.split(/\r?\n/).filter(Boolean) : [];
    return {
      ...base,
      isGitRepo: true,
      branch,
      commit,
      shortCommit,
      commitMessage,
      commitDate,
      dirty: dirtyFiles.length > 0,
      dirtyFiles
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "读取 Git 状态失败" };
  }
};

export const checkRemoteUpdate = async (repoDir) => {
  const status = await getSystemStatus(repoDir);
  if (!status.isGitRepo) {
    return { ...status, behindCount: 0, commits: [], msg: "当前运行目录不是 Git 仓库（如 Docker 镜像构建）" };
  }
  await runGit(["fetch", "--quiet"], repoDir);
  let upstream = "";
  try {
    upstream = await runGit(["rev-parse", "--abbrev-ref", "@{u}"], repoDir);
  } catch {
    return { ...status, behindCount: 0, commits: [], msg: "当前分支未关联远端上游分支" };
  }
  const logRaw = await runGit(["log", `HEAD..${upstream}`, "--format=%h%x09%s%x09%cI", "-n", "20"], repoDir);
  const commits = logRaw
    ? logRaw.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash = "", message = "", date = ""] = line.split("\t");
        return { hash, message, date };
      })
    : [];
  const countStr = await runGit(["rev-list", "--count", `HEAD..${upstream}`], repoDir);
  return { ...status, upstream, behindCount: Number(countStr || commits.length), commits };
};

export const pullRemoteUpdate = async (repoDir) => {
  const status = await getSystemStatus(repoDir);
  if (!status.isGitRepo) return { error: "当前目录不是 Git 仓库，无法执行在线拉取" };
  if (status.dirty) {
    return { error: `服务器存在未提交的本地修改（${status.dirtyFiles.length} 个文件），已拒绝拉取以防冲突` };
  }

  const lockFile = path.join(repoDir, "package-lock.json");
  const lockBefore = sha256File(lockFile);
  const output = await runGit(["pull", "--ff-only"], repoDir);
  const lockAfter = sha256File(lockFile);

  let depsInstalled = false;
  if (lockAfter && lockBefore !== lockAfter) {
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    await runCmd(npmBin, ["install", "--omit=dev"], repoDir);
    depsInstalled = true;
  }

  const nextStatus = await getSystemStatus(repoDir);
  return {
    ok: true,
    beforeCommit: status.shortCommit,
    afterCommit: nextStatus.shortCommit,
    updated: status.commit !== nextStatus.commit,
    depsInstalled,
    output: output || "Already up to date.",
    status: nextStatus
  };
};

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRemoteUpdate,
  getUpdateProbeSnapshot,
  pullRemoteUpdate,
  startUpdateProbeScheduler
} from "./lib/system-updater.mjs";

const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString("utf8").trim();

test("自动更新探测调度器可静默发现远端新提交并在拉取后自动清零", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qs-probe-"));
  const remoteDir = path.join(root, "remote.git");
  const writerDir = path.join(root, "writer");
  const serverDir = path.join(root, "server");

  try {
    git(root, ["init", "--bare", remoteDir]);
    git(root, ["clone", remoteDir, writerDir]);
    git(writerDir, ["config", "user.email", "test@example.com"]);
    git(writerDir, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(writerDir, "README.md"), "v1\n");
    git(writerDir, ["add", "README.md"]);
    git(writerDir, ["commit", "-m", "initial commit"]);
    git(writerDir, ["push", "-u", "origin", "HEAD"]);

    git(root, ["clone", remoteDir, serverDir]);
    git(serverDir, ["config", "user.email", "test@example.com"]);
    git(serverDir, ["config", "user.name", "Test"]);

    const initialSnap = getUpdateProbeSnapshot(serverDir);
    assert.equal(initialSnap.enabled, true);
    assert.equal(initialSnap.checkedAt, "");
    assert.equal(initialSnap.behindCount, 0);

    // 远端新增 1 个提交
    fs.writeFileSync(path.join(writerDir, "README.md"), "v2\n");
    git(writerDir, ["add", "README.md"]);
    git(writerDir, ["commit", "-m", "feat: auto probe target"]);
    git(writerDir, ["push"]);

    const stop = startUpdateProbeScheduler(serverDir, { intervalMinutes: 5, initialDelayMs: 20 });
    try {
      let snap = getUpdateProbeSnapshot(serverDir);
      for (let i = 0; i < 30 && !snap.checkedAt; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
        snap = getUpdateProbeSnapshot(serverDir);
      }
      assert.ok(snap.checkedAt, "应当完成首次自动探测");
      assert.equal(snap.behindCount, 1);
      assert.equal(snap.commits.length, 1);
      assert.equal(snap.commits[0].message, "feat: auto probe target");
      assert.equal(snap.error, "");
    } finally {
      stop();
    }

    const pulled = await pullRemoteUpdate(serverDir);
    assert.equal(pulled.updated, true);
    const afterPull = getUpdateProbeSnapshot(serverDir);
    assert.equal(afterPull.behindCount, 0);
    assert.deepEqual(afterPull.commits, []);

    const manual = await checkRemoteUpdate(serverDir);
    assert.equal(manual.behindCount, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

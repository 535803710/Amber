import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { run } from "../scripts/cli/commands/project.mjs";
import { runAmberCli } from "../scripts/cli/main.mjs";
import {
  getEnvLocalPath,
  getProjectsFilePath,
  normalizeGitRemote,
  readProjectsStore,
  readScanRootsFromEnv
} from "../scripts/lib/projects.mjs";

const REAL_PROJECTS_FILE = resolve(import.meta.dirname, "../.local/projects.json");
const REAL_PROJECTS_BEFORE = existsSync(REAL_PROJECTS_FILE)
  ? readFileSync(REAL_PROJECTS_FILE)
  : null;

test("HTTPS 与 SSH remote 规范化成同一 project_key", () => {
  const httpsKey = normalizeGitRemote("https://github.com/Acme/App.git");
  const sshKey = normalizeGitRemote("git@github.com:Acme/App.git");
  const sshUrlKey = normalizeGitRemote("ssh://git@github.com/Acme/App.git/");
  assert.equal(httpsKey, "github.com/acme/app");
  assert.equal(sshKey, "github.com/acme/app");
  assert.equal(sshUrlKey, "github.com/acme/app");
  assert.equal(normalizeGitRemote("https://github.com/Acme/App.git/"), "github.com/acme/app");
});

test("有 remote 时 add 不需要 --key，SSH/HTTPS 视为同一项目", async () => {
  const { targetRoot, repoA, repoB, cleanup } = fixture();
  try {
    const added = await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      io: gitIo({ remote: "https://github.com/Acme/App.git", toplevel: repoA })
    }));
    assert.equal(added.status, "ok");
    assert.equal(added.code, "project_added");
    assert.equal(added.data.project.project_key, "github.com/acme/app");
    assert.equal(added.data.project.name, basename(repoA));
    assert.ok(samePath(added.data.project.path, repoA));

    const relocated = await run(request({
      targetRoot,
      cwd: repoB,
      subcommand: "add",
      args: [repoB],
      io: gitIo({ remote: "git@github.com:Acme/App.git", toplevel: repoB })
    }));
    assert.equal(relocated.status, "ok");
    assert.equal(relocated.code, "project_added");

    const listed = await run(request({ targetRoot, subcommand: "list" }));
    assert.equal(listed.status, "ok");
    assert.equal(listed.code, "project_list");
    assert.equal(listed.data.projects.length, 1);
    assert.equal(listed.data.projects[0].project_key, "github.com/acme/app");
    assert.ok(samePath(listed.data.projects[0].path, repoB));
    assert.equal(readProjectsStore(targetRoot).schemaVersion, 1);
  } finally {
    cleanup();
  }
});

test("无 remote 且无 --key 时返回 needs_action / project_key_required", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    const result = await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      io: gitIo({ remote: "" })
    }));
    assert.equal(result.status, "needs_action");
    assert.equal(result.code, "project_key_required");
    assert.ok(result.actions.some((item) => item.includes("--key")));
    assert.equal(readProjectsStore(targetRoot).projects.length, 0);
  } finally {
    cleanup();
  }
});

test("--key 始终覆盖自动推导的 Git remote", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    const result = await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      extras: { key: "team/custom-app" },
      io: gitIo({ remote: "https://github.com/Acme/App.git", toplevel: repoA })
    }));
    assert.equal(result.status, "ok");
    assert.equal(result.data.project.project_key, "team/custom-app");
    assert.equal(result.data.project.remote, "https://github.com/Acme/App.git");
  } finally {
    cleanup();
  }
});

test("重复 add 同一 project_key 幂等，不产生重复项", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    const io = gitIo({ remote: "https://github.com/Acme/App.git", toplevel: repoA });
    const first = await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      io
    }));
    const second = await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      io
    }));
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    assert.equal(second.data.project.addedAt, first.data.project.addedAt);

    const listed = await run(request({ targetRoot, subcommand: "list" }));
    assert.equal(listed.data.projects.length, 1);
    assert.equal(scanRoots(targetRoot).filter((item) => samePath(item, repoA)).length, 1);
  } finally {
    cleanup();
  }
});

test("remove 后 list 为空，并更新 COMMIT_RECORD_SCAN_ROOTS", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      extras: { key: "local/demo" },
      io: gitIo()
    }));
    assert.equal(scanRoots(targetRoot).some((item) => samePath(item, repoA)), true);

    const removed = await run(request({
      targetRoot,
      subcommand: "remove",
      args: [repoA]
    }));
    assert.equal(removed.status, "ok");
    assert.equal(removed.code, "project_removed");

    const listed = await run(request({ targetRoot, subcommand: "list" }));
    assert.equal(listed.status, "ok");
    assert.equal(listed.code, "project_list");
    assert.deepEqual(listed.data.projects, []);
    assert.equal(scanRoots(targetRoot).some((item) => samePath(item, repoA)), false);
  } finally {
    cleanup();
  }
});

test("remove 不删除用户其它 COMMIT_RECORD_SCAN_ROOTS", async () => {
  const { targetRoot, repoA, extraRoot, cleanup } = fixture();
  try {
    writeFileSync(
      getEnvLocalPath(targetRoot),
      [
        "# keep-comment",
        "FOO=bar",
        `# COMMIT_RECORD_SCAN_ROOTS=D:/example`,
        `COMMIT_RECORD_SCAN_ROOTS=${extraRoot.replaceAll("\\", "/")}`,
        "OTHER=1",
        ""
      ].join("\n"),
      "utf8"
    );

    await run(request({
      targetRoot,
      cwd: repoA,
      subcommand: "add",
      args: [repoA],
      extras: { key: "local/demo" },
      io: gitIo()
    }));
    let roots = scanRoots(targetRoot);
    assert.equal(roots.some((item) => samePath(item, extraRoot)), true);
    assert.equal(roots.some((item) => samePath(item, repoA)), true);

    await run(request({
      targetRoot,
      subcommand: "remove",
      args: ["local/demo"]
    }));

    const envText = readFileSync(getEnvLocalPath(targetRoot), "utf8");
    assert.match(envText, /# keep-comment/);
    assert.match(envText, /^FOO=bar$/m);
    assert.match(envText, /^OTHER=1$/m);
    assert.match(envText, /# COMMIT_RECORD_SCAN_ROOTS=D:\/example/);
    roots = scanRoots(targetRoot);
    assert.equal(roots.some((item) => samePath(item, extraRoot)), true);
    assert.equal(roots.some((item) => samePath(item, repoA)), false);
    assert.equal(roots.length, 1);
  } finally {
    cleanup();
  }
});

test("路径不是目录时优先 failed / project_path_missing", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    const missing = await run(request({
      targetRoot,
      subcommand: "add",
      args: [resolve(repoA, "no-such-dir")]
    }));
    assert.equal(missing.status, "failed");
    assert.equal(missing.code, "project_path_missing");

    const filePath = resolve(repoA, "file.txt");
    writeFileSync(filePath, "not a dir\n", "utf8");
    const asFile = await run(request({
      targetRoot,
      subcommand: "add",
      args: [filePath],
      extras: { key: "should-not-matter" }
    }));
    assert.equal(asFile.status, "failed");
    assert.equal(asFile.code, "project_path_missing");
  } finally {
    cleanup();
  }
});

test("同一 path 不同 key 返回 project_path_conflict，规范化差异则幂等", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    await run(request({
      targetRoot,
      subcommand: "add",
      args: [repoA],
      extras: { key: "github.com/Acme/App.git" },
      io: gitIo({ remote: "git@github.com:Acme/App.git", toplevel: repoA })
    }));

    const normalized = await run(request({
      targetRoot,
      subcommand: "add",
      args: [repoA],
      extras: { key: "https://github.com/Acme/App.git" },
      io: gitIo({ remote: "https://github.com/Acme/App.git", toplevel: repoA })
    }));
    assert.equal(normalized.status, "ok");
    assert.equal(readProjectsStore(targetRoot).projects.length, 1);
    assert.equal(readProjectsStore(targetRoot).projects[0].project_key, "github.com/acme/app");

    const conflict = await run(request({
      targetRoot,
      subcommand: "add",
      args: [repoA],
      extras: { key: "other/app" },
      io: gitIo({ remote: "https://github.com/Acme/App.git", toplevel: repoA })
    }));
    assert.equal(conflict.status, "failed");
    assert.equal(conflict.code, "project_path_conflict");
    assert.equal(readProjectsStore(targetRoot).projects.length, 1);
  } finally {
    cleanup();
  }
});

test("非法 key、未知子命令和未找到项目返回对应错误码", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    const invalid = await run(request({
      targetRoot,
      subcommand: "add",
      args: [repoA],
      extras: { key: "???" },
      io: gitIo()
    }));
    assert.equal(invalid.status, "failed");
    assert.equal(invalid.code, "invalid_project_key");

    const unknown = await run(request({
      targetRoot,
      subcommand: "sync"
    }));
    assert.equal(unknown.status, "failed");
    assert.equal(unknown.code, "unknown_subcommand");

    const missing = await run(request({
      targetRoot,
      subcommand: "remove",
      args: ["no-such-project"]
    }));
    assert.equal(missing.status, "failed");
    assert.equal(missing.code, "project_not_found");
  } finally {
    cleanup();
  }
});

test("真实 git origin 可通过 CLI 路由器注册，且不写入仓库真实 .local", async () => {
  const { targetRoot, repoA, cleanup } = fixture();
  try {
    git(repoA, ["init"]);
    git(repoA, ["remote", "add", "origin", "https://github.com/Acme/App.git"]);

    const { result, exitCode } = await runAmberCli(
      ["project", "add", repoA, "--json", "--target", targetRoot],
      { stdout: { write() {} }, cwd: repoA }
    );
    assert.equal(result.status, "ok");
    assert.equal(result.code, "project_added");
    assert.equal(result.data.project.project_key, "github.com/acme/app");
    assert.equal(exitCode, 0);

    const listed = await runAmberCli(
      ["project", "list", "--json", "--target", targetRoot],
      { stdout: { write() {} }, cwd: targetRoot }
    );
    assert.equal(listed.result.code, "project_list");
    assert.equal(listed.result.data.projects.length, 1);
    assert.equal(existsSync(getProjectsFilePath(targetRoot)), true);
    assertRealLocalUntouched();
  } finally {
    cleanup();
    assertRealLocalUntouched();
  }
});

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "amber-projects-"));
  const targetRoot = resolve(root, "amber-home");
  const repoA = resolve(root, "repo-a");
  const repoB = resolve(root, "repo-b");
  const extraRoot = resolve(root, "manual-scan");
  mkdirSync(targetRoot);
  mkdirSync(repoA);
  mkdirSync(repoB);
  mkdirSync(extraRoot);
  return {
    root,
    targetRoot,
    repoA,
    repoB,
    extraRoot,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function request({ targetRoot, cwd, subcommand, args = [], extras = {}, io }) {
  return {
    command: "project",
    subcommand,
    rest: [subcommand, ...args].filter(Boolean),
    args,
    positional: ["project", subcommand, ...args].filter(Boolean),
    flags: {},
    extras,
    env: {},
    cwd: cwd || targetRoot,
    targetRoot,
    userHome: targetRoot,
    io
  };
}

function gitIo({ remote = "", toplevel } = {}) {
  return {
    runGit(repo, args) {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") {
        return toplevel || remote
          ? { ok: true, stdout: toplevel || repo }
          : { ok: false, stdout: "" };
      }
      if (command === "remote get-url origin") {
        return remote
          ? { ok: true, stdout: remote }
          : { ok: false, stdout: "" };
      }
      return { ok: false, stdout: "" };
    },
    now: () => "2026-09-04T09:00:00.000Z"
  };
}

function scanRoots(targetRoot) {
  return readScanRootsFromEnv(targetRoot);
}

function samePath(left, right) {
  const normalize = (value) => resolve(String(value)).replace(/[\\/]+$/, "").replaceAll("\\", "/");
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
}

function assertRealLocalUntouched() {
  if (REAL_PROJECTS_BEFORE === null) {
    assert.equal(existsSync(REAL_PROJECTS_FILE), false);
    return;
  }
  const after = readFileSync(REAL_PROJECTS_FILE);
  assert.equal(Buffer.compare(after, REAL_PROJECTS_BEFORE), 0);
  const current = statSync(REAL_PROJECTS_FILE);
  assert.ok(current);
}

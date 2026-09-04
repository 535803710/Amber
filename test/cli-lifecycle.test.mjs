import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { run as runInstall } from "../scripts/cli/commands/install.mjs";
import { run as runOpen } from "../scripts/cli/commands/open.mjs";
import { run as runDoctor } from "../scripts/cli/commands/doctor.mjs";
import { run as runStatus } from "../scripts/cli/commands/status.mjs";
import { run as runUninstall } from "../scripts/cli/commands/uninstall.mjs";
import { run as runUpdate } from "../scripts/cli/commands/update.mjs";
import { run as runRollback } from "../scripts/cli/commands/rollback.mjs";
import { inspectAmberSkill } from "../scripts/lib/skill-install.mjs";
import { inspectStartMenuShortcut, START_MENU_SHORTCUT_NAME } from "../scripts/lib/start-menu.mjs";

test("全新安装创建空 Base/Webhook 配置，不写默认 token", async () => {
  const root = fixture();
  try {
    const result = await runInstall(installRequest(root));
    assert.equal(result.status, "needs_action");
    assert.equal(result.code, "webhook_setup_required");
    const envLocal = readFileSync(resolve(root.target, ".env.local"), "utf8");
    assert.match(envLocal, /^AMBER_BASE_TOKEN=$/m);
    assert.match(envLocal, /^FEISHU_CHANGE_WEBHOOK_URL=$/m);
    assert.match(envLocal, /^FEISHU_COMMIT_WEBHOOK_URL=$/m);
    assert.doesNotMatch(envLocal, /Inmhb4Vl0alBIAsvzaxcxC0Ln0d/);
    assert.ok(inspectAmberSkill({ userHome: root.home }).installed);
    assert.equal(inspectStartMenuShortcut({
      userHome: root.home,
      platform: "win32",
      startMenuDir: root.startMenuDir
    }).installed, true);
    const shortcut = readFileSync(resolve(root.startMenuDir, START_MENU_SHORTCUT_NAME), "utf8");
    assert.match(shortcut, /amber\.bat/i);
    assert.match(shortcut, /\bopen\b/);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("重复安装幂等并保留已有 .env.local", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    const persisted = [
      "AMBER_BASE_TOKEN=keep-token",
      "FEISHU_CHANGE_WEBHOOK_URL=https://example.test/change",
      ""
    ].join("\n");
    writeFileSync(resolve(root.target, ".env.local"), persisted, "utf8");
    const result = await runInstall(installRequest(root));
    assert.equal(result.status, "needs_action");
    assert.equal(readFileSync(resolve(root.target, ".env.local"), "utf8"), persisted);
    assert.doesNotMatch(result.message, /keep-token/);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("卸载保留用户数据并移除 skill 与快捷方式", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    writeText(resolve(root.target, ".local/queue.json"), "preserve\n");
    writeText(resolve(root.home, ".agents/skills/other/SKILL.md"), "# keep\n");
    const result = await runUninstall(installRequest(root, {
      flags: { skipSystem: true }
    }));
    assert.equal(result.status, "ok");
    assert.equal(result.code, "uninstalled");
    assert.ok(existsSync(resolve(root.target, ".env.local")));
    assert.equal(readFileSync(resolve(root.target, ".local/queue.json"), "utf8"), "preserve\n");
    assert.equal(inspectAmberSkill({ userHome: root.home }).installed, false);
    assert.equal(existsSync(resolve(root.home, ".agents/skills/other/SKILL.md")), true);
    assert.equal(inspectStartMenuShortcut({
      userHome: root.home,
      platform: "win32",
      startMenuDir: root.startMenuDir
    }).installed, false);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("非 Windows 安装返回 windows_only", async () => {
  const result = await runInstall({
    platform: "linux",
    flags: { skipSystem: true, skipOpen: true, skipSpace: true },
    targetRoot: resolve(tmpdir(), "amber-should-not-exist"),
    userHome: resolve(tmpdir(), "amber-should-not-exist-home")
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "windows_only");
});

test("Dashboard open 按需启动", async () => {
  let running = false;
  let startCount = 0;
  const opened = [];
  const result = await runOpen({
    targetRoot: resolve(tmpdir(), "amber-open"),
    env: { AMBER_DASHBOARD_PORT: "3847" },
    probe: async () => running,
    startDashboard: async () => {
      startCount += 1;
      running = true;
    },
    openBrowser: async (url) => {
      opened.push(url);
    },
    sleep: async () => {},
    retries: 3,
    delayMs: 0
  });
  assert.equal(result.status, "ok");
  assert.equal(result.code, "opened");
  assert.equal(result.data.started, true);
  assert.equal(startCount, 1);
  assert.deepEqual(opened, ["http://127.0.0.1:3847"]);
});

test("Dashboard 已运行则不重复启动", async () => {
  let startCount = 0;
  const result = await runOpen({
    env: { PORT: "3901" },
    probe: async () => true,
    startDashboard: async () => {
      startCount += 1;
    },
    openBrowser: async () => {}
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data.started, false);
  assert.equal(startCount, 0);
  assert.equal(result.data.url, "http://127.0.0.1:3901");
});

test("Dashboard 启动失败返回 dashboard_unhealthy", async () => {
  let opened = 0;
  const result = await runOpen({
    env: { PORT: "3999" },
    probe: async () => false,
    startDashboard: async () => {},
    openBrowser: async () => {
      opened += 1;
    },
    sleep: async () => {},
    retries: 2,
    delayMs: 0
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "dashboard_unhealthy");
  assert.equal(opened, 0);
});

test("doctor 缺 webhook 返回 needs_action，路径脱敏且不输出 token", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    writeFileSync(
      resolve(root.target, ".env.local"),
      "AMBER_BASE_TOKEN=secret-token\nFEISHU_CHANGE_WEBHOOK_TOKEN=hook-secret\n",
      "utf8"
    );
    const result = await runDoctor(installRequest(root, {
      flags: { skipLive: true, skipSystem: true },
      extraChecks: [{
        id: "path_probe",
        label: "路径",
        status: "pass",
        detail: `${root.home} and ${root.target}`
      }]
    }));
    assert.equal(result.status, "needs_action");
    assert.equal(result.code, "webhook_setup_required");
    assert.ok(result.data.checks.some((item) => item.id === "ai_webhook" && item.status === "warn"));
    const payload = JSON.stringify(result);
    assert.doesNotMatch(payload, /secret-token/);
    assert.doesNotMatch(payload, /hook-secret/);
    const pathCheck = result.data.checks.find((item) => item.id === "path_probe");
    assert.match(pathCheck.detail, /<user-home>/);
    assert.match(pathCheck.detail, /<amber-root>/);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("status 缺空间返回 needs_action", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    const result = await runStatus(installRequest(root, {
      getWatcherStatus: () => ({ running: false, healthRunning: false })
    }));
    assert.equal(result.status, "needs_action");
    assert.equal(result.code, "space_missing");
    assert.equal(result.data.runtimeInstalled, true);
    assert.equal(result.data.spaceReady, false);
    assert.equal(result.data.projectCount, 0);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("update 成功切换版本", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    writeRuntime(root.target, "1.0.0", "v1");
    const next = resolve(root.base, "next");
    writeRuntime(next, "1.1.0", "v2");
    const result = await runUpdate(installRequest(root, {
      extras: { source: next, version: "1.1.0" },
      stopRuntime: async () => ({ stopped: true }),
      startRuntime: async () => ({ started: true }),
      doctor: async () => ({ status: "ok", code: "healthy" })
    }));
    assert.equal(result.status, "ok");
    assert.equal(result.code, "updated");
    assert.equal(readFileSync(resolve(root.target, "scripts/marker.txt"), "utf8"), "v2");
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("update 健康检查失败后自动回滚", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    writeRuntime(root.target, "1.0.0", "v1");
    const next = resolve(root.base, "next");
    writeRuntime(next, "1.1.0", "v2");
    const result = await runUpdate(installRequest(root, {
      extras: { source: next, version: "1.1.0" },
      stopRuntime: async () => ({ stopped: true }),
      startRuntime: async () => ({ started: true }),
      doctor: async () => ({ status: "failed", code: "doctor_failed" })
    }));
    assert.equal(result.status, "failed");
    assert.equal(result.code, "update_health_failed");
    assert.equal(readFileSync(resolve(root.target, "scripts/marker.txt"), "utf8"), "v1");
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("update 未提供 source 时返回 update_source_required", async () => {
  const result = await runUpdate({
    extras: {},
    args: [],
    rest: [],
    cwd: tmpdir(),
    targetRoot: resolve(tmpdir(), "amber-update-missing"),
    flags: {}
  });
  assert.equal(result.status, "needs_action");
  assert.equal(result.code, "update_source_required");
});

test("rollback 恢复上一版本", async () => {
  const root = fixture();
  try {
    await runInstall(installRequest(root));
    writeRuntime(root.target, "1.0.0", "v1");
    const next = resolve(root.base, "next");
    writeRuntime(next, "1.1.0", "v2");
    await runUpdate(installRequest(root, {
      extras: { source: next, version: "1.1.0" },
      stopRuntime: async () => ({}),
      startRuntime: async () => ({}),
      doctor: async () => ({ status: "ok", code: "healthy" })
    }));
    const result = await runRollback(installRequest(root, {
      stopRuntime: async () => ({}),
      startRuntime: async () => ({})
    }));
    assert.equal(result.status, "ok");
    assert.equal(result.code, "rolled_back");
    assert.equal(readFileSync(resolve(root.target, "scripts/marker.txt"), "utf8"), "v1");
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

function fixture() {
  const base = mkdtempSync(resolve(tmpdir(), "amber-cli-life-"));
  const source = resolve(base, "source");
  const target = resolve(base, "target");
  const home = resolve(base, "home");
  const startMenuDir = resolve(base, "start-menu");
  writeText(resolve(source, "scripts/mcp-stdio-server.mjs"), "export {}\n");
  writeText(resolve(source, "package.json"), `${JSON.stringify({ version: "1.0.0" })}\n`);
  writeText(resolve(source, "amber.bat"), "@echo off\r\n");
  writeText(resolve(source, "skills/amber/SKILL.md"), "# Amber\n");
  writeText(resolve(source, "skills/amber/references/onboarding.md"), "hello\n");
  return { base, source, target, home, startMenuDir };
}

function installRequest(root, extra = {}) {
  const {
    flags,
    extras,
    args,
    rest,
    env,
    platform,
    installSystem,
    uninstallSystem,
    openDashboard,
    ...restExtra
  } = extra;
  return {
    flags: { skipSystem: true, skipOpen: true, skipSpace: true, skipLive: true, ...flags },
    extras: extras || {},
    args: args || [],
    rest: rest || [],
    targetRoot: root.target,
    userHome: root.home,
    env: env || {},
    cwd: root.base,
    sourceRoot: root.source,
    platform: platform || "win32",
    startMenuDir: root.startMenuDir,
    installSystem: installSystem || (async () => ({ skipped: true })),
    uninstallSystem: uninstallSystem || (async () => ({ skipped: true })),
    openDashboard: openDashboard || (async () => ({ skipped: true })),
    ...restExtra
  };
}

function writeRuntime(root, version, marker) {
  mkdirSync(resolve(root, "scripts"), { recursive: true });
  writeFileSync(resolve(root, "scripts/mcp-stdio-server.mjs"), `export const version = "${version}";\n`);
  writeFileSync(resolve(root, "scripts/marker.txt"), marker);
  writeFileSync(resolve(root, "package.json"), `${JSON.stringify({ version })}\n`);
}

function writeText(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}

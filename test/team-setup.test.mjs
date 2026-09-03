import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  inspectTeamSetup,
  installTeamSetup,
  mergeCodexToml,
  resolveUninstallSystemPlan,
  uninstallTeamSetup
} from "../scripts/lib/team-setup.mjs";

test("团队安装保留现有配置并同时接入 Cursor 和 Codex", () => {
  const root = fixture();
  try {
    const { source, target, home } = root;
    writeJson(resolve(home, ".cursor/hooks.json"), {
      version: 1,
      hooks: { stop: [{ command: "node C:/tools/keep-cursor-hook.mjs" }] }
    });
    writeJson(resolve(home, ".cursor/mcp.json"), {
      mcpServers: { codegraph: { command: "codegraph" } }
    });
    writeJson(resolve(home, ".codex/hooks.json"), {
      hooks: { Stop: [{ matcher: "keep", hooks: [{ type: "command", command: "keep-codex-hook" }] }] }
    });
    writeText(resolve(home, ".codex/config.toml"), [
      "model = \"gpt-test\"",
      "",
      "[mcp_servers.keep]",
      "command = \"keep\"",
      ""
    ].join("\r\n"));
    const persistedConfig = "FEISHU_CHANGE_WEBHOOK_URL=https://example.test/change\n";
    writeText(resolve(target, ".env.local"), persistedConfig);

    const nodeExecutable = "C:/Program Files/nodejs/node.exe";
    const result = installTeamSetup({
      sourceRoot: source,
      targetRoot: target,
      userHome: home,
      nodeExecutable
    });
    assert.equal(result.changedFiles.length, 4);
    assert.ok(result.backupDir);
    assert.ok(existsSync(resolve(target, ".env.local")));
    assert.equal(readFileSync(resolve(target, ".env.local"), "utf8"), persistedConfig);
    assert.ok(existsSync(resolve(target, "scripts/mcp-stdio-server.mjs")));

    const cursorHooks = readJson(resolve(home, ".cursor/hooks.json"));
    assert.equal(cursorHooks.hooks.stop[0].command, "node C:/tools/keep-cursor-hook.mjs");
    assert.equal(cursorHooks.hooks.stop.filter((item) => item.command.includes("on-change-event.mjs")).length, 1);
    assert.match(cursorHooks.hooks.beforeSubmitPrompt[0].command, /^node /);
    const cursorMcp = readJson(resolve(home, ".cursor/mcp.json"));
    assert.equal(cursorMcp.mcpServers.codegraph.command, "codegraph");
    assert.equal(cursorMcp.mcpServers.amber.command, "C:\\Program Files\\nodejs\\node.exe");

    const codexHooks = readJson(resolve(home, ".codex/hooks.json"));
    assert.equal(codexHooks.hooks.Stop[0].matcher, "keep");
    assert.equal(JSON.stringify(codexHooks).match(/on-change-event\.mjs/g)?.length, 2);
    assert.match(codexHooks.hooks.UserPromptSubmit.at(-1).hooks[0].command, /^node /);
    const codexToml = readFileSync(resolve(home, ".codex/config.toml"), "utf8");
    assert.match(codexToml, /\[mcp_servers\.keep\]/);
    assert.match(codexToml, /\[mcp_servers\.amber\]/);
    assert.match(codexToml, /command = "C:\\\\Program Files\\\\nodejs\\\\node\.exe"/);
    assert.deepEqual(inspectTeamSetup({ targetRoot: target, userHome: home }), {
      runtime: true,
      envLocal: true,
      cursorHooks: true,
      cursorMcp: true,
      codexHooks: true,
      codexMcp: true
    });

    const rerun = installTeamSetup({
      sourceRoot: source,
      targetRoot: target,
      userHome: home,
      nodeExecutable
    });
    assert.deepEqual(rerun.changedFiles, []);
    assert.equal(readFileSync(resolve(target, ".env.local"), "utf8"), persistedConfig);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("团队卸载只移除 Amber 项并保留数据和其他工具配置", () => {
  const root = fixture();
  try {
    const { source, target, home } = root;
    writeJson(resolve(home, ".cursor/mcp.json"), { mcpServers: { keep: { command: "keep" } } });
    writeText(resolve(home, ".codex/config.toml"), "[mcp_servers.keep]\ncommand = \"keep\"\n");
    installTeamSetup({ sourceRoot: source, targetRoot: target, userHome: home });
    writeText(resolve(target, ".local/queue.json"), "preserve\n");

    uninstallTeamSetup({ targetRoot: target, userHome: home });
    const cursorMcp = readJson(resolve(home, ".cursor/mcp.json"));
    assert.equal(cursorMcp.mcpServers.keep.command, "keep");
    assert.equal(cursorMcp.mcpServers.amber, undefined);
    assert.doesNotMatch(readFileSync(resolve(home, ".codex/config.toml"), "utf8"), /mcp_servers\.amber/);
    assert.match(readFileSync(resolve(home, ".codex/config.toml"), "utf8"), /mcp_servers\.keep/);
    assert.equal(readFileSync(resolve(target, ".local/queue.json"), "utf8"), "preserve\n");
    assert.ok(existsSync(resolve(target, ".env.local")));
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("损坏的 IDE JSON 会在写入任何用户配置前停止安装", () => {
  const root = fixture();
  try {
    const { source, target, home } = root;
    const cursorHooks = resolve(home, ".cursor/hooks.json");
    const codexToml = resolve(home, ".codex/config.toml");
    writeText(cursorHooks, "{ broken");
    writeText(codexToml, "model = \"keep\"\n");
    assert.throws(
      () => installTeamSetup({ sourceRoot: source, targetRoot: target, userHome: home }),
      /JSON 无法解析/
    );
    assert.equal(readFileSync(cursorHooks, "utf8"), "{ broken");
    assert.equal(readFileSync(codexToml, "utf8"), "model = \"keep\"\n");
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("Codex MCP 合并会替换旧 Amber 段并保持单例", () => {
  const input = [
    "[mcp_servers.amber]",
    "command = \"old\"",
    "",
    "[mcp_servers.amber.env]",
    "OLD_TOKEN = \"remove\"",
    "",
    "[mcp_servers.keep]",
    "command = \"keep\"",
    "",
    "[mcp_servers.amber]",
    "command = \"duplicate\"",
    ""
  ].join("\n");
  const output = mergeCodexToml(input, "C:/Users/test/AppData/Local/Amber");
  assert.equal(output.match(/\[mcp_servers\.amber\]/g)?.length, 1);
  assert.match(output, /mcp-stdio-server\.mjs/);
  assert.match(output, /\[mcp_servers\.keep\]/);
  assert.doesNotMatch(output, /OLD_TOKEN/);
});

test("Codex MCP 合并保留带注释表头和数组表", () => {
  const input = [
    "[mcp_servers.amber]",
    "command = \"old\"",
    "",
    "[mcp_servers.keep] # keep this server",
    "command = \"keep\"",
    "",
    "[mcp_servers.amber.env]",
    "OLD_TOKEN = \"remove\"",
    "",
    "[[profiles]] # keep this array table",
    "name = \"team\"",
    ""
  ].join("\n");
  const output = mergeCodexToml(input, "C:/Users/test/AppData/Local/Amber");
  assert.match(output, /\[mcp_servers\.keep\] # keep this server/);
  assert.match(output, /command = \"keep\"/);
  assert.match(output, /\[\[profiles\]\] # keep this array table/);
  assert.match(output, /name = \"team\"/);
  assert.doesNotMatch(output, /OLD_TOKEN/);
});

test("未安装过 Amber 时执行卸载不会创建 IDE 配置", () => {
  const root = fixture();
  try {
    uninstallTeamSetup({ targetRoot: root.target, userHome: root.home });
    assert.equal(existsSync(resolve(root.home, ".cursor/hooks.json")), false);
    assert.equal(existsSync(resolve(root.home, ".cursor/mcp.json")), false);
    assert.equal(existsSync(resolve(root.home, ".codex/hooks.json")), false);
    assert.equal(existsSync(resolve(root.home, ".codex/config.toml")), false);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("卸载系统计划在自启动脚本缺失时仍清理 AMBER_HOME", () => {
  assert.deepEqual(resolveUninstallSystemPlan({
    skipSystem: false,
    autostartScriptExists: false
  }), {
    uninstallAutostart: false,
    clearAmberHome: true
  });
  assert.deepEqual(resolveUninstallSystemPlan({
    skipSystem: true,
    autostartScriptExists: true
  }), {
    uninstallAutostart: false,
    clearAmberHome: false
  });
});

test("Windows 入口使用对应 Shell 的安全路径语法", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const amberBatch = readFileSync(resolve(repositoryRoot, "amber.bat"), "utf8");
  const installBatch = readFileSync(resolve(repositoryRoot, "install.bat"), "utf8");
  const uninstallBatch = readFileSync(resolve(repositoryRoot, "uninstall.bat"), "utf8");
  const askRule = readFileSync(resolve(repositoryRoot, ".cursor/rules/amber-askquestion.mdc"), "utf8");
  assert.match(amberBatch, /--target "%ROOT%\."/);
  assert.match(amberBatch, /scripts\\resolve-node\.ps1/);
  assert.match(amberBatch, /amber\.bat config\s+Open Dashboard configuration/);
  assert.match(installBatch, /scripts\\resolve-node\.ps1/);
  assert.match(uninstallBatch, /scripts\\resolve-node\.ps1/);
  assert.match(uninstallBatch, /uninstall --target "%~dp0\."/);
  assert.match(askRule, /node "\$env:AMBER_HOME\/scripts\/notify-ask\.mjs"/);
  assert.doesNotMatch(askRule, /%AMBER_HOME%/);
});

test("解压目录中的 amber.bat 委托给已安装的 AMBER_HOME", { skip: process.platform !== "win32" }, () => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-entry-redirect-"));
  const sourceRoot = resolve(base, "download folder", "Amber");
  const installedRoot = resolve(base, "installed folder", "Amber");
  const marker = resolve(base, "redirected.txt");
  const repositoryRoot = resolve(import.meta.dirname, "..");
  try {
    writeText(
      resolve(sourceRoot, "amber.bat"),
      readFileSync(resolve(repositoryRoot, "amber.bat"), "utf8")
    );
    writeText(
      resolve(installedRoot, "amber.bat"),
      "@echo off\r\n> \"%AMBER_TEST_MARKER%\" echo redirected %*\r\nexit /b 0\r\n"
    );

    const sourceBatch = resolve(sourceRoot, "amber.bat");
    const result = spawnSync(
      "cmd.exe",
      ["/d", "/s", "/c", `call "${sourceBatch}" status`],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          AMBER_HOME: installedRoot,
          AMBER_TEST_MARKER: marker
        },
        windowsVerbatimArguments: true
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readFileSync(marker, "utf8").trim(), "redirected status");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("Windows 后台启动保留含空格的脚本路径", { skip: process.platform !== "win32" }, () => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-background-path-"));
  const target = resolve(base, "Amber runtime with spaces");
  const scripts = resolve(target, "scripts");
  const watchMarker = resolve(base, "watch.json");
  const healthMarker = resolve(base, "health.json");
  const repositoryRoot = resolve(import.meta.dirname, "..");
  try {
    writeText(
      resolve(scripts, "start-watch-background.ps1"),
      readFileSync(resolve(repositoryRoot, "scripts/start-watch-background.ps1"), "utf8")
    );
    writeText(resolve(scripts, "resolve-node.ps1"), "Write-Output $env:AMBER_TEST_NODE\r\n");
    writeText(
      resolve(scripts, "watch-all.mjs"),
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.AMBER_WATCH_MARKER, JSON.stringify(process.argv.slice(2)));\n"
    );
    writeText(
      resolve(scripts, "health-monitor-worker.mjs"),
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.AMBER_HEALTH_MARKER, JSON.stringify(process.argv.slice(2)));\n"
    );

    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve(scripts, "start-watch-background.ps1"),
      "-Profile",
      "core"
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        AMBER_TEST_NODE: process.execPath,
        AMBER_WATCH_MARKER: watchMarker,
        AMBER_HEALTH_MARKER: healthMarker
      }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    waitForFiles([watchMarker, healthMarker]);
    assert.deepEqual(JSON.parse(readFileSync(watchMarker, "utf8")), ["--profile", "core"]);
    assert.deepEqual(JSON.parse(readFileSync(healthMarker, "utf8")), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("doctor 将无法解析的飞书 CLI 报告为检查失败", () => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-team-doctor-"));
  const target = resolve(base, "installed Amber");
  const home = resolve(base, "team user");
  const cliShim = resolve(base, "broken lark-cli.cmd");
  const script = resolve(import.meta.dirname, "../scripts/team-setup.mjs");
  try {
    writeText(cliShim, "@echo off\r\nexit /b 1\r\n");
    writeText(
      resolve(target, ".env.local"),
      `AMBER_LARK_CLI_PATH=${cliShim.replaceAll("\\", "/")}\n`
    );
    const doctor = spawnSync(process.execPath, [
      script,
      "doctor",
      "--target",
      target,
      "--user-home",
      home
    ], { encoding: "utf8" });
    assert.equal(doctor.status, 1);
    assert.match(doctor.stdout, /\[FAIL\] 飞书登录：AMBER_LARK_CLI_PATH 无法解析到 Node 入口/);
    assert.doesNotMatch(doctor.stderr, /Amber 团队安装失败/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("团队安装 CLI 可以在隔离用户目录完成安装、诊断和卸载", () => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-team-cli-"));
  const target = resolve(base, "installed Amber");
  const home = resolve(base, "team user");
  const script = resolve(import.meta.dirname, "../scripts/team-setup.mjs");
  const common = ["--target", target, "--user-home", home, "--skip-system", "--skip-live", "--skip-open"];
  try {
    const install = spawnSync(process.execPath, [script, "install", ...common], { encoding: "utf8" });
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const doctor = spawnSync(process.execPath, [script, "doctor", ...common], { encoding: "utf8" });
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    const jsonDoctor = spawnSync(process.execPath, [script, "doctor", ...common, "--json"], { encoding: "utf8" });
    assert.equal(jsonDoctor.status, 0, jsonDoctor.stderr || jsonDoctor.stdout);
    const report = JSON.parse(jsonDoctor.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.profile, "core");
    assert.equal(report.status, "warn");
    assert.equal(report.checks.some((item) => item.id === "node_runtime" && item.status === "pass"), true);
    assert.doesNotMatch(jsonDoctor.stdout, /FEISHU_CHANGE_WEBHOOK_TOKEN/);
    assert.doesNotMatch(jsonDoctor.stdout, new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    const uninstall = spawnSync(process.execPath, [script, "uninstall", ...common], { encoding: "utf8" });
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
    assert.ok(existsSync(resolve(target, ".env.local")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("Windows Node resolver can use the current machine runtime", { skip: process.platform !== "win32" }, () => {
  const resolver = resolve(import.meta.dirname, "../scripts/resolve-node.ps1");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolver
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /node\.exe$/i);
});

function fixture() {
  const base = mkdtempSync(resolve(tmpdir(), "amber-team-setup-"));
  const source = resolve(base, "source");
  const target = resolve(base, "target with spaces");
  const home = resolve(base, "用户 home");
  mkdirSync(resolve(source, "scripts"), { recursive: true });
  writeText(resolve(source, "scripts/mcp-stdio-server.mjs"), "// fixture\n");
  writeText(resolve(source, "package.json"), "{}\n");
  writeText(resolve(source, "install.bat"), "@echo off\r\n");
  writeText(resolve(source, "uninstall.bat"), "@echo off\r\n");
  return { base, source, target, home };
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeText(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function waitForFiles(paths, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && paths.some((path) => !existsSync(path))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

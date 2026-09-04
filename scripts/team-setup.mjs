#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectLarkDoctorChecks,
  collectTeamSetupChecks,
  installTeamSetup,
  readDesiredProfile,
  readPackageVersion,
  redactDiagnosticPaths,
  resolveUninstallSystemPlan,
  uninstallTeamSetup
} from "./lib/team-setup.mjs";
import { getWatcherStatus } from "./lib/watcher-control.mjs";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGET = resolve(process.env.LOCALAPPDATA || SOURCE_ROOT, "Amber");

main().catch((error) => {
  console.error(`Amber 团队安装失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertWindows();
  assertNodeVersion();
  if (args.command === "install") {
    await install(args);
    return;
  }
  if (args.command === "uninstall") {
    uninstall(args);
    return;
  }
  if (args.command === "doctor") {
    const report = doctor(args, { live: !args.skipLive });
    if (report.status === "fail") process.exitCode = 1;
    return;
  }
  printHelp();
  process.exitCode = 1;
}

async function install(args) {
  const result = installTeamSetup({
    sourceRoot: SOURCE_ROOT,
    targetRoot: args.target,
    userHome: args.userHome
  });
  if (!args.skipSystem) {
    setUserAmberHome(args.target);
    runPowerShell(resolve(args.target, "scripts/install-autostart.ps1"), ["-StartNow"]);
  }
  console.log(`Amber 已安装到：${result.targetRoot}`);
  if (result.backupDir) console.log(`IDE 配置备份：${result.backupDir}`);
  const report = doctor(args, { live: !args.skipLive });
  console.log("下一步：在本地控制台填写 AI/Git Webhook，并保存实际 Git 扫描目录。");
  if (!args.skipOpen) openDashboard(args.target);
  if (report.status === "fail") process.exitCode = 1;
}

function uninstall(args) {
  const result = uninstallTeamSetup({ targetRoot: args.target, userHome: args.userHome });
  const autostartScript = resolve(args.target, "scripts/install-autostart.ps1");
  const systemPlan = resolveUninstallSystemPlan({
    skipSystem: args.skipSystem,
    autostartScriptExists: existsSync(autostartScript)
  });
  if (systemPlan.uninstallAutostart) runPowerShell(autostartScript, ["-Uninstall"]);
  if (systemPlan.clearAmberHome) clearUserAmberHome();
  console.log("Amber 已从 Cursor 和 Codex 配置中移除。");
  if (result.backupDir) console.log(`卸载前配置备份：${result.backupDir}`);
  console.log(`本地配置和队列仍保留在：${args.target}`);
}

function doctor(args, { live }) {
  const { checks: baseChecks } = collectTeamSetupChecks({
    targetRoot: args.target,
    userHome: args.userHome,
    env: process.env,
    skipSystem: args.skipSystem,
    watcher: getWatcherStatus(args.target)
  });
  const checks = live ? [...baseChecks, ...collectLarkDoctorChecks(args.target, process.env)] : baseChecks;
  const status = checks.some((item) => item.status === "fail")
    ? "fail"
    : checks.some((item) => item.status === "warn") ? "warn" : "pass";
  const reportChecks = args.json
    ? checks.map((item) => ({
        ...item,
        detail: redactDiagnosticPaths(item.detail, { userHome: args.userHome, targetRoot: args.target })
      }))
    : checks;
  const report = {
    schemaVersion: 1,
    version: readPackageVersion(args.target),
    checkedAt: new Date().toISOString(),
    profile: readDesiredProfile(args.target),
    status,
    checks: reportChecks
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  for (const item of checks) {
    const marker = item.status === "pass" ? "OK" : item.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${item.label}${item.detail ? `：${item.detail}` : ""}`);
  }
  return report;
}

function setUserAmberHome(targetRoot) {
  runPowerShellCommand("[Environment]::SetEnvironmentVariable('AMBER_HOME',$env:AMBER_SETUP_VALUE,'User')", targetRoot);
}

function clearUserAmberHome() {
  runPowerShellCommand("[Environment]::SetEnvironmentVariable('AMBER_HOME',$null,'User')", "");
}

function runPowerShell(script, extraArgs) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...extraArgs], {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error || result.status !== 0) throw new Error(`PowerShell 执行失败：${script}`);
}

function runPowerShellCommand(command, value) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    env: { ...process.env, AMBER_SETUP_VALUE: value },
    windowsHide: true
  });
  if (result.error || result.status !== 0) throw new Error("无法更新用户级 AMBER_HOME 环境变量。");
}

function openDashboard(targetRoot) {
  const child = spawn("cmd.exe", ["/c", resolve(targetRoot, "amber.bat"), "open"], {
    cwd: targetRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

function parseArgs(argv) {
  const command = argv[0] || "help";
  const value = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : argv[index + 1] || fallback;
  };
  return {
    command,
    target: resolve(value("--target", DEFAULT_TARGET)),
    userHome: resolve(value("--user-home", homedir())),
    skipLive: argv.includes("--skip-live"),
    skipOpen: argv.includes("--skip-open"),
    skipSystem: argv.includes("--skip-system"),
    json: argv.includes("--json")
  };
}

function assertWindows() {
  if (process.platform !== "win32") throw new Error("当前团队安装器仅支持 Windows。");
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major < 22) throw new Error(`需要 Node.js 22 或更高版本，当前为 ${process.version}。`);
}

function printHelp() {
  console.log(`
Amber 团队安装

  node scripts/team-setup.mjs install
  node scripts/team-setup.mjs doctor
  node scripts/team-setup.mjs uninstall

选项：
  --target <path>      安装目录，默认 %LOCALAPPDATA%\\Amber
  --skip-live         跳过飞书登录和 Base 权限检查
  --skip-open         安装后不打开本地控制台
  --skip-system       跳过用户环境变量和开机自启动
  --json              doctor 输出脱敏 JSON 报告
`);
}

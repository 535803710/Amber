#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectTeamSetup,
  installTeamSetup,
  resolveUninstallSystemPlan,
  uninstallTeamSetup
} from "./lib/team-setup.mjs";
import { resolveLarkCliInvocation } from "./lib/task-context/lark-source.mjs";
import { resolveTaskContextSource } from "./lib/task-context/constants.mjs";

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
    const ok = doctor(args, { live: !args.skipLive });
    if (!ok) process.exitCode = 1;
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
  const ok = doctor(args, { live: !args.skipLive });
  console.log("下一步：在本地控制台填写 AI/Git Webhook，并保存实际 Git 扫描目录。");
  if (!args.skipOpen) openDashboard(args.target);
  if (!ok) process.exitCode = 1;
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
  const snapshot = inspectTeamSetup({ targetRoot: args.target, userHome: args.userHome });
  const checks = [
    check("运行文件", snapshot.runtime),
    check("本地配置", snapshot.envLocal),
    check("Cursor Hook", snapshot.cursorHooks),
    check("Cursor MCP", snapshot.cursorMcp),
    check("Codex Hook", snapshot.codexHooks),
    check("Codex MCP", snapshot.codexMcp)
  ];
  if (live) checks.push(...larkChecks(args.target));
  for (const item of checks) console.log(`${item.ok ? "[OK]" : "[FAIL]"} ${item.label}${item.detail ? `：${item.detail}` : ""}`);
  return checks.every((item) => item.ok);
}

function larkChecks(targetRoot) {
  const env = { ...process.env, ...readEnvFile(resolve(targetRoot, ".env.local")) };
  const source = resolveTaskContextSource(env);
  const auth = runLark(["auth", "status", "--json", "--verify"], env);
  if (!auth.ok) return [check("飞书登录", false, auth.message)];
  const authJson = parseJsonOutput(auth.stdout);
  const verified = authJson?.verified === true || authJson?.data?.verified === true || authJson?.ok === true;
  const checks = [check("飞书登录", verified, verified ? "用户身份有效" : "登录状态未通过验证")];
  for (const [label, tableId] of [["AI 记录表", source.aiTableId], ["Git 记录表", source.commitTableId]]) {
    if (!source.baseToken || !tableId) {
      checks.push(check(label, false, "Base 配置缺失"));
      continue;
    }
    const probe = runLark([
      "base", "+record-list",
      "--base-token", source.baseToken,
      "--table-id", tableId,
      "--limit", "1",
      "--as", "user",
      "--format", "json"
    ], env);
    checks.push(check(label, probe.ok, probe.ok ? "可读取" : probe.message));
  }
  return checks;
}

function runLark(args, env) {
  let invocation;
  try {
    invocation = resolveLarkCliInvocation(args, { env });
  } catch (error) {
    return { ok: false, message: sanitize(error?.message || error) };
  }
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: {
      ...env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
    },
    windowsHide: true,
    timeout: 15_000
  });
  if (result.error) return { ok: false, message: sanitize(result.error.message) };
  if (result.status !== 0) return { ok: false, message: sanitize(result.stderr || `退出码 ${result.status}`) };
  return { ok: true, stdout: result.stdout };
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

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  return result;
}

function parseJsonOutput(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
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
    skipSystem: argv.includes("--skip-system")
  };
}

function assertWindows() {
  if (process.platform !== "win32") throw new Error("当前团队安装器仅支持 Windows。");
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major < 22) throw new Error(`需要 Node.js 22 或更高版本，当前为 ${process.version}。`);
}

function check(label, ok, detail = "") {
  return { label, ok: Boolean(ok), detail };
}

function sanitize(value) {
  return String(value || "")
    .replace(/(?:token|authorization|bearer)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
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
`);
}

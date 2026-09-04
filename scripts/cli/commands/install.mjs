import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installAmberSkill } from "../../lib/skill-install.mjs";
import { installStartMenuShortcut } from "../../lib/start-menu.mjs";
import { inspectLocalSpace, installTeamSetup } from "../../lib/team-setup.mjs";

export async function run(request = {}) {
  const {
    flags = {},
    targetRoot,
    userHome,
    env = process.env
  } = request;
  const platform = request.platform || process.platform;
  if (platform !== "win32") {
    return {
      status: "failed",
      code: "windows_only",
      message: "当前 Amber CLI 仅支持 Windows。",
      actions: [],
      data: { platform }
    };
  }

  const sourceRoot = resolve(request.sourceRoot || defaultSourceRoot());
  let setup;
  try {
    setup = (request.installTeamSetup || installTeamSetup)({
      sourceRoot,
      targetRoot,
      userHome,
      nodeExecutable: request.nodeExecutable || process.execPath
    });
  } catch (error) {
    return {
      status: "failed",
      code: String(error.message || "").includes("JSON") ? "ide_config_invalid" : "install_failed",
      message: error.message || "安装失败。",
      actions: ["检查 Cursor/Codex 配置 JSON 后重试"],
      data: {}
    };
  }

  const skill = (request.installAmberSkill || installAmberSkill)({ sourceRoot, userHome });
  const startMenu = (request.installStartMenuShortcut || installStartMenuShortcut)({
    targetRoot,
    userHome,
    platform,
    startMenuDir: request.startMenuDir,
    io: request.io
  });

  if (!flags.skipSystem) {
    await (request.installSystem || defaultInstallSystem)(targetRoot);
  }

  if (!flags.skipOpen) {
    await (request.openDashboard || defaultOpenDashboard)(targetRoot);
  }

  const installData = {
    targetRoot: setup.targetRoot,
    backupDir: setup.backupDir,
    skill,
    startMenu
  };

  if (!flags.skipSpace) {
    const spaceResult = await readSpaceStatus(request);
    if (spaceResult && spaceResult.status !== "ok") {
      return {
        status: "needs_action",
        code: spaceResult.code || "webhook_setup_required",
        message: spaceResult.message || "Amber 已安装，请继续配置飞书空间。",
        actions: Array.isArray(spaceResult.actions) && spaceResult.actions.length
          ? spaceResult.actions
          : ["运行 amber space init"],
        data: { ...installData, space: spaceResult.data || {} }
      };
    }
    if (spaceResult?.status === "ok") {
      return {
        status: "ok",
        code: "installed",
        message: "Amber 已安装。",
        actions: [],
        data: { ...installData, space: spaceResult.data || {} }
      };
    }
  }

  const space = inspectLocalSpace(targetRoot, env);
  if (!space.ready) {
    return {
      status: "needs_action",
      code: "webhook_setup_required",
      message: "Amber 已安装，请继续配置飞书空间和 Webhook。",
      actions: ["运行 amber space init"],
      data: { ...installData, space }
    };
  }

  return {
    status: "ok",
    code: "installed",
    message: "Amber 已安装。",
    actions: [],
    data: { ...installData, space }
  };
}

export function defaultSourceRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

async function readSpaceStatus(request) {
  if (typeof request.spaceStatus === "function") return request.spaceStatus(request);
  const space = await optionalImport(new URL("./space.mjs", import.meta.url).href);
  if (typeof space?.run !== "function") return null;
  return space.run({ ...request, command: "space", subcommand: "status" });
}

function defaultInstallSystem(targetRoot) {
  setUserAmberHome(targetRoot);
  const script = resolve(targetRoot, "scripts/install-autostart.ps1");
  if (!existsSync(script)) return;
  runPowerShell(script, ["-StartNow"]);
}

function defaultOpenDashboard(targetRoot) {
  const child = spawn("cmd.exe", ["/c", resolve(targetRoot, "amber.bat"), "open"], {
    cwd: targetRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

function setUserAmberHome(targetRoot) {
  runPowerShellCommand("[Environment]::SetEnvironmentVariable('AMBER_HOME',$env:AMBER_SETUP_VALUE,'User')", targetRoot);
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

async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

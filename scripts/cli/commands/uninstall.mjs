import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { uninstallAmberSkill } from "../../lib/skill-install.mjs";
import { uninstallStartMenuShortcut } from "../../lib/start-menu.mjs";
import { resolveUninstallSystemPlan, uninstallTeamSetup } from "../../lib/team-setup.mjs";

export async function run(request = {}) {
  const {
    flags = {},
    targetRoot,
    userHome
  } = request;
  const setup = (request.uninstallTeamSetup || uninstallTeamSetup)({ targetRoot, userHome });
  const skill = (request.uninstallAmberSkill || uninstallAmberSkill)({ userHome });
  const startMenu = (request.uninstallStartMenuShortcut || uninstallStartMenuShortcut)({
    userHome,
    platform: request.platform || process.platform,
    startMenuDir: request.startMenuDir,
    io: request.io
  });

  if (!flags.skipSystem) {
    await (request.uninstallSystem || defaultUninstallSystem)(targetRoot);
  }

  return {
    status: "ok",
    code: "uninstalled",
    message: "Amber 已卸载，本地配置和队列已保留。",
    actions: [],
    data: {
      preserved: setup.preserved,
      skill,
      startMenu
    }
  };
}

function defaultUninstallSystem(targetRoot) {
  const autostartScript = resolve(targetRoot, "scripts/install-autostart.ps1");
  const systemPlan = resolveUninstallSystemPlan({
    skipSystem: false,
    autostartScriptExists: existsSync(autostartScript)
  });
  if (systemPlan.uninstallAutostart) {
    spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", autostartScript, "-Uninstall"], {
      encoding: "utf8",
      stdio: "inherit",
      windowsHide: true
    });
  }
  if (systemPlan.clearAmberHome) {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::SetEnvironmentVariable('AMBER_HOME',$null,'User')"], {
      encoding: "utf8",
      windowsHide: true
    });
  }
}

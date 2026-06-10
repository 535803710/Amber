import { spawn } from "node:child_process";

/** Windows 下 spawn 子进程时隐藏控制台窗口 */
export function spawnHidden(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    shell: false,
    windowsHide: true
  });
}

export function runHiddenCommand(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawnHidden(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code !== 0) {
        rejectRun(new Error(stderr.trim() || `${command} exited with code ${code}`));
        return;
      }

      resolveRun(stdout.trim());
    });
  });
}

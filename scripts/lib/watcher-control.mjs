import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STACK_SCRIPT = resolve(SCRIPT_DIR, "../start-watch-stack.mjs");
const WINDOWS_BACKGROUND_SCRIPT = resolve(SCRIPT_DIR, "../start-watch-background.ps1");

export function getWatcherPaths(rootDir = process.cwd()) {
  const localDir = resolve(rootDir, ".local");
  return {
    pidFile: resolve(localDir, "watch-all.pid"),
    healthPidFile: resolve(localDir, "health-monitor.pid"),
    desiredFile: resolve(localDir, "runtime-desired.json"),
    logFile: resolve(localDir, "watch-all.log")
  };
}

export function getWatcherStatus(rootDir = process.cwd()) {
  const { pidFile, healthPidFile, logFile } = getWatcherPaths(rootDir);

  const pid = Number.parseInt(readFileSafe(pidFile).trim(), 10);
  const pidFilePresent = existsSync(pidFile);
  const alive = isProcessAlive(pid);
  const healthPid = Number.parseInt(readFileSafe(healthPidFile).trim(), 10);
  const healthRunning = Number.isFinite(healthPid) && healthPid > 0 && isProcessAlive(healthPid);
  return {
    running: alive,
    pid: alive ? pid : null,
    healthRunning,
    healthPid: healthRunning ? healthPid : null,
    logFile,
    stalePidFile: pidFilePresent && !alive
  };
}

export function startWatcher(rootDir = process.cwd()) {
  const status = getWatcherStatus(rootDir);
  if (status.running && status.healthRunning) {
    return { ok: true, alreadyRunning: true, pid: status.pid };
  }

  if (status.stalePidFile) {
    unlinkIfExists(getWatcherPaths(rootDir).pidFile);
  }

  const { logFile } = getWatcherPaths(rootDir);
  mkdirSync(dirname(logFile), { recursive: true });
  const { command, args } = resolveWatcherStartCommand(process.platform);
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  child.unref();
  appendLog(logFile, `started stack launcher pid=${child.pid}`);

  return { ok: true, pid: child.pid, starting: true };
}

export function resolveWatcherStartCommand(platform = process.platform) {
  return platform === "win32"
    ? {
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WINDOWS_BACKGROUND_SCRIPT]
      }
    : { command: process.execPath, args: [STACK_SCRIPT, "--background"] };
}

export function stopWatcher(rootDir = process.cwd()) {
  const status = getWatcherStatus(rootDir);
  const { pidFile, healthPidFile, desiredFile, logFile } = getWatcherPaths(rootDir);

  writeDesiredState(desiredFile, false);

  if (!status.running && !status.healthRunning) {
    cleanupPidFile(rootDir);
    return { ok: true, alreadyStopped: true };
  }

  for (const pid of [status.pid, status.healthPid]) {
    if (pid) {
      killProcessTree(pid);
      appendLog(logFile, `stopped pid=${pid}`);
    }
  }
  unlinkIfExists(pidFile);
  unlinkIfExists(healthPidFile);

  return { ok: true, pid: status.pid };
}

export function readLogTail(rootDir = process.cwd(), lines = 40) {
  const { logFile } = getWatcherPaths(rootDir);
  if (!existsSync(logFile)) {
    return [];
  }

  const content = readFileSync(logFile, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lines);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function writeDesiredState(filePath, running) {
  mkdirSync(dirname(filePath), { recursive: true });
  let current = {};
  try {
    current = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    // Start from an empty runtime state.
  }
  writeFileSync(filePath, `${JSON.stringify({ ...current, running, changedAt: new Date().toISOString(), consecutiveMisses: 0 }, null, 2)}\n`, "utf8");
}

function unlinkIfExists(filePath) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function killProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // 进程可能已退出
  }
}

function cleanupPidFile(rootDir) {
  const { pidFile, healthPidFile } = getWatcherPaths(rootDir);
  unlinkIfExists(pidFile);
  unlinkIfExists(healthPidFile);
}

function appendLog(logFile, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  writeFileSync(logFile, line, { flag: "a" });
}

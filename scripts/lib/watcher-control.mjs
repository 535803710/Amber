import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WATCH_SCRIPT = resolve(SCRIPT_DIR, "../watch-notifications.mjs");

export function getWatcherPaths(rootDir = process.cwd()) {
  const localDir = resolve(rootDir, ".local");
  return {
    pidFile: resolve(localDir, "watch-toast.pid"),
    logFile: resolve(localDir, "watch-toast.log")
  };
}

export function getWatcherStatus(rootDir = process.cwd()) {
  const { pidFile, logFile } = getWatcherPaths(rootDir);

  if (!existsSync(pidFile)) {
    return { running: false, pid: null, logFile };
  }

  const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { running: false, pid: null, logFile, stalePidFile: true };
  }

  const alive = isProcessAlive(pid);
  if (!alive) {
    return { running: false, pid: null, logFile, stalePidFile: true };
  }

  return { running: true, pid, logFile };
}

export function startWatcher(rootDir = process.cwd()) {
  const status = getWatcherStatus(rootDir);
  if (status.running) {
    return { ok: true, alreadyRunning: true, pid: status.pid };
  }

  if (status.stalePidFile) {
    cleanupPidFile(rootDir);
  }

  const { pidFile, logFile } = getWatcherPaths(rootDir);
  mkdirSync(dirname(logFile), { recursive: true });
  mkdirSync(dirname(pidFile), { recursive: true });

  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [WATCH_SCRIPT], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    shell: false,
    windowsHide: true
  });

  child.unref();
  writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  appendLog(logFile, `started pid=${child.pid}`);

  return { ok: true, pid: child.pid };
}

export function stopWatcher(rootDir = process.cwd()) {
  const status = getWatcherStatus(rootDir);
  const { pidFile, logFile } = getWatcherPaths(rootDir);

  if (!status.running) {
    cleanupPidFile(rootDir);
    return { ok: true, alreadyStopped: true };
  }

  killProcessTree(status.pid);
  appendLog(logFile, `stopped pid=${status.pid}`);
  cleanupPidFile(rootDir);

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
  const { pidFile } = getWatcherPaths(rootDir);
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
}

function appendLog(logFile, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  writeFileSync(logFile, line, { flag: "a" });
}

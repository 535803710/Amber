import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STACK_SCRIPT = resolve(SCRIPT_DIR, "../start-watch-stack.mjs");
const WINDOWS_BACKGROUND_SCRIPT = resolve(SCRIPT_DIR, "../start-watch-background.ps1");
let startInFlight = null;

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

export function startWatcher(rootDir = process.cwd(), options = {}) {
  if (startInFlight) {
    return startInFlight;
  }

  const operation = startWatcherOnce(rootDir, options);
  startInFlight = operation;
  operation.then(clearStartInFlight, clearStartInFlight);
  return operation;
}

async function startWatcherOnce(rootDir, options) {
  const getStatus = options.getStatus || (() => getWatcherStatus(rootDir));
  const status = getStatus();
  if (status.running && status.healthRunning) {
    return { ok: true, alreadyRunning: true, pid: status.pid };
  }

  if (status.stalePidFile) {
    unlinkIfExists(getWatcherPaths(rootDir).pidFile);
  }

  const { logFile } = getWatcherPaths(rootDir);
  mkdirSync(dirname(logFile), { recursive: true });
  const { command, args } = resolveWatcherStartCommand(options.platform || process.platform);
  appendLog(logFile, "starting stack launcher");

  let launcher;
  try {
    launcher = options.launchWatcher
      ? options.launchWatcher(command, args)
      : runLauncher(command, args, {
          rootDir,
          spawnProcess: options.spawnProcess || spawn
        });
    const finalStatus = await Promise.race([
      waitForWatcherStart({
        getStatus,
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs
      }),
      launcher.failure
    ]);
    launcher.stop();
    appendLog(logFile, `stack launcher completed pid=${launcher.pid}`);
    return { ok: true, pid: finalStatus.pid, started: true, status: finalStatus };
  } catch (error) {
    launcher?.stop();
    appendLog(logFile, `stack launcher failed: ${String(error?.message || error).slice(0, 500)}`);
    throw error;
  }
}

function runLauncher(command, args, { rootDir, spawnProcess }) {
  const child = spawnProcess(command, args, {
    cwd: rootDir,
    detached: false,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
    windowsHide: true
  });
  let stderr = "";
  let closed = false;
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  const failure = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      closed = true;
      if (code === 0 && !signal) return;
      const detail = stderr.trim() || (signal ? `signal ${signal}` : `exit code ${code}`);
      reject(new Error(`监听服务启动脚本失败：${detail.slice(0, 500)}`));
    });
  });
  return {
    pid: child.pid,
    failure,
    stop: () => {
      if (!closed) child.kill();
    }
  };
}

export function resolveWatcherStartCommand(platform = process.platform) {
  return platform === "win32"
    ? {
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WINDOWS_BACKGROUND_SCRIPT]
      }
    : { command: process.execPath, args: [STACK_SCRIPT, "--background"] };
}

export async function waitForWatcherStart({
  getStatus,
  timeoutMs = 10_000,
  pollIntervalMs = 100,
  sleep = delay
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = getStatus();
    if (status.running && status.healthRunning) {
      return status;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error("监听服务启动后未进入运行状态，请查看 .local/start-watch.log。");
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

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function clearStartInFlight() {
  startInFlight = null;
}

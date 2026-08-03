#!/usr/bin/env node

import { existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WATCH_ALL = resolve(ROOT, "scripts/watch-all.mjs");
const HEALTH_MONITOR = resolve(ROOT, "scripts/health-monitor-worker.mjs");
const WINDOWS_BACKGROUND_SCRIPT = resolve(ROOT, "scripts/start-watch-background.ps1");
const LOCAL_DIR = resolve(ROOT, ".local");
const WATCH_PID = resolve(LOCAL_DIR, "watch-all.pid");
const HEALTH_PID = resolve(LOCAL_DIR, "health-monitor.pid");
const DESIRED_FILE = resolve(LOCAL_DIR, "runtime-desired.json");

main();

function main() {
  const background = process.argv.includes("--background");
  if (background && process.platform === "win32") {
    const launcher = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WINDOWS_BACKGROUND_SCRIPT],
      { cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true }
    );
    launcher.unref();
    console.log("Amber watch stack start requested");
    return;
  }

  writeRuntimeDesired(true);
  mkdirSync(LOCAL_DIR, { recursive: true });

  if (background) {
    if (!isPidAlive(WATCH_PID)) {
      startDetached("watch-all", WATCH_ALL, resolve(LOCAL_DIR, "watch-all.log"));
    }
    if (!isPidAlive(HEALTH_PID)) {
      startDetached("health-monitor", HEALTH_MONITOR, resolve(LOCAL_DIR, "health-monitor.log"));
    }
    console.log("Amber watch stack started in background");
    return;
  }

  const health = startDetached("health-monitor", HEALTH_MONITOR, resolve(LOCAL_DIR, "health-monitor.log"));
  const watcher = spawn(process.execPath, [WATCH_ALL], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true
  });
  writeFileSync(WATCH_PID, `${watcher.pid}\n`, "utf8");
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    writeRuntimeDesired(false);
    watcher.kill();
    health.kill();
    removePid();
  };

  process.on("SIGINT", () => {
    stop();
    process.exitCode = 0;
  });
  process.on("SIGTERM", () => {
    stop();
    process.exitCode = 0;
  });
  watcher.once("error", (error) => {
    console.error(`watch:all 启动失败：${error.message}`);
    process.exitCode = 1;
  });
  watcher.once("exit", (code, signal) => {
    removePid();
    if (!stopping) {
      console.error(`watch:all 异常退出：${signal || code}`);
      process.exitCode = code || 1;
    }
  });
}

function startDetached(label, script, logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "a");
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true
  });
  child.unref();
  if (label === "watch-all") writeFileSync(WATCH_PID, `${child.pid}\n`, "utf8");
  if (label === "health-monitor") writeFileSync(HEALTH_PID, `${child.pid}\n`, "utf8");
  return child;
}

function isPidAlive(filePath) {
  const pid = Number.parseInt(readFileSafe(filePath).trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeRuntimeDesired(running) {
  mkdirSync(LOCAL_DIR, { recursive: true });
  const current = readJson(DESIRED_FILE) || {};
  const temp = `${DESIRED_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...current, running, changedAt: new Date().toISOString(), consecutiveMisses: 0 }, null, 2)}\n`, "utf8");
  renameSync(temp, DESIRED_FILE);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function removePid() {
  try {
    if (existsSync(WATCH_PID)) writeFileSync(WATCH_PID, "", "utf8");
  } catch {
    // Best effort; the health monitor treats a dead PID as stopped.
  }
}

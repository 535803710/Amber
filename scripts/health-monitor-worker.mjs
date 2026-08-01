#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectHealthSnapshot,
  resolveHealthThresholds,
  evaluateHealth
} from "./lib/health.mjs";
import { planHealthAlerts, sendHealthAlerts } from "./lib/health-alerts.mjs";
import { readSettings } from "./lib/settings.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = resolve(ROOT, ".local/health-monitor.pid");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`健康监控失败：${error.message}`);
    process.exitCode = 1;
  });
}

export async function runHealthCheck({
  rootDir = ROOT,
  now = Date.now(),
  env = process.env,
  notify = true,
  notifier = sendHealthAlerts,
  persist = true,
  alertsEnabled
} = {}) {
  const thresholds = resolveHealthThresholds(env);
  const healthAlertsEnabled = alertsEnabled ?? readSettings(rootDir).healthAlertsEnabled;
  const runtime = readRuntimeSnapshot(rootDir, { persist });
  const snapshot = collectHealthSnapshot({ rootDir, now, env, runtime });
  const health = evaluateHealth(snapshot, { now, thresholds });
  const currentState = readJson(resolve(rootDir, ".local/health-monitor/state.json")) || {};
  const alertPlan = planHealthAlerts(
    health.issues,
    currentState.alerts || {},
    now,
    thresholds.alertRepeatMs
  );
  let alertError = null;
  let alerts = currentState.alerts || {};

  const alertChannelConfigured = health.components.alertChannel.details.configured;
  const canSendAlerts = notify && healthAlertsEnabled && alertPlan.events.length && alertChannelConfigured;
  if (canSendAlerts) {
    try {
      await notifier(alertPlan.events, {
        webhookUrl: String(env.FEISHU_WEBHOOK_URL || "").trim(),
        webhookSecret: String(env.FEISHU_WEBHOOK_SECRET || "").trim()
      });
      alerts = alertPlan.state;
    } catch (error) {
      alertError = String(error?.message || error);
    }
  } else if (!alertPlan.events.length || !notify || !healthAlertsEnabled || !alertChannelConfigured) {
    alerts = healthAlertsEnabled && alertChannelConfigured
      ? alertPlan.state
      : preserveUnsentAlertState(alertPlan.state, currentState.alerts);
  }

  if (persist) {
    writeJsonAtomic(resolve(rootDir, ".local/health-monitor/state.json"), {
      checkedAt: health.checkedAt,
      health,
      alertsEnabled: healthAlertsEnabled,
      alerts,
      lastAlertError: alertError
    });
  }
  return { health, alertEvents: alertPlan.events, alertError };
}

function preserveUnsentAlertState(nextState, previousState = {}) {
  const previousActive = previousState?.active || {};
  const active = {};
  for (const [id, issue] of Object.entries(nextState.active || {})) {
    const previous = previousActive[id];
    active[id] = { ...issue };
    if (Number.isFinite(previous?.lastNotifiedAt)) {
      active[id].lastNotifiedAt = previous.lastNotifiedAt;
    } else {
      delete active[id].lastNotifiedAt;
    }
  }
  return { ...nextState, active };
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  const statusOnly = consumeFlag(args, "--status");
  const once = consumeFlag(args, "--once");
  if (args.length > 0) {
    throw new Error(`未知参数：${args.join(" ")}`);
  }

  if (statusOnly) {
    const result = await runHealthCheck({ notify: false, persist: false });
    console.log(JSON.stringify(result.health, null, 2));
    return;
  }

  if (once) {
    const result = await runHealthCheck();
    console.log(JSON.stringify(result.health, null, 2));
    return;
  }

  mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, `${process.pid}\n`, "utf8");
  const thresholds = resolveHealthThresholds(process.env);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    remove(PID_FILE);
    process.exitCode = 0;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`健康监控 worker 已启动：检查每 ${thresholds.checkIntervalMs}ms`);

  while (!stopping) {
    try {
      const result = await runHealthCheck();
      if (result.alertError) console.error(`健康告警发送失败：${result.alertError}`);
    } catch (error) {
      console.error(`健康检查失败：${error.message}`);
    }
    await sleep(thresholds.checkIntervalMs);
  }
}

function readRuntimeSnapshot(rootDir, { persist = true } = {}) {
  const desired = readJson(resolve(rootDir, ".local/runtime-desired.json")) || {};
  const pidFile = resolve(rootDir, ".local/watch-all.pid");
  const pid = Number.parseInt(readFileSafe(pidFile).trim(), 10);
  const running = Number.isInteger(pid) && pid > 0 && isProcessAlive(pid);
  const consecutiveMisses = running ? 0 : Number(desired.consecutiveMisses || 0) + 1;
  if (persist && (existsSync(resolve(rootDir, ".local/runtime-desired.json")) || desired.running === true)) {
    writeJsonAtomic(resolve(rootDir, ".local/runtime-desired.json"), {
      ...desired,
      consecutiveMisses,
      lastCheckedAt: new Date().toISOString()
    });
  }
  return {
    expectedRunning: desired.running === true,
    running,
    pid: running ? pid : null,
    consecutiveMisses
  };
}

function loadEnvFile(name) {
  const filePath = resolve(ROOT, name);
  if (!existsSync(filePath)) return;
  for (const line of readFileSafe(filePath).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = stripQuotes(match[2]);
  }
}

function stripQuotes(value) {
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

function writeJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function remove(filePath) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

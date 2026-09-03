#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWebhookSuccess, postJson } from "./change-record-worker.mjs";
import {
  claimReadyCommitItems,
  discoverRepositories,
  getCommitRecordStatus,
  markCommitFailed,
  markCommitSent,
  readyCommitItems,
  readScannerState,
  replayFailedCommitEvents,
  resolveCommitScanIntervals,
  resolveScanRoots,
  saveScannerState,
  scanCommitRecords,
  scanRepository,
  writeCommitWorkerState
} from "./lib/commit-records.mjs";
import {
  closeAllWatchers,
  createRepositoryWatcher,
  getWatcherStatus
} from "./lib/commit-watch.mjs";
import { readRuntimeConfig } from "./lib/runtime-config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "commit-record-scanner.mjs");
export const DEFAULT_SCAN_INTERVAL_MS = 5_000;
export const DEFAULT_DELIVERY_INTERVAL_MS = 2_000;
export const DEFAULT_DELIVERY_BATCH_SIZE = 20;
const COMMIT_RECORD_ENV_KEYS = [
  "FEISHU_COMMIT_WEBHOOK_URL",
  "FEISHU_COMMIT_WEBHOOK_TOKEN",
  "COMMIT_RECORD_SCAN_ROOTS",
];

loadEnv(".env");
loadEnv(".env.local", new Set(["COMMIT_RECORD_SCAN_ROOTS"]));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (consumeFlag(args, "--status")) {
    console.log(JSON.stringify(getCommitRecordStatus({ rootDir: ROOT }), null, 2));
    return;
  }
  if (consumeFlag(args, "--replay-failed")) {
    console.log(JSON.stringify(replayFailedCommitEvents({ rootDir: ROOT }), null, 2));
    return;
  }

  const once = consumeFlag(args, "--once");
  const dryRun = consumeFlag(args, "--dry-run");
  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(" ")}`);
  }

  const options = {
    dryRun,
    deliveryIntervalMs: readPositiveInteger("COMMIT_RECORD_DELIVERY_INTERVAL_MS", DEFAULT_DELIVERY_INTERVAL_MS),
    deliveryBatchSize: readPositiveInteger("COMMIT_RECORD_DELIVERY_BATCH_SIZE", DEFAULT_DELIVERY_BATCH_SIZE)
  };

  if (once) {
    scanCommitRecords({ rootDir: ROOT });
    await deliver(options.dryRun, { rootDir: ROOT, batchSize: options.deliveryBatchSize });
    return;
  }

  const intervals = resolveCommitScanIntervals();
  console.log(
    `提交记录 worker 已启动：全量兜底每 ${intervals.reconcileIntervalMs}ms，发现每 ${intervals.discoveryIntervalMs}ms，发送每 ${options.deliveryIntervalMs}ms，每批最多 ${options.deliveryBatchSize} 条`
  );
  startCommitRecordWorker(options);
}

export function startCommitRecordWorker({
  rootDir = ROOT,
  dryRun = false,
  scanIntervalMs,
  deliveryIntervalMs = DEFAULT_DELIVERY_INTERVAL_MS,
  deliveryBatchSize = DEFAULT_DELIVERY_BATCH_SIZE,
  reconcileIntervalMs,
  discoveryIntervalMs,
  watchDebounceMs,
  watchMaxWaitMs,
  scan = () => runScanProcess({ rootDir }),
  deliverBatch = () => deliver(dryRun, { rootDir, batchSize: deliveryBatchSize }),
  writeState = (patch) => writeCommitWorkerState(patch, { rootDir }),
  onError = (error) => console.error(`提交记录 worker 出错：${error.message}`),
  timers = globalThis
} = {}) {
  const intervals = resolveCommitScanIntervals();
  const reconcileMs = reconcileIntervalMs ?? scanIntervalMs ?? intervals.reconcileIntervalMs;
  const discoveryMs = discoveryIntervalMs ?? intervals.discoveryIntervalMs;
  const debounceMs = watchDebounceMs ?? intervals.watchDebounceMs;
  const maxWaitMs = watchMaxWaitMs ?? intervals.watchMaxWaitMs;

  let scanning = false;
  let delivering = false;
  const pendingRepoSet = new Set();
  const registeredRepos = new Map();
  let envWatcher = null;
  let envDebounceTimer = null;
  let lastDiscoveryAt = null;
  let lastTargetScanAt = null;

  const writeHeartbeat = () => {
    try {
      writeState({ lastHeartbeatAt: new Date().toISOString() });
    } catch (error) {
      onError(error);
    }
  };

  const writeWatcherState = () => {
    const status = getWatcherStatus();
    try {
      writeState({
        watcher: {
          status: status.status,
          watchedRepositoryCount: status.watchedRepositoryCount,
          lastDiscoveryAt,
          lastEventAt: status.lastEventAt,
          lastTargetScanAt,
          errors: status.errors
        },
        reconcileIntervalMs: reconcileMs,
        discoveryIntervalMs: discoveryMs
      });
    } catch (error) {
      onError(error);
    }
  };

  const scanSingleRepo = (repoPath) => {
    try {
      const state = readScannerState({ rootDir });
      const result = scanRepository({ repoPath, state, rootDir });
      state.lastScanAt = new Date().toISOString();
      saveScannerState({ rootDir, state });
      if (result.error) {
        onError(new Error(`单仓扫描失败 ${repoPath}: ${result.error.message}`));
      }
    } catch (error) {
      onError(error);
    }
  };

  const drainPendingRepos = (alreadyLocked = false) => {
    if (!alreadyLocked) {
      if (scanning) return;
      scanning = true;
    }
    try {
      while (pendingRepoSet.size > 0) {
        const [repoPath] = pendingRepoSet;
        pendingRepoSet.delete(repoPath);
        scanSingleRepo(repoPath);
      }
    } finally {
      if (!alreadyLocked) {
        scanning = false;
      }
    }
  };

  const onWatcherTrigger = (repoPath) => {
    pendingRepoSet.add(repoPath);
    if (!scanning) {
      drainPendingRepos();
    }
  };

  const runReconcile = async () => {
    if (scanning) return;
    scanning = true;
    writeHeartbeat();
    try {
      await scan();
      lastTargetScanAt = new Date().toISOString();
    } catch (error) {
      onError(error);
    }
    drainPendingRepos(true);
    scanning = false;
  };

  const runDiscovery = () => {
    const scanRoots = resolveScanRoots();
    if (scanRoots.length === 0) {
      if (registeredRepos.size > 0) {
        for (const handle of registeredRepos.values()) {
          try { handle.close(); } catch { /* ignore */ }
        }
        registeredRepos.clear();
        closeAllWatchers();
      }
      lastDiscoveryAt = new Date().toISOString();
      return;
    }

    const repositories = discoverRepositories(scanRoots);
    const repoSet = new Set(repositories);

    for (const repoPath of repositories) {
      if (!registeredRepos.has(repoPath)) {
        try {
          const handle = createRepositoryWatcher({
            repoPath,
            debounceMs,
            maxWaitMs,
            onTrigger: onWatcherTrigger,
            timers
          });
          registeredRepos.set(repoPath, handle);
        } catch (error) {
          onError(error);
        }
      }
    }

    for (const [repoPath, handle] of registeredRepos) {
      if (!repoSet.has(repoPath)) {
        try { handle.close(); } catch { /* ignore */ }
        registeredRepos.delete(repoPath);
      }
    }

    lastDiscoveryAt = new Date().toISOString();
  };

  const runDelivery = async () => {
    if (delivering) return;
    delivering = true;
    writeHeartbeat();
    try {
      await deliverBatch();
    } catch (error) {
      onError(error);
    } finally {
      delivering = false;
    }
  };

  const boot = async () => {
    runDiscovery();
    await runReconcile();
  };

  void boot();
  void runDelivery();
  const reconcileTimer = timers.setInterval(() => void runReconcile(), reconcileMs);
  const discoveryTimer = timers.setInterval(() => {
    runDiscovery();
    writeWatcherState();
  }, discoveryMs);
  const deliveryTimer = timers.setInterval(() => void runDelivery(), deliveryIntervalMs);

  if (existsSync(resolve(rootDir, ".env.local"))) {
    envWatcher = watch(rootDir, (eventType, filename) => {
      if (!filename || !filename.includes(".env.local")) return;
      if (envDebounceTimer) timers.clearTimeout(envDebounceTimer);
      envDebounceTimer = timers.setTimeout(() => {
        envDebounceTimer = null;
        reloadEnvKeys(COMMIT_RECORD_ENV_KEYS, rootDir);
        runDiscovery();
        writeWatcherState();
        void runReconcile();
        void runDelivery();
      }, 1000);
    });
  }

  return {
    stop() {
      timers.clearInterval(reconcileTimer);
      timers.clearInterval(discoveryTimer);
      timers.clearInterval(deliveryTimer);
      if (envDebounceTimer) timers.clearTimeout(envDebounceTimer);
      if (envWatcher) {
        try { envWatcher.close(); } catch { /* ignore */ }
      }
      for (const handle of registeredRepos.values()) {
        try { handle.close(); } catch { /* ignore */ }
      }
      registeredRepos.clear();
      closeAllWatchers();
    },
    runScan: runReconcile,
    runDelivery
  };
}

function runScanProcess({ rootDir }) {
  return new Promise((resolveScan, rejectScan) => {
    const child = spawn(process.execPath, [SCANNER_SCRIPT, `--root=${rootDir}`], {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", rejectScan);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveScan();
        return;
      }
      rejectScan(new Error(`提交扫描进程退出异常：${signal || `code ${code ?? "unknown"}`}`));
    });
  });
}

export async function deliver(
  dryRun = false,
  {
    rootDir = ROOT,
    batchSize = DEFAULT_DELIVERY_BATCH_SIZE,
    webhookUrl,
    webhookToken
  } = {}
) {
  const config = readRuntimeConfig({ rootDir, keys: COMMIT_RECORD_ENV_KEYS });
  webhookUrl = webhookUrl ?? config.FEISHU_COMMIT_WEBHOOK_URL?.trim() ?? "";
  webhookToken = webhookToken ?? config.FEISHU_COMMIT_WEBHOOK_TOKEN?.trim() ?? "";

  if (dryRun) {
    const items = readyCommitItems({ rootDir, limit: batchSize });
    for (const item of items) {
      console.log(JSON.stringify(item.envelope.event, null, 2));
    }
    return { ready: items.length, sent: 0, failed: 0 };
  }

  if (!webhookUrl) {
    return { ready: 0, sent: 0, failed: 0 };
  }

  const items = claimReadyCommitItems({ rootDir, limit: batchSize });
  const result = { ready: items.length, sent: 0, failed: 0 };
  if (items.length === 0) {
    return result;
  }

  for (const item of items) {
    try {
      const response = await postJson(webhookUrl, item.envelope.event, webhookToken);
      assertWebhookSuccess(response);
      markCommitSent(item, response, { rootDir });
      writeCommitWorkerState(
        { lastSuccessAt: new Date().toISOString(), lastError: null },
        { rootDir }
      );
      result.sent += 1;
    } catch (error) {
      markCommitFailed(item, error, { rootDir });
      writeCommitWorkerState(
        { lastError: error.message, lastErrorAt: new Date().toISOString() },
        { rootDir }
      );
      result.failed += 1;
    }
  }

  return result;
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function loadEnv(name, overrideKeys = new Set(), rootDir = ROOT) {
  const file = resolve(rootDir, name);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key] === undefined || overrideKeys.has(key)) {
      process.env[key] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

function reloadEnvKeys(keys, rootDir) {
  for (const key of keys) {
    delete process.env[key];
  }
  loadEnv(".env", new Set(), rootDir);
  loadEnv(".env.local", new Set(keys), rootDir);
}

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

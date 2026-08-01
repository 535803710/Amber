#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWebhookSuccess, postJson } from "./change-record-worker.mjs";
import {
  claimReadyCommitItems,
  getCommitRecordStatus,
  markCommitFailed,
  markCommitSent,
  readyCommitItems,
  replayFailedCommitEvents,
  scanCommitRecords,
  writeCommitWorkerState
} from "./lib/commit-records.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "commit-record-scanner.mjs");
export const DEFAULT_SCAN_INTERVAL_MS = 5_000;
export const DEFAULT_DELIVERY_INTERVAL_MS = 2_000;
export const DEFAULT_DELIVERY_BATCH_SIZE = 20;

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
    scanIntervalMs: readPositiveInteger("COMMIT_RECORD_SCAN_INTERVAL_MS", DEFAULT_SCAN_INTERVAL_MS),
    deliveryIntervalMs: readPositiveInteger("COMMIT_RECORD_DELIVERY_INTERVAL_MS", DEFAULT_DELIVERY_INTERVAL_MS),
    deliveryBatchSize: readPositiveInteger("COMMIT_RECORD_DELIVERY_BATCH_SIZE", DEFAULT_DELIVERY_BATCH_SIZE)
  };

  if (once) {
    scanCommitRecords({ rootDir: ROOT });
    await deliver(options.dryRun, { rootDir: ROOT, batchSize: options.deliveryBatchSize });
    return;
  }

  console.log(
    `提交记录 worker 已启动：扫描每 ${options.scanIntervalMs}ms，发送每 ${options.deliveryIntervalMs}ms，每批最多 ${options.deliveryBatchSize} 条`
  );
  startCommitRecordWorker(options);
}

export function startCommitRecordWorker({
  rootDir = ROOT,
  dryRun = false,
  scanIntervalMs = DEFAULT_SCAN_INTERVAL_MS,
  deliveryIntervalMs = DEFAULT_DELIVERY_INTERVAL_MS,
  deliveryBatchSize = DEFAULT_DELIVERY_BATCH_SIZE,
  scan = () => runScanProcess({ rootDir }),
  deliverBatch = () => deliver(dryRun, { rootDir, batchSize: deliveryBatchSize }),
  onError = (error) => console.error(`提交记录 worker 出错：${error.message}`),
  timers = globalThis
} = {}) {
  let scanning = false;
  let delivering = false;

  const runScan = async () => {
    if (scanning) return;
    scanning = true;
    writeCommitWorkerState({ lastHeartbeatAt: new Date().toISOString() }, { rootDir });
    try {
      await scan();
    } catch (error) {
      onError(error);
    } finally {
      scanning = false;
    }
  };

  const runDelivery = async () => {
    if (delivering) return;
    delivering = true;
    writeCommitWorkerState({ lastHeartbeatAt: new Date().toISOString() }, { rootDir });
    try {
      await deliverBatch();
    } catch (error) {
      onError(error);
    } finally {
      delivering = false;
    }
  };

  void runScan();
  void runDelivery();
  const scanTimer = timers.setInterval(() => void runScan(), scanIntervalMs);
  const deliveryTimer = timers.setInterval(() => void runDelivery(), deliveryIntervalMs);

  return {
    stop() {
      timers.clearInterval(scanTimer);
      timers.clearInterval(deliveryTimer);
    },
    runScan,
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
    webhookUrl = process.env.FEISHU_COMMIT_WEBHOOK_URL?.trim() || "",
    webhookToken = process.env.FEISHU_COMMIT_WEBHOOK_TOKEN?.trim() || ""
  } = {}
) {
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

function loadEnv(name, overrideKeys = new Set()) {
  const file = resolve(ROOT, name);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key] === undefined || overrideKeys.has(key)) {
      process.env[key] = line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "");
    }
  }
}

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

#!/usr/bin/env node

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getChangeRecordStatus,
  claimReadyQueueItems,
  listReadyQueueItems,
  markQueueItemFailed,
  markQueueItemSent,
  replayFailedEvents,
  toWebhookPayload,
  writeWorkerState
} from "./lib/change-records.mjs";
import { readRuntimeConfig } from "./lib/runtime-config.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 8_000;
const CHANGE_RECORD_ENV_KEYS = [
  "FEISHU_CHANGE_WEBHOOK_URL",
  "FEISHU_CHANGE_WEBHOOK_TOKEN",
];

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const args = process.argv.slice(2);
  if (consumeFlag(args, "--status")) {
    console.log(JSON.stringify(getChangeRecordStatus({ rootDir: ROOT_DIR }), null, 2));
    return;
  }
  if (consumeFlag(args, "--replay-failed")) {
    console.log(JSON.stringify(replayFailedEvents({ rootDir: ROOT_DIR }), null, 2));
    return;
  }

  const once = consumeFlag(args, "--once");
  const dryRun = consumeFlag(args, "--dry-run");
  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(" ")}`);
  }

  if (!once) {
    console.log("修改记录 worker 已启动");
  }

  do {
    await processReadyItems({ dryRun });
    if (!once) {
      await sleep(POLL_INTERVAL_MS);
    }
  } while (!once);
}

export async function processReadyItems({
  dryRun = false,
  rootDir = ROOT_DIR,
  webhookUrl,
  webhookToken,
  requestTimeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const config = readRuntimeConfig({ rootDir, keys: CHANGE_RECORD_ENV_KEYS });
  webhookUrl = webhookUrl ?? config.FEISHU_CHANGE_WEBHOOK_URL?.trim() ?? "";
  webhookToken = webhookToken ?? config.FEISHU_CHANGE_WEBHOOK_TOKEN?.trim() ?? "";

  if (!dryRun) {
    writeWorkerState({ lastHeartbeatAt: new Date().toISOString() }, { rootDir });
  }

  if (dryRun) {
    const items = listReadyQueueItems({ rootDir });
    for (const item of items) {
      console.log(JSON.stringify(toWebhookPayload(item.envelope.event), null, 2));
    }
    return;
  }

  if (!webhookUrl) {
    return;
  }

  const items = claimReadyQueueItems({ rootDir });
  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    try {
      const payload = toWebhookPayload(item.envelope.event);
      const response = await postJson(webhookUrl, payload, webhookToken, requestTimeoutMs);
      assertWebhookSuccess(response);
      markQueueItemSent(item, response, { rootDir });
      writeWorkerState(
        { lastSuccessAt: new Date().toISOString(), lastError: null },
        { rootDir }
      );
      console.log(`修改记录已发送：${item.envelope.event.event_id}`);
    } catch (error) {
      const result = markQueueItemFailed(item, error, { rootDir });
      writeWorkerState(
        {
          lastErrorAt: new Date().toISOString(),
          lastError: error.message
        },
        { rootDir }
      );
      console.error(
        result.failedPermanently
          ? `修改记录进入失败队列：${error.message}`
          : `修改记录发送失败，将重试：${error.message}`
      );
    }
  }
}

export function postJson(webhookUrl, payload, token, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url = new URL(webhookUrl);
  const client = url.protocol === "https:" ? httpsRequest : httpRequest;
  const body = JSON.stringify(payload);

  return new Promise((resolveResponse, rejectResponse) => {
    const req = client(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        timeout: timeoutMs
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          resolveResponse({
            statusCode: res.statusCode || 0,
            body: responseBody,
            json: parseJson(responseBody)
          });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("webhook request timed out")));
    req.on("error", rejectResponse);
    req.write(body);
    req.end();
  });
}

export function assertWebhookSuccess(response) {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`webhook HTTP ${response.statusCode}`);
  }
  const code = response.json?.code ?? response.json?.StatusCode;
  if (code !== undefined && Number(code) !== 0) {
    throw new Error(response.json?.msg || response.json?.message || `webhook code ${code}`);
  }
}

function loadEnvFile(fileName) {
  const filePath = resolve(ROOT_DIR, fileName);
  if (!existsSync(filePath)) {
    return;
  }
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = unquote(trimmed.slice(index + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

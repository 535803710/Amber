#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

const STATUS_LABELS = {
  test: "测试",
  info: "提示",
  running: "开始",
  done: "完成",
  error: "异常",
  wait: "需要接管",
  ask: "需要接管"
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const dryRun = consumeFlag(args, "--dry-run");
  const status = normalizeStatus(args.shift() || "info");
  const message = args.join(" ").trim();
  const title = process.env.VIBECODING_NOTIFY_TITLE || "Vibecoding";
  const text = formatMessage({ title, status, message });
  const payload = buildFeishuPayload(text);

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("Missing FEISHU_WEBHOOK_URL. Set it in .env or as an environment variable.");
  }

  const response = await postJson(webhookUrl, payload);
  assertFeishuSuccess(response);

  console.log("Feishu notification sent.");
}

function normalizeStatus(value) {
  const status = value.toLowerCase();
  return STATUS_LABELS[status] ? status : "info";
}

function formatMessage({ title, status, message }) {
  const label = STATUS_LABELS[status];
  const secondLine = message ? `${label}：${message}` : label;
  return `${title}\n${secondLine}`;
}

function buildFeishuPayload(text) {
  const payload = {
    msg_type: "text",
    content: { text }
  };

  const secret = process.env.FEISHU_WEBHOOK_SECRET;
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = createFeishuSign(timestamp, secret);
  }

  return payload;
}

function createFeishuSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

function postJson(webhookUrl, payload) {
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
          "Content-Length": Buffer.byteLength(body)
        }
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

    req.on("error", rejectResponse);
    req.write(body);
    req.end();
  });
}

function assertFeishuSuccess(response) {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Feishu request failed with HTTP ${response.statusCode}: ${response.body}`);
  }

  const result = response.json;
  if (!result) {
    return;
  }

  const code = result.code ?? result.StatusCode;
  if (code !== undefined && Number(code) !== 0) {
    const message = result.msg ?? result.StatusMessage ?? response.body;
    throw new Error(`Feishu rejected the notification: ${message}`);
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }

  args.splice(index, 1);
  return true;
}

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(equalIndex + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/notify.mjs <status> <message>

Examples:
  node scripts/notify.mjs test "手环通知链路测试"
  node scripts/notify.mjs done "Codex 任务完成"
  node scripts/notify.mjs error "Cursor 构建失败"
  node scripts/notify.mjs wait "需要你接管确认"

Options:
  --dry-run  Print the Feishu payload without sending it

Environment:
  FEISHU_WEBHOOK_URL      Required unless --dry-run is used
  FEISHU_WEBHOOK_SECRET   Optional, for Feishu signature verification
`);
}

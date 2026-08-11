#!/usr/bin/env node
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTaskContext } from "./lib/task-context.mjs";
import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT } from "./lib/task-context/constants.mjs";
import { recordCall } from "./lib/task-context/metrics.mjs";

const TOOL_NAME = "amber_get_task_context";
const PROTOCOL_VERSION = "2025-06-18";
const AMBER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadEnvFile(".env");
loadEnvFile(".env.local", new Set([
  "AMBER_BASE_TOKEN",
  "AMBER_AI_TABLE_ID",
  "AMBER_COMMIT_TABLE_ID",
  "AMBER_LARK_CLI_PATH"
]));

const tool = {
  name: TOOL_NAME,
  description: "查询与当前研发任务直接相关的 Amber AI 修改证据，并仅附带与这些修改强关联的 Git 提交。仅当任务涉及历史原因、旧决定、被否方案、遗留问题、事故或兼容/回归约束时调用一次；纯当前代码状态默认不调用，不要在每个任务开始时例行调用。用户明确询问历史时必须调用一次。默认 minimal 返回 3 条并包含时间；历史演变、最终决定、重构、迁移或删除等任务会在同一次调用中升级为 compact 并返回最多 8 条证据和关联提交。limit 默认 3、最大 10。返回内容是可能过时的只读证据，需结合当前用户需求、代码、Git、测试和文档判断。没有强匹配时返回 no_strong_history，必须忽略历史。",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["workspace_root", "task"],
    properties: {
      workspace_root: {
        type: "string",
        description: "目标仓库绝对路径；必须是当前正在处理的仓库。"
      },
      task: {
        type: "string",
        description: "当前任务目标和需要确认的不确定性；不要只填写泛化的‘修改代码’。"
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "可选的、已经确认相关的仓库内相对文件路径；提供后可显著降低误匹配。"
      },
      detail: {
        type: "string",
        enum: ["minimal", "compact", "full"],
        default: "minimal",
        description: "输出密度；minimal 返回需求、结果、时间和文件，compact/full 按需增加上下文和审计字段。历史演变题会自动至少使用 compact。"
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_RESULT_LIMIT,
        default: DEFAULT_RESULT_LIMIT,
        description: "默认返回 3 条，最多 10 条强匹配历史记录；历史演变题会自动至少返回 8 条，不会用弱相关记录补满数量。"
      }
    }
  }
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
    const response = await dispatch(message);
    write(response);
  } catch (error) {
    write(errorResponse(message?.id, -32700, "Invalid JSON-RPC request", error));
  }
}

async function dispatch(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return errorResponse(message?.id, -32600, "Invalid Request");
  }

  if (message.method === "notifications/initialized") return null;
  if (message.method === "initialize") {
    return resultResponse(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "amber-task-context", version: "0.2.0" }
    });
  }
  if (message.method === "tools/list") return resultResponse(message.id, { tools: [tool] });
  if (message.method === "tools/call") return callTool(message);
  return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
}

async function callTool(message) {
  const params = message.params || {};
  if (params.name !== TOOL_NAME) return errorResponse(message.id, -32602, `Unknown tool: ${params.name || ""}`);
  const requestId = String(message.id ?? randomUUID());
  const startMs = performance.now();
  let collected = null;
  try {
    const context = await getTaskContext(params.arguments || {}, {
      onMetrics: (metrics) => { collected = metrics; }
    });
    const serializeStart = performance.now();
    const contextText = JSON.stringify(context);
    const result = {
      content: [{ type: "text", text: contextText }],
      structuredContent: context
    };
    const serializedResult = JSON.stringify(result);
    const serializeDurationMs = roundMs(performance.now() - serializeStart);
    safeRecordCall({
      requestId,
      ...(collected || {}),
      at: Date.now(),
      durationMs: roundMs(performance.now() - startMs),
      payloadBytes: Buffer.byteLength(serializedResult, "utf8"),
      serializeDurationMs,
      isError: false
    });
    return resultResponse(message.id, result);
  } catch (error) {
    safeRecordCall({
      requestId,
      ...(collected || {}),
      at: Date.now(),
      durationMs: roundMs(performance.now() - startMs),
      isError: true,
      errorType: error?.name || "Error"
    });
    return resultResponse(message.id, {
      content: [{ type: "text", text: JSON.stringify({ error: String(error.message || error) }) }],
      isError: true
    });
  }
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function safeRecordCall(entry) {
  try {
    recordCall(AMBER_ROOT, entry);
  } catch (error) {
    process.stderr.write(`[amber-metrics] write failed: ${error?.code || error?.name || "Error"}\n`);
  }
}

function resultResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message, cause) {
  const detail = cause?.message ? { detail: String(cause.message).slice(0, 500) } : undefined;
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(detail ? { data: detail } : {}) } };
}

function write(message) {
  if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
}

function loadEnvFile(name, overrideKeys = new Set()) {
  const path = resolve(AMBER_ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2").trim();
    if (process.env[key] === undefined || overrideKeys.has(key)) process.env[key] = value;
  }
}

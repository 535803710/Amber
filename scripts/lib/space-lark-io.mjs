import { spawn } from "node:child_process";

import { postJson } from "../change-record-worker.mjs";
import { loadSpaceTemplate } from "./schema-fingerprint.mjs";
import { runLarkCli } from "./task-context/lark-source.mjs";

const COPY_TIMEOUT_MS = 90_000;
const LIST_TIMEOUT_MS = 20_000;
const DEFAULT_HOST = "https://transsioner.feishu.cn";

const COPY_RETRY_ATTEMPTS = 8;
const COPY_RETRY_DELAY_MS = 3_000;

export function createLarkSpaceIo({
  runLark = defaultRunLark,
  postWebhook = defaultPostWebhook,
  openUrl = defaultOpenUrl,
  sleep = defaultSleep,
  template = loadSpaceTemplate()
} = {}) {
  return {
    async copyTemplate({ templateToken }) {
      const token = String(templateToken || template.templateToken || "").trim();
      if (!token) {
        throw Object.assign(new Error("缺少模板 token。"), { code: "template_token_missing" });
      }
      const name = String(template.copyName || "Amber 空间").trim();
      const timeZone = String(template.timeZone || "Asia/Shanghai").trim();
      const copied = parseCopiedBase(await copyBaseWithRetry(runLark, [
        "base", "+base-copy",
        "--base-token", token,
        "--name", name,
        "--without-content",
        "--time-zone", timeZone,
        "--as", "user",
        "--format", "json"
      ], { timeoutMs: COPY_TIMEOUT_MS, sleep }), template);

      try {
        await enableCopiedWorkflows(runLark, copied.baseToken);
      } catch {
        // 副本工作流启用失败不阻断；用户仍可在飞书里手动启用后粘贴 Webhook。
      }
      return copied;
    },

    async listTables({ baseToken }) {
      const payload = await runLark([
        "base", "+table-list",
        "--base-token", baseToken,
        "--as", "user",
        "--format", "json"
      ], { timeoutMs: LIST_TIMEOUT_MS });
      const tables = unwrapData(payload)?.tables || unwrapData(payload)?.items || [];
      return tables.map((table) => ({
        id: String(table.id || table.table_id || "").trim(),
        name: String(table.name || table.table_name || "").trim()
      })).filter((table) => table.id && table.name);
    },

    async listFields({ baseToken, tableId }) {
      const payload = await runLark([
        "base", "+field-list",
        "--base-token", baseToken,
        "--table-id", tableId,
        "--as", "user",
        "--format", "json"
      ], { timeoutMs: LIST_TIMEOUT_MS });
      const fields = unwrapData(payload)?.fields || unwrapData(payload)?.items || [];
      return fields.map((field) => ({
        name: String(field.name || field.field_name || "").trim(),
        type: String(field.type || "text")
      })).filter((field) => field.name);
    },

    async listWorkflows({ baseToken }) {
      const payload = await runLark([
        "base", "+workflow-list",
        "--base-token", baseToken,
        "--as", "user",
        "--format", "json"
      ], { timeoutMs: LIST_TIMEOUT_MS });
      const items = unwrapData(payload)?.items || [];
      return items.map((item) => ({
        id: String(item.workflow_id || item.id || "").trim(),
        title: String(item.title || item.name || "").trim(),
        status: String(item.status || "")
      })).filter((item) => item.id);
    },

    async findRecord({ baseToken, tableId, eventId }) {
      for (const field of ["事件 ID", "事件ID"]) {
        const payload = await runLark([
          "base", "+record-list",
          "--base-token", baseToken,
          "--table-id", tableId,
          "--filter-json", JSON.stringify({
            logic: "and",
            conditions: [[field, "==", eventId]]
          }),
          "--limit", "1",
          "--as", "user",
          "--format", "json"
        ], { timeoutMs: LIST_TIMEOUT_MS });
        const items = unwrapData(payload)?.items || unwrapData(payload)?.records || [];
        if (items.length) return items[0];
      }
      return null;
    },

    async postWebhook(url, body, token) {
      return postWebhook(url, body, token);
    },

    async openUrl(url) {
      return openUrl(url);
    }
  };
}

export function parseCopiedBase(payload, template = {}) {
  const data = unwrapData(payload) || {};
  const base = data.base && typeof data.base === "object" ? data.base : data;
  const baseToken = String(
    base.base_token || base.app_token || data.base_token || data.app_token || data.token || ""
  ).trim();
  if (!baseToken) {
    throw Object.assign(new Error("模板复制未返回 Base token。"), { code: "io_unavailable" });
  }
  const copiedUrl = String(base.url || data.url || "").trim();
  const host = templateHost(template.templateUrl);
  return {
    baseToken,
    baseUrl: copiedUrl || `${host}/base/${baseToken}`
  };
}

export function unwrapData(payload) {
  if (payload == null) return {};
  if (typeof payload === "string") {
    try {
      return unwrapData(JSON.parse(payload));
    } catch {
      return {};
    }
  }
  if (typeof payload !== "object") return {};
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

async function copyBaseWithRetry(runLark, args, { timeoutMs, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= COPY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await runLark(args, { timeoutMs });
    } catch (error) {
      lastError = error;
      if (!isCopyInProgress(error) || attempt === COPY_RETRY_ATTEMPTS) throw error;
      await sleep(COPY_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function isCopyInProgress(error) {
  return /800004046|1254036|base is copying/i.test(String(error?.message || error || ""));
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enableCopiedWorkflows(runLark, baseToken) {
  const payload = await runLark([
    "base", "+workflow-list",
    "--base-token", baseToken,
    "--as", "user",
    "--format", "json"
  ], { timeoutMs: LIST_TIMEOUT_MS });
  const items = unwrapData(payload)?.items || [];
  for (const item of items) {
    const workflowId = String(item.workflow_id || item.id || "").trim();
    if (!workflowId) continue;
    if (String(item.status || "") === "enabled") continue;
    await runLark([
      "base", "+workflow-enable",
      "--base-token", baseToken,
      "--workflow-id", workflowId,
      "--as", "user",
      "--format", "json"
    ], { timeoutMs: LIST_TIMEOUT_MS });
  }
}

async function defaultRunLark(args, options = {}) {
  const stdout = await runLarkCli(args, options);
  try {
    return JSON.parse(String(stdout || "").trim() || "{}");
  } catch {
    throw new Error("lark-cli 返回的 JSON 无法解析。");
  }
}

async function defaultPostWebhook(url, body, token) {
  const response = await postJson(url, body, token);
  return { status: response.statusCode, body: response.body };
}

function defaultOpenUrl(url) {
  const href = String(url || "").trim();
  if (!href) return;
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", href], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }
  spawn("xdg-open", [href], { detached: true, stdio: "ignore" }).unref();
}

function templateHost(templateUrl) {
  try {
    return new URL(templateUrl).origin;
  } catch {
    return DEFAULT_HOST;
  }
}

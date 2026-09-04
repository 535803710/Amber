import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";

import { redactCliText } from "./cli-result.mjs";
import {
  AI_TABLE_NAME,
  GIT_TABLE_NAME,
  SPACE_TEMPLATE_VERSION,
  compareSpaceSchema,
  loadSpaceTemplate
} from "./schema-fingerprint.mjs";
import { createLarkSpaceIo } from "./space-lark-io.mjs";

export const SPACE_SCHEMA_VERSION = 1;
export const SPACE_STATE_RELATIVE = ".local/space.json";
export const ENV_LOCAL_RELATIVE = ".env.local";

export const SPACE_CODES = Object.freeze({
  templateTokenMissing: "template_token_missing",
  schemaMismatch: "schema_mismatch",
  webhookSetupRequired: "webhook_setup_required",
  invalidBaseUrl: "invalid_base_url",
  webhookHttpFailed: "webhook_http_failed",
  webhookRecordMissing: "webhook_record_missing",
  webhookIncomplete: "webhook_incomplete",
  spaceReady: "space_ready",
  spaceMissing: "space_missing",
  unknownSubcommand: "unknown_subcommand",
  ioUnavailable: "io_unavailable"
});

const ENV_KEYS = Object.freeze({
  baseToken: "AMBER_BASE_TOKEN",
  aiTableId: "AMBER_AI_TABLE_ID",
  commitTableId: "AMBER_COMMIT_TABLE_ID",
  aiWebhook: "FEISHU_CHANGE_WEBHOOK_URL",
  gitWebhook: "FEISHU_COMMIT_WEBHOOK_URL",
  aiWebhookToken: "FEISHU_CHANGE_WEBHOOK_TOKEN",
  gitWebhookToken: "FEISHU_COMMIT_WEBHOOK_TOKEN",
  templateToken: "AMBER_SPACE_TEMPLATE_TOKEN"
});

export function createDefaultSpaceIo(options = {}) {
  return createLarkSpaceIo(options);
}

export async function runSpace(request = {}) {
  const io = request.io || createDefaultSpaceIo();
  const targetRoot = resolve(request.targetRoot || request.cwd || process.cwd());
  const env = request.env || {};
  const extras = request.extras || {};
  const flags = request.flags || {};
  const subcommand = String(request.subcommand || "").trim() || "status";
  const args = Array.isArray(request.args) ? request.args : [];

  if (subcommand === "init") {
    return initSpace({ io, targetRoot, env, extras, flags });
  }
  if (subcommand === "connect") {
    return connectSpace({
      io,
      targetRoot,
      env,
      extras,
      flags,
      url: args[0]
    });
  }
  if (subcommand === "status") {
    return statusSpace({ io, targetRoot, env, extras, flags });
  }
  return cliResult({
    status: "failed",
    code: SPACE_CODES.unknownSubcommand,
    message: `未知子命令：${subcommand}`,
    actions: ["运行 amber space init、amber space connect <Base URL> 或 amber space status"]
  });
}

export async function initSpace({ io, targetRoot, env = {}, extras = {}, flags = {} } = {}) {
  const template = loadSpaceTemplate();
  const templateToken = firstNonEmpty(
    extras["template-token"],
    env[ENV_KEYS.templateToken],
    template.templateToken
  );
  if (!templateToken) {
    return cliResult({
      status: "needs_action",
      code: SPACE_CODES.templateTokenMissing,
      message: "缺少飞书 Amber 空间模板 token，需要维护方先完成模板配置。",
      actions: [
        "请维护方在 templates/feishu/amber-space.v1.json 写入 templateToken",
        "或设置 AMBER_SPACE_TEMPLATE_TOKEN",
        "或使用 --template-token 传入模板 token"
      ]
    });
  }

  const existing = readSpaceState(targetRoot);
  let baseToken = existing?.baseToken || "";
  let baseUrl = existing?.baseUrl || "";

  if (!baseToken) {
    let copied;
    try {
      copied = await io.copyTemplate({ templateToken });
    } catch (error) {
      return ioFailure(error, "复制飞书 Amber 空间模板失败。");
    }
    baseToken = String(copied?.baseToken || "").trim();
    baseUrl = String(copied?.baseUrl || "").trim();
    if (!baseToken) {
      return cliResult({
        status: "failed",
        code: SPACE_CODES.ioUnavailable,
        message: "模板复制未返回 Base token。"
      });
    }
  }

  if (!baseUrl) {
    baseUrl = `https://feishu.cn/base/${baseToken}`;
  }

  return finalizeIdentifiedSpace({
    io,
    targetRoot,
    env,
    extras,
    flags,
    baseToken,
    baseUrl,
    previous: existing,
    openWorkflows: shouldOpenWorkflows(extras, flags)
  });
}

export async function connectSpace({
  io,
  targetRoot,
  env = {},
  extras = {},
  flags = {},
  url
} = {}) {
  const parsed = parseBaseUrl(url);
  if (!parsed) {
    return cliResult({
      status: "failed",
      code: SPACE_CODES.invalidBaseUrl,
      message: "无法解析飞书 Base URL，一期仅支持 /base/<token> 路径。",
      actions: ["提供类似 https://example.feishu.cn/base/<token> 的地址"]
    });
  }

  return finalizeIdentifiedSpace({
    io,
    targetRoot,
    env,
    extras,
    flags,
    baseToken: parsed.baseToken,
    baseUrl: parsed.baseUrl,
    previous: readSpaceState(targetRoot),
    openWorkflows: shouldOpenWorkflows(extras, flags)
  });
}

export async function statusSpace({ io, targetRoot, env = {}, extras = {}, flags = {} } = {}) {
  const space = readSpaceState(targetRoot);
  if (!space?.baseToken) {
    return cliResult({
      status: "needs_action",
      code: SPACE_CODES.spaceMissing,
      message: "尚未创建或连接飞书 Amber 空间。",
      actions: ["运行 amber space init 或 amber space connect <Base URL>"],
      data: publicSpaceData(null)
    });
  }

  const live = await inspectLiveSchema(io, space);
  if (live?.error) return live.error;

  if (hasExtrasWebhook(extras)) {
    if (!bothExtrasWebhooks(extras)) {
      return incompleteWebhookResult(space, undefined, live?.comparison);
    }
    const identified = live?.space
      ? live
      : await identifyTables(io, space.baseToken, space.baseUrl, space);
    if (identified.error) return identified.error;
    const webhooks = resolveWebhooks({ extras, env, envLocal: readEnvLocal(targetRoot), space: identified.space });
    const verified = await verifyWebhooks({
      io,
      space: identified.space,
      webhooks
    });
    if (verified.error) return verified.error;
    writeIdentifiedState(targetRoot, identified.space);
    return readyResult(identified.space, identified.comparison);
  }

  return spaceStatusResult(space, extras, live?.comparison);
}

export function parseBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const baseIndex = parts.findIndex((part) => part === "base");
  const token = baseIndex >= 0 ? String(parts[baseIndex + 1] || "").trim() : "";
  if (!token) return null;
  return {
    baseToken: token,
    baseUrl: `${url.origin}/base/${token}`
  };
}

export function readSpaceState(targetRoot) {
  const filePath = spaceStatePath(targetRoot);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function spaceStatePath(targetRoot) {
  return resolve(targetRoot, SPACE_STATE_RELATIVE);
}

async function finalizeIdentifiedSpace({
  io,
  targetRoot,
  env,
  extras,
  flags,
  baseToken,
  baseUrl,
  previous,
  openWorkflows
}) {
  const identified = await identifyTables(io, baseToken, baseUrl, previous);
  if (identified.error) return identified.error;

  const space = identified.space;
  writeIdentifiedState(targetRoot, space);

  const hints = await maybeOpenWorkflows({
    io,
    extras,
    flags,
    space,
    template: loadSpaceTemplate(),
    enabled: openWorkflows
  });

  if (hasExtrasWebhook(extras)) {
    if (!bothExtrasWebhooks(extras)) {
      return incompleteWebhookResult(space, hints, identified.comparison);
    }
    const webhooks = resolveWebhooks({ extras, env, envLocal: readEnvLocal(targetRoot), space });
    const verified = await verifyWebhooks({ io, space, webhooks });
    if (verified.error) {
      verified.error.data = {
        ...verified.error.data,
        ...publicSpaceData(space, identified.comparison, hints)
      };
      return verified.error;
    }
    writeIdentifiedState(targetRoot, space);
    return readyResult(space, identified.comparison, hints);
  }

  return pendingWebhookResult(space, hints, identified.comparison, extras);
}

async function identifyTables(io, baseToken, baseUrl = "", previous = {}) {
  let tables;
  try {
    tables = await io.listTables({ baseToken });
  } catch (error) {
    return { error: ioFailure(error, "读取飞书表列表失败。") };
  }

  const list = Array.isArray(tables) ? tables : [];
  const ai = list.find((table) => String(table?.name || "").trim() === AI_TABLE_NAME);
  const git = list.find((table) => String(table?.name || "").trim() === GIT_TABLE_NAME);
  if (!ai?.id || !git?.id) {
    const missing = [
      ai?.id ? null : AI_TABLE_NAME,
      git?.id ? null : GIT_TABLE_NAME
    ].filter(Boolean);
    return {
      error: cliResult({
        status: "failed",
        code: SPACE_CODES.schemaMismatch,
        message: `空间表结构与模板不兼容，缺少表：${missing.join("、")}`,
        data: { missingTables: missing }
      })
    };
  }

  let aiFields;
  let gitFields;
  try {
    aiFields = await io.listFields({ baseToken, tableId: ai.id });
    gitFields = await io.listFields({ baseToken, tableId: git.id });
  } catch (error) {
    return { error: ioFailure(error, "读取飞书表字段失败。") };
  }

  const actual = {
    tables: [
      { name: AI_TABLE_NAME, id: ai.id, fields: aiFields },
      { name: GIT_TABLE_NAME, id: git.id, fields: gitFields }
    ]
  };
  const comparison = compareSpaceSchema(actual, loadSpaceTemplate());
  if (!comparison.ok) {
    return { error: schemaMismatchResult(comparison) };
  }

  const previousVerified = previous?.baseToken === baseToken && previous?.webhooksVerified === true;
  const space = {
    schemaVersion: SPACE_SCHEMA_VERSION,
    templateVersion: SPACE_TEMPLATE_VERSION,
    baseToken,
    baseUrl: baseUrl || previous?.baseUrl || "",
    aiTableId: ai.id,
    commitTableId: git.id,
    aiWebhookUrl: previousVerified ? previous?.aiWebhookUrl || "" : "",
    gitWebhookUrl: previousVerified ? previous?.gitWebhookUrl || "" : "",
    webhooksVerified: previousVerified,
    fingerprints: {
      [AI_TABLE_NAME]: comparison.tables.find((item) => item.name === AI_TABLE_NAME)?.fingerprint || "",
      [GIT_TABLE_NAME]: comparison.tables.find((item) => item.name === GIT_TABLE_NAME)?.fingerprint || ""
    },
    extraFields: comparison.extraFields,
    updatedAt: new Date().toISOString()
  };

  return { space, comparison };
}

async function inspectLiveSchema(io, space) {
  if (typeof io?.listTables !== "function" || typeof io?.listFields !== "function") {
    return null;
  }
  try {
    const identified = await identifyTables(io, space.baseToken, space.baseUrl, space);
    if (identified.error) {
      if (identified.error.code === SPACE_CODES.ioUnavailable) return null;
      return identified;
    }
    return identified;
  } catch (error) {
    if (error?.code === SPACE_CODES.ioUnavailable) return null;
    throw error;
  }
}

async function verifyWebhooks({ io, space, webhooks }) {
  if (!webhooks.ai || !webhooks.git) {
    return { error: incompleteWebhookResult(space) };
  }

  const aiEventId = "setup-test-ai";
  const gitEventId = "setup-test-git";
  const aiPayload = {
    setup_test: true,
    event_id: aiEventId,
    "事件 ID": aiEventId,
    "修改记录": "Amber space setup-test"
  };
  const gitPayload = {
    setup_test: true,
    event_id: gitEventId,
    事件ID: gitEventId,
    提交标题: "Amber space setup-test"
  };

  const aiResponse = await postWebhookSafe(io, webhooks.ai, aiPayload, webhooks.aiToken);
  if (aiResponse.error) return aiResponse;
  const gitResponse = await postWebhookSafe(io, webhooks.git, gitPayload, webhooks.gitToken);
  if (gitResponse.error) return gitResponse;

  if (typeof io.findRecord === "function") {
    const aiRecord = await findRecordSafe(io, {
      baseToken: space.baseToken,
      tableId: space.aiTableId,
      eventId: aiEventId
    });
    if (aiRecord.error) return aiRecord;
    const gitRecord = await findRecordSafe(io, {
      baseToken: space.baseToken,
      tableId: space.commitTableId,
      eventId: gitEventId
    });
    if (gitRecord.error) return gitRecord;
  }

  space.aiWebhookUrl = webhooks.ai;
  space.gitWebhookUrl = webhooks.git;
  space.webhooksVerified = true;
  space.updatedAt = new Date().toISOString();
  return { ok: true };
}

async function postWebhookSafe(io, url, payload, token) {
  if (typeof io.postWebhook !== "function") {
    return {
      error: cliResult({
        status: "failed",
        code: SPACE_CODES.ioUnavailable,
        message: "无法校验 Webhook：未提供 postWebhook。"
      })
    };
  }
  let response;
  try {
    response = await io.postWebhook(url, payload, token);
  } catch (error) {
    return {
      error: cliResult({
        status: "failed",
        code: SPACE_CODES.webhookHttpFailed,
        message: redactCliText(`Webhook 请求失败：${error.message || "未知错误"}`)
      })
    };
  }
  const status = Number(response?.status);
  if (!Number.isInteger(status) || status < 200 || status > 299) {
    return {
      error: cliResult({
        status: "failed",
        code: SPACE_CODES.webhookHttpFailed,
        message: `Webhook 校验未通过，HTTP 状态 ${Number.isInteger(status) ? status : "未知"}。`
      })
    };
  }
  return { ok: true, response };
}

async function findRecordSafe(io, query) {
  let record;
  try {
    record = await io.findRecord(query);
  } catch (error) {
    return {
      error: cliResult({
        status: "failed",
        code: SPACE_CODES.webhookRecordMissing,
        message: "Webhook 校验未在表中找到测试记录。"
      })
    };
  }
  if (!record) {
    return {
      error: cliResult({
        status: "failed",
        code: SPACE_CODES.webhookRecordMissing,
        message: "Webhook 校验未在表中找到测试记录。"
      })
    };
  }
  return { ok: true, record };
}

async function maybeOpenWorkflows({ io, extras, flags, space, template, enabled }) {
  const hints = workflowHints(extras, space, template);
  if (!enabled || flags.skipOpen) return hints;
  if (typeof io.openUrl !== "function") return hints;
  const opened = new Set();
  for (const hint of hints) {
    if (!hint.url || opened.has(hint.url)) continue;
    opened.add(hint.url);
    try {
      await io.openUrl(hint.url);
      hint.opened = true;
    } catch {
      hint.opened = false;
    }
  }
  return hints;
}

function workflowHints(extras, space, template) {
  const workflows = Array.isArray(template?.workflows) ? template.workflows : [];
  const ai = workflows.find((item) => item.id === "ai") || {};
  const git = workflows.find((item) => item.id === "git") || {};
  return [
    {
      id: "ai",
      table: AI_TABLE_NAME,
      title: ai.name || "VibeCoding修改记录修改工作流",
      url: firstNonEmpty(extras["ai-workflow-url"], joinWorkflowUrl(space.baseUrl, ai.workflowPath), space.baseUrl),
      message: "打开「VibeCoding修改记录修改工作流」，复制「接收到 Webhook 时」地址"
    },
    {
      id: "git",
      table: GIT_TABLE_NAME,
      title: git.name || "Git提交工作流",
      url: firstNonEmpty(extras["git-workflow-url"], joinWorkflowUrl(space.baseUrl, git.workflowPath), space.baseUrl),
      message: "打开「Git提交工作流」，复制「接收到 Webhook 时」地址"
    }
  ];
}

function joinWorkflowUrl(baseUrl, workflowPath) {
  const path = String(workflowPath || "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const root = String(baseUrl || "").replace(/\/+$/, "");
  if (!root) return path;
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

function writeIdentifiedState(targetRoot, space) {
  writeJsonAtomic(spaceStatePath(targetRoot), space);
  const envUpdates = {
    [ENV_KEYS.baseToken]: space.baseToken,
    [ENV_KEYS.aiTableId]: space.aiTableId,
    [ENV_KEYS.commitTableId]: space.commitTableId
  };
  if (space.webhooksVerified) {
    envUpdates[ENV_KEYS.aiWebhook] = space.aiWebhookUrl;
    envUpdates[ENV_KEYS.gitWebhook] = space.gitWebhookUrl;
  }
  updateEnvLocal(targetRoot, envUpdates);
}

function pendingWebhookResult(space, hints, comparison, extras = {}) {
  if (hasExtrasWebhook(extras) && !bothExtrasWebhooks(extras)) {
    return incompleteWebhookResult(space, hints, comparison);
  }
  return cliResult({
    status: "needs_action",
    code: SPACE_CODES.webhookSetupRequired,
    message: "空间表已识别，请粘贴两个 Webhook 地址以完成校验。",
    actions: [
      "打开两个「接收到 Webhook 时」工作流页面",
      "复制地址后执行 amber space status --ai-webhook <AI地址> --git-webhook <Git地址>"
    ],
    data: publicSpaceData(space, comparison, hints)
  });
}

function incompleteWebhookResult(space, hints, comparison) {
  return cliResult({
    status: "needs_action",
    code: SPACE_CODES.webhookIncomplete,
    message: "两个 Webhook 都需要提供并完成校验。",
    actions: ["同时提供 --ai-webhook 与 --git-webhook 后再试"],
    data: publicSpaceData(space, comparison, hints)
  });
}

function readyResult(space, comparison, hints) {
  return cliResult({
    status: "ok",
    code: SPACE_CODES.spaceReady,
    message: "飞书 Amber 空间已就绪。",
    data: publicSpaceData(space, comparison, hints)
  });
}

function spaceStatusResult(space, extras, comparison) {
  if (!space.webhooksVerified) {
    return pendingWebhookResult(space, undefined, comparison, extras);
  }
  return readyResult(space, comparison);
}

function schemaMismatchResult(comparison) {
  const missing = (comparison.missingFields || []).join("、");
  return cliResult({
    status: "failed",
    code: SPACE_CODES.schemaMismatch,
    message: missing
      ? `空间字段结构与模板不兼容，缺少：${missing}`
      : "空间字段结构与模板不兼容。",
    data: {
      missingFields: comparison.missingFields || [],
      extraFields: comparison.extraFields || [],
      tables: comparison.tables || []
    }
  });
}

function publicSpaceData(space, comparison, hints) {
  const extraFields = comparison?.extraFields || space?.extraFields || [];
  return {
    configured: Boolean(space?.webhooksVerified),
    baseConfigured: Boolean(space?.baseToken),
    aiTableConfigured: Boolean(space?.aiTableId),
    commitTableConfigured: Boolean(space?.commitTableId),
    aiWebhookConfigured: Boolean(space?.webhooksVerified && space?.aiWebhookUrl),
    gitWebhookConfigured: Boolean(space?.webhooksVerified && space?.gitWebhookUrl),
    schemaOk: comparison ? comparison.ok !== false : Boolean(space?.baseToken),
    extraFields,
    workflowHints: Array.isArray(hints)
      ? hints.map((item) => ({
        id: item.id,
        table: item.table,
        url: item.url || "",
        message: item.message,
        opened: Boolean(item.opened)
      }))
      : []
  };
}

function resolveWebhooks({ extras, env, envLocal, space }) {
  return {
    ai: firstNonEmpty(
      extras["ai-webhook"],
      space?.webhooksVerified ? space.aiWebhookUrl : "",
      env[ENV_KEYS.aiWebhook],
      envLocal[ENV_KEYS.aiWebhook]
    ),
    git: firstNonEmpty(
      extras["git-webhook"],
      space?.webhooksVerified ? space.gitWebhookUrl : "",
      env[ENV_KEYS.gitWebhook],
      envLocal[ENV_KEYS.gitWebhook]
    ),
    aiToken: firstNonEmpty(
      extras["ai-webhook-token"],
      env[ENV_KEYS.aiWebhookToken],
      envLocal[ENV_KEYS.aiWebhookToken]
    ),
    gitToken: firstNonEmpty(
      extras["git-webhook-token"],
      env[ENV_KEYS.gitWebhookToken],
      envLocal[ENV_KEYS.gitWebhookToken]
    )
  };
}

function hasExtrasWebhook(extras) {
  return Boolean(firstNonEmpty(extras?.["ai-webhook"]) || firstNonEmpty(extras?.["git-webhook"]));
}

function bothExtrasWebhooks(extras) {
  return Boolean(firstNonEmpty(extras?.["ai-webhook"]) && firstNonEmpty(extras?.["git-webhook"]));
}

function shouldOpenWorkflows(extras, flags) {
  if (flags?.skipOpen) return false;
  return isEnabled(extras["open-workflows"], true);
}

function isEnabled(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(text)) return false;
  return true;
}

function readEnvLocal(targetRoot) {
  const filePath = resolve(targetRoot, ENV_LOCAL_RELATIVE);
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    values[trimmed.slice(0, index).trim()] = unquote(trimmed.slice(index + 1).trim());
  }
  return values;
}

function updateEnvLocal(targetRoot, updates) {
  const filePath = resolve(targetRoot, ENV_LOCAL_RELATIVE);
  const original = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original ? original.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = [];

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !(match[1] in updates)) {
      nextLines.push(line);
      continue;
    }
    const key = match[1];
    seen.add(key);
    nextLines.push(`${key}=${formatEnvValue(updates[key])}`);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key) || value === undefined || value === null) continue;
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  writeFileAtomic(filePath, `${nextLines.join(newline)}${newline}`);
}

function formatEnvValue(value) {
  const text = String(value ?? "");
  if (/[\s#"'\\]/.test(text)) return JSON.stringify(text);
  return text;
}

function unquote(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, filePath);
}

function cliResult({ status, code, message, actions = [], data = {} }) {
  return {
    status,
    code,
    message: redactCliText(message),
    actions: actions.map((item) => redactCliText(item)).filter(Boolean),
    data: sanitizeData(data)
  };
}

function sanitizeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const omit = new Set([
    "baseToken",
    "aiWebhookUrl",
    "gitWebhookUrl",
    "token",
    "webhook",
    "templateToken"
  ]);
  const copy = {};
  for (const [key, value] of Object.entries(data)) {
    if (omit.has(key)) continue;
    copy[key] = redactValue(value);
  }
  return copy;
}

function redactValue(value) {
  if (typeof value === "string") return redactCliText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const nested = {};
    for (const [key, item] of Object.entries(value)) {
      nested[key] = redactValue(item);
    }
    return nested;
  }
  return value;
}

function ioFailure(error, fallback) {
  return cliResult({
    status: "failed",
    code: error?.code || SPACE_CODES.ioUnavailable,
    message: error?.message || fallback
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === true) continue;
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

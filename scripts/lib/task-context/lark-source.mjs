import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_TABLE_ID,
  QUERY_LIMIT,
  QUERY_TIMEOUT_MS,
  resolveTaskContextSource,
  text
} from "./constants.mjs";

export const AI_FIELDS = [
  "用户需求",
  "修改结果",
  "项目",
  "仓库路径",
  "分支",
  "修改文件",
  "完成时间",
  "事件 ID"
];

export const COMMIT_FIELDS = [
  "提交说明",
  "提交标题",
  "项目",
  "仓库路径",
  "分支",
  "修改文件",
  "提交时间",
  "事件ID",
  "提交SHA",
  "关联AI事件ID"
];

export function buildRecordListArgs({
  tableId,
  fields,
  project,
  sortField,
  baseToken = resolveTaskContextSource().baseToken
}) {
  const filter = {
    logic: "and",
    conditions: [["项目", "==", project]]
  };
  return [
    "base",
    "+record-list",
    "--base-token",
    baseToken,
    "--table-id",
    tableId,
    ...fields.flatMap((field) => ["--field-id", field]),
    "--filter-json",
    JSON.stringify(filter),
    "--sort-json",
    JSON.stringify([{ field: sortField, desc: true }]),
    "--limit",
    String(QUERY_LIMIT),
    "--as",
    "user",
    "--format",
    "json"
  ];
}

export async function listTable({ tableId, fields, project, sortField, baseToken, recordType, runCommand }) {
  const args = buildRecordListArgs({ tableId, fields, project, sortField, baseToken });
  const commandStart = performance.now();
  try {
    const output = await runCommand(args, { timeoutMs: QUERY_TIMEOUT_MS });
    const commandDurationMs = roundMs(performance.now() - commandStart);
    const parseStart = performance.now();
    const records = mapRemoteRecords(parseRecords(output), tableId, recordType);
    return {
      records,
      warnings: [],
      commandDurationMs,
      parseDurationMs: roundMs(performance.now() - parseStart)
    };
  } catch (error) {
    return {
      records: [],
      warnings: [toWarning(tableId, error)],
      commandDurationMs: roundMs(performance.now() - commandStart),
      parseDurationMs: 0
    };
  }
}

export function runLarkCli(args, { timeoutMs = QUERY_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = createLarkCliProcess(args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`查询飞书超时（${Math.round(timeoutMs / 1000)} 秒）。`));
        return;
      }
      if (code !== 0) {
        reject(new Error(sanitizeError(stderr || `lark-cli exited with ${code}`)));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function createLarkCliProcess(args) {
  const invocation = resolveLarkCliInvocation(args);
  return spawn(invocation.command, invocation.args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

export function resolveLarkCliInvocation(args, {
  env = process.env,
  localEntries = defaultLocalCliEntries(),
  findCommands = findPathCommands
} = {}) {
  const configuredCommand = String(env.AMBER_LARK_CLI_PATH || "").trim();
  const configuredEntry = resolveCliEntry(configuredCommand);
  if (configuredEntry) return nodeInvocation(configuredEntry, args);
  if (configuredCommand) return commandInvocation(configuredCommand, args);

  const localEntry = localEntries.find((candidate) => existsSync(candidate));
  if (localEntry) return nodeInvocation(localEntry, args);

  const pathEntry = findCommands("lark-cli")
    .map(resolveCliEntry)
    .find((candidate) => candidate && existsSync(candidate));
  return pathEntry
    ? nodeInvocation(pathEntry, args)
    : commandInvocation("lark-cli", args);
}

function defaultLocalCliEntries() {
  return [
    resolve(dirname(process.execPath), "node_modules/@larksuite/cli/scripts/run.js"),
    resolve(dirname(process.execPath), "../node_modules/@larksuite/cli/scripts/run.js"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/@larksuite/cli/scripts/run.js")
  ];
}

function nodeInvocation(entry, args) {
  return { command: process.execPath, args: [entry, ...args] };
}

function commandInvocation(command, args) {
  if (/\.(?:cmd|bat)$/i.test(command)) {
    throw new Error("AMBER_LARK_CLI_PATH 无法解析到 Node 入口，请改为 lark-cli 的 run.js 绝对路径。");
  }
  return { command, args };
}

function resolveCliEntry(command) {
  if (!command) return null;
  if (/\.(?:c?js|mjs)$/i.test(command) && existsSync(command)) return command;
  const shimEntry = resolveCliEntryFromShim(command);
  if (shimEntry) return shimEntry;
  const directory = dirname(command);
  const candidates = [
    resolve(directory, "node_modules/@larksuite/cli/scripts/run.js"),
    resolve(directory, "../node_modules/@larksuite/cli/scripts/run.js")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function resolveCliEntryFromShim(command) {
  if (!/\.(?:cmd|bat)$/i.test(command) || !existsSync(command)) return null;
  const directory = dirname(command);
  const content = readFileSync(command, "utf8");
  const candidates = [...content.matchAll(/"([^"\r\n]+\.(?:c?js|mjs))"/gi)]
    .map((match) => match[1]
      .replace(/%~dp0/gi, `${directory}\\`)
      .replace(/%dp0%/gi, `${directory}\\`));
  return candidates.map((candidate) => resolve(candidate)).find((candidate) => existsSync(candidate)) || null;
}

function findPathCommands(name) {
  if (process.platform !== "win32") return [];
  const result = spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return [];
  return String(result.stdout || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function parseRecords(output) {
  const parsed = typeof output === "string" ? JSON.parse(output) : output;
  const matrix = parsed?.data?.data;
  if (Array.isArray(matrix) && Array.isArray(parsed?.data?.fields)) {
    return matrix.map((row, index) => ({
      record_id: parsed.data.record_id_list?.[index] || "",
      fields: Object.fromEntries(parsed.data.fields.map((field, fieldIndex) => [field, row[fieldIndex]]))
    }));
  }
  const candidates = [
    parsed?.data?.items,
    parsed?.data?.records,
    parsed?.items,
    parsed?.records,
    parsed?.data
  ];
  const records = candidates.find(Array.isArray);
  if (!records) {
    throw new Error("飞书返回格式无法识别。");
  }
  return records;
}

export function mapRemoteRecords(records, tableId, recordType) {
  return records.map((item) => {
    const fields = item?.fields || item || {};
    return (recordType || (tableId === AI_TABLE_ID ? "change" : "commit")) === "change"
      ? mapAiRecord(fields, item?.record_id || item?.recordId)
      : mapCommitRecord(fields, item?.record_id || item?.recordId);
  }).filter((record) => record.id);
}

function mapAiRecord(fields, fallbackId) {
  return {
    id: textField(fields, ["事件 ID", "event_id"]) || String(fallbackId || ""),
    type: "change",
    task: textField(fields, ["用户需求", "任务", "prompt_summary"]),
    result: textField(fields, ["修改结果", "结果", "result_summary"]),
    project: textField(fields, ["项目", "project"]),
    repository: textField(fields, ["仓库路径", "repo_path"]),
    branch: textField(fields, ["分支", "branch"]),
    files: listField(fields, ["修改文件", "changed_files"]),
    occurredAt: dateField(fields, ["完成时间", "completed_at"]),
    relatedEventIds: []
  };
}

function mapCommitRecord(fields, fallbackId) {
  const commitSha = textField(fields, ["提交SHA", "提交 SHA", "commit_sha"]);
  return {
    id: textField(fields, ["事件ID", "事件 ID"]) || commitSha || String(fallbackId || ""),
    commitSha,
    type: "commit",
    task: "",
    result: textField(fields, ["提交说明", "提交标题", "提交信息", "commit_subject", "commit_message"]),
    project: textField(fields, ["项目", "project"]),
    repository: textField(fields, ["仓库路径", "repo_path"]),
    branch: textField(fields, ["分支", "branch"]),
    files: listField(fields, ["修改文件", "changed_files"]),
    occurredAt: dateField(fields, ["提交时间", "committed_at", "完成时间"]),
    relatedEventIds: eventIdListField(fields, ["关联AI事件ID", "关联 AI 事件", "关联事件", "related_ai_event_ids"])
  };
}

function toWarning(tableId, error) {
  const { aiTableId } = resolveTaskContextSource();
  const label = tableId === AI_TABLE_ID || tableId === aiTableId ? "AI 修改记录" : "Git 提交记录";
  return `${label}飞书查询失败，已尝试本地记录回退：${sanitizeError(error?.message || error)}`;
}

function sanitizeError(value) {
  return String(value).replace(/(?:token|authorization|bearer)\s*[:=]\s*\S+/gi, "[redacted]").slice(0, 500);
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function textField(fields, names) {
  for (const name of names) {
    const value = fields?.[name];
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function listField(fields, names) {
  for (const name of names) {
    const value = fields?.[name];
    const normalized = Array.isArray(value)
      ? value.flatMap((item) => typeof item === "object" && item ? [text(item.name || item.text || item.path)] : [text(item)]).filter(Boolean)
      : parseListText(text(value));
    if (normalized.length) return normalized;
  }
  return [];
}

function eventIdListField(fields, names) {
  const values = listField(fields, names);
  return values.flatMap((value) => value.match(/[a-f0-9]{64}/gi) || [value]).filter(Boolean);
}

function parseListText(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.flatMap((item) => parseListText(text(item?.path || item)));
    if (parsed && typeof parsed === "object") return parseListText(text(parsed.path || parsed.name || parsed.text));
  } catch {
    // Some Base text fields are not JSON; treat them as ordinary line-delimited values.
  }
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function dateField(fields, names) {
  return textField(fields, names);
}

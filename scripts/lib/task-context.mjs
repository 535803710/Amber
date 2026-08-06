import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const AMBER_BASE_TOKEN = "Inmhb4Vl0alBIAsvzaxcxC0Ln0d";
export const AI_TABLE_ID = "tblppOxOQCQkAzoY";
export const COMMIT_TABLE_ID = "tbl9MKpf3sAHG4tR";
export const QUERY_LIMIT = 200;
export const QUERY_TIMEOUT_MS = 8_000;
export const CACHE_TTL_MS = 60_000;
export const DEFAULT_RESULT_LIMIT = 3;
export const MAX_RESULT_LIMIT = 20;

const SCHEMA_VERSION = 2;
const DETAIL_LEVELS = new Set(["minimal", "compact", "full"]);
const TEXT_LIMIT = 240;
const FILE_LIMIT = 12;
const RELATED_COMMIT_LIMIT = 3;
const TEXT_TRUNCATION_MARKER = "…（已截断）";
const FILE_TRUNCATION_MARKER = "…（其余文件已截断）";

const cache = new Map();

const AI_FIELDS = [
  "用户需求",
  "修改结果",
  "项目",
  "仓库路径",
  "分支",
  "修改文件",
  "完成时间",
  "事件 ID"
];
const COMMIT_FIELDS = [
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

export async function getTaskContext(input, options = {}) {
  const request = normalizeRequest(input);
  const now = options.now || Date.now();
  const cacheKey = JSON.stringify(request);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const runCommand = options.runCommand || runLarkCli;
  const [aiResult, commitResult] = await Promise.all([
    listTable({
      tableId: AI_TABLE_ID,
      fields: AI_FIELDS,
      project: request.project,
      sortField: "完成时间",
      runCommand
    }),
    listTable({
      tableId: COMMIT_TABLE_ID,
      fields: COMMIT_FIELDS,
      project: request.project,
      sortField: "提交时间",
      runCommand
    })
  ]);

  const warnings = [...aiResult.warnings, ...commitResult.warnings];
  const remoteRecords = [
    ...aiResult.records.map((record) => ({ ...record, source: "feishu" })),
    ...commitResult.records.map((record) => ({ ...record, source: "feishu" }))
  ];
  const localRecords = remoteRecords.length === 0 || warnings.length > 0
    ? readLocalRecords(request.workspaceRoot)
    : [];
  const records = deduplicateRecords([...remoteRecords, ...localRecords]);
  const aiRecords = records.filter((record) => record.type === "change");
  const commitRecords = records.filter((record) => record.type === "commit");
  const selectedRecords = rankRecords(aiRecords, request)
    .filter((item) => item.eligible)
    .slice(0, request.limit);
  const status = warnings.length > 0 || localRecords.length > 0
    ? "degraded"
    : selectedRecords.length > 0
      ? "ok"
      : "no_strong_history";
  const message = statusMessage(status);
  const value = {
    schema_version: SCHEMA_VERSION,
    status,
    ...(message ? { message } : {}),
    evidence: selectedRecords.map((record) => toEvidence(record, commitRecords, request.detail))
  };

  cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

export function normalizeRequest(input = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("参数必须是对象。");
  }
  const workspaceRoot = resolveRequiredPath(input.workspace_root);
  const task = requiredText(input.task, "task");
  const files = Array.isArray(input.files)
    ? input.files.filter((file) => typeof file === "string" && file.trim()).map((file) => normalizePath(file))
    : [];
  const limit = normalizeLimit(input.limit);
  const detail = normalizeDetail(input.detail);
  return {
    workspaceRoot,
    project: basename(workspaceRoot),
    task,
    files,
    limit,
    detail
  };
}

export function buildRecordListArgs({ tableId, fields, project, sortField }) {
  const filter = {
    logic: "and",
    conditions: [["项目", "==", project]]
  };
  return [
    "base",
    "+record-list",
    "--base-token",
    AMBER_BASE_TOKEN,
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

async function listTable({ tableId, fields, project, sortField, runCommand }) {
  const args = buildRecordListArgs({ tableId, fields, project, sortField });
  try {
    const output = await runCommand(args, { timeoutMs: QUERY_TIMEOUT_MS });
    return { records: mapRemoteRecords(parseRecords(output), tableId), warnings: [] };
  } catch (error) {
    return {
      records: [],
      warnings: [toWarning(tableId, error)]
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
        reject(new Error("查询飞书超时（8 秒）。"));
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
  const cliEntry = resolve(dirname(process.execPath), "node_modules/@larksuite/cli/scripts/run.js");
  const command = process.platform === "win32" && existsSync(cliEntry)
    ? process.execPath
    : "lark-cli";
  const commandArgs = command === process.execPath ? [cliEntry, ...args] : args;
  return spawn(command, commandArgs, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
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

export function mapRemoteRecords(records, tableId) {
  return records.map((item) => {
    const fields = item?.fields || item || {};
    return tableId === AI_TABLE_ID
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

function readLocalRecords(workspaceRoot) {
  return [
    ...readLocalQueue(workspaceRoot, ".local/change-records/queue", "change"),
    ...readLocalQueue(workspaceRoot, ".local/commit-records/queue", "commit")
  ];
}

function readLocalQueue(workspaceRoot, relativeRoot, type) {
  const root = resolve(workspaceRoot, relativeRoot);
  if (!existsSync(root)) return [];
  return ["pending", "sent", "failed"].flatMap((status) => {
    const directory = resolve(root, status);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson(resolve(directory, entry.name))?.event)
      .filter(Boolean)
      .map((event) => type === "change" ? mapLocalAi(event) : mapLocalCommit(event));
  });
}

function mapLocalAi(event) {
  return {
    id: text(event.event_id),
    type: "change",
    task: text(event.prompt_summary),
    result: text(event.result_summary),
    project: text(event.project),
    repository: text(event.repo_path),
    branch: text(event.branch),
    files: filePaths(event.changed_files),
    occurredAt: text(event.completed_at),
    relatedEventIds: [],
    source: "local"
  };
}

function mapLocalCommit(event) {
  return {
    id: text(event.event_id || event.commit_sha),
    commitSha: text(event.commit_sha),
    type: "commit",
    task: "",
    result: text(event.commit_subject || event.commit_message),
    project: text(event.project),
    repository: text(event.repo_path),
    branch: text(event.branch),
    files: filePaths(event.changed_files),
    occurredAt: text(event.committed_at),
    relatedEventIds: Array.isArray(event.related_ai_event_ids) ? event.related_ai_event_ids.map(text).filter(Boolean) : [],
    source: "local"
  };
}

export function rankRecords(records, request) {
  const taskWords = tokenize(request.task);
  const fileSet = new Set(request.files);
  return records.map((record) => ({
    ...record,
    ...scoreRecord(record, request, taskWords, fileSet)
  })).sort((left, right) =>
    right.relevance - left.relevance
    || timestamp(right.occurredAt) - timestamp(left.occurredAt)
    || right.id.localeCompare(left.id)
  );
}

function scoreRecord(record, request, taskWords, fileSet) {
  let score = 0;
  const matchReasons = [];
  const exactRepository = normalizePath(record.repository) === normalizePath(request.workspaceRoot);
  const sameProject = record.project === request.project;
  const sameBranch = record.branch && record.branch === currentBranchHint(request.workspaceRoot);
  const exactFile = record.files.some((file) => fileSet.has(normalizePath(file)));
  const corpus = `${record.task}\n${record.result}`.toLowerCase();
  const keywordHits = [...new Set(taskWords.filter((word) => corpus.includes(word)))];
  const semanticAnchor = keywordHits.length >= 2;
  const fileSemanticAnchor = exactFile && keywordHits.length >= 1;
  const eligible = (sameProject || exactRepository) && (semanticAnchor || fileSemanticAnchor);

  if (sameProject) score += 1;
  if (exactRepository) {
    score += 3;
    matchReasons.push("same_repository");
  }
  if (sameBranch) {
    score += 2;
    matchReasons.push("same_branch");
  }
  if (exactFile) {
    score += 6;
    matchReasons.push("exact_file");
  }
  if (keywordHits.length) {
    score += keywordHits.length * 2;
    matchReasons.push("task_keywords");
  }
  if (recordsRelatedFile(record, request)) score += 1;

  return {
    relevance: score,
    eligible,
    confidence: eligible ? "high" : "none",
    matchReasons
  };
}

function recordsRelatedFile(record, request) {
  return record.project === request.project && record.files.some((file) => request.files.includes(normalizePath(file)));
}

function currentBranchHint(workspaceRoot) {
  const marker = resolve(workspaceRoot, ".git", "HEAD");
  try {
    const text = readFileSync(marker, "utf8").trim();
    return text.startsWith("ref: refs/heads/") ? text.slice("ref: refs/heads/".length) : "";
  } catch {
    return "";
  }
}

function deduplicateRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.type}:${record.id}`;
    if (!record.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toEvidence(record, commits, detail) {
  const core = {
    task: limitText(record.task),
    result: limitText(record.result),
    files: limitFiles(record.files)
  };
  if (detail === "minimal") return core;

  const relatedCommits = commits
    .filter((commit) => commit.relatedEventIds.includes(record.id))
    .sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))
    .slice(0, RELATED_COMMIT_LIMIT)
    .map((commit) => toRelatedCommit(commit, detail));
  const compact = {
    kind: "ai_change",
    ...core,
    occurred_at: record.occurredAt,
    branch: record.branch,
    related_commits: relatedCommits
  };
  if (detail === "compact") return compact;

  return {
    id: record.id,
    ...compact,
    repository: record.repository,
    source: record.source,
    confidence: record.confidence,
    match_reasons: record.matchReasons,
    relevance: record.relevance
  };
}

function toRelatedCommit(commit, detail) {
  const compact = {
    sha: limitText(commit.commitSha || commit.id),
    subject: limitText(commit.result),
    occurred_at: commit.occurredAt
  };
  if (detail === "compact") return compact;
  return {
    id: commit.id,
    ...compact,
    files: limitFiles(commit.files),
    source: commit.source
  };
}

function statusMessage(status) {
  if (status === "degraded") return "历史来源不完整，已尝试本地回退，结果可能不完整。";
  if (status === "no_strong_history") return "未找到与当前任务强关联的 AI 修改记录。";
  return "";
}

function limitText(value) {
  const normalized = text(value);
  if (normalized.length <= TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, TEXT_LIMIT - TEXT_TRUNCATION_MARKER.length)}${TEXT_TRUNCATION_MARKER}`;
}

function limitFiles(files) {
  const normalized = Array.isArray(files) ? files.map(limitText).filter(Boolean) : [];
  if (normalized.length <= FILE_LIMIT) return normalized;
  return [...normalized.slice(0, FILE_LIMIT - 1), FILE_TRUNCATION_MARKER];
}

function toWarning(tableId, error) {
  const label = tableId === AI_TABLE_ID ? "AI 修改记录" : "Git 提交记录";
  return `${label}飞书查询失败，已尝试本地记录回退：${sanitizeError(error?.message || error)}`;
}

function sanitizeError(value) {
  return String(value).replace(/(?:token|authorization|bearer)\s*[:=]\s*\S+/gi, "[redacted]").slice(0, 500);
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

function filePaths(value) {
  return Array.isArray(value) ? value.map((item) => text(item?.path || item)).filter(Boolean) : [];
}

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") return text(value.text || value.name || value.value);
  return "";
}

function tokenize(value) {
  const normalized = String(value).toLowerCase();
  const latinTokens = normalized.match(/[a-z0-9_./-]{2,}/g) || [];
  const cjkRuns = normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
  const cjkTokens = cjkRuns.flatMap((run) => {
    const tokens = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
    if (run.length <= 8) tokens.push(run);
    return tokens;
  });
  const stopWords = new Set([
    "修改", "代码", "功能", "问题", "页面", "调整", "继续", "实现", "修复", "新增", "完成", "配置",
    "需求", "结果", "方案", "验证", "测试", "支持", "处理", "描述", "名称", "名词", "更新", "能力",
    "目标", "流程", "步骤", "使用", "数据", "信息", "原因", "之前", "过去", "是否", "可能", "需要",
    "提供", "查询", "调用", "记录", "项目", "文档", "说明", "研发", "现场", "恢复", "系统", "任务",
    "上下", "下文", "上下文", "当前", "历史", "决策", "避免", "无关", "相关", "相关性", "影响", "优化",
    "change", "changes", "code", "context", "current", "decision", "docs", "fix", "history", "implement",
    "issue", "project", "record", "task", "update"
  ]);
  return [...new Set([...latinTokens, ...cjkTokens])].filter((token) => !stopWords.has(token));
}

function timestamp(value) {
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? 0 : result;
}

function normalizePath(value) {
  let normalized = String(value || "").replaceAll("\\", "/").toLowerCase();
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

function resolveRequiredPath(value) {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) {
    throw new TypeError("workspace_root 必须是绝对路径。");
  }
  return resolve(value);
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} 必须是非空字符串。`);
  return value.trim().slice(0, 2_000);
}

function normalizeLimit(value) {
  if (value === undefined) return DEFAULT_RESULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
    throw new RangeError(`limit 必须在 1 到 ${MAX_RESULT_LIMIT} 之间。`);
  }
  return value;
}

function normalizeDetail(value) {
  if (value === undefined) return "minimal";
  if (typeof value !== "string" || !DETAIL_LEVELS.has(value)) {
    throw new RangeError("detail 必须是 minimal、compact 或 full。");
  }
  return value;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

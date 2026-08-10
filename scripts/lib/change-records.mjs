import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  claimReadyOutboxItems,
  countOutboxFiles,
  ensureOutboxDirs
} from "./file-outbox.mjs";

export const CHANGE_RECORD_DIR = ".local/change-records";
export const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

const MAX_PROMPT_LENGTH = 1_000;
const MAX_RESULT_LENGTH = 4_000;
const MAX_CHANGED_FILES = 200;

export function beginChangeTurn(input, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const source = normalizeSource(input.source);
  const cwd = resolve(input.cwd || process.cwd());
  const identity = resolveTurnIdentity(input);
  const repo = inspectRepository(cwd);

  if (!repo) {
    appendChangeLog(rootDir, `${source} begin skipped: not a Git repository (${cwd})`);
    return { ok: true, skipped: "not_git" };
  }

  const filePath = baselinePath(rootDir, source, identity.key);
  const existing = readJson(filePath);
  if (existing) {
    appendChangeLog(rootDir, `${source} begin duplicate ${identity.key} ${repo.root}`);
    return { ok: true, baseline: existing, duplicate: true };
  }

  archiveSupersededBaselines(rootDir, source, identity, repo.root);

  const tree = captureWorktreeTree(repo.root);
  const baseline = {
    schemaVersion: 1,
    source,
    sessionId: identity.sessionId,
    turnId: identity.turnId,
    key: identity.key,
    cwd,
    repoRoot: repo.root,
    project: basename(repo.root),
    branch: repo.branch,
    headCommit: repo.headCommit,
    ...readGitAuthor(repo.root),
    baselineTree: tree,
    prompt: truncateText(extractPrompt(input), MAX_PROMPT_LENGTH),
    startedAt: new Date().toISOString()
  };

  writeJsonAtomic(filePath, baseline);
  appendChangeLog(rootDir, `${source} begin ${identity.key} ${repo.root}`);
  return { ok: true, baseline };
}

export function cacheChangeTurnResponse(input, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const source = normalizeSource(input.source);
  const identity = resolveTurnIdentity(input);
  const response = truncateText(extractResult(input), MAX_RESULT_LENGTH);
  if (!response) {
    return { ok: true, skipped: "empty_response" };
  }

  const filePath = responsePath(rootDir, source, identity.key);
  writeJsonAtomic(filePath, {
    source,
    sessionId: identity.sessionId,
    turnId: identity.turnId,
    response,
    updatedAt: new Date().toISOString()
  });
  return { ok: true };
}

export function completeChangeTurn(input, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const source = normalizeSource(input.source);
  const identity = resolveTurnIdentity(input);
  const match = findBaselineForCompletion(rootDir, source, identity, input.cwd);
  const filePath = match?.filePath || baselinePath(rootDir, source, identity.key);
  const baseline = match?.baseline || readJson(filePath);
  const exactResponseFile = responsePath(rootDir, source, identity.key);
  let responseFile = exactResponseFile;

  if (!baseline) {
    appendChangeLog(rootDir, `${source} complete skipped: missing baseline ${identity.key}`);
    return { ok: true, skipped: "missing_baseline" };
  }

  try {
    const repo = inspectRepository(baseline.repoRoot);
    if (!repo || repo.root !== baseline.repoRoot) {
      appendChangeLog(rootDir, `${source} complete skipped: repository unavailable ${baseline.repoRoot}`);
      return { ok: true, skipped: "repository_unavailable" };
    }

    const resultTree = captureWorktreeTree(repo.root);
    if (resultTree === baseline.baselineTree) {
      appendChangeLog(rootDir, `${source} complete ${identity.key}: no changes`);
      return { ok: true, skipped: "no_changes" };
    }

    const diff = summarizeTreeDiff(repo.root, baseline.baselineTree, resultTree);
    if (diff.changedFiles.length === 0) {
      return { ok: true, skipped: "no_changes" };
    }

    const concurrent = findConcurrentBaselines(rootDir, baseline).length > 0;
    let responseCache = readJson(exactResponseFile);
    if (!responseCache) {
      const responseMatch = findLatestResponse(rootDir, source, baseline.sessionId);
      responseCache = responseMatch?.response || null;
      responseFile = responseMatch?.filePath || exactResponseFile;
    }
    const resultSummary = truncateText(
      extractResult(input) || responseCache?.response || "",
      MAX_RESULT_LENGTH
    );
    const completedAt = new Date().toISOString();
    const eventTurnId =
      identity.turnId !== identity.sessionId ? identity.turnId : baseline.turnId;
    const eventId = createEventId({
      source,
      sessionId: baseline.sessionId,
      turnId: eventTurnId,
      repoRoot: repo.root,
      resultTree
    });
    const event = {
      schema_version: 1,
      event_id: eventId,
      source,
      completed_at: completedAt,
      project: baseline.project,
      repo_path: repo.root,
      branch: repo.branch || baseline.branch,
      head_commit: repo.headCommit || baseline.headCommit,
      author_name: baseline.authorName || "",
      author_email: baseline.authorEmail || "",
      session_id: baseline.sessionId,
      turn_id: eventTurnId,
      prompt_summary: truncateText(extractPrompt(input) || baseline.prompt, MAX_PROMPT_LENGTH),
      result_summary: resultSummary,
      changed_files: diff.changedFiles.slice(0, MAX_CHANGED_FILES),
      changed_file_count: diff.changedFiles.length,
      additions: diff.additions,
      deletions: diff.deletions,
      result_status: normalizeResultStatus(input),
      collection_quality: concurrent ? "concurrent_risk" : "exact",
      baseline_tree: baseline.baselineTree,
      result_tree: resultTree
    };

    const enqueueResult = enqueueChangeEvent(event, { rootDir });
    appendChangeLog(
      rootDir,
      `${source} complete ${identity.key}: ${diff.changedFiles.length} files, +${diff.additions}/-${diff.deletions}`
    );
    return { ok: true, event, ...enqueueResult };
  } finally {
    removeIfExists(filePath);
    removeIfExists(responseFile);
  }
}

export function enqueueChangeEvent(event, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  ensureQueueDirs(rootDir);
  const eventId = safeFileName(event.event_id);
  const pendingFile = queueFile(rootDir, "pending", eventId);
  const sentFile = queueFile(rootDir, "sent", eventId);
  const failedFile = queueFile(rootDir, "failed", eventId);

  const processingFile = queueFile(rootDir, "processing", eventId);
  if (
    existsSync(pendingFile) ||
    existsSync(processingFile) ||
    existsSync(sentFile) ||
    existsSync(failedFile)
  ) {
    return { queued: false, duplicate: true };
  }

  writeJsonAtomic(pendingFile, {
    event,
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextAttemptAt: new Date().toISOString(),
    lastError: null
  });
  return { queued: true, duplicate: false };
}

export function listReadyQueueItems(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const now = options.now ? new Date(options.now) : new Date();
  ensureQueueDirs(rootDir);

  return listJsonFiles(queueDir(rootDir, "pending"))
    .map((filePath) => ({ filePath, envelope: readJson(filePath) }))
    .filter((item) => item.envelope?.event?.event_id)
    .filter((item) => {
      const next = new Date(item.envelope.nextAttemptAt || 0);
      return Number.isNaN(next.getTime()) || next <= now;
    })
    .sort((a, b) => String(a.envelope.createdAt).localeCompare(String(b.envelope.createdAt)));
}

export function claimReadyQueueItems(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  return claimReadyOutboxItems({
    queueRoot: queueRoot(rootDir),
    now: options.now || new Date(),
    limit: options.limit ?? Infinity,
    processingLeaseMs: options.processingLeaseMs,
    readEnvelope: readJson,
    writeEnvelope: writeJsonAtomic
  });
}

export function markQueueItemSent(item, response, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const eventId = safeFileName(item.envelope.event.event_id);
  const target = queueFile(rootDir, "sent", eventId);
  writeJsonAtomic(target, {
    ...withoutClaim(item.envelope),
    sentAt: new Date().toISOString(),
    response: sanitizeResponse(response)
  });
  removeIfExists(item.filePath);
}

export function markQueueItemFailed(item, error, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const attempts = Number(item.envelope.attempts || 0) + 1;
  const lastError = truncateText(error?.message || String(error), 1_000);
  const nextEnvelope = {
    ...withoutClaim(item.envelope),
    attempts,
    lastError,
    lastAttemptAt: new Date().toISOString()
  };

  if (attempts >= MAX_ATTEMPTS) {
    nextEnvelope.failedAt = new Date().toISOString();
    const target = queueFile(rootDir, "failed", safeFileName(item.envelope.event.event_id));
    writeJsonAtomic(target, nextEnvelope);
    removeIfExists(item.filePath);
    return { failedPermanently: true, attempts };
  }

  nextEnvelope.nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString();
  const pendingFile = queueFile(rootDir, "pending", safeFileName(item.envelope.event.event_id));
  writeJsonAtomic(pendingFile, nextEnvelope);
  if (item.filePath !== pendingFile) {
    removeIfExists(item.filePath);
  }
  return { failedPermanently: false, attempts, nextAttemptAt: nextEnvelope.nextAttemptAt };
}

export function replayFailedEvents(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  ensureQueueDirs(rootDir);
  let replayed = 0;

  for (const filePath of listJsonFiles(queueDir(rootDir, "failed"))) {
    const envelope = readJson(filePath);
    if (!envelope?.event?.event_id) {
      continue;
    }
    const eventId = safeFileName(envelope.event.event_id);
    writeJsonAtomic(queueFile(rootDir, "pending", eventId), {
      ...envelope,
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      replayedAt: new Date().toISOString()
    });
    removeIfExists(filePath);
    replayed += 1;
  }

  return { replayed };
}

export function getChangeRecordStatus(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  ensureQueueDirs(rootDir);
  const state = readJson(resolve(changeRecordRoot(rootDir), "worker-state.json")) || {};
  return {
    configured: Boolean(options.webhookUrl || process.env.FEISHU_CHANGE_WEBHOOK_URL),
    tokenConfigured: Boolean(options.webhookToken || process.env.FEISHU_CHANGE_WEBHOOK_TOKEN),
    pending: listJsonFiles(queueDir(rootDir, "pending")).length,
    processing: countOutboxFiles(queueRoot(rootDir), "processing"),
    failed: listJsonFiles(queueDir(rootDir, "failed")).length,
    sent: listJsonFiles(queueDir(rootDir, "sent")).length,
    lastHeartbeatAt: state.lastHeartbeatAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastErrorAt: state.lastErrorAt || null,
    lastError: state.lastError || null
  };
}

export function writeWorkerState(patch, options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const filePath = resolve(changeRecordRoot(rootDir), "worker-state.json");
  const current = readJson(filePath) || {};
  writeJsonAtomic(filePath, { ...current, ...patch });
}

export function toWebhookPayload(event) {
  const fileLines = event.changed_files.map((item) => {
    const oldPath = item.old_path ? `${item.old_path} -> ` : "";
    return `${item.status} ${oldPath}${item.path}`;
  });
  const result = event.result_summary || `${event.changed_file_count} 个文件发生修改`;
  const titleSummary = truncateText(result.split(/\r?\n/)[0], 80);

  return {
    schema_version: event.schema_version,
    author_name: event.author_name || "",
    author_email: event.author_email || "",
    "\u4f5c\u8005": event.author_name || "",
    "\u4f5c\u8005\u90ae\u7bb1": event.author_email || "",
    "修改记录": `[${event.source}] ${event.project} - ${titleSummary}`,
    "完成时间": event.completed_at,
    "工具": event.source,
    "项目": event.project,
    "仓库路径": event.repo_path,
    "分支": event.branch,
    "HEAD 提交": event.head_commit,
    "用户需求": event.prompt_summary,
    "修改结果": result,
    "修改文件": fileLines.join("\n"),
    "文件数": event.changed_file_count,
    "新增行": event.additions,
    "删除行": event.deletions,
    "结果状态": resultStatusLabel(event.result_status),
    "采集质量": event.collection_quality === "concurrent_risk" ? "并发风险" : "精确",
    "会话 ID": event.session_id,
    "轮次 ID": event.turn_id,
    "事件 ID": event.event_id
  };
}

export function inspectRepository(cwd) {
  const rootResult = runGit(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (!rootResult.ok || !rootResult.stdout.trim()) {
    return null;
  }
  const root = resolve(rootResult.stdout.trim());
  const branch = runGit(root, ["branch", "--show-current"], { allowFailure: true }).stdout.trim();
  const headCommit = runGit(root, ["rev-parse", "HEAD"], { allowFailure: true }).stdout.trim();
  return { root, branch, headCommit };
}

export function captureWorktreeTree(repoRoot) {
  const token = createHash("sha256")
    .update(`${repoRoot}\0${process.pid}\0${Date.now()}\0${Math.random()}`)
    .digest("hex")
    .slice(0, 16);
  const indexPath = resolve(tmpdir(), `amber-index-${token}`);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };

  try {
    const head = runGit(repoRoot, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
    runGit(repoRoot, head.ok ? ["read-tree", "HEAD"] : ["read-tree", "--empty"], { env });
    runGit(repoRoot, ["add", "-A", "--", "."], { env });
    return runGit(repoRoot, ["write-tree"], { env }).stdout.trim();
  } finally {
    removeIfExists(indexPath);
    removeIfExists(`${indexPath}.lock`);
  }
}

export function summarizeTreeDiff(repoRoot, baselineTree, resultTree) {
  const nameStatus = runGit(repoRoot, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-status",
    "--find-renames",
    baselineTree,
    resultTree,
    "--"
  ]).stdout;
  const changedFiles = nameStatus
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseNameStatusLine);

  const numstat = runGit(repoRoot, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--numstat",
    "--find-renames",
    baselineTree,
    resultTree,
    "--"
  ]).stdout;
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const [added, deleted] = line.split("\t");
    additions += numericDiffValue(added);
    deletions += numericDiffValue(deleted);
  }

  return { changedFiles, additions, deletions };
}

function parseNameStatusLine(line) {
  const parts = line.split("\t");
  const statusToken = parts[0] || "M";
  const status = statusToken[0];
  if ((status === "R" || status === "C") && parts.length >= 3) {
    return { status, old_path: parts[1], path: parts[2] };
  }
  return { status, path: parts[1] || parts[0] };
}

function numericDiffValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function runGit(cwd, args, options = {}) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: options.env || process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  const ok = result.status === 0 && !result.error;
  if (!ok && !options.allowFailure) {
    const detail = String(result.stderr || result.error?.message || "git command failed").trim();
    throw new Error(detail);
  }
  return {
    ok,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    status: result.status
  };
}

function resolveTurnIdentity(input) {
  const sessionId = firstText(
    input.sessionId,
    input.session_id,
    input.conversation_id,
    input.generation_id,
    "unknown-session"
  );
  const turnId = firstText(
    input.turnId,
    input.turn_id,
    input.generation_id,
    input.request_id,
    sessionId
  );
  return {
    sessionId: truncateText(sessionId, 200),
    turnId: truncateText(turnId, 200),
    key: safeFileName(`${sessionId}-${turnId}`)
  };
}

function normalizeSource(value) {
  return String(value || "").toLowerCase() === "cursor" ? "Cursor" : "ChatGPT";
}

function readGitAuthor(repoRoot) {
  return {
    authorName: runGit(repoRoot, ["config", "--get", "user.name"], { allowFailure: true }).stdout.trim(),
    authorEmail: runGit(repoRoot, ["config", "--get", "user.email"], { allowFailure: true }).stdout.trim()
  };
}

function extractPrompt(input) {
  const messages = input.input_messages || input["input-messages"];
  if (Array.isArray(messages)) {
    return messages.map((item) => (typeof item === "string" ? item : item?.content || "")).filter(Boolean).join("\n");
  }
  return firstText(input.prompt, input.user_message, input.userMessage, input.message, input.input);
}

function extractResult(input) {
  return firstText(
    input.resultSummary,
    input.last_assistant_message,
    input["last-assistant-message"],
    input.response,
    input.agent_message,
    input.text
  );
}

function normalizeResultStatus(input) {
  const value = String(input.resultStatus || input.status || "completed").toLowerCase();
  if (/(fail|error)/.test(value)) {
    return "failed";
  }
  if (/(interrupt|abort|cancel)/.test(value)) {
    return "interrupted";
  }
  return "completed";
}

function resultStatusLabel(value) {
  if (value === "failed") {
    return "失败";
  }
  if (value === "interrupted") {
    return "中断";
  }
  return "完成";
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function createEventId({ source, sessionId, turnId, repoRoot, resultTree }) {
  return createHash("sha256")
    .update(`${source}\0${sessionId}\0${turnId}\0${repoRoot}\0${resultTree}`)
    .digest("hex");
}

function findConcurrentBaselines(rootDir, baseline) {
  const baseDir = resolve(changeRecordRoot(rootDir), "baselines");
  if (!existsSync(baseDir)) {
    return [];
  }
  return listJsonFilesRecursive(baseDir)
    .map((filePath) => readJson(filePath))
    .filter(Boolean)
    .filter((item) => Date.now() - new Date(item.startedAt || 0).getTime() < 24 * 60 * 60 * 1_000)
    .filter(
      (item) =>
        (item.key !== baseline.key || item.source !== baseline.source) &&
        item.repoRoot === baseline.repoRoot
    );
}

function findBaselineForCompletion(rootDir, source, identity, cwd) {
  const exactPath = baselinePath(rootDir, source, identity.key);
  const exact = readJson(exactPath);
  if (exact) {
    return { filePath: exactPath, baseline: exact };
  }

  if (source !== "Cursor") {
    return null;
  }

  const repo = inspectRepository(cwd || process.cwd());
  const candidates = listJsonFiles(resolve(changeRecordRoot(rootDir), "baselines", source.toLowerCase()))
    .map((filePath) => ({ filePath, baseline: readJson(filePath) }))
    .filter((item) => item.baseline?.sessionId === identity.sessionId)
    .filter((item) => !repo || item.baseline.repoRoot === repo.root)
    .sort((a, b) => String(b.baseline.startedAt).localeCompare(String(a.baseline.startedAt)));
  return candidates[0] || null;
}

function archiveSupersededBaselines(rootDir, source, identity, repoRoot) {
  const directory = resolve(changeRecordRoot(rootDir), "baselines", source.toLowerCase());
  const identityHash = createHash("sha256").update(identity.key).digest("hex").slice(0, 12);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${identityHash}-superseded`;
  const archiveRoot = resolve(changeRecordRoot(rootDir), "baselines-reset", runId);
  const entries = [];
  for (const filePath of listJsonFiles(directory)) {
    const baseline = readJson(filePath);
    if (
      baseline?.key === identity.key ||
      baseline?.sessionId !== identity.sessionId ||
      baseline?.repoRoot !== repoRoot
    ) {
      continue;
    }
    const sourceName = source.toLowerCase();
    const destinationDir = resolve(archiveRoot, sourceName);
    mkdirSync(destinationDir, { recursive: true });
    const destination = resolve(destinationDir, basename(filePath));
    renameSync(filePath, destination);

    const responseFile = responsePath(rootDir, source, baseline.key);
    let archivedResponsePath = null;
    if (existsSync(responseFile)) {
      const responseDestinationDir = resolve(archiveRoot, "responses", sourceName);
      mkdirSync(responseDestinationDir, { recursive: true });
      archivedResponsePath = resolve(responseDestinationDir, basename(responseFile));
      renameSync(responseFile, archivedResponsePath);
    }
    entries.push({
      source: sourceName,
      fileName: basename(filePath),
      key: baseline.key,
      startedAt: baseline.startedAt || null,
      reason: "superseded",
      supersededBy: identity.key,
      archivedPath: destination,
      archivedResponsePath
    });
    appendChangeLog(rootDir, `${source} superseded ${baseline.key} by ${identity.key}`);
  }
  if (entries.length > 0) {
    writeJsonAtomic(resolve(archiveRoot, "manifest.json"), {
      runId,
      createdAt: new Date().toISOString(),
      reason: "superseded",
      supersededBy: identity.key,
      entries
    });
  }
}

function findLatestResponse(rootDir, source, sessionId) {
  const candidates = listJsonFiles(resolve(changeRecordRoot(rootDir), "responses", source.toLowerCase()))
    .map((filePath) => ({ filePath, response: readJson(filePath) }))
    .filter((item) => item.response?.sessionId === sessionId)
    .sort((a, b) => String(b.response.updatedAt).localeCompare(String(a.response.updatedAt)));
  return candidates[0] || null;
}

function changeRecordRoot(rootDir) {
  return resolve(rootDir, CHANGE_RECORD_DIR);
}

function baselinePath(rootDir, source, key) {
  return resolve(changeRecordRoot(rootDir), "baselines", source.toLowerCase(), `${safeFileName(key)}.json`);
}

function responsePath(rootDir, source, key) {
  return resolve(changeRecordRoot(rootDir), "responses", source.toLowerCase(), `${safeFileName(key)}.json`);
}

function queueDir(rootDir, name) {
  return resolve(changeRecordRoot(rootDir), "queue", name);
}

function queueRoot(rootDir) {
  return resolve(changeRecordRoot(rootDir), "queue");
}

function queueFile(rootDir, name, eventId) {
  return resolve(queueDir(rootDir, name), `${safeFileName(eventId)}.json`);
}

function ensureQueueDirs(rootDir) {
  ensureOutboxDirs(queueRoot(rootDir));
}

function withoutClaim(envelope) {
  const result = { ...envelope };
  delete result.claimedAt;
  return result;
}

function safeFileName(value) {
  const text = String(value || "unknown").replace(/[^A-Za-z0-9._-]+/g, "-");
  if (text.length <= 180) {
    return text;
  }
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `${text.slice(0, 160)}-${hash}`;
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listJsonFiles(dirPath) {
  if (!existsSync(dirPath)) {
    return [];
  }
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolve(dirPath, entry.name));
}

function listJsonFilesRecursive(dirPath) {
  if (!existsSync(dirPath)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFilesRecursive(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

function removeIfExists(filePath) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function sanitizeResponse(response) {
  if (!response) {
    return null;
  }
  return {
    statusCode: response.statusCode,
    body: truncateText(response.body, 500)
  };
}

function appendChangeLog(rootDir, message) {
  const filePath = resolve(changeRecordRoot(rootDir), "change-records.log");
  mkdirSync(dirname(filePath), { recursive: true });
  const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = `${current}[${new Date().toISOString()}] ${message}\n`
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-500);
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

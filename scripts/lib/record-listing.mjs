import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_STATUSES = ["pending", "sent", "failed"];
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const recordRoots = {
  change: ".local/change-records/queue",
  commit: ".local/commit-records/queue"
};

export function listRecordPage(kind, query = {}, options = {}) {
  const normalizedKind = normalizeKind(kind);
  const { status, page, pageSize } = normalizeListQuery(query);
  const rootDir = resolve(options.rootDir || process.cwd());
  const records = QUEUE_STATUSES.flatMap((queueStatus) =>
    readQueue(rootDir, normalizedKind, queueStatus)
  );
  const counts = countByStatus(records);
  const filtered = status === "all"
    ? records
    : records.filter((record) => record.queueStatus === status);
  const sorted = filtered.sort(compareByOccurredAt);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    items: sorted.slice(start, start + pageSize),
    counts,
    pagination: {
      page: currentPage,
      pageSize,
      totalItems: sorted.length,
      totalPages,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages
    }
  };
}

export function normalizeListQuery(query = {}) {
  const status = readQueryValue(query, "status") || "all";
  if (status !== "all" && !QUEUE_STATUSES.includes(status)) {
    throw new RangeError("status 必须为 all、pending、sent 或 failed。");
  }

  return {
    status,
    page: readPositiveInteger(readQueryValue(query, "page"), "page", 1, Number.MAX_SAFE_INTEGER),
    pageSize: readPositiveInteger(readQueryValue(query, "pageSize"), "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  };
}

function readQueue(rootDir, kind, queueStatus) {
  const directory = resolve(rootDir, recordRoots[kind], queueStatus);
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(resolve(directory, entry.name)))
    .filter((envelope) => envelope?.event)
    .map((envelope) => toRecordProjection(kind, queueStatus, envelope))
    .filter(Boolean);
}

function toRecordProjection(kind, queueStatus, envelope) {
  return kind === "change"
    ? toChangeRecord(queueStatus, envelope)
    : toCommitRecord(queueStatus, envelope);
}

function toChangeRecord(queueStatus, envelope) {
  const event = envelope.event;
  if (!event.event_id) {
    return null;
  }

  return {
    id: event.event_id,
    type: "change",
    queueStatus,
    occurredAt: firstText(event.completed_at, envelope.createdAt, envelope.sentAt),
    createdAt: stringOrEmpty(envelope.createdAt),
    deliveredAt: stringOrEmpty(envelope.sentAt),
    project: stringOrEmpty(event.project),
    branch: stringOrEmpty(event.branch),
    source: stringOrEmpty(event.source),
    summary: firstText(event.result_summary, event.prompt_summary, `${numberOrZero(event.changed_file_count)} 个文件发生修改`),
    promptSummary: stringOrEmpty(event.prompt_summary),
    resultSummary: stringOrEmpty(event.result_summary),
    changedFiles: normalizeFiles(event.changed_files),
    changedFileCount: numberOrZero(event.changed_file_count),
    additions: numberOrZero(event.additions),
    deletions: numberOrZero(event.deletions),
    resultStatus: stringOrEmpty(event.result_status),
    collectionQuality: stringOrEmpty(event.collection_quality),
    attempts: numberOrZero(envelope.attempts),
    lastError: stringOrEmpty(envelope.lastError)
  };
}

function toCommitRecord(queueStatus, envelope) {
  const event = envelope.event;
  if (!event.event_id) {
    return null;
  }

  return {
    id: event.event_id,
    type: "commit",
    queueStatus,
    occurredAt: firstText(event.committed_at, envelope.createdAt, envelope.sentAt),
    createdAt: stringOrEmpty(envelope.createdAt),
    deliveredAt: stringOrEmpty(envelope.sentAt),
    project: stringOrEmpty(event.project),
    branch: stringOrEmpty(event.branch),
    authorName: stringOrEmpty(event.author_name),
    shortSha: stringOrEmpty(event.short_sha),
    summary: firstText(event.commit_subject, "无提交说明"),
    commitMessage: stringOrEmpty(event.commit_message),
    commitKind: stringOrEmpty(event.commit_kind),
    changedFiles: normalizeFiles(event.changed_files),
    changedFileCount: numberOrZero(event.changed_file_count),
    additions: numberOrZero(event.additions),
    deletions: numberOrZero(event.deletions),
    relatedAiEventIds: normalizeStringList(event.related_ai_event_ids),
    attempts: numberOrZero(envelope.attempts),
    lastError: stringOrEmpty(envelope.lastError)
  };
}

function normalizeKind(kind) {
  if (kind === "change" || kind === "commit") {
    return kind;
  }
  throw new RangeError("记录类型必须为 change 或 commit。");
}

function readPositiveInteger(value, name, fallback, maximum) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (!/^\d+$/.test(String(value))) {
    throw new RangeError(`${name} 必须为正整数。`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new RangeError(`${name} 必须在 1 到 ${maximum} 之间。`);
  }
  return number;
}

function readQueryValue(query, name) {
  if (typeof query?.get === "function") {
    return query.get(name) || "";
  }
  return query?.[name] ?? "";
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function countByStatus(records) {
  return {
    all: records.length,
    pending: records.filter((record) => record.queueStatus === "pending").length,
    sent: records.filter((record) => record.queueStatus === "sent").length,
    failed: records.filter((record) => record.queueStatus === "failed").length
  };
}

function compareByOccurredAt(left, right) {
  return toTimestamp(right.occurredAt) - toTimestamp(left.occurredAt)
    || right.id.localeCompare(left.id);
}

function toTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeFiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item && typeof item.path === "string")
    .map((item) => ({
      status: stringOrEmpty(item.status),
      path: item.path,
      oldPath: stringOrEmpty(item.old_path)
    }));
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}
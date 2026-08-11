// facade：协调子模块，保持对外接口兼容

import { basename, isAbsolute, resolve } from "node:path";
import { realpathSync } from "node:fs";

import {
  AI_TABLE_ID,
  COMMIT_TABLE_ID,
  CACHE_TTL_MS,
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  resolveTaskContextSource,
  timestamp
} from "./task-context/constants.mjs";
import {
  getCached,
  setCached,
  getDataset,
  setDataset,
  setNegativeDataset,
  getInflight,
  setInflight,
  NEGATIVE_TTL_MS,
  withFetchSlot
} from "./task-context/cache.mjs";
import {
  AI_FIELDS,
  COMMIT_FIELDS,
  listTable,
  runLarkCli
} from "./task-context/lark-source.mjs";
import { readLocalRecords } from "./task-context/local-queue-source.mjs";
import { rankRecords, normalizePath } from "./task-context/ranking.mjs";
import { deduplicateRecords, toEvidence, statusMessage } from "./task-context/evidence.mjs";
import { timedAsync } from "./task-context/metrics.mjs";

// re-export：保持测试和 mcp-stdio-server 的导入路径不变
export { AI_TABLE_ID, COMMIT_TABLE_ID, QUERY_LIMIT } from "./task-context/constants.mjs";
export { buildRecordListArgs, parseRecords, mapRemoteRecords } from "./task-context/lark-source.mjs";

const SCHEMA_VERSION = 2;
const DETAIL_LEVELS = new Set(["minimal", "compact", "full"]);
const DETAIL_RANK = { minimal: 0, compact: 1, full: 2 };
const ADAPTIVE_HISTORY_LIMIT = 8;
const ADAPTIVE_HISTORY_ENV = "AMBER_TASK_CONTEXT_ADAPTIVE_HISTORY";
const EVOLUTION_PHRASES = [
  "历史调整", "历史演变", "演变过程", "演进过程", "决策过程", "最终决定", "最终口径",
  "之前如何处理", "过去如何处理", "decision history", "final decision", "migration", "renamed",
  "removed", "deprecated"
];
const TEMPORAL_MARKERS = ["历史", "之前", "过去", "旧版", "旧组件", "旧实现", "v1", "v2"];
const TRANSITION_MARKERS = ["调整", "演变", "演进", "重构", "迁移", "重命名", "删除", "移除", "替换", "废弃", "最终", "决定", "口径"];

export async function getTaskContext(input, options = {}) {
  const startMs = performance.now();
  const request = resolveRetrievalPolicy(normalizeRequest(input), options.env);
  const source = resolveTaskContextSource(options.env);
  const now = options.now ?? Date.now();
  const cacheKey = requestCacheKey(request);

  // 精确请求缓存命中
  const cached = getCached(cacheKey, now);
  if (cached.hit) {
    emitMetrics(options, now, {
      durationMs: roundMs(performance.now() - startMs),
      cacheHit: true,
      cacheStatus: "request_hit",
      remoteCalls: 0,
      timedOut: false,
      status: cached.value.status,
      candidateCount: 0,
      evidenceCount: cached.value.evidence?.length || 0,
      adaptiveUpgrade: request.adaptiveUpgrade,
      effectiveDetail: request.detail,
      effectiveLimit: request.limit,
      sourceTableCount: request.detail === "minimal" ? 1 : 2,
      queriedTableCount: 0
    });
    return cached.value;
  }

  const runCommand = options.runCommand || runLarkCli;
  const needsCommits = request.detail !== "minimal";
  // SWR 仅生产环境启用：测试注入 runCommand 时不走 SWR，保证确定性
  const enableSWR = options.enableSWR ?? !options.runCommand;

  // 并行查 AI 表 + commit 表（带数据集缓存 + in-flight 合并 + SWR）
  // 先启动两个 fetchTable（不 await），确保 runCommand 同步调用阶段并行触发
  const aiTimed = timedAsync(() => fetchTable({
    tableId: source.aiTableId,
    baseToken: source.baseToken,
    recordType: "change",
    fields: AI_FIELDS,
    project: request.project,
    sortField: "完成时间",
    runCommand,
    now,
    enableSWR
  }));
  const commitTimed = needsCommits
    ? timedAsync(() => fetchTable({
        tableId: source.commitTableId,
        baseToken: source.baseToken,
        recordType: "commit",
        fields: COMMIT_FIELDS,
        project: request.project,
        sortField: "提交时间",
        runCommand,
        now,
        enableSWR
      }))
    : null;

  const [aiResult, commitResult] = await Promise.all([
    aiTimed.promise,
    commitTimed?.promise || Promise.resolve({
      records: [],
      warnings: [],
      remoteCalls: 0,
      cacheStatus: "skipped"
    })
  ]);
  const aiDurationMs = aiTimed.timing.durationMs;
  const commitDurationMs = commitTimed?.timing.durationMs || 0;

  const warnings = [...aiResult.warnings, ...commitResult.warnings];
  const mergeStart = performance.now();
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
  const mergeDurationMs = roundMs(performance.now() - mergeStart);
  const rankStart = performance.now();
  let selectedRecords = rankRecords(aiRecords, request)
    .filter((item) => item.eligible)
    .slice(0, request.limit);
  if (request.adaptiveUpgrade) {
    selectedRecords = selectedRecords.sort((left, right) =>
      timestamp(left.occurredAt) - timestamp(right.occurredAt)
      || left.id.localeCompare(right.id)
    );
  }
  const rankDurationMs = roundMs(performance.now() - rankStart);
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
    retrieval: {
      requested_detail: request.requestedDetail,
      effective_detail: request.detail,
      requested_limit: request.requestedLimit,
      effective_limit: request.limit,
      ...(request.adaptiveReason ? { reason: request.adaptiveReason } : {})
    },
    evidence: selectedRecords.map((record) => toEvidence(record, commitRecords, request.detail, request.task))
  };

  const sourceResults = needsCommits ? [aiResult, commitResult] : [aiResult];
  const cacheStatus = sourceResults.map((result) => result.cacheStatus).join("+");
  const cacheHit = sourceResults.every((result) =>
    result.cacheStatus === "dataset_hit" || result.cacheStatus === "swr_stale"
  );
  const shouldCacheExact = warnings.length === 0
    && sourceResults.every((result) => result.cacheStatus !== "swr_stale");
  if (shouldCacheExact) {
    const ttlMs = status === "no_strong_history" ? NEGATIVE_TTL_MS : CACHE_TTL_MS;
    setCached(cacheKey, value, ttlMs, now);
  }
  emitMetrics(options, Date.now(), {
    durationMs: roundMs(performance.now() - startMs),
    cacheHit,
    cacheStatus,
    aiDurationMs,
    commitDurationMs,
    aiCommandDurationMs: aiResult.commandDurationMs || 0,
    commitCommandDurationMs: commitResult.commandDurationMs || 0,
    parseDurationMs: (aiResult.parseDurationMs || 0) + (commitResult.parseDurationMs || 0),
    mergeDurationMs,
    rankDurationMs,
    remoteCalls: aiResult.remoteCalls + commitResult.remoteCalls,
    timedOut: warnings.some((warning) => String(warning).includes("超时")),
    status,
    degradedReason: warnings.length > 0
      ? "remote_error"
      : localRecords.length > 0
        ? "local_fallback"
        : null,
    candidateCount: aiRecords.length,
    evidenceCount: selectedRecords.length,
    adaptiveUpgrade: request.adaptiveUpgrade,
    effectiveDetail: request.detail,
    effectiveLimit: request.limit,
    sourceTableCount: needsCommits ? 2 : 1,
    queriedTableCount: sourceResults.filter((result) => result.remoteCalls > 0).length
  });
  return value;
}

// 带数据集缓存 + in-flight 合并 + SWR 的表查询
async function fetchTable({ tableId, fields, project, sortField, baseToken, recordType, runCommand, now, enableSWR }) {
  const cacheKey = `${tableId}:${project}`;
  const cached = getDataset(cacheKey, now);

  // 1. 新鲜数据集缓存命中
  if (cached.hit) {
    return {
      ...cached.value,
      remoteCalls: 0,
      cacheStatus: "dataset_hit",
      commandDurationMs: 0,
      parseDurationMs: 0
    };
  }

  // 2. SWR：过期但有旧值 → 返回旧值 + 后台刷新
  if (cached.stale && enableSWR) {
    if (!getInflight(cacheKey)) {
      const promise = actuallyFetch({ tableId, fields, project, sortField, baseToken, recordType, runCommand, now });
      setInflight(cacheKey, promise);
    }
    return {
      ...cached.value,
      remoteCalls: 0,
      cacheStatus: "swr_stale",
      commandDurationMs: 0,
      parseDurationMs: 0
    };
  }

  // 3. In-flight 合并：相同表+项目并发时共享一个请求
  const existing = getInflight(cacheKey);
  if (existing) {
    const result = await existing;
    return {
      ...result,
      remoteCalls: 0,
      cacheStatus: "inflight",
      commandDurationMs: 0,
      parseDurationMs: 0
    };
  }

  // 4. 全新查询
  const promise = actuallyFetch({ tableId, fields, project, sortField, baseToken, recordType, runCommand, now });
  setInflight(cacheKey, promise);
  const result = await promise;
  return { ...result, remoteCalls: 1, cacheStatus: "miss" };
}

async function actuallyFetch({ tableId, fields, project, sortField, baseToken, recordType, runCommand, now }) {
  const result = await withFetchSlot(() =>
    listTable({ tableId, fields, project, sortField, baseToken, recordType, runCommand })
  );
  // 空结果用 negative cache（短 TTL），避免频繁重复查空
  if (result.records.length === 0 && result.warnings.length === 0) {
    setNegativeDataset(`${tableId}:${project}`, result, now);
  } else if (result.records.length > 0 && result.warnings.length === 0) {
    setDataset(`${tableId}:${project}`, result, CACHE_TTL_MS, now);
  }
  return result;
}

function emitMetrics(options, at, metrics) {
  if (options.onMetrics) options.onMetrics({ at, ...metrics });
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

export function normalizeRequest(input = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("参数必须是对象。");
  }
  const workspaceRoot = resolveRequiredPath(input.workspace_root);
  const task = requiredText(input.task, "task");
  const files = Array.isArray(input.files)
    ? [...new Set(input.files
        .filter((file) => typeof file === "string" && file.trim())
        .map((file) => normalizePath(file)))]
        .sort()
    : [];
  const limit = normalizeLimit(input.limit);
  const detail = normalizeDetail(input.detail);
  return {
    workspaceRoot,
    project: resolveProjectName(workspaceRoot),
    task,
    files,
    limit,
    detail
  };
}

export function resolveRetrievalPolicy(request, env = process.env) {
  const adaptiveUpgrade = isAdaptiveHistoryEnabled(env) && isHistoryEvolutionTask(request.task);
  const detail = adaptiveUpgrade
    ? higherDetail(request.detail, "compact")
    : request.detail;
  const limit = adaptiveUpgrade
    ? Math.max(request.limit, ADAPTIVE_HISTORY_LIMIT)
    : request.limit;

  return {
    ...request,
    requestedDetail: request.detail,
    requestedLimit: request.limit,
    detail,
    limit,
    adaptiveUpgrade,
    adaptiveReason: adaptiveUpgrade ? "history_evolution" : ""
  };
}

function isAdaptiveHistoryEnabled(env) {
  return String(env?.[ADAPTIVE_HISTORY_ENV] ?? "1").trim() !== "0";
}

function isHistoryEvolutionTask(task) {
  const normalized = String(task).toLowerCase();
  if (EVOLUTION_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  return TEMPORAL_MARKERS.some((marker) => normalized.includes(marker))
    && TRANSITION_MARKERS.some((marker) => normalized.includes(marker));
}

function higherDetail(left, right) {
  return DETAIL_RANK[left] >= DETAIL_RANK[right] ? left : right;
}

function resolveRequiredPath(value) {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) {
    throw new TypeError("workspace_root 必须是绝对路径。");
  }
  return resolve(value);
}

function resolveProjectName(workspaceRoot) {
  try {
    return basename(realpathSync.native(workspaceRoot));
  } catch {
    return basename(workspaceRoot);
  }
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} 必须是非空字符串。`);
  return value.trim().replace(/\s+/g, " ").slice(0, 2_000);
}

function requestCacheKey(request) {
  return JSON.stringify({
    ...request,
    workspaceRoot: normalizePath(request.workspaceRoot),
    project: request.project.toLowerCase()
  });
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

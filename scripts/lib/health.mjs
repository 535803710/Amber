import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getChangeRecordStatus } from "./change-records.mjs";
import { getCommitRecordStatus } from "./commit-records.mjs";
import { readSettings } from "./settings.mjs";
import { readMetricsSummary } from "./task-context/metrics.mjs";

export const DEFAULT_HEALTH_THRESHOLDS = Object.freeze({
  checkIntervalMs: 30_000,
  baselineWarnMs: 30 * 60_000,
  baselineCriticalMs: 2 * 60 * 60_000,
  pendingWarnMs: 60_000,
  pendingCriticalMs: 10 * 60_000,
  processingWarnMs: 30_000,
  processingCriticalMs: 2 * 60_000,
  runtimeMisses: 2,
  startupGraceMs: 2 * 60_000,
  gitScanWarnFloorMs: 30_000,
  gitScanCriticalFloorMs: 2 * 60_000,
  gitScanWarnMultiplier: 2,
  gitScanCriticalMultiplier: 3,
  alertRepeatMs: 60 * 60_000
});

export function collectHealthSnapshot({
  rootDir = process.cwd(),
  now = Date.now(),
  env = process.env,
  runtime
} = {}) {
  const root = resolve(rootDir);
  const changeStatus = getChangeRecordStatus({ rootDir: root });
  const commitStatus = getCommitRecordStatus({ rootDir: root });
  const changeQueue = collectQueueMetrics(root, "change-records");
  const commitQueue = collectQueueMetrics(root, "commit-records");
  const scannerState = readJson(resolve(root, ".local/commit-records/scanner-state.json")) || {};
  const hooks = collectHookHealth(root, now);
  const runtimeState = runtime || collectRuntimeHealth(root);
  const taskContext = readMetricsSummary(root, now);

  return {
    now,
    runtime: runtimeState,
    hooks,
    aiDelivery: {
      ...changeStatus,
      oldestPendingAt: changeQueue.oldestPendingAt,
      oldestProcessingAt: changeQueue.oldestProcessingAt
    },
    gitScan: {
      configured: commitStatus.scanConfigured,
      lastScanAt: commitStatus.lastScanAt,
      repositoryCount: commitStatus.repositoryCount,
      scanIntervalMs: commitStatus.scanIntervalMs,
      repositoryErrors: scannerState.repositoryErrors || [],
      repositoryErrorsAt: scannerState.repositoryErrorsAt || null,
      watcher: commitStatus.watcher
    },
    gitDelivery: {
      ...commitStatus,
      oldestPendingAt: commitQueue.oldestPendingAt,
      oldestProcessingAt: commitQueue.oldestProcessingAt
    },
    gitWatch: {
      configured: commitStatus.scanConfigured,
      status: commitStatus.watcher?.status || "inactive",
      watchedRepositoryCount: commitStatus.watcher?.watchedRepositoryCount || 0,
      lastEventAt: commitStatus.watcher?.lastEventAt || null,
      lastDiscoveryAt: commitStatus.watcher?.lastDiscoveryAt || null,
      lastTargetScanAt: commitStatus.watcher?.lastTargetScanAt || null,
      errors: commitStatus.watcher?.errors || []
    },
    taskContext: {
      callCount: taskContext.callCount,
      p50Ms: taskContext.p50Ms,
      p95Ms: taskContext.p95Ms,
      cacheHitRate: taskContext.cacheHitRate,
      timeoutRate: taskContext.timeoutRate,
      errorRate: taskContext.errorRate,
      adaptiveUpgradeCount: taskContext.adaptiveUpgradeCount,
      adaptiveUpgradeRate: taskContext.adaptiveUpgradeRate,
      remoteCalls: taskContext.remoteCalls,
      lastCalledAt: taskContext.lastCalledAt
    },
    alertChannel: {
      configured: Boolean(String(env.FEISHU_WEBHOOK_URL || "").trim()),
      enabled: readSettings(root).healthAlertsEnabled
    }
  };
}

export function resolveHealthThresholds(env = process.env) {
  const checkIntervalMs = positiveInteger(
    env.AMBER_HEALTH_CHECK_INTERVAL_MS,
    DEFAULT_HEALTH_THRESHOLDS.checkIntervalMs
  );
  const baselineWarnMs = positiveInteger(
    env.AMBER_HEALTH_BASELINE_WARN_MS,
    DEFAULT_HEALTH_THRESHOLDS.baselineWarnMs
  );
  const pendingWarnMs = positiveInteger(
    env.AMBER_HEALTH_PENDING_WARN_MS,
    DEFAULT_HEALTH_THRESHOLDS.pendingWarnMs
  );
  const criticalMultiplier = positiveNumber(
    env.AMBER_HEALTH_CRITICAL_MULTIPLIER,
    DEFAULT_HEALTH_THRESHOLDS.baselineCriticalMs / DEFAULT_HEALTH_THRESHOLDS.baselineWarnMs
  );

  return {
    ...DEFAULT_HEALTH_THRESHOLDS,
    checkIntervalMs,
    baselineWarnMs,
    baselineCriticalMs: Math.round(baselineWarnMs * criticalMultiplier),
    pendingWarnMs,
    pendingCriticalMs: Math.round(
      DEFAULT_HEALTH_THRESHOLDS.pendingCriticalMs * (criticalMultiplier / 4)
    ),
    processingWarnMs: checkIntervalMs,
    processingCriticalMs: Math.round(
      DEFAULT_HEALTH_THRESHOLDS.processingCriticalMs * (criticalMultiplier / 4)
    ),
    gitScanWarnFloorMs: Math.max(
      DEFAULT_HEALTH_THRESHOLDS.gitScanWarnFloorMs,
      checkIntervalMs
    ),
    gitScanCriticalFloorMs: Math.max(
      DEFAULT_HEALTH_THRESHOLDS.gitScanCriticalFloorMs,
      checkIntervalMs * 4
    ),
    startupGraceMs: positiveInteger(
      env.AMBER_HEALTH_STARTUP_GRACE_MS,
      DEFAULT_HEALTH_THRESHOLDS.startupGraceMs
    ),
    alertRepeatMs: positiveInteger(
      env.AMBER_HEALTH_ALERT_REPEAT_MS,
      DEFAULT_HEALTH_THRESHOLDS.alertRepeatMs
    )
  };
}

export function evaluateHealth(snapshot = {}, options = {}) {
  const now = Number.isFinite(options.now)
    ? options.now
    : Number.isFinite(snapshot.now)
      ? snapshot.now
      : Date.now();
  const thresholds = options.thresholds || resolveHealthThresholds(options.env);
  const issues = [];
  const components = {
    runtime: component("runtime", snapshot.runtime),
    cursor: component("cursor", snapshot.hooks?.Cursor),
    chatgpt: component("chatgpt", snapshot.hooks?.ChatGPT),
    gitScan: component("gitScan", snapshot.gitScan),
    gitWatch: component("gitWatch", snapshot.gitWatch),
    aiDelivery: component("aiDelivery", snapshot.aiDelivery),
    gitDelivery: component("gitDelivery", snapshot.gitDelivery),
    taskContext: component("taskContext", snapshot.taskContext),
    alertChannel: component("alertChannel", snapshot.alertChannel)
  };

  const startupGraceActive = isStartupGraceActive(snapshot.runtime || {}, now, thresholds);
  evaluateRuntime(components.runtime, snapshot.runtime || {}, issues, now, thresholds, startupGraceActive);
  evaluateHook("Cursor", components.cursor, snapshot.hooks?.Cursor || {}, issues, now, thresholds);
  evaluateHook("ChatGPT", components.chatgpt, snapshot.hooks?.ChatGPT || {}, issues, now, thresholds);
  evaluateDelivery("ai", components.aiDelivery, snapshot.aiDelivery || {}, issues, now, thresholds);
  evaluateDelivery("git", components.gitDelivery, snapshot.gitDelivery || {}, issues, now, thresholds);
  evaluateGitScan(components.gitScan, snapshot.gitScan || {}, issues, now, thresholds, startupGraceActive);
  evaluateGitWatch(components.gitWatch, snapshot.gitWatch || {}, issues, now, thresholds, startupGraceActive);
  evaluateTaskContext(components.taskContext, snapshot.taskContext || {}, issues, now, thresholds);
  components.alertChannel.status = snapshot.alertChannel?.configured && snapshot.alertChannel?.enabled !== false
    ? "healthy"
    : "disabled";

  issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id));
  for (const issue of issues) {
    const target = components[issue.component];
    if (target) {
      target.status = moreSevere(target.status, issue.severity);
    }
  }

  const activeComponents = Object.values(components).filter((item) => item.status !== "disabled");
  const status = issues.some((issue) => issue.severity === "critical")
    ? "critical"
    : issues.length > 0
      ? "warning"
      : activeComponents.length === 0
        ? "disabled"
        : "healthy";

  return {
    status,
    checkedAt: new Date(now).toISOString(),
    components,
    issues
  };
}

function evaluateRuntime(target, runtime, issues, now, thresholds, startupGraceActive = false) {
  if (!runtime.expectedRunning) {
    target.status = "disabled";
    return;
  }
  if (runtime.running) {
    target.status = "healthy";
    const optionalWatchers = Object.entries(runtime.optionalWatchers || {});
    const failed = optionalWatchers.filter(([, state]) => state?.status === "failed");
    const restarting = optionalWatchers.filter(([, state]) => state?.status === "restarting");
    if (failed.length > 0) {
      issues.push(issue(
        "runtime_optional_watcher_failed",
        "runtime",
        "warning",
        `可选监听器自动重启失败：${failed.map(([label]) => label).join("、")}`,
        now,
        failed[0][1]?.changedAt
      ));
    } else if (restarting.length > 0) {
      issues.push(issue(
        "runtime_optional_watcher_restarting",
        "runtime",
        "warning",
        `可选监听器正在自动重启：${restarting.map(([label]) => label).join("、")}`,
        now,
        restarting[0][1]?.changedAt
      ));
    }
    return;
  }
  target.status = "warning";
  if (startupGraceActive) {
    return;
  }
  if ((runtime.consecutiveMisses || 0) >= thresholds.runtimeMisses) {
    issues.push(issue(
      "runtime_stopped",
      "runtime",
      "critical",
      "Amber 监听进程未运行",
      now,
      runtime.issueStartedAt
    ));
  }
}

function evaluateHook(source, target, hook, issues, now, thresholds) {
  target.details = {
    lastBeginAt: hook.lastBeginAt || null,
    lastCompleteAt: hook.lastCompleteAt || null,
    lastQueuedAt: hook.lastQueuedAt || null,
    lastSentAt: hook.lastSentAt || null,
    activeBaselines: hook.activeBaselines || 0,
    oldestBaselineAt: hook.oldestBaselineAt || null,
    oldestBaseline: hook.oldestBaseline || null,
    lastErrorAt: hook.lastErrorAt || null,
    lastError: hook.lastError || null
  };
  const active = Boolean(
    target.details.lastBeginAt ||
      target.details.lastCompleteAt ||
      target.details.lastQueuedAt ||
      target.details.lastSentAt ||
      target.details.activeBaselines ||
      target.details.lastErrorAt
  );
  target.status = active ? "healthy" : "disabled";

  if (target.details.lastErrorAt) {
    issues.push(issue(
      `${source.toLowerCase()}_hook_error`,
      target.key,
      "warning",
      `${source} Hook 最近一次执行失败：${target.details.lastError || "未知错误"}`,
      now,
      target.details.lastErrorAt
    ));
  }

  const age = ageOf(target.details.oldestBaselineAt, now);
  const baselineContext = formatBaselineContext(target.details.oldestBaseline);
  if (target.details.activeBaselines > 0 && age !== null) {
    if (age >= thresholds.baselineCriticalMs) {
      issues.push(issue(
        `${source.toLowerCase()}_baseline_stale`,
        target.key,
        "critical",
        `${source} 存在超过 ${formatDuration(thresholds.baselineCriticalMs)} 未完成的修改轮次${baselineContext}`,
        now,
        target.details.oldestBaselineAt
      ));
    } else if (age >= thresholds.baselineWarnMs) {
      issues.push(issue(
        `${source.toLowerCase()}_baseline_stale`,
        target.key,
        "warning",
        `${source} 存在长时间未完成的修改轮次${baselineContext}`,
        now,
        target.details.oldestBaselineAt
      ));
    }
  }
}

function evaluateDelivery(kind, target, delivery, issues, now, thresholds) {
  const label = kind === "ai" ? "AI 修改" : "Git 提交";
  target.details = {
    configured: Boolean(delivery.configured),
    pending: delivery.pending || 0,
    processing: delivery.processing || 0,
    failed: delivery.failed || 0,
    oldestPendingAt: delivery.oldestPendingAt || null,
    oldestProcessingAt: delivery.oldestProcessingAt || null,
    lastSuccessAt: delivery.lastSuccessAt || null,
    lastErrorAt: delivery.lastErrorAt || null,
    lastError: delivery.lastError || null
  };
  target.status = target.details.configured ? "healthy" : "disabled";

  if (!target.details.configured && (target.details.pending || target.details.processing || target.details.failed)) {
    issues.push(issue(
      `${kind}_webhook_missing`,
      target.key,
      "critical",
      `${label}存在未投递事件，但 Webhook 未配置`,
      now,
      delivery.issueStartedAt
    ));
  }
  if (target.details.failed > 0) {
    issues.push(issue(
      `${kind}_delivery_failed`,
      target.key,
      "critical",
      `${label}失败队列有 ${target.details.failed} 条记录`,
      now,
      delivery.issueStartedAt || target.details.lastErrorAt
    ));
  }
  evaluateAgeIssue(kind, "pending", target, target.details.oldestPendingAt, issues, now, thresholds.pendingWarnMs, thresholds.pendingCriticalMs, `${label}待发送队列等待过久`);
  evaluateAgeIssue(kind, "processing", target, target.details.oldestProcessingAt, issues, now, thresholds.processingWarnMs, thresholds.processingCriticalMs, `${label}处理中队列停留过久`);
}

function evaluateAgeIssue(kind, state, target, timestamp, issues, now, warnMs, criticalMs, message) {
  const age = ageOf(timestamp, now);
  if (age === null) return;
  if (age >= criticalMs) {
    issues.push(issue(`${kind}_${state}_stale`, target.key, "critical", message, now, timestamp));
  } else if (age >= warnMs) {
    issues.push(issue(`${kind}_${state}_stale`, target.key, "warning", message, now, timestamp));
  }
}

function evaluateGitScan(target, scan, issues, now, thresholds, startupGraceActive = false) {
  target.details = {
    configured: Boolean(scan.configured),
    lastScanAt: scan.lastScanAt || null,
    repositoryCount: scan.repositoryCount || 0,
    scanIntervalMs: scan.scanIntervalMs || null,
    repositoryErrors: Array.isArray(scan.repositoryErrors) ? scan.repositoryErrors : [],
    watcher: scan.watcher || null
  };
  target.status = target.details.configured ? "healthy" : "disabled";
  if (!target.details.configured) return;
  if (startupGraceActive) return;

  const age = ageOf(target.details.lastScanAt, now);
  if (age !== null) {
    const scanIntervalMs = target.details.scanIntervalMs || thresholds.checkIntervalMs;
    const warnMs = Math.max(thresholds.gitScanWarnFloorMs, scanIntervalMs * thresholds.gitScanWarnMultiplier);
    const criticalMs = Math.max(thresholds.gitScanCriticalFloorMs, scanIntervalMs * thresholds.gitScanCriticalMultiplier);
    if (age >= criticalMs) {
      issues.push(issue("git_scan_stale", target.key, "critical", "Git 扫描超过预期间隔", now, target.details.lastScanAt));
    } else if (age >= warnMs) {
      issues.push(issue("git_scan_stale", target.key, "warning", "Git 扫描延迟", now, target.details.lastScanAt));
    }
  }
  if (target.details.repositoryErrors.length > 0) {
    issues.push(issue(
      "git_scan_errors",
      target.key,
      "warning",
      `Git 扫描有 ${target.details.repositoryErrors.length} 个仓库失败`,
      now,
      scan.repositoryErrorsAt
    ));
  }
}

function evaluateGitWatch(target, watch, issues, now, thresholds, startupGraceActive = false) {
  target.details = {
    configured: Boolean(watch.configured),
    status: watch.status || "inactive",
    watchedRepositoryCount: watch.watchedRepositoryCount || 0,
    lastEventAt: watch.lastEventAt || null,
    lastDiscoveryAt: watch.lastDiscoveryAt || null,
    lastTargetScanAt: watch.lastTargetScanAt || null,
    errors: Array.isArray(watch.errors) ? watch.errors : []
  };
  target.status = target.details.configured ? "healthy" : "disabled";
  if (!target.details.configured) return;
  if (startupGraceActive) return;

  if (target.details.status === "down") {
    issues.push(issue(
      "git_watch_down",
      target.key,
      "critical",
      "Git refs 文件监听全部不可用",
      now,
      target.details.errors[0]?.at || null
    ));
  } else if (target.details.status === "degraded") {
    issues.push(issue(
      "git_watch_degraded",
      target.key,
      "warning",
      `Git refs 文件监听有 ${target.details.errors.length} 个错误`,
      now,
      target.details.errors[0]?.at || null
    ));
  }
}

function evaluateTaskContext(target, metrics, issues, now, thresholds) {
  target.details = {
    callCount: metrics.callCount || 0,
    p50Ms: metrics.p50Ms || 0,
    p95Ms: metrics.p95Ms || 0,
    cacheHitRate: metrics.cacheHitRate || 0,
    timeoutRate: metrics.timeoutRate || 0,
    errorRate: metrics.errorRate || 0,
    adaptiveUpgradeCount: metrics.adaptiveUpgradeCount || 0,
    adaptiveUpgradeRate: metrics.adaptiveUpgradeRate || 0,
    remoteCalls: metrics.remoteCalls || 0,
    lastCalledAt: metrics.lastCalledAt || null
  };
  target.status = target.details.callCount > 0 ? "healthy" : "disabled";
  if (target.details.callCount === 0) return;

  if (target.details.timeoutRate >= 0.05) {
    issues.push(issue(
      "task_context_timeout_rate",
      target.key,
      "warning",
      `MCP 调用超时率为 ${Math.round(target.details.timeoutRate * 100)}%`,
      now,
      target.details.lastCalledAt
    ));
  }
  if (target.details.errorRate >= 0.1) {
    issues.push(issue(
      "task_context_error_rate",
      target.key,
      "warning",
      `MCP 调用错误率为 ${Math.round(target.details.errorRate * 100)}%`,
      now,
      target.details.lastCalledAt
    ));
  }
}

function component(key, value = {}) {
  return { key, status: "disabled", details: value || {} };
}

function collectQueueMetrics(rootDir, name) {
  const queueRoot = resolve(rootDir, ".local", name, "queue");
  const result = { oldestPendingAt: null, oldestProcessingAt: null };
  for (const status of ["pending", "processing"]) {
    const directory = resolve(queueRoot, status);
    if (!existsSync(directory)) continue;
    for (const fileName of readdirSync(directory)) {
      if (!fileName.endsWith(".json")) continue;
      const envelope = readJson(resolve(directory, fileName));
      const timestamp = status === "processing"
        ? envelope?.claimedAt || envelope?.createdAt
        : envelope?.createdAt;
      if (!timestamp || !Number.isFinite(Date.parse(timestamp))) continue;
      const key = status === "processing" ? "oldestProcessingAt" : "oldestPendingAt";
      if (!result[key] || Date.parse(timestamp) < Date.parse(result[key])) {
        result[key] = new Date(timestamp).toISOString();
      }
    }
  }
  return result;
}

function collectHookHealth(rootDir, now) {
  const result = { Cursor: emptyHookHealth(), ChatGPT: emptyHookHealth() };
  const healthFile = resolve(rootDir, ".local/change-records/hook-health.ndjson");
  if (existsSync(healthFile)) {
    const lines = readFileSafe(healthFile).split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(-500)) {
      const event = parseJson(line);
      if (!event || !result[event.source]) continue;
      applyHookHealthEvent(result[event.source], event);
    }
  }

  const changeQueue = resolve(rootDir, ".local/change-records/queue");
  for (const status of ["pending", "processing", "sent", "failed"]) {
    const directory = resolve(changeQueue, status);
    if (!existsSync(directory)) continue;
    for (const fileName of readdirSync(directory)) {
      if (!fileName.endsWith(".json")) continue;
      const envelope = readJson(resolve(directory, fileName));
      const event = envelope?.event;
      if (!event || !result[event.source]) continue;
      result[event.source].lastQueuedAt = maxIso(result[event.source].lastQueuedAt, event.completed_at);
      if (status === "sent") {
        result[event.source].lastSentAt = maxIso(result[event.source].lastSentAt, envelope.sentAt);
      }
    }
  }

  for (const source of Object.keys(result)) {
    const baselineDir = resolve(rootDir, ".local/change-records/baselines", source.toLowerCase());
    if (!existsSync(baselineDir)) continue;
    const baselines = readdirSync(baselineDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => readJson(resolve(baselineDir, fileName)))
      .filter(Boolean);
    const oldestBaseline = baselines
      .filter((item) => Number.isFinite(Date.parse(item.startedAt)))
      .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))[0] || null;
    result[source].activeBaselines = baselines.length;
    result[source].oldestBaselineAt = oldestBaseline?.startedAt || null;
    result[source].oldestBaseline = oldestBaseline ? summarizeBaseline(oldestBaseline) : null;
  }
  return result;
}

function collectRuntimeHealth(rootDir) {
  const desired = readJson(resolve(rootDir, ".local/runtime-desired.json"));
  const pidFile = resolve(rootDir, ".local/watch-all.pid");
  const healthPidFile = resolve(rootDir, ".local/health-monitor.pid");
  const pid = Number.parseInt(readFileSafe(pidFile).trim(), 10);
  const healthPid = Number.parseInt(readFileSafe(healthPidFile).trim(), 10);
  const running = Number.isInteger(pid) && pid > 0 && isProcessAlive(pid);
  const healthRunning = Number.isInteger(healthPid) && healthPid > 0 && isProcessAlive(healthPid);
  const expectedRunning = desired?.running === true;
  const watcherState = readJson(resolve(rootDir, ".local/watcher-state.json"));
  const optionalWatchers = running && watcherState?.runtimePid === pid
    ? watcherState.optionalWatchers || {}
    : {};
  return {
    expectedRunning,
    running,
    pid: running ? pid : null,
    healthRunning,
    healthPid: healthRunning ? healthPid : null,
    profile: watcherState?.profile || desired?.profile || "full",
    optionalWatchers,
    desiredChangedAt: desired?.changedAt || null,
    consecutiveMisses: running ? 0 : Number(desired?.consecutiveMisses || 0)
  };
}

function isStartupGraceActive(runtime, now, thresholds) {
  if (!runtime.expectedRunning) return false;
  const age = ageOf(runtime.desiredChangedAt, now);
  return age !== null && age >= 0 && age < thresholds.startupGraceMs;
}

function emptyHookHealth() {
  return {
    lastBeginAt: null,
    lastCompleteAt: null,
    lastQueuedAt: null,
    lastSentAt: null,
    activeBaselines: 0,
    oldestBaselineAt: null,
    oldestBaseline: null,
    lastErrorAt: null,
    lastError: null
  };
}

function applyHookHealthEvent(target, event) {
  const at = validIso(event.at);
  if (!at) return;
  if (event.event === "begin") target.lastBeginAt = maxIso(target.lastBeginAt, at);
  if (event.event === "complete") target.lastCompleteAt = maxIso(target.lastCompleteAt, at);
  if (
    (event.event === "begin" || event.event === "complete") &&
    target.lastErrorAt &&
    Date.parse(at) >= Date.parse(target.lastErrorAt)
  ) {
    target.lastErrorAt = null;
    target.lastError = null;
  }
  if (event.event === "error") {
    if (!target.lastErrorAt || Date.parse(at) >= Date.parse(target.lastErrorAt)) {
      target.lastErrorAt = at;
      target.lastError = String(event.error || "Hook 执行失败").slice(0, 500);
    }
  }
}

function readJson(filePath) {
  return parseJson(readFileSafe(filePath));
}

function parseJson(text) {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function maxIso(current, next) {
  const normalized = validIso(next);
  if (!normalized) return current || null;
  return !current || Date.parse(normalized) > Date.parse(current) ? normalized : current;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function issue(id, componentKey, severity, message, now, startedAt) {
  return {
    id,
    component: componentKey,
    severity,
    message,
    startedAt: validIso(startedAt) || new Date(now).toISOString()
  };
}

function ageOf(value, now) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

function validIso(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function severityRank(value) {
  return value === "critical" ? 2 : value === "warning" ? 1 : 0;
}

function moreSevere(current, next) {
  if (current === "disabled") return next;
  return severityRank(next) > severityRank(current) ? next : current;
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.round(minutes / 60)} 小时` : `${minutes} 分钟`;
}

function formatBaselineContext(baseline) {
  if (!baseline) return "";
  const project = compactText(baseline.project, 80) || "未知项目";
  const turnId = compactText(baseline.turnId || baseline.key, 80) || "未知轮次";
  const startedAt = validIso(baseline.startedAt);
  return `：${project}，轮次 ${turnId}${startedAt ? `，开始于 ${startedAt}` : ""}`;
}

function summarizeBaseline(baseline) {
  return {
    key: compactText(baseline.key, 200) || null,
    sessionId: compactText(baseline.sessionId, 200) || null,
    turnId: compactText(baseline.turnId, 200) || null,
    project: compactText(baseline.project, 120) || null,
    repoRoot: compactText(baseline.repoRoot, 500) || null,
    promptSummary: compactText(String(baseline.prompt || "").split(/\r?\n/)[0], 160) || null,
    startedAt: validIso(baseline.startedAt)
  };
}

function compactText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

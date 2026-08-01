import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getChangeRecordStatus } from "./change-records.mjs";
import { getCommitRecordStatus } from "./commit-records.mjs";
import { readSettings } from "./settings.mjs";

export const DEFAULT_HEALTH_THRESHOLDS = Object.freeze({
  checkIntervalMs: 30_000,
  baselineWarnMs: 30 * 60_000,
  baselineCriticalMs: 2 * 60 * 60_000,
  pendingWarnMs: 60_000,
  pendingCriticalMs: 10 * 60_000,
  processingWarnMs: 30_000,
  processingCriticalMs: 2 * 60_000,
  runtimeMisses: 2,
  gitScanWarnFloorMs: 30_000,
  gitScanCriticalFloorMs: 2 * 60_000,
  gitScanWarnMultiplier: 6,
  gitScanCriticalMultiplier: 24,
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
      scanIntervalMs: positiveInteger(env.COMMIT_RECORD_SCAN_INTERVAL_MS, 5_000),
      repositoryErrors: scannerState.repositoryErrors || [],
      repositoryErrorsAt: scannerState.repositoryErrorsAt || null
    },
    gitDelivery: {
      ...commitStatus,
      oldestPendingAt: commitQueue.oldestPendingAt,
      oldestProcessingAt: commitQueue.oldestProcessingAt
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
    aiDelivery: component("aiDelivery", snapshot.aiDelivery),
    gitDelivery: component("gitDelivery", snapshot.gitDelivery),
    alertChannel: component("alertChannel", snapshot.alertChannel)
  };

  evaluateRuntime(components.runtime, snapshot.runtime || {}, issues, now, thresholds);
  evaluateHook("Cursor", components.cursor, snapshot.hooks?.Cursor || {}, issues, now, thresholds);
  evaluateHook("ChatGPT", components.chatgpt, snapshot.hooks?.ChatGPT || {}, issues, now, thresholds);
  evaluateDelivery("ai", components.aiDelivery, snapshot.aiDelivery || {}, issues, now, thresholds);
  evaluateDelivery("git", components.gitDelivery, snapshot.gitDelivery || {}, issues, now, thresholds);
  evaluateGitScan(components.gitScan, snapshot.gitScan || {}, issues, now, thresholds);
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

function evaluateRuntime(target, runtime, issues, now, thresholds) {
  if (!runtime.expectedRunning) {
    target.status = "disabled";
    return;
  }
  if (runtime.running) {
    target.status = "healthy";
    return;
  }
  target.status = "warning";
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
  if (target.details.activeBaselines > 0 && age !== null) {
    if (age >= thresholds.baselineCriticalMs) {
      issues.push(issue(
        `${source.toLowerCase()}_baseline_stale`,
        target.key,
        "critical",
        `${source} 存在超过 ${formatDuration(thresholds.baselineCriticalMs)} 未完成的修改轮次`,
        now,
        target.details.oldestBaselineAt
      ));
    } else if (age >= thresholds.baselineWarnMs) {
      issues.push(issue(
        `${source.toLowerCase()}_baseline_stale`,
        target.key,
        "warning",
        `${source} 存在长时间未完成的修改轮次`,
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

function evaluateGitScan(target, scan, issues, now, thresholds) {
  target.details = {
    configured: Boolean(scan.configured),
    lastScanAt: scan.lastScanAt || null,
    repositoryCount: scan.repositoryCount || 0,
    scanIntervalMs: scan.scanIntervalMs || null,
    repositoryErrors: Array.isArray(scan.repositoryErrors) ? scan.repositoryErrors : []
  };
  target.status = target.details.configured ? "healthy" : "disabled";
  if (!target.details.configured) return;

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
    result[source].activeBaselines = baselines.length;
    result[source].oldestBaselineAt = baselines
      .map((item) => item.startedAt)
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort()[0] || null;
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
  return {
    expectedRunning,
    running,
    pid: running ? pid : null,
    healthRunning,
    healthPid: healthRunning ? healthPid : null,
    consecutiveMisses: running ? 0 : Number(desired?.consecutiveMisses || 0)
  };
}

function emptyHookHealth() {
  return {
    lastBeginAt: null,
    lastCompleteAt: null,
    lastQueuedAt: null,
    lastSentAt: null,
    activeBaselines: 0,
    oldestBaselineAt: null,
    lastErrorAt: null,
    lastError: null
  };
}

function applyHookHealthEvent(target, event) {
  const at = validIso(event.at);
  if (!at) return;
  if (event.event === "begin") target.lastBeginAt = maxIso(target.lastBeginAt, at);
  if (event.event === "complete") target.lastCompleteAt = maxIso(target.lastCompleteAt, at);
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

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  DEFAULT_HEALTH_THRESHOLDS,
  collectHealthSnapshot,
  evaluateHealth,
  resolveHealthThresholds
} from "../scripts/lib/health.mjs";
import { planHealthAlerts } from "../scripts/lib/health-alerts.mjs";
import { runHealthCheck } from "../scripts/health-monitor-worker.mjs";
import { archiveStaleBaselines } from "../scripts/lib/health-reset.mjs";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

test("health evaluator keeps inactive optional components disabled", () => {
  const health = evaluateHealth({
    now: NOW,
    runtime: { expectedRunning: false, running: false },
    hooks: { Cursor: {}, ChatGPT: {} },
    aiDelivery: { configured: false },
    gitScan: { configured: false },
    gitDelivery: { configured: false },
    alertChannel: { configured: false }
  });

  assert.equal(health.status, "disabled");
  assert.equal(health.issues.length, 0);
  assert.equal(health.components.cursor.status, "disabled");
  assert.equal(health.components.gitScan.status, "disabled");
});

test("health evaluator reports a stale baseline by severity", () => {
  const warning = evaluateHealth({
    now: NOW,
    runtime: { expectedRunning: true, running: true },
    hooks: {
      ChatGPT: {
        activeBaselines: 1,
        oldestBaselineAt: new Date(NOW - DEFAULT_HEALTH_THRESHOLDS.baselineWarnMs).toISOString()
      }
    }
  });
  assert.equal(warning.status, "warning");
  assert.equal(warning.issues[0].id, "chatgpt_baseline_stale");

  const critical = evaluateHealth({
    now: NOW,
    runtime: { expectedRunning: true, running: true },
    hooks: {
      ChatGPT: {
        activeBaselines: 1,
        oldestBaselineAt: new Date(NOW - DEFAULT_HEALTH_THRESHOLDS.baselineCriticalMs).toISOString()
      }
    }
  });
  assert.equal(critical.status, "critical");
  assert.equal(critical.issues[0].severity, "critical");
});

test("health evaluator detects stopped runtime and delivery backlog", () => {
  const health = evaluateHealth({
    now: NOW,
    runtime: { expectedRunning: true, running: false, consecutiveMisses: 2 },
    aiDelivery: {
      configured: true,
      pending: 1,
      oldestPendingAt: new Date(NOW - DEFAULT_HEALTH_THRESHOLDS.pendingCriticalMs).toISOString(),
      failed: 1
    },
    gitScan: { configured: true, lastScanAt: new Date(NOW).toISOString(), scanIntervalMs: 5_000 },
    gitDelivery: { configured: true }
  });

  assert.equal(health.status, "critical");
  assert.deepEqual(
    health.issues.map((issue) => issue.id).sort(),
    ["ai_delivery_failed", "ai_pending_stale", "runtime_stopped"]
  );
});

test("health evaluator reports git scan lag and repository errors", () => {
  const health = evaluateHealth({
    now: NOW,
    runtime: { expectedRunning: true, running: true },
    gitScan: {
      configured: true,
      lastScanAt: new Date(NOW - 180_000).toISOString(),
      scanIntervalMs: 5_000,
      repositoryErrors: [{ repository: "D:/project/repo", message: "git unavailable" }]
    }
  });

  assert.equal(health.status, "critical");
  assert.ok(health.issues.some((issue) => issue.id === "git_scan_stale"));
  assert.ok(health.issues.some((issue) => issue.id === "git_scan_errors"));
});

test("health evaluator suppresses runtime and git scan alerts during startup grace", () => {
  const health = evaluateHealth({
    now: NOW,
    runtime: {
      expectedRunning: true,
      running: false,
      consecutiveMisses: 3,
      desiredChangedAt: new Date(NOW - 30_000).toISOString()
    },
    gitScan: {
      configured: true,
      lastScanAt: new Date(NOW - 10 * 60_000).toISOString(),
      scanIntervalMs: 5_000
    }
  });

  assert.equal(health.issues.some((issue) => issue.id === "runtime_stopped"), false);
  assert.equal(health.issues.some((issue) => issue.id === "git_scan_stale"), false);
});

test("health thresholds accept environment overrides without accepting invalid values", () => {
  const thresholds = resolveHealthThresholds({
    AMBER_HEALTH_BASELINE_WARN_MS: "1234",
    AMBER_HEALTH_PENDING_WARN_MS: "bad",
    AMBER_HEALTH_ALERT_REPEAT_MS: "0"
  });

  assert.equal(thresholds.baselineWarnMs, 1234);
  assert.equal(thresholds.pendingWarnMs, DEFAULT_HEALTH_THRESHOLDS.pendingWarnMs);
  assert.equal(thresholds.alertRepeatMs, DEFAULT_HEALTH_THRESHOLDS.alertRepeatMs);
});

test("health alerts notify once, repeat critical issues, and announce recovery", () => {
  const first = planHealthAlerts(
    [{ id: "runtime_stopped", component: "runtime", severity: "critical", message: "stopped" }],
    {},
    1_000,
    10_000
  );
  assert.deepEqual(first.events.map((event) => event.type), ["problem"]);

  const quiet = planHealthAlerts(
    [{ id: "runtime_stopped", component: "runtime", severity: "critical", message: "stopped" }],
    first.state,
    5_000,
    10_000
  );
  assert.deepEqual(quiet.events, []);

  const repeated = planHealthAlerts(
    [{ id: "runtime_stopped", component: "runtime", severity: "critical", message: "stopped" }],
    first.state,
    12_000,
    10_000
  );
  assert.deepEqual(repeated.events.map((event) => event.type), ["problem"]);

  const recovered = planHealthAlerts([], repeated.state, 13_000, 10_000);
  assert.deepEqual(recovered.events.map((event) => event.type), ["recovered"]);

  const configuredLater = planHealthAlerts(
    [{ id: "runtime_stopped", component: "runtime", severity: "critical", message: "stopped" }],
    { active: { runtime_stopped: { severity: "critical", lastNotifiedAt: undefined } } },
    14_000,
    10_000
  );
  assert.deepEqual(configuredLater.events.map((event) => event.type), ["problem"]);
});

test("health snapshot tolerates corrupt queue and hook health lines", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-health-snapshot-"));
  const pending = resolve(root, ".local/change-records/queue/pending");
  const hooks = resolve(root, ".local/change-records");
  mkdirSync(pending, { recursive: true });
  writeFileSync(resolve(pending, "corrupt.json"), "not-json", "utf8");
  writeFileSync(resolve(pending, "event.json"), JSON.stringify({ createdAt: "2026-08-01T11:59:00.000Z" }), "utf8");
  writeFileSync(resolve(hooks, "hook-health.ndjson"), "bad-line\n{" +
    "\"source\":\"ChatGPT\",\"event\":\"begin\",\"at\":\"2026-08-01T11:58:00.000Z\"}\n", "utf8");

  const snapshot = collectHealthSnapshot({
    rootDir: root,
    now: NOW,
    env: { FEISHU_WEBHOOK_URL: "", COMMIT_RECORD_SCAN_ROOTS: "" },
    runtime: { expectedRunning: false, running: false }
  });

  assert.equal(snapshot.aiDelivery.oldestPendingAt, "2026-08-01T11:59:00.000Z");
  assert.equal(snapshot.hooks.ChatGPT.lastBeginAt, "2026-08-01T11:58:00.000Z");
});

test("health snapshot exposes MCP task-context metrics", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-health-mcp-"));
  const local = resolve(root, ".local");
  mkdirSync(local, { recursive: true });
  writeFileSync(resolve(local, "mcp-metrics.ndjson"), [
    JSON.stringify({
      at: NOW - 200,
      durationMs: 100,
      cacheHit: false,
      adaptiveUpgrade: true,
      remoteCalls: 1,
      timedOut: false,
      isError: false
    }),
    JSON.stringify({
      at: NOW - 100,
      durationMs: 300,
      cacheHit: true,
      remoteCalls: 0,
      timedOut: true,
      isError: false
    })
  ].join("\n"), "utf8");

  const snapshot = collectHealthSnapshot({
    rootDir: root,
    now: NOW,
    env: { FEISHU_WEBHOOK_URL: "", COMMIT_RECORD_SCAN_ROOTS: "" },
    runtime: { expectedRunning: false, running: false }
  });
  const health = evaluateHealth(snapshot, { now: NOW });

  assert.equal(snapshot.taskContext.callCount, 2);
  assert.equal(snapshot.taskContext.cacheHitRate, 0.5);
  assert.equal(snapshot.taskContext.adaptiveUpgradeCount, 1);
  assert.equal(snapshot.taskContext.adaptiveUpgradeRate, 0.5);
  assert.equal(snapshot.taskContext.remoteCalls, 1);
  assert.equal(health.issues.some((issue) => issue.id === "task_context_timeout_rate"), true);
});

test("health status check persists a snapshot without creating runtime expectation", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-health-status-"));
  const result = await runHealthCheck({
    rootDir: root,
    now: NOW,
    env: { FEISHU_WEBHOOK_URL: "", COMMIT_RECORD_SCAN_ROOTS: "" },
    notify: false
  });

  assert.equal(result.health.status, "disabled");
  assert.equal(existsSync(resolve(root, ".local/runtime-desired.json")), false);
  const state = JSON.parse(readFileSync(resolve(root, ".local/health-monitor/state.json"), "utf8"));
  assert.equal(state.health.status, "disabled");
});

test("health reset archives only stale baselines and leaves fresh state untouched", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-health-reset-"));
  const baselineDir = resolve(root, ".local/change-records/baselines/cursor");
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(resolve(baselineDir, "stale.json"), JSON.stringify({
    source: "Cursor",
    key: "stale",
    startedAt: new Date(NOW - 2 * 60 * 60_000).toISOString()
  }), "utf8");
  writeFileSync(resolve(baselineDir, "fresh.json"), JSON.stringify({
    source: "Cursor",
    key: "fresh",
    startedAt: new Date(NOW - 5 * 60_000).toISOString()
  }), "utf8");

  const result = archiveStaleBaselines({ rootDir: root, source: "cursor", now: NOW });
  assert.equal(result.archivedCount, 1);
  assert.equal(existsSync(resolve(baselineDir, "stale.json")), false);
  assert.equal(existsSync(resolve(baselineDir, "fresh.json")), true);
  assert.equal(existsSync(resolve(root, ".local/change-records/baselines-reset", result.runId, "manifest.json")), true);
});

test("health alert switch suppresses sends without suppressing health state", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-health-alert-toggle-"));
  const baselineDir = resolve(root, ".local/change-records/baselines/chatgpt");
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(resolve(baselineDir, "stale.json"), JSON.stringify({
    source: "ChatGPT",
    key: "stale",
    startedAt: new Date(NOW - DEFAULT_HEALTH_THRESHOLDS.baselineWarnMs).toISOString()
  }), "utf8");

  let sent = 0;
  await runHealthCheck({
    rootDir: root,
    now: NOW,
    env: { FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    alertsEnabled: false,
    notifier: async () => { sent += 1; }
  });
  const mutedState = JSON.parse(readFileSync(resolve(root, ".local/health-monitor/state.json"), "utf8"));
  assert.equal(sent, 0);
  assert.equal(mutedState.health.status, "warning");
  assert.ok(mutedState.alerts.active.chatgpt_baseline_stale);

  await runHealthCheck({
    rootDir: root,
    now: NOW + 1_000,
    env: { FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    alertsEnabled: true,
    notifier: async () => { sent += 1; }
  });
  assert.equal(sent, 1);
});

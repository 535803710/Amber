// MCP 调用指标：NDJSON 追加写入 + 窗口摘要 + 并发计时辅助
// 指标只记录数值和时间戳，不记录任务文本、token 或敏感字段

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const METRICS_FILE = ".local/mcp-metrics.ndjson";
const MAX_ENTRIES = 500;

// 追加一条调用指标到 NDJSON
export function recordCall(rootDir, entry) {
  const dir = resolve(rootDir, ".local");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = resolve(rootDir, METRICS_FILE);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

// 读取最近 windowMs 内的指标摘要
export function readMetricsSummary(rootDir, now = Date.now(), windowMs = 24 * 60 * 60_000) {
  const file = resolve(rootDir, METRICS_FILE);
  if (!existsSync(file)) return emptySummary();

  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const recent = lines.slice(-MAX_ENTRIES);
  const entries = recent
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .filter((entry) => now - entry.at < windowMs);

  if (entries.length === 0) return emptySummary();

  const durations = entries.map((entry) => entry.durationMs || 0).sort((a, b) => a - b);
  const cacheHits = entries.filter((entry) => entry.cacheHit).length;
  const timeouts = entries.filter((entry) => entry.timedOut).length;
  const errors = entries.filter((entry) => entry.isError).length;
  const adaptiveUpgrades = entries.filter((entry) => entry.adaptiveUpgrade).length;
  const remoteCalls = entries.reduce((sum, entry) => sum + (entry.remoteCalls || 0), 0);
  const evidenceTotal = entries.reduce((sum, entry) => sum + (entry.evidenceCount || 0), 0);

  return {
    callCount: entries.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    cacheHitRate: entries.length > 0 ? cacheHits / entries.length : 0,
    timeoutRate: entries.length > 0 ? timeouts / entries.length : 0,
    errorRate: entries.length > 0 ? errors / entries.length : 0,
    adaptiveUpgradeCount: adaptiveUpgrades,
    adaptiveUpgradeRate: entries.length > 0 ? adaptiveUpgrades / entries.length : 0,
    remoteCalls,
    evidenceTotal,
    lastCalledAt: entries[entries.length - 1]?.at || null
  };
}

// 并发计时辅助：保持 Promise.all 并行的同时记录各自耗时
export function timedAsync(fn) {
  const timing = { durationMs: 0 };
  const promise = (async () => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timing.durationMs = Math.round((performance.now() - start) * 10) / 10;
    }
  })();
  return { promise, timing };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function emptySummary() {
  return {
    callCount: 0,
    p50Ms: 0,
    p95Ms: 0,
    cacheHitRate: 0,
    timeoutRate: 0,
    errorRate: 0,
    adaptiveUpgradeCount: 0,
    adaptiveUpgradeRate: 0,
    remoteCalls: 0,
    evidenceTotal: 0,
    lastCalledAt: null
  };
}

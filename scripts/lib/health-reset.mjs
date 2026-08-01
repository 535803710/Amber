import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCES = Object.freeze(["cursor", "chatgpt"]);
const DEFAULT_MINIMUM_AGE_MS = 30 * 60_000;

export function archiveStaleBaselines({
  rootDir = process.cwd(),
  source = "all",
  now = Date.now(),
  minimumAgeMs = DEFAULT_MINIMUM_AGE_MS
} = {}) {
  const sources = normalizeSources(source);
  const root = resolve(rootDir);
  const cutoff = now - positiveInteger(minimumAgeMs, DEFAULT_MINIMUM_AGE_MS);
  const runId = `${new Date(now).toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const archiveRoot = resolve(root, ".local/change-records/baselines-reset", runId);
  const entries = [];

  for (const sourceName of sources) {
    const baselineDir = resolve(root, ".local/change-records/baselines", sourceName);
    if (!existsSync(baselineDir)) continue;
    const sourceArchiveDir = resolve(archiveRoot, sourceName);
    for (const fileName of readdirSync(baselineDir)) {
      if (!fileName.endsWith(".json")) continue;
      const filePath = resolve(baselineDir, fileName);
      const baseline = readJson(filePath);
      const startedAt = Date.parse(baseline?.startedAt || "");
      if (!baseline || !Number.isFinite(startedAt) || startedAt > cutoff) continue;

      mkdirSync(sourceArchiveDir, { recursive: true });
      const destination = resolve(sourceArchiveDir, fileName);
      renameSync(filePath, destination);
      entries.push({
        source: sourceName,
        fileName,
        key: baseline.key || fileName.replace(/\.json$/i, ""),
        startedAt: new Date(startedAt).toISOString(),
        archivedPath: destination
      });
    }
  }

  if (entries.length > 0) {
    mkdirSync(archiveRoot, { recursive: true });
    writeFileSync(resolve(archiveRoot, "manifest.json"), `${JSON.stringify({
      runId,
      createdAt: new Date(now).toISOString(),
      minimumAgeMs,
      entries
    }, null, 2)}\n`, "utf8");
  }

  return {
    ok: true,
    archivedCount: entries.length,
    runId: entries.length > 0 ? runId : null,
    entries
  };
}

function normalizeSources(value) {
  if (value === "all" || value === undefined || value === null || value === "") {
    return [...SOURCES];
  }
  const source = String(value).trim().toLowerCase();
  if (!SOURCES.includes(source)) {
    throw new Error("source must be cursor, chatgpt, or all");
  }
  return [source];
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { ignoredChangeReason } from "./change-record-policy.mjs";

const SOURCES = Object.freeze(["cursor", "chatgpt"]);
const DEFAULT_MINIMUM_AGE_MS = 30 * 60_000;

export function archiveAbortedBaselines({
  rootDir = process.cwd(),
  codexHome = resolve(homedir(), ".codex"),
  now = Date.now(),
  minimumAgeMs = DEFAULT_MINIMUM_AGE_MS
} = {}) {
  const root = resolve(rootDir);
  const baselineDir = resolve(root, ".local/change-records/baselines/chatgpt");
  if (!existsSync(baselineDir)) {
    return { ok: true, archivedCount: 0, runId: null, entries: [] };
  }

  const runId = `${new Date(now).toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const archiveRoot = resolve(root, ".local/change-records/baselines-reset", runId);
  const cutoff = now - positiveInteger(minimumAgeMs, DEFAULT_MINIMUM_AGE_MS);
  const entries = [];
  for (const fileName of readdirSync(baselineDir)) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = resolve(baselineDir, fileName);
    const baseline = readJson(filePath);
    const startedAt = Date.parse(baseline?.startedAt || "");
    const oldEnough = Number.isFinite(startedAt) && startedAt <= cutoff;
    const ignoredReason = baseline && oldEnough
      ? ignoredChangeReason(baseline, { codexHome })
      : null;
    const terminalEvent = baseline && oldEnough && !ignoredReason
      ? findCodexTerminalEvent(baseline, codexHome)
      : null;
    const archiveReason = ignoredReason || terminalEvent;
    if (
      !baseline ||
      !Number.isFinite(startedAt) ||
      startedAt > cutoff ||
      !archiveReason
    ) continue;

    const destinationDir = resolve(archiveRoot, "chatgpt");
    mkdirSync(destinationDir, { recursive: true });
    const destination = resolve(destinationDir, fileName);
    renameSync(filePath, destination);
    entries.push({
      source: "chatgpt",
      fileName,
      key: baseline.key || fileName.replace(/\.json$/i, ""),
      startedAt: baseline.startedAt || null,
      reason: archiveReason,
      archivedPath: destination
    });
  }

  if (entries.length > 0) {
    writeManifest(archiveRoot, { runId, now, entries, minimumAgeMs });
  }
  return {
    ok: true,
    archivedCount: entries.length,
    runId: entries.length > 0 ? runId : null,
    entries
  };
}

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

function findCodexTerminalEvent(baseline, codexHome) {
  const sessionId = String(baseline.sessionId || "");
  const turnId = String(baseline.turnId || "");
  const startedAt = Date.parse(baseline.startedAt || "");
  if (!/^[A-Za-z0-9-]+$/.test(sessionId) || !turnId || !Number.isFinite(startedAt)) {
    return null;
  }

  for (const offset of [-1, 0, 1]) {
    const date = new Date(startedAt + offset * 24 * 60 * 60_000);
    const sessionDir = resolve(
      codexHome,
      "sessions",
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    );
    if (!existsSync(sessionDir)) continue;
    const fileName = readdirSync(sessionDir).find((name) =>
      name.endsWith(`-${sessionId}.jsonl`)
    );
    if (!fileName) continue;
    const terminalEvent = readSessionTerminalEvent(resolve(sessionDir, fileName), turnId);
    if (terminalEvent) {
      return terminalEvent;
    }
  }
  return null;
}

function readSessionTerminalEvent(filePath, turnId) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.includes(turnId)) continue;
    try {
      const event = JSON.parse(line);
      if (
        event?.type === "event_msg" &&
        event.payload?.type === "turn_aborted" &&
        event.payload?.turn_id === turnId
      ) {
        return event.payload.type;
      }
    } catch {
      // Ignore partially written session lines.
    }
  }
  return null;
}

function writeManifest(archiveRoot, { runId, now, entries, minimumAgeMs } = {}) {
  mkdirSync(archiveRoot, { recursive: true });
  writeFileSync(resolve(archiveRoot, "manifest.json"), `${JSON.stringify({
    runId,
    createdAt: new Date(now).toISOString(),
    ...(minimumAgeMs === undefined ? {} : { minimumAgeMs }),
    entries
  }, null, 2)}\n`, "utf8");
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

import { watch } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REBUILD_DELAY_MS = 30_000;

const watcherRegistry = new Map();
const commonDirWatchers = new Map();

export function resolveGitDirs(repoPath) {
  const gitDirResult = git(repoPath, ["rev-parse", "--git-dir"]);
  if (!gitDirResult.ok) throw new Error("unable to resolve git directory");
  const commonDirResult = git(repoPath, ["rev-parse", "--git-common-dir"]);
  const gitDir = resolve(repoPath, gitDirResult.stdout.trim());
  const commonDirRaw = commonDirResult.ok ? commonDirResult.stdout.trim() : "";
  const commonDir = commonDirRaw ? resolve(repoPath, commonDirRaw) : gitDir;
  return { gitDir, commonDir: commonDir || gitDir };
}

export function createRepositoryWatcher({
  repoPath,
  debounceMs = 750,
  maxWaitMs = 5_000,
  onTrigger,
  timers = globalThis
}) {
  const entry = {
    repoPath,
    gitDir: null,
    commonDir: null,
    debounceMs,
    maxWaitMs,
    onTrigger,
    timers,
    status: "active",
    errors: [],
    lastEventAt: null,
    watchers: [],
    debouncer: null,
    rebuildTimer: null
  };

  entry.debouncer = createDebouncer(debounceMs, maxWaitMs, () => {
    entry.lastEventAt = new Date().toISOString();
    entry.onTrigger(repoPath);
  }, timers);

  try {
    buildWatchers(entry);
  } catch (error) {
    entry.status = "degraded";
    entry.errors.push({ message: String(error.message || error).slice(0, 500), at: new Date().toISOString() });
    scheduleRebuild(entry);
  }

  watcherRegistry.set(repoPath, entry);

  return {
    close() {
      unregisterWatcher(repoPath);
    },
    get status() {
      return entry.status;
    }
  };
}

function buildWatchers(entry) {
  const { gitDir, commonDir } = resolveGitDirs(entry.repoPath);
  entry.gitDir = gitDir;
  entry.commonDir = commonDir;

  const gitDirWatcher = watch(gitDir, { recursive: true }, (eventType, filename) => {
    if (isRelevantRefFile(filename)) {
      entry.debouncer.ping();
    }
  });
  gitDirWatcher.on("error", (error) => handleWatcherError(entry, "gitDir", error));
  entry.watchers.push(gitDirWatcher);

  if (commonDir && commonDir !== gitDir) {
    let shared = commonDirWatchers.get(commonDir);
    if (!shared) {
      const commonWatcher = watch(commonDir, { recursive: true }, (eventType, filename) => {
        if (!isRelevantRefFile(filename)) return;
        const sharedEntry = commonDirWatchers.get(commonDir);
        if (!sharedEntry) return;
        for (const otherRepoPath of sharedEntry.repos) {
          const otherEntry = watcherRegistry.get(otherRepoPath);
          if (otherEntry) otherEntry.debouncer.ping();
        }
      });
      commonWatcher.on("error", (error) => {
        const sharedEntry = commonDirWatchers.get(commonDir);
        if (sharedEntry) {
          for (const otherRepoPath of sharedEntry.repos) {
            const otherEntry = watcherRegistry.get(otherRepoPath);
            if (otherEntry) handleWatcherError(otherEntry, "commonDir", error);
          }
        }
      });
      shared = { watcher: commonWatcher, repos: new Set() };
      commonDirWatchers.set(commonDir, shared);
    }
    shared.repos.add(entry.repoPath);
  }
}

function unregisterWatcher(repoPath) {
  const entry = watcherRegistry.get(repoPath);
  if (!entry) return;

  closeEntryWatchers(entry);

  if (entry.rebuildTimer) {
    entry.timers.clearTimeout(entry.rebuildTimer);
    entry.rebuildTimer = null;
  }

  if (entry.debouncer) {
    entry.debouncer.dispose();
  }

  if (entry.commonDir && entry.commonDir !== entry.gitDir) {
    const shared = commonDirWatchers.get(entry.commonDir);
    if (shared) {
      shared.repos.delete(repoPath);
      if (shared.repos.size === 0) {
        try { shared.watcher.close(); } catch { /* ignore */ }
        commonDirWatchers.delete(entry.commonDir);
      }
    }
  }

  watcherRegistry.delete(repoPath);
}

function closeEntryWatchers(entry) {
  for (const w of entry.watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  entry.watchers = [];

  if (entry.commonDir && entry.commonDir !== entry.gitDir) {
    const shared = commonDirWatchers.get(entry.commonDir);
    if (shared) {
      shared.repos.delete(entry.repoPath);
      if (shared.repos.size === 0) {
        try { shared.watcher.close(); } catch { /* ignore */ }
        commonDirWatchers.delete(entry.commonDir);
      }
    }
  }
}

function handleWatcherError(entry, source, error) {
  entry.status = "degraded";
  entry.errors.push({
    message: `[${source}] ${String(error?.message || error).slice(0, 500)}`,
    at: new Date().toISOString()
  });
  if (entry.errors.length > 50) entry.errors = entry.errors.slice(-50);

  closeEntryWatchers(entry);

  entry.debouncer?.dispose();
  entry.debouncer = createDebouncer(entry.debounceMs, entry.maxWaitMs, () => {
    entry.lastEventAt = new Date().toISOString();
    entry.onTrigger(entry.repoPath);
  }, entry.timers);

  scheduleRebuild(entry);
}

function scheduleRebuild(entry) {
  if (entry.rebuildTimer) return;
  entry.rebuildTimer = entry.timers.setTimeout(() => {
    entry.rebuildTimer = null;
    rebuildWatcher(entry);
  }, REBUILD_DELAY_MS);
}

function rebuildWatcher(entry) {
  if (!watcherRegistry.has(entry.repoPath)) return;

  try {
    entry.debouncer?.dispose();
    entry.debouncer = createDebouncer(entry.debounceMs, entry.maxWaitMs, () => {
      entry.lastEventAt = new Date().toISOString();
      entry.onTrigger(entry.repoPath);
    }, entry.timers);

    buildWatchers(entry);
    entry.status = "active";
    entry.errors = [];
  } catch (error) {
    entry.errors.push({
      message: `[rebuild] ${String(error?.message || error).slice(0, 500)}`,
      at: new Date().toISOString()
    });
    if (entry.errors.length > 50) entry.errors = entry.errors.slice(-50);
    scheduleRebuild(entry);
  }
}

export function closeAllWatchers() {
  for (const repoPath of [...watcherRegistry.keys()]) {
    unregisterWatcher(repoPath);
  }
  for (const shared of commonDirWatchers.values()) {
    try { shared.watcher.close(); } catch { /* ignore */ }
  }
  commonDirWatchers.clear();
}

export function getWatcherStatus() {
  const entries = [...watcherRegistry.values()];
  const errors = [];
  let lastEventAt = null;
  let degradedCount = 0;

  for (const entry of entries) {
    for (const error of entry.errors) {
      errors.push({ repository: entry.repoPath, message: error.message, at: error.at });
    }
    if (entry.lastEventAt) {
      if (!lastEventAt || entry.lastEventAt > lastEventAt) {
        lastEventAt = entry.lastEventAt;
      }
    }
    if (entry.status === "degraded") degradedCount++;
  }

  let status;
  if (entries.length === 0) {
    status = "inactive";
  } else if (degradedCount === entries.length) {
    status = "down";
  } else if (degradedCount > 0) {
    status = "degraded";
  } else {
    status = "active";
  }

  return {
    status,
    watchedRepositoryCount: entries.length,
    lastEventAt,
    errors
  };
}

function createDebouncer(debounceMs, maxWaitMs, onTrigger, timers = globalThis) {
  let debounceTimer = null;
  let maxWaitTimer = null;
  let firstEventAt = null;

  function clearTimers() {
    if (debounceTimer) { timers.clearTimeout(debounceTimer); debounceTimer = null; }
    if (maxWaitTimer) { timers.clearTimeout(maxWaitTimer); maxWaitTimer = null; }
    firstEventAt = null;
  }

  function fire() {
    clearTimers();
    try { onTrigger(); } catch { /* swallow callback errors */ }
  }

  function ping() {
    if (!firstEventAt) firstEventAt = Date.now();

    if (debounceTimer) timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(() => {
      debounceTimer = null;
      fire();
    }, debounceMs);

    if (!maxWaitTimer) {
      maxWaitTimer = timers.setTimeout(() => {
        fire();
      }, maxWaitMs);
    }
  }

  function dispose() {
    clearTimers();
  }

  return { ping, dispose, fire, debounceMs, maxWaitMs };
}

function isRelevantRefFile(filename) {
  if (!filename) return true;
  const normalized = String(filename).replace(/\\/g, "/");
  if (normalized === "HEAD") return true;
  if (normalized === "packed-refs") return true;
  if (normalized.startsWith("refs/heads/")) return true;
  if (normalized === "logs/HEAD") return true;
  if (normalized.startsWith("logs/refs/heads/")) return true;
  return false;
}

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });
  return { ok: result.status === 0 && !result.error, stdout: String(result.stdout || "") };
}
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const SESSION_META_MAX_BYTES = 512 * 1024;
const SPAWN_WINDOW_MS = 15 * 60_000;
const THREAD_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const DAY_MS = 24 * 60 * 60_000;

export function resolveCodexHome(codexHome) {
  return resolve(codexHome || process.env.CODEX_HOME || resolve(homedir(), ".codex"));
}

// Codex writes one rollout per thread. A subagent reuses its parent's session_id, so only
// `id` and `thread_source` in the leading session_meta record tell the two apart.
export function readRolloutThreadMeta(filePath) {
  const record = parseJson(readFirstLine(filePath));
  if (record?.type !== "session_meta") {
    return null;
  }
  const payload = record.payload || {};
  const sessionId = text(payload.session_id);
  if (!sessionId) {
    return null;
  }
  return {
    sessionId,
    threadId: text(payload.id) || sessionId,
    parentThreadId: text(payload.parent_thread_id),
    threadSource: text(payload.thread_source) || "user"
  };
}

// Resolves the thread that owns a turn at hook time. Returns null when the thread cannot be
// proven, so callers stay on the conservative path instead of guessing "main thread".
export function resolveCodexTurnThread(
  { sessionId, turnId, transcriptPath } = {},
  { codexHome, now = Date.now() } = {}
) {
  const session = text(sessionId);
  if (!THREAD_ID_PATTERN.test(session)) {
    return null;
  }
  const home = resolveCodexHome(codexHome);
  const turn = text(turnId);

  const transcriptMeta = transcriptPath ? readRolloutThreadMeta(transcriptPath) : null;
  if (transcriptMeta?.sessionId === session && transcriptMeta.threadSource === "subagent") {
    return transcriptMeta;
  }

  const subagent = findSubagentThreadForTurn({ sessionId: session, turnId: turn, codexHome: home, now });
  if (subagent) {
    return subagent;
  }

  if (transcriptMeta?.sessionId === session) {
    return transcriptMeta;
  }
  return findRolloutByThreadId({ threadId: session, codexHome: home, around: now })
    ? { sessionId: session, threadId: session, parentThreadId: "", threadSource: "user" }
    : null;
}

// Locates the rollout holding a turn's events. A subagent turn lives in its own rollout, not in
// the parent rollout named after the shared session id.
export function findCodexTurnRollout({ sessionId, turnId, threadId, codexHome, startedAt } = {}) {
  const session = text(sessionId);
  const turn = text(turnId);
  const thread = text(threadId);
  const home = resolveCodexHome(codexHome);
  const around = Number.isFinite(startedAt) ? startedAt : Date.now();

  if (thread) {
    const direct = findRolloutByThreadId({ threadId: thread, codexHome: home, around });
    if (direct) {
      return direct;
    }
  }

  if (session) {
    const parent = findRolloutByThreadId({ threadId: session, codexHome: home, around });
    if (parent && (!turn || rolloutMentionsTurn(parent, turn))) {
      return parent;
    }
  }

  if (!session || !turn) {
    return null;
  }
  for (const directory of sessionDirectories(home, around)) {
    for (const entry of rolloutEntries(directory)) {
      if (session && entry.name.endsWith(`-${session}.jsonl`)) {
        continue;
      }
      if (readRolloutThreadMeta(entry.path)?.sessionId !== session) {
        continue;
      }
      if (rolloutMentionsTurn(entry.path, turn)) {
        return entry.path;
      }
    }
  }
  return null;
}

function findSubagentThreadForTurn({ sessionId, turnId, codexHome, now }) {
  if (!turnId) {
    return null;
  }
  for (const directory of sessionDirectories(codexHome, now)) {
    for (const entry of rolloutEntries(directory)) {
      if (entry.name.endsWith(`-${sessionId}.jsonl`) || now - entry.mtimeMs > SPAWN_WINDOW_MS) {
        continue;
      }
      const meta = readRolloutThreadMeta(entry.path);
      if (meta?.sessionId !== sessionId || meta.threadSource !== "subagent") {
        continue;
      }
      if (rolloutMentionsTurn(entry.path, turnId)) {
        return meta;
      }
    }
  }
  return null;
}

function findRolloutByThreadId({ threadId, codexHome, around }) {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    return null;
  }
  for (const directory of sessionDirectories(codexHome, around)) {
    const entry = rolloutEntries(directory).find((item) => item.name.endsWith(`-${threadId}.jsonl`));
    if (entry) {
      return entry.path;
    }
  }
  return null;
}

function sessionDirectories(codexHome, around) {
  const directories = [];
  for (const offset of [0, -1, 1]) {
    const date = new Date(around + offset * DAY_MS);
    const directory = resolve(
      codexHome,
      "sessions",
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    );
    if (existsSync(directory)) {
      directories.push(directory);
    }
  }
  return directories;
}

function rolloutEntries(directory) {
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const path = resolve(directory, name);
    try {
      entries.push({ name, path, mtimeMs: statSync(path).mtimeMs });
    } catch {
      // A rollout can be rotated away while the directory is being scanned.
    }
  }
  return entries;
}

function rolloutMentionsTurn(filePath, turnId) {
  try {
    return readFileSync(filePath, "utf8").includes(turnId);
  } catch {
    return false;
  }
}

function readFirstLine(filePath) {
  let descriptor;
  try {
    descriptor = openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(SESSION_META_MAX_BYTES);
    const bytes = readSync(descriptor, buffer, 0, SESSION_META_MAX_BYTES, 0);
    const chunk = buffer.toString("utf8", 0, bytes);
    const newline = chunk.indexOf("\n");
    if (newline !== -1) {
      return chunk.slice(0, newline);
    }
    return bytes < SESSION_META_MAX_BYTES ? chunk : "";
  } catch {
    return "";
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The descriptor is already gone; nothing to release.
      }
    }
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function text(value) {
  return String(value || "").trim();
}

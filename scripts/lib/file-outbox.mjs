import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

export const DEFAULT_PROCESSING_LEASE_MS = 15 * 60 * 1_000;

export function ensureOutboxDirs(queueRoot) {
  for (const state of ["pending", "processing", "sent", "failed"]) {
    mkdirSync(resolve(queueRoot, state), { recursive: true });
  }
}

export function listOutboxFiles(queueRoot, state) {
  const directory = resolve(queueRoot, state);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolve(directory, entry.name));
}

export function claimReadyOutboxItems({
  queueRoot,
  now = new Date(),
  limit = Infinity,
  processingLeaseMs = DEFAULT_PROCESSING_LEASE_MS,
  readEnvelope,
  writeEnvelope
}) {
  ensureOutboxDirs(queueRoot);
  const claimTime = toDate(now);
  recoverStaleOutboxItems({
    queueRoot,
    now: claimTime,
    processingLeaseMs,
    readEnvelope,
    writeEnvelope
  });

  const claimed = [];
  for (const pendingFile of listOutboxFiles(queueRoot, "pending")) {
    if (claimed.length >= limit) {
      break;
    }

    const envelope = readEnvelope(pendingFile);
    if (!isReadyEnvelope(envelope, claimTime)) {
      continue;
    }

    const item = claimOutboxFile({
      queueRoot,
      pendingFile,
      envelope,
      now: claimTime,
      writeEnvelope
    });
    if (item) {
      claimed.push(item);
    }
  }
  return claimed;
}

export function claimOutboxItem({
  queueRoot,
  fileName,
  now = new Date(),
  processingLeaseMs = DEFAULT_PROCESSING_LEASE_MS,
  readEnvelope,
  writeEnvelope
}) {
  ensureOutboxDirs(queueRoot);
  const claimTime = toDate(now);
  recoverStaleOutboxItems({
    queueRoot,
    now: claimTime,
    processingLeaseMs,
    readEnvelope,
    writeEnvelope
  });
  const pendingFile = resolve(queueRoot, "pending", fileName);
  const envelope = readEnvelope(pendingFile);
  if (!isReadyEnvelope(envelope, claimTime)) {
    return null;
  }
  return claimOutboxFile({
    queueRoot,
    pendingFile,
    envelope,
    now: claimTime,
    writeEnvelope
  });
}

export function recoverStaleOutboxItems({
  queueRoot,
  now = new Date(),
  processingLeaseMs = DEFAULT_PROCESSING_LEASE_MS,
  readEnvelope,
  writeEnvelope
}) {
  ensureOutboxDirs(queueRoot);
  const currentTime = toDate(now).getTime();
  let recovered = 0;

  for (const processingFile of listOutboxFiles(queueRoot, "processing")) {
    const envelope = readEnvelope(processingFile);
    const claimedAt = Date.parse(String(envelope?.claimedAt || ""));
    const fileAge = safeMtime(processingFile);
    const startedAt = Number.isFinite(claimedAt) ? claimedAt : fileAge;
    if (!Number.isFinite(startedAt) || currentTime - startedAt < processingLeaseMs) {
      continue;
    }

    const pendingFile = resolve(queueRoot, "pending", basename(processingFile));
    if (existsSync(pendingFile)) {
      continue;
    }

    if (envelope) {
      const recoveredEnvelope = { ...envelope };
      delete recoveredEnvelope.claimedAt;
      writeEnvelope(processingFile, recoveredEnvelope);
    }

    try {
      renameSync(processingFile, pendingFile);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    recovered += 1;
  }
  return recovered;
}

export function countOutboxFiles(queueRoot, state) {
  return listOutboxFiles(queueRoot, state).length;
}

function claimOutboxFile({ queueRoot, pendingFile, envelope, now, writeEnvelope }) {
  const processingFile = resolve(queueRoot, "processing", basename(pendingFile));
  try {
    renameSync(pendingFile, processingFile);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const claimedEnvelope = {
    ...envelope,
    claimedAt: now.toISOString()
  };
  writeEnvelope(processingFile, claimedEnvelope);
  return { filePath: processingFile, envelope: claimedEnvelope };
}

function isReadyEnvelope(envelope, now) {
  if (!envelope?.event?.event_id) {
    return false;
  }
  const nextAttemptAt = Date.parse(String(envelope.nextAttemptAt || ""));
  return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now.getTime();
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Outbox time must be a valid date");
  }
  return date;
}

function safeMtime(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return NaN;
  }
}

export function writeOutboxJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

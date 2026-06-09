import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_TTL_SECONDS = 120;

export function getPendingAskFile(baseDir = process.cwd()) {
  return resolve(baseDir, ".local/pending-ask-notify.json");
}

export function markPendingAskNotify(summary, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const filePath = getPendingAskFile(baseDir);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({ summary: String(summary || "").trim(), expiresAt, markedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );

  return expiresAt;
}

export function readPendingAskNotify(baseDir = process.cwd()) {
  const filePath = getPendingAskFile(baseDir);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    const expiresAt = new Date(data.expiresAt || 0);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export function isPendingAskNotifyActive(baseDir = process.cwd()) {
  return Boolean(readPendingAskNotify(baseDir));
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const STATUS_LABELS = {
  test: "测试",
  info: "提示",
  running: "开始",
  done: "完成",
  error: "异常",
  wait: "需要操作",
  ask: "需要操作"
};

const DEFAULT_NOTIFY_STATUSES = new Set(["test", "done", "error", "wait", "ask"]);
const DEFAULT_DEDUPE_SECONDS = 300;
const STATUS_FILE = resolve(process.cwd(), ".local/status.json");
const CACHE_FILE = resolve(process.cwd(), ".local/notify-cache.json");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NOTIFY_SCRIPT = resolve(SCRIPT_DIR, "notify.mjs");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const dryRun = consumeFlag(args, "--dry-run");
  const force = consumeFlag(args, "--force");
  const notify = consumeFlag(args, "--notify");
  const noNotify = consumeFlag(args, "--no-notify");
  const editor = readOption(args, "--editor");
  const task = readOption(args, "--task");

  if (notify && noNotify) {
    throw new Error("Use either --notify or --no-notify, not both.");
  }

  const status = normalizeStatus(args.shift() || "info");
  const message = args.join(" ").trim();
  const now = new Date();
  const dedupeSeconds = readDedupeSeconds();
  const decision = decideNotification({
    status,
    message,
    force,
    notify,
    noNotify,
    dedupeSeconds,
    now
  });

  const statusRecord = {
    status,
    label: STATUS_LABELS[status],
    message,
    editor: editor || null,
    task: task || null,
    updatedAt: now.toISOString(),
    notify: {
      shouldSend: decision.shouldSend,
      reason: decision.reason,
      dedupeSeconds
    }
  };

  if (dryRun) {
    console.log(JSON.stringify({ status: statusRecord, notification: decision }, null, 2));
    return;
  }

  writeJson(STATUS_FILE, statusRecord);

  if (!decision.shouldSend) {
    console.log(`Status recorded. Notification skipped: ${decision.reason}.`);
    return;
  }

  writeJson(CACHE_FILE, updateCache(decision.fingerprint, status, message, now));
  await runNotify(status, message, editor, task);
  console.log(`Status recorded and notification sent: ${status}.`);
}

function normalizeStatus(value) {
  const status = value.toLowerCase();
  return STATUS_LABELS[status] ? status : "info";
}

function decideNotification({ status, message, force, notify, noNotify, dedupeSeconds, now }) {
  const fingerprint = createFingerprint(status, message);

  if (noNotify) {
    return { shouldSend: false, reason: "disabled", fingerprint };
  }

  if (!force && !notify && !DEFAULT_NOTIFY_STATUSES.has(status)) {
    return { shouldSend: false, reason: "status_not_notifiable", fingerprint };
  }

  const enforceDedupe = status === "wait" || status === "ask";
  if ((!force || enforceDedupe) && isDuplicate(fingerprint, dedupeSeconds, now)) {
    return { shouldSend: false, reason: "duplicate", fingerprint };
  }

  return {
    shouldSend: true,
    reason: force ? "forced" : notify ? "manual_notify" : "status_notifies",
    fingerprint
  };
}

function createFingerprint(status, message) {
  const normalizedMessage = normalizeMessageForDedupe(status, message);
  return createHash("sha256").update(`${status}\0${normalizedMessage}`).digest("hex");
}

function normalizeMessageForDedupe(status, message) {
  const text = String(message || "").trim();
  if (status !== "wait" && status !== "ask") {
    return text;
  }

  let normalized = text.toLowerCase();

  normalized = normalized.replace(/^(cursor|codex)[：:\s]+/i, "");
  normalized = normalized.replace(/^cursor 等你回答[：:\s]+/i, "");
  normalized = normalized.replace(/^codex\/cursor 需要你确认[：:\s]+/i, "");

  normalized = normalized.replace(/input needed\s*[·•?\u00b7\-–—]*\s*/gi, "");
  normalized = normalized.replace(/command approval\s*[·•?\u00b7\-–—]*\s*/gi, "");
  normalized = normalized.replace(/open cursor to answer the agent'?s questions?\.?\s*/gi, "");
  normalized = normalized.replace(/open cursor to view the agent'?s output\.?\s*/gi, "");

  return normalized.replace(/\s+/g, " ").trim();
}

function isDuplicate(fingerprint, dedupeSeconds, now) {
  const cache = readJson(CACHE_FILE, { fingerprints: {} });
  const record = cache.fingerprints?.[fingerprint];
  if (!record?.sentAt) {
    return false;
  }

  const sentAt = new Date(record.sentAt);
  if (Number.isNaN(sentAt.getTime())) {
    return false;
  }

  return now.getTime() - sentAt.getTime() < dedupeSeconds * 1000;
}

function updateCache(fingerprint, status, message, now) {
  const cache = readJson(CACHE_FILE, { fingerprints: {} });
  return {
    ...cache,
    fingerprints: {
      ...(cache.fingerprints || {}),
      [fingerprint]: {
        status,
        message,
        sentAt: now.toISOString()
      }
    }
  };
}

function readDedupeSeconds() {
  const value = Number(process.env.VIBECODING_NOTIFY_DEDUPE_SECONDS || DEFAULT_DEDUPE_SECONDS);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_DEDUPE_SECONDS;
  }

  return Math.floor(value);
}

function runNotify(status, message, editor, task) {
  return new Promise((resolveRun, rejectRun) => {
    const notifyArgs = [NOTIFY_SCRIPT, status, message];
    if (editor) {
      notifyArgs.push("--editor", editor);
    }
    if (task) {
      notifyArgs.push("--task", task);
    }

    const child = spawn(process.execPath, notifyArgs, {
      stdio: "inherit",
      shell: false
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`notify.mjs exited with code ${code}`));
    });
  });
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(equalIndex + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }

  args.splice(index, 1);
  return true;
}

function readOption(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  args.splice(index, 2);
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/status.mjs <status> <message>

Examples:
  node scripts/status.mjs running "Codex 正在执行"
  node scripts/status.mjs done "Codex 任务完成"
  node scripts/status.mjs error "Cursor 构建失败"
  node scripts/status.mjs wait "需要你接管确认"

Options:
  --dry-run    Print the status decision without writing or notifying
  --force      Send even when duplicate or normally non-notifying
  --notify     Send for this status even if it is normally record-only
  --no-notify  Record only, never send
  --editor     Codex or Cursor (shown on Feishu/band)
  --task       Task name (third line on Feishu/band)

Files:
  .local/status.json        Latest status
  .local/notify-cache.json  Local dedupe cache
`);
}

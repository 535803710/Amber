#!/usr/bin/env node

/**
 * Cursor 用户级 Hook：检测 Agent 提问/待回应场景并调用 Amber 发 wait 通知。
 * 配置见 ~/.cursor/hooks.json
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const AMBER_HOME = resolveAmberHome();
const NOTIFY_ASK = resolve(AMBER_HOME, "scripts/notify-ask.mjs");
const LOG_FILE = resolve(AMBER_HOME, ".local/cursor-hook.log");
const DEDUPE_FILE = resolve(AMBER_HOME, ".local/cursor-hook-dedupe.json");
const DEDUPE_SECONDS = 120;

// 失焦时 watch:all [toast] 会处理，Hook 不再重复发
const TOAST_DELEGATED_MARKERS = [
  "input needed",
  "open cursor to answer",
  "open cursor to view",
  "command approval",
  "answer the agent"
];

const ASK_MARKERS = [
  "askquestion",
  "ask_question",
  "askuserquestion",
  "no answer provided",
  '"questions"',
  "需要你回答",
  "等你回答",
  "请选择",
  "确认问题"
];

main().catch((error) => {
  logLine(`error: ${error.message}`);
  process.exit(0);
});

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    logLine("invalid json stdin");
    return;
  }

  const event = String(payload.hook_event_name || "unknown");
  logLine(`event=${event} generation=${payload.generation_id || "-"}`);

  const decision = decideNotification(event, payload);
  if (!decision.shouldNotify) {
    logLine(`skip: ${decision.reason}`);
    return;
  }

  if (isDuplicate(payload.generation_id, decision.summary)) {
    logLine(`skip: duplicate ${decision.summary}`);
    return;
  }

  await runNotifyAsk(decision.summary);
  markSent(payload.generation_id, decision.summary);
  logLine(`sent: ${decision.summary}`);
}

function decideNotification(event, payload) {
  const blob = JSON.stringify(payload).toLowerCase();

  if (isToastDelegatedScenario(blob)) {
    return {
      shouldNotify: false,
      reason: "delegated to watch:all toast (avoid duplicate when unfocused)"
    };
  }

  if (event === "afterAgentResponse") {
    if (containsAskMarker(blob)) {
      return {
        shouldNotify: true,
        reason: "afterAgentResponse ask marker",
        summary: extractSummary(payload) || "Cursor Agent 有问题等你回答"
      };
    }

    return { shouldNotify: false, reason: "afterAgentResponse no marker" };
  }

  if (event === "stop") {
    const status = String(payload.status || "").toLowerCase();
    if (status !== "completed") {
      return { shouldNotify: false, reason: `stop status=${status}` };
    }

    if (containsAskMarker(blob)) {
      return {
        shouldNotify: true,
        reason: "stop with ask marker",
        summary: extractSummary(payload) || "Cursor Agent 有问题等你回答"
      };
    }

    return { shouldNotify: false, reason: "stop completed without ask marker" };
  }

  return { shouldNotify: false, reason: `ignored event ${event}` };
}

function containsAskMarker(text) {
  return ASK_MARKERS.some((marker) => text.includes(marker));
}

function isToastDelegatedScenario(text) {
  return TOAST_DELEGATED_MARKERS.some((marker) => text.includes(marker));
}

function extractSummary(payload) {
  const candidates = [
    payload.prompt,
    payload.user_message,
    payload.text,
    payload.response,
    payload.message,
    payload.agent_message
  ];

  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text && text.length >= 4) {
      return truncate(text, 80);
    }
  }

  const questions = payload.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    const first = questions[0];
    const prompt = String(first?.prompt || first?.question || first?.title || "").trim();
    if (prompt) {
      return truncate(prompt, 80);
    }
  }

  return "";
}

function truncate(text, max) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 3)}...`;
}

function resolveAmberHome() {
  const candidates = [
    process.env.AMBER_HOME,
    resolve(SCRIPT_DIR, "../.."),
    "D:/project/Amber"
  ].filter(Boolean);

  for (const home of candidates) {
    const root = resolve(home);
    if (existsSync(resolve(root, "scripts/notify-ask.mjs"))) {
      return root;
    }
  }

  throw new Error("找不到 Amber 目录");
}

function runNotifyAsk(summary) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [NOTIFY_ASK, summary], {
      cwd: AMBER_HOME,
      stdio: "ignore",
      shell: false
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`notify-ask.mjs exited with code ${code}`));
    });
  });
}

function isDuplicate(generationId, summary) {
  const cache = readDedupe();
  const key = `${generationId || "unknown"}:${summary}`;
  const record = cache.entries?.[key];
  if (!record?.sentAt) {
    return false;
  }

  const sentAt = new Date(record.sentAt);
  if (Number.isNaN(sentAt.getTime())) {
    return false;
  }

  return Date.now() - sentAt.getTime() < DEDUPE_SECONDS * 1000;
}

function markSent(generationId, summary) {
  const cache = readDedupe();
  const key = `${generationId || "unknown"}:${summary}`;
  cache.entries = cache.entries || {};
  cache.entries[key] = { sentAt: new Date().toISOString() };
  writeDedupe(cache);
}

function readDedupe() {
  if (!existsSync(DEDUPE_FILE)) {
    return { entries: {} };
  }

  try {
    return JSON.parse(readFileSync(DEDUPE_FILE, "utf8"));
  } catch {
    return { entries: {} };
  }
}

function writeDedupe(cache) {
  mkdirSync(dirname(DEDUPE_FILE), { recursive: true });
  writeFileSync(DEDUPE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function logLine(message) {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function readStdin() {
  return new Promise((resolveRead) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveRead(data));
  });
}

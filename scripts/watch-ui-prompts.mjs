#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnHidden, runHiddenCommand } from "./lib/spawn-hidden.mjs";

import { resolveEditorFromAppName } from "./notify-format.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PS_SCRIPT = resolve(SCRIPT_DIR, "windows-ui-prompt-listener.ps1");
const STATUS_SCRIPT = resolve(SCRIPT_DIR, "status.mjs");
const WATCHED_FILE = resolve(process.cwd(), ".local/watched-ui-prompts.json");
const DEFAULT_APPS = ["Codex", "Cursor"];
const DEFAULT_INTERVAL_SECONDS = 2;
const DEFAULT_KEYWORDS = [
  "confirm",
  "approve",
  "allow",
  "run command",
  "permission",
  "ask",
  "question",
  "answer",
  "input needed",
  "no answer provided",
  "确认",
  "允许",
  "批准",
  "需要",
  "问题",
  "回答",
  "选择",
  "确认问题",
  "等你",
  "需要你"
];

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
  const probe = consumeFlag(args, "--probe");
  const apps = parseApps(readOption(args, "--apps") || DEFAULT_APPS.join(","));
  const intervalSeconds = parseInterval(readOption(args, "--interval"));

  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(" ")}`);
  }

  console.log(`开始监听 Codex/Cursor 内部确认框（${apps.join(", ")}），间隔 ${intervalSeconds}s`);
  console.log("只读监听：不会自动点击或批准。");
  if (dryRun) {
    console.log("dry-run 模式：只打印，不写入状态或发飞书。");
  }

  const watched = readWatched();

  if (probe) {
    const snapshot = await runPromptListener(apps);
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  while (true) {
    const snapshot = await runPromptListener(apps);
    if (snapshot.error) {
      console.error(`UI 探测失败：${snapshot.error}`);
    }

    for (const item of snapshot.prompts || []) {
      if (isWatched(watched, item.fingerprint)) {
        continue;
      }

      const message = formatMessage(item);
      if (dryRun) {
        console.log(`[dry-run] 将发送 wait：${message}`);
      } else {
        const editor =
          resolveEditorFromAppName(item.processName) || resolveEditorFromAppName(item.windowTitle);
        await runStatus(message, editor);
        console.log(`已发送 wait：${message}`);
      }

      markWatched(watched, item);
    }

    writeWatched(watched);
    await sleep(intervalSeconds * 1000);
  }
}

function formatMessage(item) {
  const summary = String(item.summary || item.windowTitle || "确认框").trim();
  return `[需要操作] ${summary}`;
}

function parseApps(value) {
  const apps = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return apps.length > 0 ? apps : [...DEFAULT_APPS];
}

function parseInterval(value) {
  if (!value) {
    return DEFAULT_INTERVAL_SECONDS;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("--interval 必须是大于 0 的数字");
  }

  return seconds;
}

function readOption(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} 需要一个值`);
  }

  args.splice(index, 2);
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

async function runPromptListener(apps) {
  const psArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    PS_SCRIPT,
    "-Apps",
    ...apps,
    "-Keywords",
    ...DEFAULT_KEYWORDS
  ];

  const stdout = await runHiddenCommand("powershell.exe", psArgs);
  const snapshot = JSON.parse(stdout);
  if (!Array.isArray(snapshot.prompts)) {
    snapshot.prompts = [];
  }
  return snapshot;
}

function runStatus(message, editor) {
  return new Promise((resolveRun, rejectRun) => {
    const args = [STATUS_SCRIPT, "wait", message, "--force"];
    if (editor) {
      args.push("--editor", editor);
    }

    const child = spawnHidden(process.execPath, args, {
      stdio: "inherit"
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`status.mjs exited with code ${code}`));
    });
  });
}

function readWatched() {
  if (!existsSync(WATCHED_FILE)) {
    return { fingerprints: {} };
  }

  try {
    const data = JSON.parse(readFileSync(WATCHED_FILE, "utf8"));
    return { fingerprints: data.fingerprints || {} };
  } catch {
    return { fingerprints: {} };
  }
}

function writeWatched(watched) {
  mkdirSync(dirname(WATCHED_FILE), { recursive: true });
  writeFileSync(WATCHED_FILE, `${JSON.stringify(watched, null, 2)}\n`, "utf8");
}

function isWatched(watched, fingerprint) {
  return Boolean(watched.fingerprints?.[fingerprint]);
}

function markWatched(watched, item) {
  watched.fingerprints[item.fingerprint] = {
    processName: item.processName,
    windowTitle: item.windowTitle,
    summary: item.summary,
    forwardedAt: new Date().toISOString()
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

function printHelp() {
  console.log(`Usage:
  node scripts/watch-ui-prompts.mjs [options]

Options:
  --apps <names>     逗号分隔的进程名匹配，默认 Codex,Cursor
  --interval <sec>   轮询间隔秒数，默认 2
  --dry-run          只打印将要发送的 wait 消息
  --probe            扫描一次后退出

Examples:
  node scripts/watch-ui-prompts.mjs --probe --dry-run
  node scripts/watch-ui-prompts.mjs --apps Codex,Cursor

说明：
  使用 Windows UI Automation 只读监听内部确认框，存在误报/漏报风险。
  命中后发送：node scripts/status.mjs wait "<消息>" --force
`);
}

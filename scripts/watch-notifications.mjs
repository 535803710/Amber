#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHiddenCommand, spawnHidden } from "./lib/spawn-hidden.mjs";
import { isPendingAskNotifyActive } from "./ask-notify-window.mjs";
import { shouldNotifyForStatus } from "./lib/settings.mjs";
import {
  compactToastSummary,
  getNotifyCategoryLabel,
  resolveEditorFromAppName
} from "./notify-format.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PS_SCRIPT = resolve(SCRIPT_DIR, "windows-notification-listener.ps1");
const STATUS_SCRIPT = resolve(SCRIPT_DIR, "status.mjs");
const WATCHED_FILE = resolve(process.cwd(), ".local/watched-notifications.json");
const DEFAULT_APPS = ["ChatGPT", "Codex", "Cursor"];
const DEFAULT_INTERVAL_SECONDS = 2;
const ACCESS_GUIDE =
  "Windows 设置 -> 隐私和安全性 -> 通知 -> 用户通知访问";
const WAIT_TOAST_PATTERNS = [
  /input needed/i,
  /需要你回答/i,
  /answer the agent/i,
  /command approval/i,
  /需要批准/i,
  /需要你确认/i
];
const DONE_TOAST_PATTERNS = [/^\s*done\b/i, /view the agent'?s output/i];

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
  const noSeed = consumeFlag(args, "--no-seed");
  const apps = parseApps(readOption(args, "--apps") || DEFAULT_APPS.join(","));
  const intervalSeconds = parseInterval(readOption(args, "--interval"));

  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(" ")}`);
  }

  const access = await runListener({ action: "check-access", requestAccess: !probe });
  if (access.accessStatus === "Error") {
    throw new Error(access.error || "无法检查 Windows 通知访问权限");
  }

  if (access.accessStatus !== "Allowed") {
    console.error("当前未获得 Windows 用户通知访问权限，无法监听系统 toast。");
    console.error(`请前往：${ACCESS_GUIDE}`);
    console.error("开启后重新运行 watcher。");
    process.exitCode = 2;
    return;
  }

  if (probe) {
    const snapshot = await runListener({ action: "list" });
    printProbe(snapshot, apps);
    return;
  }

  console.log(`开始监听 Windows 系统通知（${apps.join(", ")}），间隔 ${intervalSeconds}s`);
  if (dryRun) {
    console.log("dry-run 模式：只打印，不写入状态或发飞书。");
  }

  const watched = readWatched();
  let seeded = noSeed;

  while (true) {
    const snapshot = await runListener({ action: "list" });
    if (snapshot.accessStatus !== "Allowed") {
      console.error(`通知访问权限已失效（${snapshot.accessStatus}）。请检查：${ACCESS_GUIDE}`);
      process.exitCode = 2;
      return;
    }

    const matched = filterNotifications(snapshot.notifications || [], apps);

    if (!seeded) {
      for (const item of matched) {
        markWatched(watched, item);
      }
      writeWatched(watched);
      seeded = true;
      console.log("已记录当前通知，后续只转发新出现的 toast。");
    } else {
      for (const item of matched) {
        if (isWatched(watched, item.id)) {
          continue;
        }

        const message = formatMessage(item);
        const status = classifyNotification(item);

        if (!shouldNotifyForStatus(status, process.cwd())) {
          if (dryRun) {
            console.log(`[dry-run] 跳过 toast（设置已关闭 ${status}）：${message}`);
          } else {
            console.log(`跳过 toast（设置已关闭 ${status}）：${message}`);
          }
          markWatched(watched, item);
          continue;
        }

        if (status === "wait" && isPendingAskNotifyActive(process.cwd())) {
          if (dryRun) {
            console.log(`[dry-run] 跳过 toast（notify-ask 窗口内）：${message}`);
          } else {
            console.log(`跳过 toast（notify-ask 窗口内）：${message}`);
          }
          markWatched(watched, item);
          continue;
        }

        if (dryRun) {
          console.log(`[dry-run] 将转发 (${status})：${message}`);
        } else {
          const editor = resolveEditorFromAppName(item.appName);
          const sent = await runStatus(message, status, editor);
          if (sent) {
            console.log(`已转发 (${status})：${message}`);
          } else {
            console.log(`去重跳过 (${status})：${message}`);
          }
        }

        markWatched(watched, item);
      }
      writeWatched(watched);
    }

    await sleep(intervalSeconds * 1000);
  }
}

function printProbe(snapshot, apps) {
  const items = filterNotifications(snapshot.notifications || [], apps).map((item) => ({
    ...item,
    status: classifyNotification(item)
  }));
  console.log(JSON.stringify({ accessStatus: snapshot.accessStatus, count: items.length, notifications: items }, null, 2));
}

function filterNotifications(notifications, apps) {
  return notifications.filter((item) => matchesApp(item.appName, apps));
}

function matchesApp(appName, apps) {
  const name = String(appName || "").toLowerCase();
  if (!name) {
    return false;
  }

  if (apps.includes("*")) {
    return true;
  }

  return apps.some((app) => name.includes(app.toLowerCase()));
}

function classifyNotification(item) {
  const haystack = `${item.title || ""} ${item.body || ""}`;
  if (WAIT_TOAST_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return "wait";
  }
  if (DONE_TOAST_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return "done";
  }
  return "info";
}

function formatMessage(item) {
  const status = classifyNotification(item);
  const summary = compactToastSummary(item);
  const category = getNotifyCategoryLabel(status, summary);
  return `[${category}] ${summary}`;
}

function parseApps(value) {
  const apps = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (apps.length === 0) {
    return [...DEFAULT_APPS];
  }

  return apps;
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

async function runListener({ action, requestAccess = false }) {
  const psArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    PS_SCRIPT,
    "-Action",
    action
  ];

  if (requestAccess) {
    psArgs.push("-RequestAccess");
  }

  const stdout = await runHiddenCommand("powershell.exe", psArgs);
  return JSON.parse(stdout);
}

function runStatus(message, status = "info", editor) {
  const args = [STATUS_SCRIPT, status, message, "--force"];
  if (editor) {
    args.push("--editor", editor);
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawnHidden(process.execPath, args, { stdio: "pipe" });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code !== 0) {
        rejectRun(new Error(`status.mjs exited with code ${code}`));
        return;
      }

      resolveRun(!/Notification skipped: duplicate/.test(output));
    });
  });
}

function readWatched() {
  if (!existsSync(WATCHED_FILE)) {
    return { ids: {} };
  }

  try {
    const data = JSON.parse(readFileSync(WATCHED_FILE, "utf8"));
    return { ids: data.ids || {} };
  } catch {
    return { ids: {} };
  }
}

function writeWatched(watched) {
  mkdirSync(dirname(WATCHED_FILE), { recursive: true });
  writeFileSync(WATCHED_FILE, `${JSON.stringify(watched, null, 2)}\n`, "utf8");
}

function isWatched(watched, id) {
  return Boolean(watched.ids?.[id]);
}

function markWatched(watched, item) {
  watched.ids[item.id] = {
    appName: item.appName,
    title: item.title,
    body: item.body,
    status: classifyNotification(item),
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
  node scripts/watch-notifications.mjs [options]

Options:
  --apps <names>     逗号分隔的应用名匹配，默认 ChatGPT,Codex,Cursor；* 表示全部
  --interval <sec>   轮询间隔秒数，默认 2
  --dry-run          只打印将要转发的消息
  --probe            列出当前可读通知后退出
  --no-seed          启动时不忽略已有通知（可能一次性转发多条）

Examples:
  node scripts/watch-notifications.mjs --probe --dry-run --apps "*"
  node scripts/watch-notifications.mjs --dry-run --apps Codex,Cursor
  node scripts/watch-notifications.mjs --apps Codex,Cursor

转发命令：
  Input needed / Command approval 等 -> status.mjs wait
  其他 toast -> status.mjs info --notify --force

权限：
  ${ACCESS_GUIDE}
`);
}

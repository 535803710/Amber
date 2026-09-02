#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { superviseWatchers } from "./lib/watch-supervisor.mjs";
import { resolveRuntimeProfile, runtimeWatcherLabels } from "./lib/runtime-profile.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NOTIFICATIONS_SCRIPT = resolve(SCRIPT_DIR, "watch-notifications.mjs");
const UI_PROMPTS_SCRIPT = resolve(SCRIPT_DIR, "watch-ui-prompts.mjs");
const CHANGE_RECORD_WORKER = resolve(SCRIPT_DIR, "change-record-worker.mjs");
const COMMIT_RECORD_WORKER = resolve(SCRIPT_DIR, "commit-record-worker.mjs");
const WATCHER_STATE_FILE = resolve(SCRIPT_DIR, "../.local/watcher-state.json");

main();

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const profile = resolveRuntimeProfile(args, "full");
  const full = profile === "full";
  console.log(full
    ? "启动 Amber 完整监听：系统通知 + 内部确认/提问 UI + AI/Git 记录"
    : "启动 Amber 核心监听：AI 修改记录 + Git 提交记录");
  console.log("按 Ctrl+C 停止。");

  const definitions = {
    toast: [NOTIFICATIONS_SCRIPT, watcherArgs(args)],
    ui: [UI_PROMPTS_SCRIPT, watcherArgs(args)],
    records: [CHANGE_RECORD_WORKER, workerArgs(args)],
    commits: [COMMIT_RECORD_WORKER, workerArgs(args)]
  };
  const children = runtimeWatcherLabels(profile).map((label) => {
    const [scriptPath, childArgs] = definitions[label];
    return spawnWatcher(label, scriptPath, childArgs);
  });

  const isProbe = args.includes("--probe");
  let stopping = false;
  const optionalWatchers = full
    ? { toast: watcherState("running"), ui: watcherState("running") }
    : { toast: watcherState("disabled"), ui: watcherState("disabled") };
  if (!isProbe) {
    writeWatcherState(profile, optionalWatchers);
  }

  const stop = (reason, code = 0, killOthers = true) => {
    if (stopping) {
      return;
    }
    stopping = true;

    if (reason) {
      console.error(reason);
    }

    if (killOthers) {
      for (const child of children) {
        if (!child.killed) {
          child.kill();
        }
      }
    }

    process.exitCode = code;
  };

  superviseWatchers(children, {
    isProbe,
    isStopping: () => stopping,
    onFatal: stop,
    onWarning: (message) => console.error(message),
    restartOptional: isProbe || !full ? null : (child) => {
      const scriptPath = child.label === "toast" ? NOTIFICATIONS_SCRIPT : UI_PROMPTS_SCRIPT;
      return spawnWatcher(child.label, scriptPath, watcherArgs(args));
    },
    onOptionalState: ({ label, status, restarts, detail }) => {
      optionalWatchers[label] = watcherState(status, { restarts, detail });
      writeWatcherState(profile, optionalWatchers);
    },
    onProbeComplete: () => {
      stopping = true;
      process.exitCode = 0;
    }
  });

  process.on("SIGINT", () => stop("收到停止信号，正在关闭 watcher...", 0));
  process.on("SIGTERM", () => stop("收到终止信号，正在关闭 watcher...", 0));
}

function watcherState(status, { restarts = 0, detail = null } = {}) {
  return {
    status,
    restarts,
    detail,
    changedAt: new Date().toISOString()
  };
}

function writeWatcherState(profile, optionalWatchers) {
  mkdirSync(dirname(WATCHER_STATE_FILE), { recursive: true });
  const tempPath = `${WATCHER_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify({
    runtimePid: process.pid,
    profile,
    optionalWatchers
  }, null, 2)}\n`, "utf8");
  renameSync(tempPath, WATCHER_STATE_FILE);
}

function watcherArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--profile") {
      index += 1;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

function spawnWatcher(label, scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.label = label;
  pipeLines(child.stdout, label, "out");
  pipeLines(child.stderr, label, "err");
  return child;
}

function workerArgs(args) {
  const result = [];
  if (args.includes("--dry-run")) {
    result.push("--dry-run");
  }
  if (args.includes("--probe")) {
    result.push("--once");
  }
  return result;
}

function pipeLines(stream, label, kind) {
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) {
        continue;
      }

      const prefix = kind === "err" ? `[${label}] ` : `[${label}] `;
      if (kind === "err") {
        console.error(`${prefix}${line}`);
      } else {
        console.log(`${prefix}${line}`);
      }
    }
  });

  stream.on("end", () => {
    if (buffer.trim()) {
      const prefix = `[${label}] `;
      if (kind === "err") {
        console.error(`${prefix}${buffer}`);
      } else {
        console.log(`${prefix}${buffer}`);
      }
    }
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/watch-all.mjs [options]

说明：
  默认使用 full；core 只启动 AI/Git 记录 worker。

Examples:
  npm run watch:all
  node scripts/watch-all.mjs --profile core
  npm run watch:all -- --dry-run
  npm run watch:all -- --interval 2
`);
}

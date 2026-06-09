#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NOTIFICATIONS_SCRIPT = resolve(SCRIPT_DIR, "watch-notifications.mjs");
const UI_PROMPTS_SCRIPT = resolve(SCRIPT_DIR, "watch-ui-prompts.mjs");

main();

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  console.log("启动 mi-notic 全量监听：系统 toast + 内部确认/提问 UI");
  console.log("按 Ctrl+C 停止。");

  const children = [
    spawnWatcher("toast", NOTIFICATIONS_SCRIPT, args),
    spawnWatcher("ui", UI_PROMPTS_SCRIPT, args)
  ];

  const isProbe = args.includes("--probe");
  let stopping = false;
  let exitedCount = 0;

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

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (stopping) {
        return;
      }

      const label = child.label;
      if (code !== 0 || signal) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        stop(`[${label}] 异常退出 (${detail})`, code || 1);
        return;
      }

      if (isProbe) {
        exitedCount += 1;
        if (exitedCount >= children.length) {
          stopping = true;
          process.exitCode = 0;
        }
        return;
      }

      stop(`[${label}] 意外退出`, 1);
    });

    child.on("error", (error) => {
      stop(`[${child.label}] 启动失败：${error.message}`, 1);
    });
  }

  process.on("SIGINT", () => stop("收到停止信号，正在关闭 watcher...", 0));
  process.on("SIGTERM", () => stop("收到终止信号，正在关闭 watcher...", 0));
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
  并行启动 watch-notifications.mjs 与 watch-ui-prompts.mjs。
  参数会原样传给两个 watcher。

Examples:
  npm run watch:all
  npm run watch:all -- --dry-run
  npm run watch:all -- --interval 2
`);
}

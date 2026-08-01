#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { markPendingAskNotify } from "./ask-notify-window.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_SCRIPT = "scripts/status.mjs";
const DEFAULT_HOME = resolve(SCRIPT_DIR, "..");
const FALLBACK_HOME = "D:/project/Amber";

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const dryRun = consumeFlag(args, "--dry-run");
  const summary = args.join(" ").trim() || "Agent 提问";
  const message = `[需要操作] ${summary}`;
  const amberHome = resolveAmberHome();

  if (dryRun) {
    console.log(JSON.stringify({ amberHome, message }, null, 2));
    return;
  }

  await runStatus(amberHome, message);
  markPendingAskNotify(summary, { baseDir: amberHome, ttlSeconds: 120 });
  console.log(`Notification sent: 需要操作`);
}

function resolveAmberHome() {
  const candidates = [
    process.env.AMBER_HOME,
    DEFAULT_HOME,
    FALLBACK_HOME
  ].filter(Boolean);

  for (const home of candidates) {
    const root = resolve(home);
    if (existsSync(resolve(root, STATUS_SCRIPT))) {
      return root;
    }
  }

  throw new Error(
    "找不到 Amber。请设置环境变量 AMBER_HOME，或把仓库放在 D:/project/Amber"
  );
}

function runStatus(amberHome, message) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(amberHome, STATUS_SCRIPT), "wait", message, "--force", "--editor", "Cursor"], {
      cwd: amberHome,
      stdio: "inherit",
      shell: false
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

function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }

  args.splice(index, 1);
  return true;
}

function printHelp() {
  console.log(`Usage:
  node scripts/notify-ask.mjs "<问题摘要>"
  node scripts/notify-ask.mjs --dry-run "测试问题"

说明：
  Cursor 聚焦时 AskQuestion 不会弹 Windows toast。
  Agent 在调用 AskQuestion 之前应先运行本脚本，直接发 wait 到飞书/手环。

环境变量：
  AMBER_HOME  Amber 仓库路径（可选）
`);
}

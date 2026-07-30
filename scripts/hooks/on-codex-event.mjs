#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NOTIFY_ASK = resolve(SCRIPT_DIR, "../notify-ask.mjs");

main().catch(() => {
  process.stdout.write("{}\n");
});

async function main() {
  const eventName = readOption(process.argv.slice(2), "--event") || "";
  const payload = await readStdinJson();

  if (eventName === "PermissionRequest") {
    await notifyAsk(
      firstText(payload.reason, payload.message, payload.tool_name, "ChatGPT 等待你确认")
    );
  }

  process.stdout.write("{}\n");
}

function notifyAsk(message) {
  return new Promise((resolveNotify, rejectNotify) => {
    const child = spawn(process.execPath, [NOTIFY_ASK, message], {
      cwd: resolve(SCRIPT_DIR, "../.."),
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", rejectNotify);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveNotify();
      } else {
        rejectNotify(new Error(`notify-ask exited with code ${code}`));
      }
    });
  });
}

function readStdinJson() {
  return new Promise((resolvePayload) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolvePayload(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        resolvePayload({});
      }
    });
  });
}

function readOption(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] || null;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 200);
    }
  }
  return "";
}

#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const STATUS_FILE = resolve(process.cwd(), ".local/status.json");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_SCRIPT = resolve(SCRIPT_DIR, "status.mjs");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const status = readStatus();
  if (!status) {
    console.log("No local status found.");
    return;
  }

  const ageMinutes = getAgeMinutes(status.updatedAt);
  printStatus(status, ageMinutes);

  if (!shouldWarnStale(status, ageMinutes, options.staleMinutes)) {
    return;
  }

  const message = buildStaleMessage(status, ageMinutes, options.staleMinutes);
  const args = ["wait", message];
  if (options.noNotify) {
    args.push("--no-notify");
  }
  if (options.dryRun) {
    args.push("--dry-run");
  }

  await runStatus(args);
}

function parseArgs(args) {
  const options = {
    help: false,
    dryRun: false,
    noNotify: false,
    staleMinutes: 0
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--no-notify") {
      options.noNotify = true;
      continue;
    }

    if (arg === "--stale-minutes") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--stale-minutes must be a non-negative integer.");
      }

      options.staleMinutes = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readStatus() {
  if (!existsSync(STATUS_FILE)) {
    return null;
  }

  return JSON.parse(readFileSync(STATUS_FILE, "utf8"));
}

function getAgeMinutes(updatedAt) {
  const timestamp = new Date(updatedAt).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor((Date.now() - timestamp) / 60000);
}

function printStatus(status, ageMinutes) {
  const ageText = ageMinutes === null ? "unknown" : `${ageMinutes}m`;
  console.log(`Status: ${status.status}`);
  console.log(`Message: ${status.message || ""}`);
  console.log(`Updated: ${status.updatedAt || ""}`);
  console.log(`Age: ${ageText}`);
}

function shouldWarnStale(status, ageMinutes, staleMinutes) {
  return status.status === "running" && staleMinutes > 0 && ageMinutes !== null && ageMinutes >= staleMinutes;
}

function buildStaleMessage(status, ageMinutes, staleMinutes) {
  const message = status.message ? `：${status.message}` : "";
  return `运行超过 ${staleMinutes} 分钟（当前 ${ageMinutes} 分钟）${message}`;
}

function runStatus(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [STATUS_SCRIPT, ...args], {
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

function printHelp() {
  console.log(`Usage:
  node scripts/check-status.mjs [options]

Examples:
  node scripts/check-status.mjs
  node scripts/check-status.mjs --stale-minutes 30
  node scripts/check-status.mjs --stale-minutes 30 --no-notify

Options:
  --stale-minutes <minutes>  Send wait status if running is older than this
  --dry-run                  Print the wait decision without writing or notifying
  --no-notify                Record wait status only; never send Feishu notifications
`);
}

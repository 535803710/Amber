#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_SCRIPT = resolve(SCRIPT_DIR, "status.mjs");
const DEFAULT_TAIL_LINES = 5;

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.command.length === 0) {
    throw new Error("Missing command. Use: node scripts/run-notify.mjs --name \"测试\" -- npm test");
  }

  const taskName = parsed.name || parsed.command.join(" ");
  const output = createOutputCollector(parsed.tail);

  if (!parsed.noStartNotify) {
    await safeStatus(["running", `${taskName}开始`, "--no-notify"]);
  }

  const result = await runCommand(parsed.command, {
    timeoutSeconds: parsed.timeoutSeconds,
    output
  });

  if (result.timedOut) {
    await safeStatus(buildFinalStatusArgs("error", buildTimeoutMessage(taskName, output), parsed));
    process.exitCode = result.exitCode ?? 1;
    return;
  }

  if (result.error) {
    await safeStatus(buildFinalStatusArgs("error", buildSpawnErrorMessage(taskName, result.error), parsed));
    process.exitCode = 1;
    return;
  }

  if (result.exitCode === 0) {
    await safeStatus(buildFinalStatusArgs("done", `${taskName}完成`, parsed));
    process.exitCode = 0;
    return;
  }

  await safeStatus(buildFinalStatusArgs("error", buildFailureMessage(taskName, result.exitCode, output), parsed));
  process.exitCode = result.exitCode ?? 1;
}

function parseArgs(args) {
  const options = {
    help: false,
    name: "",
    timeoutSeconds: 0,
    tail: DEFAULT_TAIL_LINES,
    noStartNotify: false,
    noNotify: false,
    command: []
  };

  const commandIndex = args.indexOf("--");
  const optionArgs = commandIndex === -1 ? args : args.slice(0, commandIndex);
  options.command = commandIndex === -1 ? [] : args.slice(commandIndex + 1);

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--name") {
      options.name = readOptionValue(optionArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--timeout") {
      options.timeoutSeconds = readNonNegativeInteger(optionArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--tail") {
      options.tail = readNonNegativeInteger(optionArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--no-start-notify") {
      options.noStartNotify = true;
      continue;
    }

    if (arg === "--no-notify") {
      options.noNotify = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return value;
}

function readNonNegativeInteger(args, index, optionName) {
  const value = Number(readOptionValue(args, index, optionName));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }

  return value;
}

function runCommand(command, { timeoutSeconds, output }) {
  return new Promise((resolveRun) => {
    const [rawCmd, ...cmdArgs] = command;
    const cmd = resolveExecutable(rawCmd);
    const child = spawn(cmd, cmdArgs, {
      shell: false,
      stdio: ["inherit", "pipe", "pipe"]
    });

    let settled = false;
    let timedOut = false;
    let timeout = null;

    if (timeoutSeconds > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutSeconds * 1000);
    }

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output.add(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output.add(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolveRun({ exitCode: 1, timedOut: false, error });
    });

    child.on("exit", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolveRun({ exitCode, timedOut, error: null });
    });
  });
}

function resolveExecutable(command) {
  if (process.platform !== "win32" || command.includes("\\") || command.includes("/") || isAbsolute(command)) {
    return command;
  }

  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const hasExtension = /\.[^.\\/:]+$/.test(command);
  const pathExts = hasExtension ? [""] : (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";");

  for (const dir of pathDirs) {
    for (const ext of pathExts) {
      const candidate = resolve(dir, `${command}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
}

function createOutputCollector(maxLines) {
  const lines = [];
  let pending = "";

  return {
    add(chunk) {
      pending += chunk.toString("utf8");
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() || "";

      for (const part of parts) {
        pushLine(lines, part, maxLines);
      }
    },
    tail() {
      if (maxLines <= 0) {
        return [];
      }

      const result = [...lines];
      if (pending) {
        result.push(pending);
      }

      return result
        .map((line) => stripAnsi(line).trim())
        .filter(Boolean)
        .slice(-maxLines);
    }
  };
}

function pushLine(lines, line, maxLines) {
  lines.push(line);
  while (lines.length > Math.max(maxLines * 4, maxLines, 20)) {
    lines.shift();
  }
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function buildFinalStatusArgs(status, message, parsed) {
  const args = [status, message];
  if (parsed.noNotify) {
    args.push("--no-notify");
  }

  return args;
}

function buildFailureMessage(taskName, exitCode, output) {
  const tail = output.tail().join(" | ");
  return truncateMessage(tail ? `${taskName}失败：退出码 ${exitCode}：${tail}` : `${taskName}失败：退出码 ${exitCode}`);
}

function buildTimeoutMessage(taskName, output) {
  const tail = output.tail().join(" | ");
  return truncateMessage(tail ? `${taskName}超时：${tail}` : `${taskName}超时`);
}

function buildSpawnErrorMessage(taskName, error) {
  return truncateMessage(`${taskName}启动失败：${error.message}`);
}

function truncateMessage(value) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function safeStatus(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [STATUS_SCRIPT, ...args], {
      stdio: "inherit",
      shell: false
    });

    child.on("error", (error) => {
      console.error(`Status update failed: ${error.message}`);
      resolveRun();
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Status update exited with code ${code}.`);
      }

      resolveRun();
    });
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-notify.mjs --name <task-name> [options] -- <command> [args...]

Examples:
  node scripts/run-notify.mjs --name "测试" -- npm test
  node scripts/run-notify.mjs --name "构建" --timeout 60 -- npm run build
  node scripts/run-notify.mjs --name "本地验证" --no-notify -- node -e "process.exit(0)"

Options:
  --name <name>          Task name shown in status messages
  --timeout <seconds>   Kill the command after this many seconds
  --tail <lines>        Include this many output lines on failure, default 5
  --no-start-notify     Do not record the running state
  --no-notify           Record status only; never send Feishu notifications
`);
}

#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginChangeTurn,
  cacheChangeTurnResponse,
  completeChangeTurn
} from "../lib/change-records.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "../..");
const LOG_FILE = resolve(ROOT_DIR, ".local/change-records/hook-errors.log");

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logError(error);
    writeHookResponse();
  });
}

async function main() {
  const source = readOption(process.argv.slice(2), "--source") || "ChatGPT";
  const payload = await readStdinJson();
  const event = String(payload.hook_event_name || payload.event || "").toLowerCase();
  const input = normalizeHookPayload(payload, source);
  if (source === "Cursor" && event === "stop") {
    input.prompt = findCursorPromptFromLogs(payload) || input.prompt;
    input.text = findCursorResponseFromLogs(payload, input.text);
  }

  if (event === "usersubmitprompt" || event === "userpromptsubmit" || event === "beforesubmitprompt") {
    beginChangeTurn(input, { rootDir: ROOT_DIR });
  } else if (event === "afteragentresponse") {
    cacheChangeTurnResponse(input, { rootDir: ROOT_DIR });
  } else if (event === "stop" || event === "agent-turn-complete") {
    completeChangeTurn(input, { rootDir: ROOT_DIR });
  }

  writeHookResponse();
}

function readStdinJson() {
  return new Promise((resolvePayload, rejectPayload) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      if (!raw.trim()) {
        resolvePayload({});
        return;
      }
      try {
        resolvePayload(parseHookJson(raw));
      } catch (error) {
        rejectPayload(new Error(`invalid hook JSON: ${error.message}`));
      }
    });
    process.stdin.on("error", rejectPayload);
  });
}

export function parseHookJson(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    const recovered = recoverCursorHookFields(text);
    if (recovered) {
      return recovered;
    }
    throw error;
  }
}

export function normalizeHookPayload(payload, source) {
  const workspaceRoot = Array.isArray(payload.workspace_roots)
    ? payload.workspace_roots.find((item) => typeof item === "string" && item)
    : "";
  return {
    ...payload,
    cwd: payload.cwd || normalizeWorkspaceRoot(workspaceRoot),
    source
  };
}

export function extractCursorPromptFromHookLog(log, sessionId, turnId) {
  const text = String(log || "");
  let offset = 0;
  while (offset < text.length) {
    const inputStart = text.indexOf("INPUT:", offset);
    if (inputStart === -1) {
      break;
    }
    const jsonStart = text.indexOf("{", inputStart);
    const outputStart = text.indexOf("\nOUTPUT:", jsonStart);
    if (jsonStart === -1 || outputStart === -1) {
      break;
    }
    try {
      const payload = JSON.parse(text.slice(jsonStart, outputStart).trim());
      if (
        payload.hook_event_name === "beforeSubmitPrompt" &&
        (payload.session_id || payload.conversation_id) === sessionId &&
        (!turnId || payload.generation_id === turnId)
      ) {
        return String(payload.prompt || "").trim();
      }
    } catch {
      // Cursor may also log malformed payloads; keep looking for a valid matching entry.
    }
    offset = outputStart + 1;
  }
  return "";
}

export function extractCursorResponseFromHookLog(log, sessionId, turnId, fallback = "") {
  const text = String(log || "");
  let offset = 0;
  while (offset < text.length) {
    const inputStart = text.indexOf("INPUT:", offset);
    if (inputStart === -1) {
      break;
    }
    const jsonStart = text.indexOf("{", inputStart);
    const outputStart = text.indexOf("\nOUTPUT:", jsonStart);
    if (jsonStart === -1 || outputStart === -1) {
      break;
    }
    try {
      const payload = JSON.parse(text.slice(jsonStart, outputStart).trim());
      if (
        payload.hook_event_name === "afterAgentResponse" &&
        (payload.session_id || payload.conversation_id) === sessionId &&
        (!turnId || payload.generation_id === turnId) &&
        typeof payload.text === "string" &&
        payload.text.trim()
      ) {
        return payload.text.trim();
      }
    } catch {
      // Keep looking for a valid matching response.
    }
    offset = outputStart + 1;
  }
  return String(fallback || "");
}

function findCursorPromptFromLogs(payload) {
  const appData = process.env.APPDATA;
  if (!appData) {
    return "";
  }

  const logRoot = resolve(appData, "Cursor/logs");
  if (!existsSync(logRoot)) {
    return "";
  }

  const sessionDirs = readdirSync(logRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, 3);
  const logFiles = sessionDirs
    .flatMap((name) => collectCursorHookLogs(resolve(logRoot, name)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of logFiles) {
    try {
      const prompt = extractCursorPromptFromHookLog(
        readFileSync(item.path, "utf8"),
        payload.session_id || payload.conversation_id || "",
        payload.generation_id || ""
      );
      if (prompt) {
        return prompt;
      }
    } catch {
      // A log can rotate while the hook is reading it.
    }
  }
  return "";
}

function findCursorResponseFromLogs(payload, fallback = "") {
  const appData = process.env.APPDATA;
  if (!appData) {
    return fallback;
  }

  const logRoot = resolve(appData, "Cursor/logs");
  if (!existsSync(logRoot)) {
    return fallback;
  }

  const sessionDirs = readdirSync(logRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, 3);
  const logFiles = sessionDirs
    .flatMap((name) => collectCursorHookLogs(resolve(logRoot, name)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of logFiles) {
    try {
      const response = extractCursorResponseFromHookLog(
        readFileSync(item.path, "utf8"),
        payload.session_id || payload.conversation_id || "",
        payload.generation_id || "",
        ""
      );
      if (response) {
        return response;
      }
    } catch {
      // A log can rotate while the hook is reading it.
    }
  }
  return fallback;
}

function collectCursorHookLogs(directory) {
  const result = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectCursorHookLogs(path));
    } else if (entry.name.startsWith("cursor.hooks") && entry.name.endsWith(".log")) {
      try {
        result.push({ path, mtimeMs: statSync(path).mtimeMs });
      } catch {
        // A log can rotate while the directory is being scanned.
      }
    }
  }
  return result;
}

function recoverCursorHookFields(text) {
  const hookEventName = extractJsonString(text, "hook_event_name");
  const workspaceRoot = extractFirstArrayString(text, "workspace_roots");
  if (!hookEventName || !workspaceRoot) {
    return null;
  }

  return {
    hook_event_name: hookEventName,
    conversation_id: extractJsonString(text, "conversation_id"),
    generation_id: extractJsonString(text, "generation_id"),
    session_id: extractJsonString(text, "session_id"),
    status: extractJsonString(text, "status"),
    workspace_roots: [workspaceRoot]
  };
}

function extractJsonString(text, key) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  if (!match) {
    return "";
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return "";
  }
}

function extractFirstArrayString(text, key) {
  const match = text.match(
    new RegExp(`"${key}"\\s*:\\s*\\[\\s*("(?:\\\\.|[^"\\\\])*")`)
  );
  if (!match) {
    return "";
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return "";
  }
}

function normalizeWorkspaceRoot(value) {
  const text = String(value || "");
  return /^\/[a-zA-Z]:\//.test(text) ? text.slice(1) : text;
}

function readOption(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] || null;
}

function writeHookResponse() {
  process.stdout.write("{}\n");
}

function logError(error) {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${error?.stack || error}\n`, "utf8");
}

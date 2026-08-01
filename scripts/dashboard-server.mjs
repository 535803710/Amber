#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnHidden, runHiddenCommand } from "./lib/spawn-hidden.mjs";
import { readSettings, writeSettings } from "./lib/settings.mjs";
import {
  getChangeRecordStatus,
  replayFailedEvents
} from "./lib/change-records.mjs";
import { collectHealthSnapshot, evaluateHealth } from "./lib/health.mjs";
import { archiveStaleBaselines } from "./lib/health-reset.mjs";
import { assertWebhookSuccess, postJson } from "./change-record-worker.mjs";
import {
  claimPendingCommitItem,
  getCommitRecordStatus,
  listPendingCommitItems,
  markCommitFailed,
  markCommitSent,
  readyCommitItems,
  replayFailedCommitEvents,
  parseScanRoots,
  writeCommitWorkerState
} from "./lib/commit-records.mjs";
import { listRecordPage } from "./lib/record-listing.mjs";
import {
  getWatcherStatus,
  readLogTail,
  startWatcher,
  stopWatcher
} from "./lib/watcher-control.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");
const DASHBOARD_DIR = resolve(ROOT_DIR, "dashboard");
const STATUS_FILE = resolve(ROOT_DIR, ".local/status.json");
const ENV_LOCAL_FILE = resolve(ROOT_DIR, ".env.local");
const PS_SCRIPT = resolve(SCRIPT_DIR, "windows-notification-listener.ps1");
const STATUS_SCRIPT = resolve(SCRIPT_DIR, "status.mjs");
const AUTOSTART_SCRIPT = resolve(SCRIPT_DIR, "install-autostart.ps1");
const DEFAULT_PORT = 3847;
const ACCESS_PROBE_TTL_MS = 30_000;
const AUTOSTART_STATUS_TTL_MS = 30_000;
const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const CHILD_PROCESS_TIMEOUT_MS = 15_000;
let accessProbeCache = null;
let autostartStatusCache = null;
let commitSyncState = idleCommitSyncState();

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local", new Set(["COMMIT_RECORD_SCAN_ROOTS"]));

  const port = readPort(process.argv.slice(2));
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, error.statusCode || 500, { error: error.message });
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Amber 控制台：http://127.0.0.1:${port}`);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname, url);
    return;
  }

  serveStatic(req, res, pathname);
}

async function handleApi(req, res, pathname, url) {
  if (pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, await buildState());
    return;
  }

  if (pathname === "/api/health/reset" && req.method === "POST") {
    const body = await readJsonBody(req);
    const source = body.source === undefined ? "all" : String(body.source).trim().toLowerCase();
    if (!["all", "cursor", "chatgpt"].includes(source)) {
      throw createHttpError(400, "source 必须是 cursor、chatgpt 或 all。");
    }
    sendJson(res, 200, archiveStaleBaselines({ rootDir: ROOT_DIR, source }));
    return;
  }

  if (pathname === "/api/settings" && req.method === "GET") {
    sendJson(res, 200, readSettings(ROOT_DIR));
    return;
  }

  if (pathname === "/api/settings" && req.method === "POST") {
    const body = await readJsonBody(req);
    const next = writeSettings(body, ROOT_DIR);
    sendJson(res, 200, next);
    return;
  }

  if (pathname === "/api/feishu-settings" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = saveFeishuSettings(body);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/change-records" && req.method === "GET") {
    sendJson(res, 200, listRecordPage("change", url.searchParams, { rootDir: ROOT_DIR }));
    return;
  }

  if (pathname === "/api/commit-records" && req.method === "GET") {
    sendJson(res, 200, listRecordPage("commit", url.searchParams, { rootDir: ROOT_DIR }));
    return;
  }

  if (pathname === "/api/change-record-settings" && req.method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, 200, saveChangeRecordSettings(body));
    return;
  }

  if (pathname === "/api/commit-record-settings" && req.method === "GET") {
    sendJson(res, 200, getCommitRecordStatus({ rootDir: ROOT_DIR }));
    return;
  }

  if (pathname === "/api/commit-record-settings" && req.method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, 200, saveCommitRecordSettings(body));
    return;
  }

  if (pathname === "/api/choose-folder" && req.method === "POST") {
    sendJson(res, 200, await chooseFolder());
    return;
  }

  if (pathname === "/api/change-records/replay" && req.method === "POST") {
    sendJson(res, 200, replayFailedEvents({ rootDir: ROOT_DIR }));
    return;
  }
  if (pathname === "/api/commit-records/sync" && req.method === "GET") {
    sendJson(res, 200, commitSyncState);
    return;
  }

  if (pathname === "/api/commit-records/sync" && req.method === "POST") {
    if (commitSyncState.running) {
      throw createHttpError(409, "Git 提交记录正在同步中。");
    }
    startCommitSync();
    sendJson(res, 202, commitSyncState);
    return;
  }

  const singleCommitMatch = pathname.match(/^\/api\/commit-records\/([A-Za-z0-9._-]+)\/send$/);
  if (singleCommitMatch && req.method === "POST") {
    sendJson(res, 200, await sendPendingCommit(singleCommitMatch[1]));
    return;
  }

  if (pathname === "/api/commit-records/replay" && req.method === "POST") {
    sendJson(res, 200, replayFailedCommitEvents({ rootDir: ROOT_DIR }));
    return;
  }

  if (pathname === "/api/autostart" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await setAutostart(Boolean(body.enabled));
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/watcher/start" && req.method === "POST") {
    const result = startWatcher(ROOT_DIR);
    sendJson(res, 200, { ...result, status: getWatcherStatus(ROOT_DIR) });
    return;
  }

  if (pathname === "/api/watcher/stop" && req.method === "POST") {
    const result = stopWatcher(ROOT_DIR);
    sendJson(res, 200, { ...result, status: getWatcherStatus(ROOT_DIR) });
    return;
  }

  if (pathname === "/api/test-notify" && req.method === "POST") {
    await runNotifyTest();
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function sendPendingCommit(eventId) {
  if (commitSyncState.running) {
    throw createHttpError(409, "Git 提交记录正在全量同步中。");
  }
  if (!process.env.FEISHU_COMMIT_WEBHOOK_URL?.trim()) {
    throw createHttpError(409, "未配置 FEISHU_COMMIT_WEBHOOK_URL。");
  }

  const item = claimPendingCommitItem(eventId, { rootDir: ROOT_DIR });
  if (!item) {
    throw createHttpError(404, "未找到待发送的 Git 提交记录。");
  }

  await deliverCommitItem(item);
  return { ok: true, eventId };
}

function startCommitSync() {
  if (!process.env.FEISHU_COMMIT_WEBHOOK_URL?.trim()) {
    commitSyncState = {
      ...idleCommitSyncState(),
      lastError: "未配置 FEISHU_COMMIT_WEBHOOK_URL。"
    };
    return;
  }
  const items = listPendingCommitItems({ rootDir: ROOT_DIR });
  commitSyncState = {
    running: true,
    total: items.length,
    processed: 0,
    sent: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null
  };

  queueMicrotask(async () => {
    for (const item of items) {
      try {
        const claimed = claimPendingCommitItem(item.envelope.event.event_id, { rootDir: ROOT_DIR });
        if (!claimed) {
          continue;
        }
        await deliverCommitItem(claimed);
        commitSyncState.sent += 1;
      } catch (error) {
        commitSyncState.failed += 1;
        commitSyncState.lastError = error.message;
      } finally {
        commitSyncState.processed += 1;
      }
    }
    commitSyncState.running = false;
    commitSyncState.finishedAt = new Date().toISOString();
  });
}

async function deliverCommitItem(item) {
  const webhookUrl = process.env.FEISHU_COMMIT_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw createHttpError(409, "未配置 FEISHU_COMMIT_WEBHOOK_URL。");
  }

  try {
    const response = await postJson(
      webhookUrl,
      item.envelope.event,
      process.env.FEISHU_COMMIT_WEBHOOK_TOKEN?.trim() || ""
    );
    assertWebhookSuccess(response);
    markCommitSent(item, response, { rootDir: ROOT_DIR });
    writeCommitWorkerState({ lastSuccessAt: new Date().toISOString(), lastError: null }, { rootDir: ROOT_DIR });
  } catch (error) {
    markCommitFailed(item, error, { rootDir: ROOT_DIR });
    writeCommitWorkerState(
      { lastError: error.message, lastErrorAt: new Date().toISOString() },
      { rootDir: ROOT_DIR }
    );
    throw error;
  }
}

function idleCommitSyncState() {
  return {
    running: false,
    total: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null
  };
}

async function buildState() {
  const watcher = getWatcherStatus(ROOT_DIR);
  const settings = readSettings(ROOT_DIR);
  const lastStatus = readStatus();
  const notificationAccess = await probeNotificationAccess();
  const feishu = readFeishuConfig();
  const autostart = await readAutostartStatus();
  const healthSnapshot = collectHealthSnapshot({ rootDir: ROOT_DIR });
  const health = evaluateHealth(healthSnapshot, { now: healthSnapshot.now });

  return {
    watcher,
    settings,
    lastStatus,
    notificationAccess,
    feishu,
    feishuConfigured: feishu.configured,
    changeRecords: {
      ...getChangeRecordStatus({ rootDir: ROOT_DIR }),
      webhookMasked: maskWebhookUrl(process.env.FEISHU_CHANGE_WEBHOOK_URL?.trim() || ""),
      baseUrl: "https://transsioner.feishu.cn/base/Inmhb4Vl0alBIAsvzaxcxC0Ln0d"
    },
    commitRecords: getCommitRecordStatus({ rootDir: ROOT_DIR }),
    health,
    autostart,
    logTail: readLogTail(ROOT_DIR, 30)
  };
}

function saveChangeRecordSettings(body) {
  const webhookUrl = normalizeOptionalString(body.webhookUrl);
  const webhookToken = normalizeOptionalString(body.webhookToken);
  const clearWebhook = body.clearWebhook === true;
  const clearToken = body.clearToken === true;

  if (webhookUrl && !isHttpUrl(webhookUrl)) {
    throw createHttpError(400, "修改记录 Webhook 必须是 http 或 https 地址。");
  }

  writeEnvLocalValues({
    FEISHU_CHANGE_WEBHOOK_URL: clearWebhook ? null : webhookUrl,
    FEISHU_CHANGE_WEBHOOK_TOKEN: clearToken ? null : webhookToken
  });
  reloadEnvKeys(["FEISHU_CHANGE_WEBHOOK_URL", "FEISHU_CHANGE_WEBHOOK_TOKEN"]);
  return getChangeRecordStatus({ rootDir: ROOT_DIR });
}

function saveCommitRecordSettings(body) {
  if (!body || body.scanRoots === undefined) {
    throw createHttpError(400, "请提供 Git 提交扫描目录。");
  }

  const roots = [];
  const seen = new Set();
  for (const value of parseScanRoots(body.scanRoots)) {
    if (!isAbsolute(value)) {
      throw createHttpError(400, `扫描目录必须是绝对路径：${value}`);
    }
    const root = resolve(value);
    let directory = false;
    try {
      directory = existsSync(root) && statSync(root).isDirectory();
    } catch {
      directory = false;
    }
    if (!directory) {
      throw createHttpError(400, `扫描目录必须是已存在的目录：${root}`);
    }
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(root);
    }
  }

  writeEnvLocalValues({
    COMMIT_RECORD_SCAN_ROOTS: roots.length ? roots.map((root) => root.replaceAll("\\", "/")).join(";") : null
  });
  reloadEnvKeys(["COMMIT_RECORD_SCAN_ROOTS"]);
  return getCommitRecordStatus({ rootDir: ROOT_DIR });
}

async function chooseFolder() {
  if (process.platform !== "win32") {
    throw createHttpError(501, "当前系统不支持打开 Windows 文件夹选择器。");
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择 Git 提交扫描目录'",
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }"
  ].join("; ");
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    { timeoutMs: 300_000 }
  );
  return { path: result.stdout || "" };
}

function readStatus() {
  if (!existsSync(STATUS_FILE)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function probeNotificationAccess() {
  const now = Date.now();
  if (accessProbeCache && now - accessProbeCache.checkedAt < ACCESS_PROBE_TTL_MS) {
    return accessProbeCache.result;
  }

  try {
    const stdout = await runHiddenCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      PS_SCRIPT,
      "-Action",
      "check-access"
    ]);
    const data = JSON.parse(stdout);
    const result = {
      ok: data.accessStatus === "Allowed",
      accessStatus: data.accessStatus,
      guide: "Windows 设置 -> 隐私和安全性 -> 通知 -> 用户通知访问"
    };
    accessProbeCache = { checkedAt: now, result };
    return result;
  } catch (error) {
    const result = {
      ok: false,
      accessStatus: "Error",
      error: error.message,
      guide: "Windows 设置 -> 隐私和安全性 -> 通知 -> 用户通知访问"
    };
    accessProbeCache = { checkedAt: now, result };
    return result;
  }
}

function runNotifyTest() {
  return runNodeScript(STATUS_SCRIPT, ["test", "控制台测试通知", "--force"]);
}

function saveFeishuSettings(body) {
  const webhookUrl = normalizeOptionalString(body.webhookUrl);
  const webhookSecret = normalizeOptionalString(body.webhookSecret);
  const clearWebhook = body.clearWebhook === true;
  const clearSecret = body.clearSecret === true;

  if (webhookUrl && !isHttpUrl(webhookUrl)) {
    throw createHttpError(400, "飞书 Webhook 必须是 http 或 https 地址。");
  }

  writeEnvLocalValues({
    FEISHU_WEBHOOK_URL: clearWebhook ? null : webhookUrl,
    FEISHU_WEBHOOK_SECRET: clearSecret ? null : webhookSecret
  });
  reloadEnvKeys(["FEISHU_WEBHOOK_URL", "FEISHU_WEBHOOK_SECRET"]);

  return readFeishuConfig();
}

function readFeishuConfig() {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL?.trim() || "";
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET?.trim() || "";

  return {
    configured: Boolean(webhookUrl),
    secretConfigured: Boolean(webhookSecret),
    webhookHost: webhookUrl ? safeUrlHost(webhookUrl) : "",
    webhookMasked: webhookUrl ? maskWebhookUrl(webhookUrl) : ""
  };
}

async function setAutostart(enabled) {
  await runPowerShellScript(AUTOSTART_SCRIPT, enabled ? ["-StartNow"] : ["-Uninstall"], 30_000);
  autostartStatusCache = null;
  return readAutostartStatus();
}

async function readAutostartStatus() {
  const now = Date.now();
  if (autostartStatusCache && now - autostartStatusCache.checkedAt < AUTOSTART_STATUS_TTL_MS) {
    return autostartStatusCache.result;
  }

  try {
    const result = await runPowerShellScript(AUTOSTART_SCRIPT, ["-Status"], 10_000);
    const raw = `${result.stdout}\n${result.stderr}`.trim();
    const methods = [];
    if (/Method:\s*Task Scheduler/i.test(raw)) {
      methods.push("Task Scheduler");
    }
    if (/Method:\s*Startup folder shortcut/i.test(raw)) {
      methods.push("Startup folder shortcut");
    }

    const status = {
      installed: methods.length > 0,
      methods,
      raw
    };
    autostartStatusCache = { checkedAt: now, result: status };
    return status;
  } catch (error) {
    const status = {
      installed: false,
      methods: [],
      error: error.message,
      raw: ""
    };
    autostartStatusCache = { checkedAt: now, result: status };
    return status;
  }
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    const child = spawnHidden(
      process.execPath,
      [scriptPath, ...args],
      { cwd: ROOT_DIR, stdio: "pipe" }
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("发送测试通知超时，请检查飞书 Webhook 或网络连接。"));
    }, CHILD_PROCESS_TIMEOUT_MS);
    const finish = (error, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectRun(error);
        return;
      }

      resolveRun(value);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0) {
        finish(null, { stdout: stdout.trim() });
        return;
      }
      finish(new Error(formatChildError(stderr, stdout, `status.mjs exited with code ${code}`)));
    });
  });
}

function formatChildError(stderr, stdout, fallback) {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const usefulLines = lines.filter((line) => !/\.mjs exited with code \d+$/i.test(line));

  return usefulLines.join("\n") || lines.join("\n") || fallback;
}

function runPowerShellScript(scriptPath, args, timeoutMs) {
  return runCommand("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args
  ], { timeoutMs });
}

function runCommand(command, args, { timeoutMs }) {
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    const child = spawnHidden(command, args, { cwd: ROOT_DIR, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`${command} 执行超时`));
    }, timeoutMs);
    const finish = (error, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectRun(error);
        return;
      }

      resolveRun(value);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0) {
        finish(null, { stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      finish(new Error(formatChildError(stderr, stdout, `${command} exited with code ${code}`)));
    });
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = resolve(DASHBOARD_DIR, `.${filePath}`);

  const relativePath = relative(DASHBOARD_DIR, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const content = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": getContentType(filePath),
    "Cache-Control": "no-store"
  });
  res.end(content);
}

function getContentType(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return types[extname(filePath)] || "application/octet-stream";
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > JSON_BODY_LIMIT_BYTES) {
        rejectBody(createHttpError(413, "JSON body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        rejectBody(createHttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readPort(args) {
  const index = args.indexOf("--port");
  if (index === -1) {
    return DEFAULT_PORT;
  }

  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error("--port 必须是 1 到 65535 之间的整数");
  }

  return value;
}

function loadEnvFile(fileName, overrideKeys = new Set()) {
  const filePath = resolve(ROOT_DIR, fileName);
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
    if (key && (process.env[key] === undefined || overrideKeys.has(key))) {
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

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function maskWebhookUrl(value) {
  try {
    const url = new URL(value);
    const token = url.pathname.split("/").filter(Boolean).pop() || "";
    const maskedToken =
      token.length > 10 ? `${token.slice(0, 4)}...${token.slice(-4)}` : "****";
    return `${url.origin}${url.pathname.replace(token, maskedToken)}`;
  } catch {
    return "已配置";
  }
}

function reloadEnvKeys(keys) {
  for (const key of keys) {
    delete process.env[key];
  }

  loadEnvFile(".env");
  loadEnvFile(".env.local", new Set(keys));
}

function writeEnvLocalValues(updates) {
  const keys = Object.keys(updates);
  const lines = existsSync(ENV_LOCAL_FILE)
    ? readFileSync(ENV_LOCAL_FILE, "utf8").split(/\r?\n/)
    : [];
  const seen = new Set();
  const nextLines = [];

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !keys.includes(match[1])) {
      nextLines.push(line);
      continue;
    }

    const key = match[1];
    seen.add(key);
    const value = updates[key];
    if (value === undefined) {
      nextLines.push(line);
    } else if (value !== null) {
      nextLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  for (const key of keys) {
    const value = updates[key];
    if (seen.has(key) || value === undefined || value === null) {
      continue;
    }
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  mkdirSync(dirname(ENV_LOCAL_FILE), { recursive: true });
  writeFileSync(ENV_LOCAL_FILE, `${nextLines.join("\n")}\n`, "utf8");
}

function formatEnvValue(value) {
  const text = String(value);
  if (/[\s#"'\\]/.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { resolveTaskContextSource } from "./task-context/constants.mjs";
import { resolveLarkCliInvocation } from "./task-context/lark-source.mjs";
import { getWatcherStatus } from "./watcher-control.mjs";

export const TEAM_RUNTIME_FILES = [
  ".env.example",
  "README.md",
  "amber.bat",
  "install.bat",
  "package.json",
  "uninstall.bat",
  "LICENSE"
];
export const TEAM_RUNTIME_DIRECTORIES = ["dashboard", "docs", "scripts", "bin", "skills", "templates"];
export const EXCLUDED_RUNTIME_RELATIVE_PATHS = [
  "docs/Windows-MVP-mvp.3-杨金辉复测步骤-2026-09-03.md",
  "docs/Windows-MVP-第二台机器试测问题-2026-09-03.md",
  "docs/Windows-MVP-第二台机器完整复测步骤-2026-09-03.md"
];
const AMBER_HOOK_PATTERN = /[\\/]scripts[\\/]hooks[\\/](?:on-change-event|on-cursor-event|on-codex-event)\.mjs\b/i;

export function installTeamSetup({
  sourceRoot,
  targetRoot,
  userHome,
  nodeExecutable = process.execPath,
  now = new Date()
}) {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  const home = resolve(userHome);
  syncTeamRuntime(source, target);
  ensureEnvLocal(target);

  const paths = setupPaths(home);
  const changes = prepareInstallChanges(paths, target, nodeExecutable);
  const backupDir = backupChangedFiles(changes, target, now);
  writeChanges(changes);
  return {
    targetRoot: target,
    backupDir,
    changedFiles: changes.filter((item) => item.changed).map((item) => item.path),
    diagnostics: inspectTeamSetup({ targetRoot: target, userHome: home })
  };
}

export function uninstallTeamSetup({ targetRoot, userHome, now = new Date() }) {
  const target = resolve(targetRoot);
  const home = resolve(userHome);
  const paths = setupPaths(home);
  const changes = prepareUninstallChanges(paths);
  const backupDir = backupChangedFiles(changes, target, now);
  writeChanges(changes);
  return {
    targetRoot: target,
    backupDir,
    changedFiles: changes.filter((item) => item.changed).map((item) => item.path),
    preserved: [resolve(target, ".env.local"), resolve(target, ".local")]
  };
}

export function resolveUninstallSystemPlan({ skipSystem, autostartScriptExists }) {
  return {
    uninstallAutostart: !skipSystem && autostartScriptExists,
    clearAmberHome: !skipSystem
  };
}

export function inspectTeamSetup({ targetRoot, userHome }) {
  const target = resolve(targetRoot);
  const paths = setupPaths(resolve(userHome));
  const cursorHooks = readJsonIfPresent(paths.cursorHooks);
  const cursorMcp = readJsonIfPresent(paths.cursorMcp);
  const codexHooks = readJsonIfPresent(paths.codexHooks);
  const codexToml = readTextIfPresent(paths.codexToml);
  return {
    runtime: existsSync(resolve(target, "scripts/mcp-stdio-server.mjs")),
    envLocal: existsSync(resolve(target, ".env.local")),
    cursorHooks: hasAmberHooks(cursorHooks, "Cursor"),
    cursorMcp: hasAmberMcp(cursorMcp, target),
    codexHooks: hasAmberHooks(codexHooks, "ChatGPT"),
    codexMcp: hasAmberToml(codexToml, target)
  };
}

export function mergeCursorHooks(input = {}, amberRoot) {
  const document = cloneObject(input);
  document.version = document.version || 1;
  document.hooks = objectValue(document.hooks);
  const commands = cursorHookCommands(amberRoot);
  for (const [event, desired] of Object.entries(commands)) {
    const current = Array.isArray(document.hooks[event]) ? document.hooks[event] : [];
    const preserved = current.filter((item) => !isAmberHook(item));
    document.hooks[event] = [...preserved, ...desired.map((command) => ({ command }))];
  }
  return document;
}

export function removeCursorHooks(input = {}) {
  const document = cloneObject(input);
  document.hooks = objectValue(document.hooks);
  for (const [event, items] of Object.entries(document.hooks)) {
    if (!Array.isArray(items)) continue;
    const preserved = items.filter((item) => !isAmberHook(item));
    if (preserved.length) document.hooks[event] = preserved;
    else delete document.hooks[event];
  }
  return document;
}

export function mergeCodexHooks(input = {}, amberRoot) {
  const document = cloneObject(input);
  document.hooks = objectValue(document.hooks);
  const commands = codexHookCommands(amberRoot);
  for (const [event, desired] of Object.entries(commands)) {
    const groups = Array.isArray(document.hooks[event]) ? document.hooks[event] : [];
    const preserved = groups.map(removeAmberHooksFromGroup).filter(Boolean);
    document.hooks[event] = [...preserved, { hooks: desired }];
  }
  return document;
}

export function removeCodexHooks(input = {}) {
  const document = cloneObject(input);
  document.hooks = objectValue(document.hooks);
  for (const [event, groups] of Object.entries(document.hooks)) {
    if (!Array.isArray(groups)) continue;
    const preserved = groups.map(removeAmberHooksFromGroup).filter(Boolean);
    if (preserved.length) document.hooks[event] = preserved;
    else delete document.hooks[event];
  }
  return document;
}

export function mergeMcpJson(input = {}, amberRoot, nodeExecutable = "node") {
  const document = cloneObject(input);
  document.mcpServers = objectValue(document.mcpServers);
  document.mcpServers.amber = {
    command: resolveNodeCommand(nodeExecutable),
    args: [slashPath(resolve(amberRoot, "scripts/mcp-stdio-server.mjs"))]
  };
  return document;
}

export function removeMcpJson(input = {}) {
  const document = cloneObject(input);
  document.mcpServers = objectValue(document.mcpServers);
  delete document.mcpServers.amber;
  return document;
}

export function mergeCodexToml(input = "", amberRoot, nodeExecutable = "node") {
  const script = slashPath(resolve(amberRoot, "scripts/mcp-stdio-server.mjs"));
  const section = [
    "[mcp_servers.amber]",
    `command = \"${escapeToml(resolveNodeCommand(nodeExecutable))}\"`,
    `args = [\"${escapeToml(script)}\"]`
  ];
  return replaceTomlSection(input, "mcp_servers.amber", section);
}

export function removeCodexToml(input = "") {
  return replaceTomlSection(input, "mcp_servers.amber", null);
}

function prepareInstallChanges(paths, targetRoot, nodeExecutable) {
  const cursorHooks = readJsonIfPresent(paths.cursorHooks);
  const cursorMcp = readJsonIfPresent(paths.cursorMcp);
  const codexHooks = readJsonIfPresent(paths.codexHooks);
  const codexToml = readTextIfPresent(paths.codexToml);
  return [
    jsonChange(paths.cursorHooks, cursorHooks, mergeCursorHooks(cursorHooks, targetRoot)),
    jsonChange(paths.cursorMcp, cursorMcp, mergeMcpJson(cursorMcp, targetRoot, nodeExecutable)),
    jsonChange(paths.codexHooks, codexHooks, mergeCodexHooks(codexHooks, targetRoot)),
    textChange(paths.codexToml, codexToml, mergeCodexToml(codexToml, targetRoot, nodeExecutable))
  ];
}

function prepareUninstallChanges(paths) {
  const cursorHooks = readJsonIfPresent(paths.cursorHooks);
  const cursorMcp = readJsonIfPresent(paths.cursorMcp);
  const codexHooks = readJsonIfPresent(paths.codexHooks);
  const codexToml = readTextIfPresent(paths.codexToml);
  return [
    existingJsonChange(paths.cursorHooks, cursorHooks, removeCursorHooks(cursorHooks)),
    existingJsonChange(paths.cursorMcp, cursorMcp, removeMcpJson(cursorMcp)),
    existingJsonChange(paths.codexHooks, codexHooks, removeCodexHooks(codexHooks)),
    existingTextChange(paths.codexToml, codexToml, removeCodexToml(codexToml))
  ];
}

function setupPaths(userHome) {
  return {
    cursorHooks: resolve(userHome, ".cursor/hooks.json"),
    cursorMcp: resolve(userHome, ".cursor/mcp.json"),
    codexHooks: resolve(userHome, ".codex/hooks.json"),
    codexToml: resolve(userHome, ".codex/config.toml")
  };
}

export function syncTeamRuntime(sourceRoot, targetRoot) {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  if (source === target) return;
  mkdirSync(target, { recursive: true });
  for (const name of TEAM_RUNTIME_FILES) {
    const file = resolve(source, name);
    if (!existsSync(file)) continue;
    cpSync(file, resolve(target, name), { force: true });
  }
  for (const name of TEAM_RUNTIME_DIRECTORIES) {
    const directory = resolve(source, name);
    if (!existsSync(directory)) continue;
    cpSync(directory, resolve(target, name), {
      recursive: true,
      force: true,
      filter: (current) => allowRuntimeCopy(source, current)
    });
  }
  removeExcludedRuntimeFiles(target);
}

function allowRuntimeCopy(sourceRoot, sourcePath) {
  const rel = slashPath(relative(sourceRoot, sourcePath));
  if (!rel || rel === ".") return true;
  return !EXCLUDED_RUNTIME_RELATIVE_PATHS.includes(rel);
}

function removeExcludedRuntimeFiles(targetRoot) {
  for (const rel of EXCLUDED_RUNTIME_RELATIVE_PATHS) {
    rmSync(resolve(targetRoot, rel), { force: true });
  }
}

function ensureEnvLocal(targetRoot) {
  const envFile = resolve(targetRoot, ".env.local");
  if (existsSync(envFile)) return;
  const content = [
    "# Amber team setup. Webhook credentials stay on this machine.",
    "AMBER_BASE_TOKEN=",
    "AMBER_AI_TABLE_ID=",
    "AMBER_COMMIT_TABLE_ID=",
    "FEISHU_WEBHOOK_URL=",
    "FEISHU_WEBHOOK_SECRET=",
    "FEISHU_CHANGE_WEBHOOK_URL=",
    "FEISHU_CHANGE_WEBHOOK_TOKEN=",
    "FEISHU_COMMIT_WEBHOOK_URL=",
    "FEISHU_COMMIT_WEBHOOK_TOKEN=",
    "# COMMIT_RECORD_SCAN_ROOTS=D:/project",
    ""
  ].join("\r\n");
  writeAtomic(envFile, content);
}

function backupChangedFiles(changes, targetRoot, now) {
  const changed = changes.filter((item) => item.changed && item.existed);
  if (!changed.length) return null;
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(targetRoot, ".local/setup-backups", stamp);
  mkdirSync(backupDir, { recursive: true });
  for (const item of changed) {
    const label = item.path.replace(/^.*[\\/](\.cursor|\.codex)[\\/]/i, "$1-").replace(/[\\/]/g, "-");
    writeFileSync(resolve(backupDir, label), item.before, "utf8");
  }
  return backupDir;
}

function writeChanges(changes) {
  for (const item of changes) {
    if (item.changed) writeAtomic(item.path, item.after);
  }
}

function jsonChange(path, beforeObject, afterObject) {
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = `${JSON.stringify(afterObject, null, 2)}\n`;
  return { path, before, after, existed: existsSync(path), changed: normalizeText(before) !== normalizeText(after) };
}

function existingJsonChange(path, beforeObject, afterObject) {
  return existsSync(path)
    ? jsonChange(path, beforeObject, afterObject)
    : { path, before: "", after: "", existed: false, changed: false };
}

function textChange(path, before, after) {
  return { path, before, after, existed: existsSync(path), changed: normalizeText(before) !== normalizeText(after) };
}

function existingTextChange(path, before, after) {
  return existsSync(path)
    ? textChange(path, before, after)
    : { path, before: "", after: "", existed: false, changed: false };
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, path);
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`配置文件 JSON 无法解析，安装已停止：${path} (${error.message})`);
  }
}

function readTextIfPresent(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function cursorHookCommands(amberRoot) {
  const change = quotedCommand(amberRoot, "on-change-event.mjs");
  const prompt = quotedCommand(amberRoot, "on-cursor-event.mjs");
  const node = "node";
  return {
    beforeSubmitPrompt: [`${node} ${change} --source Cursor`],
    afterAgentResponse: [`${node} ${prompt}`, `${node} ${change} --source Cursor`],
    stop: [`${node} ${prompt}`, `${node} ${change} --source Cursor`]
  };
}

function codexHookCommands(amberRoot) {
  const change = quotedCommand(amberRoot, "on-change-event.mjs");
  const prompt = quotedCommand(amberRoot, "on-codex-event.mjs");
  const node = "node";
  return {
    UserPromptSubmit: [{ type: "command", command: `${node} ${change} --source ChatGPT`, timeout: 30 }],
    Stop: [
      { type: "command", command: `${node} ${prompt} --event Stop` },
      { type: "command", command: `${node} ${change} --source ChatGPT`, timeout: 30 }
    ],
    PermissionRequest: [{ type: "command", command: `${node} ${prompt} --event PermissionRequest` }]
  };
}

function resolveNodeCommand(value) {
  const command = String(value || "node").trim();
  return command ? resolveExecutablePath(command) : "node";
}

function resolveExecutablePath(command) {
  return /[\\/]/.test(command) ? resolve(command) : command;
}

function quotedCommand(amberRoot, file) {
  return `"${resolve(amberRoot, "scripts/hooks", file)}"`;
}

function removeAmberHooksFromGroup(group) {
  if (!group || typeof group !== "object") return group;
  if (!Array.isArray(group.hooks)) return isAmberHook(group) ? null : group;
  const hooks = group.hooks.filter((item) => !isAmberHook(item));
  return hooks.length ? { ...group, hooks } : null;
}

function isAmberHook(item) {
  return AMBER_HOOK_PATTERN.test(String(item?.command || ""));
}

function hasAmberHooks(document, source) {
  if (!document?.hooks || typeof document.hooks !== "object") return false;
  const commands = collectCommands(document.hooks);
  return commands.some((command) => AMBER_HOOK_PATTERN.test(command) && command.includes(source));
}

function collectCommands(value) {
  if (Array.isArray(value)) return value.flatMap(collectCommands);
  if (!value || typeof value !== "object") return [];
  return [
    ...(typeof value.command === "string" ? [value.command] : []),
    ...Object.values(value).flatMap(collectCommands)
  ];
}

function hasAmberMcp(document, targetRoot) {
  const args = document?.mcpServers?.amber?.args;
  return Array.isArray(args) && args.some((item) => slashPath(item) === slashPath(resolve(targetRoot, "scripts/mcp-stdio-server.mjs")));
}

function hasAmberToml(input, targetRoot) {
  return input.includes("[mcp_servers.amber]") && input.includes(slashPath(resolve(targetRoot, "scripts/mcp-stdio-server.mjs")));
}

function replaceTomlSection(input, name, replacementLines) {
  const newline = input.includes("\r\n") ? "\r\n" : "\n";
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const output = [];
  let inserted = false;
  for (let index = 0; index < lines.length;) {
    const sectionName = tomlSectionName(lines[index]);
    if (sectionName !== name && !sectionName?.startsWith(`${name}.`)) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    if (replacementLines && !inserted) {
      output.push(...replacementLines);
      inserted = true;
    }
    index += 1;
    while (index < lines.length && !isTomlTableHeader(lines[index])) index += 1;
  }
  if (replacementLines && !inserted) {
    while (output.length && !output.at(-1).trim()) output.pop();
    if (output.length) output.push("");
    output.push(...replacementLines);
  }
  while (output.length > 1 && !output.at(-1).trim() && !output.at(-2).trim()) output.pop();
  return `${output.join(newline).replace(/\s+$/, "")}${newline}`;
}

function tomlSectionName(line) {
  return line.match(/^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/)?.[1].trim() || null;
}

function isTomlTableHeader(line) {
  return Boolean(tomlSectionName(line) || /^\s*\[\[[^\]]+\]\]\s*(?:#.*)?$/.test(line));
}

function escapeToml(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function slashPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function cloneObject(value) {
  return value && typeof value === "object" ? structuredClone(value) : {};
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

export function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  return result;
}

export function inspectLocalSpace(targetRoot, env = {}) {
  const local = { ...env, ...readDotEnv(resolve(targetRoot, ".env.local")) };
  const baseToken = Boolean(local.AMBER_BASE_TOKEN?.trim());
  const aiWebhook = Boolean(local.FEISHU_CHANGE_WEBHOOK_URL?.trim());
  const gitWebhook = Boolean(local.FEISHU_COMMIT_WEBHOOK_URL?.trim());
  return {
    baseToken,
    aiTable: Boolean(local.AMBER_AI_TABLE_ID?.trim()),
    commitTable: Boolean(local.AMBER_COMMIT_TABLE_ID?.trim()),
    aiWebhook,
    gitWebhook,
    ready: baseToken && aiWebhook && gitWebhook
  };
}

export function doctorCheck(id, label, ok, detail = "") {
  return { id, label, status: ok ? "pass" : "fail", detail };
}

export function doctorWarn(id, label, ok, detail = "") {
  return { id, label, status: ok ? "pass" : "warn", detail };
}

export function collectTeamSetupChecks({
  targetRoot,
  userHome,
  env = process.env,
  skipSystem = false,
  watcher = null,
  getStatus = getWatcherStatus
} = {}) {
  const snapshot = inspectTeamSetup({ targetRoot, userHome });
  const localEnv = { ...env, ...readDotEnv(resolve(targetRoot, ".env.local")) };
  const watcherStatus = watcher || getStatus(targetRoot);
  const processesOk = Boolean(watcherStatus.running && watcherStatus.healthRunning);
  return {
    snapshot,
    env: localEnv,
    checks: [
      doctorCheck("node_runtime", "Node.js", true, `${nodeSource(process.execPath)} · ${process.version}`),
      doctorCheck("runtime_files", "运行文件", snapshot.runtime),
      doctorCheck("local_config", "本地配置", snapshot.envLocal),
      doctorCheck("cursor_hooks", "Cursor Hook", snapshot.cursorHooks),
      doctorCheck("cursor_mcp", "Cursor MCP", snapshot.cursorMcp),
      doctorCheck("codex_hooks", "Codex Hook", snapshot.codexHooks),
      doctorCheck("codex_mcp", "Codex MCP", snapshot.codexMcp),
      doctorWarn("ai_webhook", "AI 记录 Webhook", Boolean(localEnv.FEISHU_CHANGE_WEBHOOK_URL?.trim())),
      doctorWarn("git_webhook", "Git 记录 Webhook", Boolean(localEnv.FEISHU_COMMIT_WEBHOOK_URL?.trim())),
      doctorWarn("git_scan_roots", "Git 扫描目录", Boolean(localEnv.COMMIT_RECORD_SCAN_ROOTS?.trim())),
      doctorWarn(
        "autostart",
        "开机自启动",
        existsSync(resolve(targetRoot, ".local/autostart-method.txt")) || skipSystem
      ),
      doctorWarn(
        "runtime_processes",
        "核心常驻进程",
        processesOk,
        processesOk ? "watcher 与 health monitor 正常" : "尚未全部运行"
      )
    ]
  };
}

export function collectLarkDoctorChecks(targetRoot, env = process.env) {
  const localEnv = { ...env, ...readDotEnv(resolve(targetRoot, ".env.local")) };
  const source = resolveTaskContextSource(localEnv);
  const auth = runLark(["auth", "status", "--json", "--verify"], localEnv);
  if (!auth.ok) return [doctorCheck("lark_auth", "飞书登录", false, auth.message)];
  const authJson = parseJsonOutput(auth.stdout);
  const verified = authJson?.verified === true || authJson?.data?.verified === true || authJson?.ok === true;
  const checks = [doctorCheck("lark_auth", "飞书登录", verified, verified ? "用户身份有效" : "登录状态未通过验证")];
  for (const [id, label, tableId] of [
    ["ai_table", "AI 记录表", source.aiTableId],
    ["git_table", "Git 记录表", source.commitTableId]
  ]) {
    if (!source.baseToken || !tableId) {
      checks.push(doctorCheck(id, label, false, "Base 配置缺失"));
      continue;
    }
    const probe = runLark([
      "base", "+record-list",
      "--base-token", source.baseToken,
      "--table-id", tableId,
      "--limit", "1",
      "--as", "user",
      "--format", "json"
    ], localEnv);
    checks.push(doctorCheck(id, label, probe.ok, probe.ok ? "可读取" : probe.message));
  }
  return checks;
}

export function readPackageVersion(targetRoot) {
  try {
    return JSON.parse(readFileSync(resolve(targetRoot, "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

export function readDesiredProfile(targetRoot) {
  try {
    const desired = JSON.parse(readFileSync(resolve(targetRoot, ".local/runtime-desired.json"), "utf8"));
    return desired?.profile === "full" ? "full" : "core";
  } catch {
    return "core";
  }
}

export function redactDiagnosticPaths(value, { userHome, targetRoot } = {}) {
  let detail = String(value || "");
  for (const [path, replacement] of [
    [userHome, "<user-home>"],
    [targetRoot, "<amber-root>"]
  ]) {
    const normalized = String(path || "");
    if (!normalized) continue;
    for (const variant of new Set([normalized, normalized.replaceAll("\\", "/")])) {
      detail = detail.replace(new RegExp(escapeRegExp(variant), "gi"), replacement);
    }
  }
  return detail;
}

export function redactDoctorChecks(checks, paths) {
  return checks.map((item) => ({
    ...item,
    detail: redactDiagnosticPaths(item.detail, paths)
  }));
}

function runLark(args, env) {
  let invocation;
  try {
    invocation = resolveLarkCliInvocation(args, { env });
  } catch (error) {
    return { ok: false, message: sanitizeDoctorText(error?.message || error) };
  }
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: {
      ...env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
    },
    windowsHide: true,
    timeout: 15_000
  });
  if (result.error) return { ok: false, message: sanitizeDoctorText(result.error.message) };
  if (result.status !== 0) {
    return { ok: false, message: sanitizeDoctorText(result.stderr || `退出码 ${result.status}`) };
  }
  return { ok: true, stdout: result.stdout };
}

function parseJsonOutput(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
}

function nodeSource(path) {
  const normalized = String(path || "").replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.cache/codex-runtimes/")) return "Codex Runtime";
  if (normalized.includes("/program files/") || normalized.includes("/program files (x86)/")) return "标准安装";
  if (normalized.includes("/appdata/local/programs/nodejs/")) return "用户安装";
  return "当前 Node";
}

function sanitizeDoctorText(value) {
  return String(value || "")
    .replace(/(?:token|authorization|bearer)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

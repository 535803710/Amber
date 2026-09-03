import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  AI_TABLE_ID,
  AMBER_BASE_TOKEN,
  COMMIT_TABLE_ID
} from "./task-context/constants.mjs";

export const TEAM_RUNTIME_FILES = [
  ".env.example",
  "README.md",
  "amber.bat",
  "install.bat",
  "package.json",
  "uninstall.bat"
];
export const TEAM_RUNTIME_DIRECTORIES = ["dashboard", "docs", "scripts"];
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
  syncRuntime(source, target);
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

function syncRuntime(sourceRoot, targetRoot) {
  if (sourceRoot === targetRoot) return;
  mkdirSync(targetRoot, { recursive: true });
  for (const name of TEAM_RUNTIME_FILES) {
    const source = resolve(sourceRoot, name);
    if (!existsSync(source)) continue;
    cpSync(source, resolve(targetRoot, name), { force: true });
  }
  for (const name of TEAM_RUNTIME_DIRECTORIES) {
    const source = resolve(sourceRoot, name);
    if (!existsSync(source)) continue;
    cpSync(source, resolve(targetRoot, name), { recursive: true, force: true });
  }
}

function ensureEnvLocal(targetRoot) {
  const envFile = resolve(targetRoot, ".env.local");
  if (existsSync(envFile)) return;
  const content = [
    "# Amber team setup. Webhook credentials stay on this machine.",
    `AMBER_BASE_TOKEN=${AMBER_BASE_TOKEN}`,
    `AMBER_AI_TABLE_ID=${AI_TABLE_ID}`,
    `AMBER_COMMIT_TABLE_ID=${COMMIT_TABLE_ID}`,
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

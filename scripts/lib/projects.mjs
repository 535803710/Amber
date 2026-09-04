import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

export const PROJECTS_SCHEMA_VERSION = 1;
export const SCAN_ROOTS_ENV_KEY = "COMMIT_RECORD_SCAN_ROOTS";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

export function getProjectsFilePath(targetRoot) {
  return resolve(targetRoot, ".local/projects.json");
}

export function getEnvLocalPath(targetRoot) {
  return resolve(targetRoot, ".env.local");
}

export function normalizeGitRemote(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";

  if (!value.includes("://") && /^[^@\s]+@[^:/\s]+:/.test(value)) {
    const at = value.indexOf("@");
    const colon = value.indexOf(":", at);
    value = `${value.slice(at + 1, colon)}/${value.slice(colon + 1)}`;
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    try {
      const url = new URL(value);
      value = url.pathname ? `${url.hostname}${url.pathname}` : url.hostname;
    } catch {
      return "";
    }
  }

  return canonicalizeProjectKey(value);
}

export function normalizeProjectKey(raw) {
  return canonicalizeProjectKey(normalizeGitRemote(raw) || String(raw ?? "").trim());
}

export function isValidProjectKey(key) {
  return typeof key === "string" && key.length > 0 && PROJECT_KEY_PATTERN.test(key) && !key.includes("//");
}

export function addProject(options) {
  const ctx = createContext(options);
  const inputPath = firstText(options.path, ctx.cwd);
  if (!inputPath) {
    return fail("project_path_missing", "项目路径不存在或不是目录。");
  }

  const resolvedPath = resolve(ctx.cwd, inputPath);
  if (!isDirectory(resolvedPath)) {
    return fail("project_path_missing", "项目路径不存在或不是目录。");
  }

  const repoRoot = resolveRepoRoot(resolvedPath, ctx.io) || resolvedPath;
  const remoteResult = ctx.io.runGit(repoRoot, ["remote", "get-url", "origin"]);
  const remote = remoteResult.ok ? String(remoteResult.stdout || "").trim() : "";
  const explicitKey = readExplicitKey(options.explicitKey ?? options.key);
  let projectKey;

  if (explicitKey !== null) {
    projectKey = normalizeProjectKey(explicitKey);
    if (!isValidProjectKey(projectKey)) {
      return fail("invalid_project_key", "project_key 无效。", [
        "使用 --key 提供类似 host/group/name 的稳定标识"
      ]);
    }
  } else if (remote) {
    projectKey = normalizeGitRemote(remote);
    if (!isValidProjectKey(projectKey)) {
      return fail("invalid_project_key", "无法从 Git remote 得到有效的 project_key。", [
        "使用 --key 提供稳定的 project_key"
      ]);
    }
  } else {
    return {
      status: "needs_action",
      code: "project_key_required",
      message: "无法推导 project_key，请使用 --key 指定。",
      actions: ["使用 --key 提供稳定的 project_key"],
      data: { path: repoRoot }
    };
  }

  const store = readProjectsStore(ctx.targetRoot);
  const pathConflict = store.projects.find((item) => {
    return samePath(item.path, repoRoot) && item.project_key !== projectKey;
  });
  if (pathConflict) {
    return fail(
      "project_path_conflict",
      `该路径已注册为其他 project_key：${pathConflict.project_key}。`,
      ["先 amber project remove 再重新添加，或使用已有 project_key"]
    );
  }

  const existingIndex = store.projects.findIndex((item) => item.project_key === projectKey);
  const previous = existingIndex >= 0 ? store.projects[existingIndex] : null;
  const record = {
    project_key: projectKey,
    path: repoRoot,
    name: basename(repoRoot),
    remote,
    addedAt: previous?.addedAt || ctx.io.now()
  };

  if (existingIndex >= 0) {
    store.projects[existingIndex] = record;
  } else {
    store.projects.push(record);
  }

  writeProjectsStore(ctx.targetRoot, store);
  upsertScanRoot(ctx.targetRoot, {
    add: [repoRoot],
    remove: previous && !samePath(previous.path, repoRoot) ? [previous.path] : []
  });

  return {
    status: "ok",
    code: "project_added",
    message: `已注册项目 ${record.name}（${record.project_key}）。`,
    actions: [],
    data: { project: record, projects: store.projects }
  };
}

export function removeProject(options) {
  const ctx = createContext(options);
  const selector = firstText(options.selector, options.path, options.key);
  if (!selector) {
    return fail("project_not_found", "未找到该项目。", ["使用 amber project list 查看已注册项目"]);
  }

  const store = readProjectsStore(ctx.targetRoot);
  const index = findProjectIndex(store.projects, selector, ctx.cwd);
  if (index < 0) {
    return fail("project_not_found", "未找到该项目。", ["使用 amber project list 查看已注册项目"]);
  }

  const [removed] = store.projects.splice(index, 1);
  writeProjectsStore(ctx.targetRoot, store);
  upsertScanRoot(ctx.targetRoot, { remove: [removed.path] });

  return {
    status: "ok",
    code: "project_removed",
    message: `已移除项目 ${removed.name}（${removed.project_key}）。`,
    actions: [],
    data: { project: removed, projects: store.projects }
  };
}

export function listProjects(options) {
  const ctx = createContext(options);
  const store = readProjectsStore(ctx.targetRoot);
  const count = store.projects.length;
  return {
    status: "ok",
    code: "project_list",
    message: count ? `已注册 ${count} 个项目。` : "当前没有注册项目。",
    actions: [],
    data: { projects: store.projects }
  };
}

export function readProjectsStore(targetRoot) {
  const filePath = getProjectsFilePath(targetRoot);
  if (!existsSync(filePath)) {
    return { schemaVersion: PROJECTS_SCHEMA_VERSION, projects: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const projects = Array.isArray(parsed?.projects)
      ? parsed.projects.map(normalizeStoredProject).filter(Boolean)
      : [];
    return { schemaVersion: PROJECTS_SCHEMA_VERSION, projects };
  } catch {
    return { schemaVersion: PROJECTS_SCHEMA_VERSION, projects: [] };
  }
}

export function readScanRootsFromEnv(targetRoot) {
  return parseScanRootsValue(readEnvValue(getEnvLocalPath(targetRoot), SCAN_ROOTS_ENV_KEY));
}

function createContext(options = {}) {
  return {
    targetRoot: resolve(options.targetRoot || options.cwd || process.cwd()),
    cwd: resolve(options.cwd || options.targetRoot || process.cwd()),
    io: resolveIo(options.io)
  };
}

function resolveIo(io = {}) {
  return {
    runGit: typeof io.runGit === "function" ? io.runGit : defaultRunGit,
    now: typeof io.now === "function" ? io.now : () => new Date().toISOString()
  };
}

function defaultRunGit(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: String(result.stdout || "").trim()
  };
}

function canonicalizeProjectKey(raw) {
  let key = String(raw ?? "").trim().replaceAll("\\", "/");
  key = key.replace(/^\/+/, "").replace(/\/+$/, "");
  if (key.toLowerCase().endsWith(".git")) {
    key = key.slice(0, -4).replace(/\/+$/, "");
  }
  return key.toLowerCase();
}

function readExplicitKey(value) {
  if (value == null || value === false || value === true) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function resolveRepoRoot(path, io) {
  const result = io.runGit(path, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) return "";
  const root = String(result.stdout || "").trim();
  return root ? resolve(root) : "";
}

function findProjectIndex(projects, selector, cwd) {
  const key = normalizeProjectKey(selector);
  if (isValidProjectKey(key)) {
    const byKey = projects.findIndex((item) => item.project_key === key);
    if (byKey >= 0) return byKey;
  }

  const resolved = resolve(cwd, selector);
  const byPath = projects.findIndex((item) => samePath(item.path, resolved) || samePath(item.path, selector));
  return byPath;
}

function normalizeStoredProject(item) {
  if (!item || typeof item !== "object") return null;
  const projectKey = normalizeProjectKey(item.project_key);
  const path = String(item.path || "").trim();
  if (!isValidProjectKey(projectKey) || !path) return null;
  return {
    project_key: projectKey,
    path,
    name: String(item.name || basename(path)),
    remote: String(item.remote || ""),
    addedAt: String(item.addedAt || "")
  };
}

function writeProjectsStore(targetRoot, store) {
  writeAtomic(getProjectsFilePath(targetRoot), `${JSON.stringify({
    schemaVersion: PROJECTS_SCHEMA_VERSION,
    projects: store.projects
  }, null, 2)}\n`);
}

function upsertScanRoot(targetRoot, { add = [], remove = [] } = {}) {
  const envPath = getEnvLocalPath(targetRoot);
  const current = parseScanRootsValue(readEnvValue(envPath, SCAN_ROOTS_ENV_KEY));
  const next = [];

  for (const root of current) {
    if (remove.some((item) => samePath(item, root))) continue;
    if (!next.some((item) => samePath(item, root))) next.push(root);
  }
  for (const root of add) {
    if (!root) continue;
    if (next.some((item) => samePath(item, root))) continue;
    next.push(root);
  }

  writeEnvValue(envPath, SCAN_ROOTS_ENV_KEY, formatScanRootsValue(next));
}

function parseScanRootsValue(value) {
  if (!value) return [];
  return String(value).split(";").map((item) => item.trim()).filter(Boolean);
}

function formatScanRootsValue(roots) {
  return roots.map((root) => String(root).replaceAll("\\", "/")).join(";");
}

function readEnvValue(filePath, key) {
  if (!existsSync(filePath)) return "";
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match || match[1] !== key) continue;
    return unquoteEnvValue(match[2].trim());
  }
  return "";
}

function writeEnvValue(filePath, key, value) {
  const existed = existsSync(filePath);
  const original = existed ? readFileSync(filePath, "utf8") : "";
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = existed ? original.split(/\r?\n/) : [];
  const rendered = `${key}=${formatEnvValue(value)}`;
  let found = false;
  const nextLines = [];

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || match[1] !== key) {
      nextLines.push(line);
      continue;
    }
    if (!found) nextLines.push(rendered);
    found = true;
  }

  if (!found) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") {
      nextLines.push(rendered);
    } else if (nextLines.length) {
      nextLines[nextLines.length - 1] = rendered;
      nextLines.push("");
    } else {
      nextLines.push(rendered);
    }
  }

  while (nextLines.length > 1 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  writeAtomic(filePath, `${nextLines.join(newline)}${newline}`);
}

function formatEnvValue(value) {
  const text = String(value);
  if (/[\s#"'\\]/.test(text)) return JSON.stringify(text);
  return text;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function writeAtomic(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, filePath);
}

function samePath(left, right) {
  if (!left || !right) return false;
  const a = normalizePath(left);
  const b = normalizePath(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function normalizePath(value) {
  return resolve(String(value)).replace(/[\\/]+$/, "").replaceAll("\\", "/");
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function firstText(...values) {
  for (const value of values) {
    if (value == null || value === false || value === true) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function fail(code, message, actions = []) {
  return {
    status: "failed",
    code,
    message,
    actions,
    data: {}
  };
}

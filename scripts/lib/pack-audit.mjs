import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

export const FORBIDDEN_BASE_TOKEN = ["Inmhb4Vl", "0alBIAsvzaxcxC0Ln0d"].join("");
export const FORBIDDEN_AI_TABLE_ID = ["tblppOxO", "QCQkAzoY"].join("");
export const FORBIDDEN_COMMIT_TABLE_ID = ["tbl9MKpf", "3sAHG4tR"].join("");

const DEFAULT_PUBLISH_ENTRIES = [
  "bin",
  "scripts",
  "dashboard",
  "skills",
  "templates",
  "LICENSE",
  "README.md",
  "amber.bat",
  ".env.example"
];

const EXCLUDED_SEGMENTS = new Set(["test", ".git", ".local", "node_modules", "docs"]);
const RETEST_PATH_MARKERS = ["杨金辉", "Windows-MVP-第二台机器"];
const WEBHOOK_TOKEN_PATTERN = /open-apis\/bot\/v2\/hook\/([A-Za-z0-9_-]+)/gi;
const PLACEHOLDER_WEBHOOK_TOKENS = new Set([
  "your-webhook-token",
  "example",
  "example-token",
  "placeholder",
  "xxx",
  "redacted"
]);

export function auditPackageFiles(filePaths, fileContentsByPath = {}) {
  const findings = [];
  for (const filePath of filePaths || []) {
    const path = toPosix(filePath);
    collectPathFindings(path, findings);
    const content = lookupContent(fileContentsByPath, filePath, path);
    if (content == null) continue;
    collectContentFindings(path, String(content), findings);
  }
  return { ok: findings.length === 0, findings };
}

export function collectPublishableFiles(rootDir) {
  const files = [];
  for (const entry of readPublishEntries(rootDir)) {
    const abs = join(rootDir, entry);
    if (!existsSync(abs)) continue;
    collectFrom(abs, rootDir, files);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function readPublishEntries(rootDir) {
  const packageFile = join(rootDir, "package.json");
  if (!existsSync(packageFile)) return DEFAULT_PUBLISH_ENTRIES;
  try {
    const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
    return Array.isArray(pkg.files) && pkg.files.length > 0
      ? pkg.files
      : DEFAULT_PUBLISH_ENTRIES;
  } catch {
    return DEFAULT_PUBLISH_ENTRIES;
  }
}

function collectFrom(abs, rootDir, files) {
  const rel = toPosix(relative(rootDir, abs));
  if (!rel || rel === ".") return;
  if (isExcluded(rel)) return;
  const info = statSync(abs);
  if (info.isDirectory()) {
    for (const name of readdirSync(abs)) {
      collectFrom(join(abs, name), rootDir, files);
    }
    return;
  }
  files.push(rel);
}

function collectPathFindings(path, findings) {
  const segments = path.split("/").filter(Boolean);
  if (segments.includes(".env.local") || basename(path) === ".env.local") {
    findings.push({ path, reason: ".env.local must not be published" });
  }
  if (segments.includes(".local")) {
    findings.push({ path, reason: ".local/ must not be published" });
  }
  for (const marker of RETEST_PATH_MARKERS) {
    if (path.includes(marker)) {
      findings.push({
        path,
        reason: `personnel retest document (${marker}) must not be published`
      });
    }
  }
}

function collectContentFindings(path, content, findings) {
  if (content.includes(FORBIDDEN_BASE_TOKEN)) {
    findings.push({ path, reason: "default Base token must not be published" });
  }
  if (content.includes(FORBIDDEN_AI_TABLE_ID)) {
    findings.push({ path, reason: "default AI table id must not be published" });
  }
  if (content.includes(FORBIDDEN_COMMIT_TABLE_ID)) {
    findings.push({ path, reason: "default commit table id must not be published" });
  }
  for (const match of content.matchAll(WEBHOOK_TOKEN_PATTERN)) {
    const token = String(match[1] || "");
    if (!isLikelyWebhookToken(token)) continue;
    findings.push({
      path,
      reason: "plaintext Feishu webhook token must not be published"
    });
  }
}

function isLikelyWebhookToken(token) {
  const normalized = token.trim();
  if (!normalized) return false;
  if (PLACEHOLDER_WEBHOOK_TOKENS.has(normalized.toLowerCase())) return false;
  if (/^your[-_]/i.test(normalized)) return false;
  if (/^[<[{]/.test(normalized)) return false;
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(normalized)
    || normalized.length >= 20;
}

function lookupContent(fileContentsByPath, originalPath, posixPath) {
  if (Object.prototype.hasOwnProperty.call(fileContentsByPath, originalPath)) {
    return fileContentsByPath[originalPath];
  }
  if (Object.prototype.hasOwnProperty.call(fileContentsByPath, posixPath)) {
    return fileContentsByPath[posixPath];
  }
  return undefined;
}

function isExcluded(rel) {
  const segments = rel.split("/").filter(Boolean);
  if (segments.includes(".env.local") || basename(rel) === ".env.local") return true;
  return segments.some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function toPosix(value) {
  return String(value || "").split(sep).join("/").replace(/^\.\/+/, "");
}

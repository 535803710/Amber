#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEAM_RUNTIME_DIRECTORIES,
  TEAM_RUNTIME_FILES
} from "./lib/team-setup.mjs";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT_NAME = "Amber";
const EXCLUDED_NAMES = new Set([
  ".claude",
  ".cursor",
  ".git",
  ".local",
  ".vscode",
  "node_modules",
  "test",
  "dist"
]);
const REQUIRED_ARCHIVE_ENTRIES = [
  "Amber/.env.example",
  "Amber/amber.bat",
  "Amber/install.bat",
  "Amber/uninstall.bat",
  "Amber/scripts/team-setup.mjs",
  "Amber/scripts/mcp-stdio-server.mjs"
];

export function collectTeamPackageEntries(sourceRoot) {
  const root = resolve(sourceRoot);
  const entries = [];

  for (const name of TEAM_RUNTIME_FILES) {
    const source = resolve(root, name);
    assertRegularFile(source, name);
    entries.push(normalizeRelativePath(name));
  }

  for (const name of TEAM_RUNTIME_DIRECTORIES) {
    const source = resolve(root, name);
    if (!existsSync(source) || !lstatSync(source).isDirectory()) {
      throw new Error(`团队安装包目录缺失：${name}`);
    }
    entries.push(...collectDirectoryEntries(source, name));
  }

  return entries.sort();
}

export function resolveArtifactPath(sourceRoot, version) {
  return resolve(sourceRoot, "dist", `Amber-team-v${version}.zip`);
}

export function runBuild({ sourceRoot = SOURCE_ROOT } = {}) {
  const root = resolve(sourceRoot);
  assertWindows();
  const version = readPackageVersion(root);
  runTests(root);

  const entries = collectTeamPackageEntries(root);
  const outputDirectory = resolve(root, "dist");
  mkdirSync(outputDirectory, { recursive: true });
  const artifactPath = resolveArtifactPath(root, version);
  const temporaryArtifactPath = resolve(outputDirectory, `.Amber-team-v${version}.tmp.zip`);
  const stagingRoot = mkdtempSync(resolve(tmpdir(), "amber-team-build-"));
  const packageRoot = resolve(stagingRoot, PACKAGE_ROOT_NAME);

  try {
    copyEntries(root, packageRoot, entries);
    rmSync(temporaryArtifactPath, { force: true });
    compressDirectory(stagingRoot, temporaryArtifactPath);
    verifyArchive(temporaryArtifactPath);
    rmSync(artifactPath, { force: true });
    renameSync(temporaryArtifactPath, artifactPath);
    return {
      artifactPath,
      entryCount: entries.length,
      size: lstatSync(artifactPath).size,
      version
    };
  } finally {
    rmSync(temporaryArtifactPath, { force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function collectDirectoryEntries(directory, relativeDirectory) {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (isExcludedName(entry.name)) continue;
    const absolutePath = resolve(directory, entry.name);
    const relativePath = normalizeRelativePath(join(relativeDirectory, entry.name));
    if (entry.isSymbolicLink()) {
      throw new Error(`团队安装包不支持符号链接：${relativePath}`);
    }
    if (entry.isDirectory()) {
      entries.push(...collectDirectoryEntries(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile()) entries.push(relativePath);
  }
  return entries;
}

function copyEntries(sourceRoot, packageRoot, entries) {
  for (const entry of entries) {
    const source = resolve(sourceRoot, entry);
    const target = resolve(packageRoot, entry);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { force: true });
  }
}

function compressDirectory(stagingRoot, destination) {
  runPowerShell(
    [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$ErrorActionPreference = 'Stop'",
      "$source = Join-Path $env:AMBER_BUILD_STAGING 'Amber'",
      "$destination = $env:AMBER_BUILD_DESTINATION",
      "Compress-Archive -LiteralPath $source -DestinationPath $destination -Force"
    ].join("; "),
    { AMBER_BUILD_DESTINATION: destination, AMBER_BUILD_STAGING: stagingRoot }
  );
}

function verifyArchive(archivePath) {
  const requiredEntries = REQUIRED_ARCHIVE_ENTRIES.map((entry) => `'${entry}'`).join(",");
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$archive = [System.IO.Compression.ZipFile]::OpenRead($env:AMBER_BUILD_ARCHIVE)",
    "try {",
    "$names = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\\', '/') })",
    `$required = @(${requiredEntries})`,
    "$missing = @($required | Where-Object { $names -notcontains $_ })",
    "if ($missing.Count -gt 0) { throw ('团队安装包缺少文件：' + ($missing -join ', ')) }",
    "$forbidden = @($names | Where-Object { $_ -match '(^|/)(\.claude/|\.cursor/|\.env$|\.env\.local$|\.local/|\.vscode/|node_modules/|\.git/|test/|dist/)' })",
    "if ($forbidden.Count -gt 0) { throw ('团队安装包包含禁止文件：' + ($forbidden -join ', ')) }",
    "} finally { $archive.Dispose() }"
  ].join("\n");
  runPowerShell(script, { AMBER_BUILD_ARCHIVE: archivePath });
}

function runPowerShell(command, extraEnv) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      windowsHide: true
    }
  );
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || "PowerShell 执行失败")
      .replace(/\s+/g, " ")
      .trim();
    throw new Error(detail || "PowerShell 执行失败");
  }
}

function runTests(sourceRoot) {
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: sourceRoot,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error("npm test 未通过，团队安装包未生成。");
  }
}

function readPackageVersion(sourceRoot) {
  const packagePath = resolve(sourceRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (!packageJson.version || !/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(packageJson.version)) {
    throw new Error("package.json 的 version 无效，无法生成安装包名称。");
  }
  return packageJson.version;
}

function assertRegularFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`团队安装包文件缺失：${label}`);
  }
}

function isExcludedName(name) {
  return EXCLUDED_NAMES.has(name) || (name.startsWith(".env") && name !== ".env.example");
}

function normalizeRelativePath(path) {
  return path.replaceAll("\\", "/");
}

function assertWindows() {
  if (process.platform !== "win32") throw new Error("团队安装包构建仅支持 Windows。");
}

if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = runBuild();
    console.log(`Amber 团队安装包已生成：${result.artifactPath}`);
    console.log(`包含 ${result.entryCount} 个文件，大小 ${result.size} 字节。`);
  } catch (error) {
    console.error(`Amber 团队安装包构建失败：${error.message}`);
    process.exitCode = 1;
  }
}

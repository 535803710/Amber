import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  collectTeamPackageEntries,
  normalizeWindowsBatchContent,
  resolveArtifactPath,
  resolveManifestPath
} from "../scripts/build-team-package.mjs";

test("团队安装包只收集运行文件和运行目录", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const entries = collectTeamPackageEntries(repositoryRoot);

  assert.ok(entries.includes("install.bat"));
  assert.ok(entries.includes("uninstall.bat"));
  assert.ok(entries.includes("scripts/team-setup.mjs"));
  assert.ok(entries.includes("scripts/mcp-stdio-server.mjs"));
  assert.ok(entries.includes("docs/团队安装说明.md"));
  assert.equal(
    entries.some((entry) => /(^|\/)(\.claude|\.cursor|\.env|\.env\.local|\.local|\.vscode|node_modules|\.git|test|dist)(\/|$)/.test(entry)),
    false
  );
});

test("团队安装包名称使用 package.json 版本", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  assert.equal(
    resolveArtifactPath(repositoryRoot, "0.1.0"),
    resolve(repositoryRoot, "dist/Amber-team-v0.1.0.zip")
  );
  assert.equal(
    resolveManifestPath(repositoryRoot, "0.1.0"),
    resolve(repositoryRoot, "dist/Amber-team-v0.1.0.manifest.json")
  );
});

test("团队安装包中的批处理脚本使用 Windows 换行", () => {
  const content = normalizeWindowsBatchContent("@echo off\necho 安装\n");

  assert.equal(content, "@echo off\r\necho 安装\r\n");
  assert.equal(/(?<!\r)\n/.test(content), false);
});

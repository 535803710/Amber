import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readPackageVersion, syncTeamRuntime } from "./team-setup.mjs";

const REQUIRED_RUNTIME_ENTRY = "scripts/mcp-stdio-server.mjs";

export function versionsRoot(targetRoot) {
  return resolve(targetRoot, ".local/versions");
}

export function versionStatePath(targetRoot) {
  return resolve(versionsRoot(targetRoot), "state.json");
}

export function readVersionState(targetRoot) {
  try {
    return JSON.parse(readFileSync(versionStatePath(targetRoot), "utf8"));
  } catch {
    return null;
  }
}

export function assertValidRuntimePackage(sourceRoot) {
  if (!existsSync(resolve(sourceRoot, REQUIRED_RUNTIME_ENTRY))) {
    const error = new Error("更新包缺少 scripts/mcp-stdio-server.mjs");
    error.code = "update_invalid_package";
    throw error;
  }
}

export function planUpdate({ currentRoot, nextSource, version } = {}) {
  const current = resolve(currentRoot);
  const source = resolve(nextSource);
  assertValidRuntimePackage(source);
  const previousVersion = readPackageVersion(current) || "current";
  const nextVersion = String(version || readPackageVersion(source) || "next").trim() || "next";
  const backupName = previousVersion === nextVersion ? `${previousVersion}-previous` : previousVersion;
  const backupDir = resolve(versionsRoot(current), backupName);
  const stagingDir = resolve(versionsRoot(current), nextVersion);
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  syncTeamRuntime(current, backupDir);
  syncTeamRuntime(source, stagingDir);
  assertValidRuntimePackage(stagingDir);
  syncTeamRuntime(stagingDir, current);
  writeVersionState(current, {
    version: nextVersion,
    previousVersion: backupName,
    updatedAt: new Date().toISOString()
  });
  return { previousVersion: backupName, version: nextVersion, backupDir, stagingDir };
}

export function rollbackRuntime({ targetRoot } = {}) {
  const current = resolve(targetRoot);
  const state = readVersionState(current);
  const previousVersion = state?.previousVersion;
  if (!previousVersion) {
    const error = new Error("没有可回滚的 Runtime 版本。");
    error.code = "rollback_unavailable";
    throw error;
  }
  const backupDir = resolve(versionsRoot(current), previousVersion);
  assertValidRuntimePackage(backupDir);
  syncTeamRuntime(backupDir, current);
  writeVersionState(current, {
    version: previousVersion,
    previousVersion: state.version,
    rolledBackAt: new Date().toISOString()
  });
  return { version: previousVersion, previousVersion: state.version, backupDir };
}

function writeVersionState(targetRoot, state) {
  mkdirSync(versionsRoot(targetRoot), { recursive: true });
  writeFileSync(versionStatePath(targetRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

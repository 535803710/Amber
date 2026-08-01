#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCommitRecords } from "./lib/commit-records.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

function main() {
  loadEnv(".env");
  loadEnv(".env.local", new Set(["COMMIT_RECORD_SCAN_ROOTS"]));
  const rootDir = readArgument("--root") || ROOT;
  const scanRoot = readArgument("--scan-root") || undefined;
  const result = scanCommitRecords({ rootDir, ...(scanRoot ? { scanRoot } : {}) });
  console.log(JSON.stringify(result));
}

function loadEnv(fileName, overrideKeys = new Set()) {
  const filePath = resolve(ROOT, fileName);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    const index = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key] !== undefined && !overrideKeys.has(key)) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readArgument(name) {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : "";
}

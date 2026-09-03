import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readRuntimeConfig({ rootDir, keys, env = process.env }) {
  const selected = new Set(keys);
  const values = {};
  for (const key of selected) {
    if (env[key] !== undefined) values[key] = env[key];
  }
  loadEnvValues(resolve(rootDir, ".env"), selected, values, false);
  loadEnvValues(resolve(rootDir, ".env.local"), selected, values, true);
  return values;
}

function loadEnvValues(filePath, keys, values, override) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (!keys.has(key) || (!override && values[key] !== undefined)) continue;
    values[key] = unquote(trimmed.slice(index + 1).trim());
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

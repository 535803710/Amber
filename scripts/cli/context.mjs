import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function resolveAmberRoot({ flags = {}, env = process.env, cwd = process.cwd() } = {}) {
  if (flags.target) return resolve(flags.target);
  if (env.AMBER_HOME?.trim()) return resolve(env.AMBER_HOME.trim());
  if (isAmberRoot(cwd)) return resolve(cwd);
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) return resolve(localAppData, "Amber");
  return resolve(cwd);
}

export function resolveUserHome({ flags = {}, env = process.env } = {}) {
  if (flags.userHome) return resolve(flags.userHome);
  if (env.USERPROFILE?.trim()) return resolve(env.USERPROFILE.trim());
  if (env.HOME?.trim()) return resolve(env.HOME.trim());
  return resolve(homedir());
}

export function isAmberRoot(root) {
  return existsSync(resolve(root, "scripts/mcp-stdio-server.mjs"));
}

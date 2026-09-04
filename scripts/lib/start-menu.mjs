import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const START_MENU_SHORTCUT_NAME = "Amber 控制台.cmd";

const defaultIo = { existsSync, mkdirSync, rmSync, writeFileSync };

export function resolveStartMenuDir(userHome) {
  return resolve(userHome, "AppData/Roaming/Microsoft/Windows/Start Menu/Programs");
}

export function startMenuShortcutPath(userHome, startMenuDir) {
  return resolve(startMenuDir || resolveStartMenuDir(userHome), START_MENU_SHORTCUT_NAME);
}

export function installStartMenuShortcut({
  targetRoot,
  userHome,
  platform = process.platform,
  startMenuDir,
  io = defaultIo
} = {}) {
  if (platform !== "win32") return { skipped: true, path: null };
  const directory = startMenuDir || resolveStartMenuDir(userHome);
  const path = resolve(directory, START_MENU_SHORTCUT_NAME);
  io.mkdirSync(directory, { recursive: true });
  const bat = resolve(targetRoot, "amber.bat");
  io.writeFileSync(path, `@echo off\r\ncall "${bat}" open\r\n`, "utf8");
  return { skipped: false, path };
}

export function uninstallStartMenuShortcut({
  userHome,
  platform = process.platform,
  startMenuDir,
  io = defaultIo
} = {}) {
  if (platform !== "win32") return { skipped: true, path: null };
  const path = startMenuShortcutPath(userHome, startMenuDir);
  const existed = io.existsSync(path);
  if (existed) io.rmSync(path, { force: true });
  return { skipped: false, removed: existed, path };
}

export function inspectStartMenuShortcut({
  userHome,
  platform = process.platform,
  startMenuDir,
  io = defaultIo
} = {}) {
  if (platform !== "win32") return { skipped: true, installed: false, path: null };
  const path = startMenuShortcutPath(userHome, startMenuDir);
  return { skipped: false, installed: io.existsSync(path), path };
}

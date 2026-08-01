import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_SETTINGS = {
  notifyOnDone: true,
  notifyOnWait: true,
  notifyOnInfo: true,
  healthAlertsEnabled: true
};

export function getSettingsPath(rootDir = process.cwd()) {
  return resolve(rootDir, ".local/settings.json");
}

export function readSettings(rootDir = process.cwd()) {
  const filePath = getSettingsPath(rootDir);
  if (!existsSync(filePath)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      notifyOnDone: data.notifyOnDone !== false,
      notifyOnWait: data.notifyOnWait !== false,
      notifyOnInfo: data.notifyOnInfo === true,
      healthAlertsEnabled: data.healthAlertsEnabled !== false
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings, rootDir = process.cwd()) {
  const filePath = getSettingsPath(rootDir);
  const next = {
    notifyOnDone: settings.notifyOnDone !== false,
    notifyOnWait: settings.notifyOnWait !== false,
    notifyOnInfo: settings.notifyOnInfo === true,
    healthAlertsEnabled: settings.healthAlertsEnabled !== false
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function shouldNotifyForStatus(status, rootDir = process.cwd()) {
  const settings = readSettings(rootDir);

  if (status === "done") {
    return settings.notifyOnDone;
  }
  if (status === "wait" || status === "ask") {
    return settings.notifyOnWait;
  }
  if (status === "info") {
    return settings.notifyOnInfo;
  }

  return true;
}

export { DEFAULT_SETTINGS };

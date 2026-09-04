import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export function amberSkillSource(sourceRoot) {
  return resolve(sourceRoot, "skills/amber");
}

export function amberSkillDestination(userHome) {
  return resolve(userHome, ".agents/skills/amber");
}

export function installAmberSkill({ sourceRoot, userHome }) {
  const source = amberSkillSource(sourceRoot);
  const dest = amberSkillDestination(userHome);
  if (!existsSync(source)) {
    return { installed: false, skipped: true, path: dest };
  }
  mkdirSync(dest, { recursive: true });
  const skillMd = resolve(source, "SKILL.md");
  if (existsSync(skillMd)) cpSync(skillMd, resolve(dest, "SKILL.md"), { force: true });
  const references = resolve(source, "references");
  if (existsSync(references)) {
    cpSync(references, resolve(dest, "references"), { recursive: true, force: true });
  }
  return { installed: true, skipped: false, path: dest };
}

export function uninstallAmberSkill({ userHome }) {
  const dest = amberSkillDestination(userHome);
  const existed = existsSync(dest);
  rmSync(dest, { recursive: true, force: true });
  return { removed: existed, path: dest };
}

export function inspectAmberSkill({ userHome }) {
  const dest = amberSkillDestination(userHome);
  return {
    installed: existsSync(resolve(dest, "SKILL.md")),
    path: dest,
    hasReferences: existsSync(resolve(dest, "references"))
  };
}

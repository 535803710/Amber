import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  inspectAmberSkill,
  installAmberSkill,
  uninstallAmberSkill
} from "../scripts/lib/skill-install.mjs";

test("Skill 安装到用户目录并覆盖且幂等", () => {
  const root = fixture();
  try {
    const first = installAmberSkill({ sourceRoot: root.source, userHome: root.home });
    assert.equal(first.installed, true);
    assert.equal(readFileSync(resolve(root.home, ".agents/skills/amber/SKILL.md"), "utf8"), "# Amber v1\n");
    assert.equal(
      readFileSync(resolve(root.home, ".agents/skills/amber/references/onboarding.md"), "utf8"),
      "start\n"
    );

    writeText(resolve(root.source, "skills/amber/SKILL.md"), "# Amber v2\n");
    writeText(resolve(root.source, "skills/amber/references/troubleshooting.md"), "fix\n");
    const second = installAmberSkill({ sourceRoot: root.source, userHome: root.home });
    assert.equal(second.installed, true);
    assert.equal(readFileSync(resolve(root.home, ".agents/skills/amber/SKILL.md"), "utf8"), "# Amber v2\n");
    assert.equal(readFileSync(resolve(root.home, ".agents/skills/amber/references/troubleshooting.md"), "utf8"), "fix\n");
    assert.deepEqual(inspectAmberSkill({ userHome: root.home }), {
      installed: true,
      path: resolve(root.home, ".agents/skills/amber"),
      hasReferences: true
    });

    const third = installAmberSkill({ sourceRoot: root.source, userHome: root.home });
    assert.equal(third.installed, true);
    assert.equal(readFileSync(resolve(root.home, ".agents/skills/amber/SKILL.md"), "utf8"), "# Amber v2\n");
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("卸载只删除 amber skill，不影响其它 skill", () => {
  const root = fixture();
  try {
    installAmberSkill({ sourceRoot: root.source, userHome: root.home });
    writeText(resolve(root.home, ".agents/skills/other/SKILL.md"), "# keep\n");
    const removed = uninstallAmberSkill({ userHome: root.home });
    assert.equal(removed.removed, true);
    assert.equal(existsSync(resolve(root.home, ".agents/skills/amber")), false);
    assert.equal(readFileSync(resolve(root.home, ".agents/skills/other/SKILL.md"), "utf8"), "# keep\n");
    assert.equal(inspectAmberSkill({ userHome: root.home }).installed, false);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("源 Skill 不存在时安装跳过且不创建目录", () => {
  const root = fixture();
  try {
    rmSync(resolve(root.source, "skills"), { recursive: true, force: true });
    const result = installAmberSkill({ sourceRoot: root.source, userHome: root.home });
    assert.equal(result.skipped, true);
    assert.equal(existsSync(resolve(root.home, ".agents/skills/amber")), false);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

function fixture() {
  const base = mkdtempSync(resolve(tmpdir(), "amber-skill-"));
  const source = resolve(base, "source");
  const home = resolve(base, "home");
  writeText(resolve(source, "skills/amber/SKILL.md"), "# Amber v1\n");
  writeText(resolve(source, "skills/amber/references/onboarding.md"), "start\n");
  return { base, source, home };
}

function writeText(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}

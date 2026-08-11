import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("notify-ask 跳过 Bash 工具标签并保留真实问题通知", () => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-notify-ask-"));
  const marker = resolve(base, "status-called.txt");
  const pending = resolve(base, ".local/pending-ask-notify.json");
  const script = resolve(import.meta.dirname, "../scripts/notify-ask.mjs");
  const env = { ...process.env, AMBER_HOME: base };
  try {
    mkdirSync(resolve(base, "scripts"), { recursive: true });
    writeFileSync(
      resolve(base, "scripts/status.mjs"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join("\\n"));\n`,
      "utf8"
    );

    const ignored = spawnSync(process.execPath, [script, "Bash"], { encoding: "utf8", env });
    assert.equal(ignored.status, 0, ignored.stderr || ignored.stdout);
    assert.match(ignored.stdout, /Notification skipped: Bash/);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(pending), false);

    const actionable = spawnSync(process.execPath, [script, "请选择代码审核类型"], {
      encoding: "utf8",
      env
    });
    assert.equal(actionable.status, 0, actionable.stderr || actionable.stdout);
    assert.match(readFileSync(marker, "utf8"), /wait\n\[需要操作\] 请选择代码审核类型/);
    assert.equal(JSON.parse(readFileSync(pending, "utf8")).summary, "请选择代码审核类型");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

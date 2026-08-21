import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("PermissionRequest 缺少审批说明时不按工具名发送通知", () => {
  const script = resolve(import.meta.dirname, "../scripts/hooks/on-codex-event.mjs");
  const result = spawnSync(process.execPath, [script, "--event", "PermissionRequest"], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "apply_patch" })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "{}\n");
});

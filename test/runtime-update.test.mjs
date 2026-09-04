import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  planUpdate,
  readVersionState,
  rollbackRuntime
} from "../scripts/lib/runtime-update.mjs";

test("planUpdate 备份当前版本并切换到新包", () => {
  const root = fixture();
  try {
    writeRuntime(root.current, "1.0.0", "v1");
    writeRuntime(root.next, "1.1.0", "v2");
    const planned = planUpdate({
      currentRoot: root.current,
      nextSource: root.next,
      version: "1.1.0"
    });
    assert.equal(planned.previousVersion, "1.0.0");
    assert.equal(planned.version, "1.1.0");
    assert.equal(readFileSync(resolve(root.current, "scripts/marker.txt"), "utf8"), "v2");
    assert.equal(readFileSync(resolve(root.current, ".local/versions/1.0.0/scripts/marker.txt"), "utf8"), "v1");
    assert.equal(readVersionState(root.current).version, "1.1.0");
    assert.ok(existsSync(resolve(root.current, "scripts/mcp-stdio-server.mjs")));
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("无效更新包不切换当前 Runtime", () => {
  const root = fixture();
  try {
    writeRuntime(root.current, "1.0.0", "v1");
    mkdirSync(resolve(root.next, "scripts"), { recursive: true });
    writeFileSync(resolve(root.next, "package.json"), JSON.stringify({ version: "9.9.9" }) + "\n");
    assert.throws(
      () => planUpdate({ currentRoot: root.current, nextSource: root.next, version: "9.9.9" }),
      (error) => error.code === "update_invalid_package"
    );
    assert.equal(readFileSync(resolve(root.current, "scripts/marker.txt"), "utf8"), "v1");
    assert.equal(readVersionState(root.current), null);
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

test("rollbackRuntime 恢复上一版本", () => {
  const root = fixture();
  try {
    writeRuntime(root.current, "1.0.0", "v1");
    writeRuntime(root.next, "1.1.0", "v2");
    planUpdate({ currentRoot: root.current, nextSource: root.next, version: "1.1.0" });
    const rolled = rollbackRuntime({ targetRoot: root.current });
    assert.equal(rolled.version, "1.0.0");
    assert.equal(readFileSync(resolve(root.current, "scripts/marker.txt"), "utf8"), "v1");
    assert.equal(readVersionState(root.current).version, "1.0.0");
  } finally {
    rmSync(root.base, { recursive: true, force: true });
  }
});

function fixture() {
  const base = mkdtempSync(resolve(tmpdir(), "amber-runtime-update-"));
  return {
    base,
    current: resolve(base, "current"),
    next: resolve(base, "next")
  };
}

function writeRuntime(root, version, marker) {
  mkdirSync(resolve(root, "scripts"), { recursive: true });
  writeFileSync(resolve(root, "scripts/mcp-stdio-server.mjs"), `export const version = "${version}";\n`);
  writeFileSync(resolve(root, "scripts/marker.txt"), marker);
  writeFileSync(resolve(root, "package.json"), `${JSON.stringify({ version })}\n`);
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runAmberCli } from "../scripts/cli/main.mjs";
import { parseCliArgs } from "../scripts/cli/parse-args.mjs";
import { resolveAmberRoot } from "../scripts/cli/context.mjs";

test("解析全局 JSON、target 和命令额外选项", () => {
  const parsed = parseCliArgs([
    "space", "connect", "https://example.feishu.cn/base/ABC",
    "--json", "--target", "D:/Amber", "--ai-webhook", "https://hook.example/ai"
  ]);
  assert.equal(parsed.command, "space");
  assert.equal(parsed.subcommand, "connect");
  assert.deepEqual(parsed.args, ["https://example.feishu.cn/base/ABC"]);
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags.target, "D:/Amber");
  assert.equal(parsed.extras["ai-webhook"], "https://hook.example/ai");
  assert.throws(() => parseCliArgs(["doctor", "-x"]), /未知选项/);
  assert.throws(() => parseCliArgs(["space", "--target"]), /需要一个路径参数/);
});

test("未知命令返回 failed 和退出码 1", async () => {
  const { result, exitCode } = await runAmberCli(["nope", "--json"], {
    stdout: { write() {} }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "unknown_command");
  assert.equal(exitCode, 1);
});

test("help 返回 ok 和退出码 0", async () => {
  const { result, exitCode } = await runAmberCli(["--help"], {
    stdout: { write() {} }
  });
  assert.equal(result.status, "ok");
  assert.equal(result.code, "help");
  assert.equal(exitCode, 0);
  assert.match(result.message, /amber space/);
});

test("优先使用 --target，其次 AMBER_HOME，源码目录可识别为 Amber 根", () => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-cli-root-"));
  try {
    const source = resolve(base, "source");
    mkdirSync(resolve(source, "scripts"), { recursive: true });
    writeFileSync(resolve(source, "scripts/mcp-stdio-server.mjs"), "export {}\n");
    assert.equal(
      resolveAmberRoot({ flags: { target: resolve(base, "x") }, cwd: source }),
      resolve(base, "x")
    );
    assert.equal(
      resolveAmberRoot({ flags: {}, env: { AMBER_HOME: resolve(base, "home") }, cwd: source }),
      resolve(base, "home")
    );
    assert.equal(resolveAmberRoot({ flags: {}, env: {}, cwd: source }), source);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

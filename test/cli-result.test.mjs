import test from "node:test";
import assert from "node:assert/strict";

import {
  CLI_EXIT_CODES,
  exitCodeFor,
  formatCliResult,
  printCliResult,
  redactCliText
} from "../scripts/lib/cli-result.mjs";

test("CLI 结果契约固定 status/code/message/actions/data", () => {
  const result = formatCliResult({
    status: "needs_action",
    code: "webhook_missing",
    message: "请粘贴两个 Webhook 地址",
    actions: ["打开工作流页面"],
    data: { tables: 2 }
  });
  assert.deepEqual(result, {
    status: "needs_action",
    code: "webhook_missing",
    message: "请粘贴两个 Webhook 地址",
    actions: ["打开工作流页面"],
    data: { tables: 2 }
  });
  assert.equal(exitCodeFor(result), CLI_EXIT_CODES.needs_action);
  assert.equal(exitCodeFor({ status: "ok" }), 0);
  assert.equal(exitCodeFor({ status: "failed" }), 1);
});

test("未知 status 回退为 failed，并脱敏 token 与 webhook", () => {
  const result = formatCliResult({
    status: "weird",
    message: "token=abc123 webhook=https://open.feishu.cn/open-apis/bot/v2/hook/secret"
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "failed");
  assert.match(result.message, /\[redacted\]/);
  assert.doesNotMatch(result.message, /abc123/);
  assert.equal(redactCliText("Authorization: Bearer secret-value"), "[redacted]");
});

test("文本输出打印 message 与 actions，JSON 输出完整契约", () => {
  const chunks = [];
  printCliResult({
    status: "ok",
    code: "ok",
    message: "已连接空间",
    actions: ["执行 amber project add"]
  }, {
    stdout: { write(value) { chunks.push(value); } }
  });
  assert.equal(chunks.join(""), "已连接空间\n- 执行 amber project add\n");

  const jsonChunks = [];
  printCliResult({
    status: "failed",
    code: "space_missing",
    message: "尚未连接 Amber 空间"
  }, {
    json: true,
    stdout: { write(value) { jsonChunks.push(value); } }
  });
  const parsed = JSON.parse(jsonChunks.join(""));
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.code, "space_missing");
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.data, {});
});

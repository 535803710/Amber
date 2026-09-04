import test from "node:test";
import assert from "node:assert/strict";

import {
  createLarkSpaceIo,
  parseCopiedBase,
  unwrapData
} from "../scripts/lib/space-lark-io.mjs";

test("解析模板复制返回的 Base token 和公司域 URL", () => {
  const copied = parseCopiedBase({
    ok: true,
    data: {
      base: {
        base_token: "copiedToken",
        url: "https://transsioner.feishu.cn/base/copiedToken"
      }
    }
  }, { templateUrl: "https://transsioner.feishu.cn/base/JDHxbOPw9aBWrQskKBRcw911nPI" });
  assert.equal(copied.baseToken, "copiedToken");
  assert.equal(copied.baseUrl, "https://transsioner.feishu.cn/base/copiedToken");
  assert.equal(
    parseCopiedBase({ data: { app_token: "app1" } }, {
      templateUrl: "https://transsioner.feishu.cn/base/x"
    }).baseUrl,
    "https://transsioner.feishu.cn/base/app1"
  );
});

test("lark io 用注入的 runLark 复制模板、列表并启用未开启的工作流", async () => {
  const calls = [];
  const io = createLarkSpaceIo({
    template: {
      templateToken: "JDHxbOPw9aBWrQskKBRcw911nPI",
      copyName: "Amber 空间",
      timeZone: "Asia/Shanghai",
      templateUrl: "https://transsioner.feishu.cn/base/JDHxbOPw9aBWrQskKBRcw911nPI"
    },
    runLark: async (args) => {
      calls.push(args);
      const command = args[1];
      if (command === "+base-copy") {
        return {
          ok: true,
          data: { base: { base_token: "newBase", url: "https://transsioner.feishu.cn/base/newBase" } }
        };
      }
      if (command === "+workflow-list") {
        return {
          data: {
            items: [
              { workflow_id: "wkf1", title: "VibeCoding修改记录修改工作流", status: "disabled" },
              { workflow_id: "wkf2", title: "Git提交工作流", status: "enabled" }
            ]
          }
        };
      }
      if (command === "+workflow-enable") return { ok: true };
      if (command === "+table-list") {
        return {
          data: {
            tables: [
              { id: "tbl_ai", name: "VibeCoding修改记录" },
              { id: "tbl_git", name: "Git提交记录" }
            ]
          }
        };
      }
      if (command === "+field-list") {
        return { data: { fields: [{ name: "事件 ID", type: "text" }] } };
      }
      throw new Error(`unexpected ${command}`);
    }
  });

  const copied = await io.copyTemplate({});
  assert.equal(copied.baseToken, "newBase");
  assert.ok(calls.some((args) => args.includes("+base-copy") && args.includes("JDHxbOPw9aBWrQskKBRcw911nPI")));
  assert.ok(calls.some((args) => args.includes("+workflow-enable") && args.includes("wkf1")));
  assert.equal(calls.filter((args) => args.includes("+workflow-enable")).length, 1);

  const tables = await io.listTables({ baseToken: "newBase" });
  assert.deepEqual(tables.map((item) => item.name), ["VibeCoding修改记录", "Git提交记录"]);
  const fields = await io.listFields({ baseToken: "newBase", tableId: "tbl_ai" });
  assert.equal(fields[0].name, "事件 ID");
});

test("模板复制遇到异步 copying 错误时自动重试", async () => {
  let copyCalls = 0;
  const delays = [];
  const io = createLarkSpaceIo({
    template: {
      templateToken: "JDHxbOPw9aBWrQskKBRcw911nPI",
      copyName: "Amber 空间",
      templateUrl: "https://transsioner.feishu.cn/base/JDHxbOPw9aBWrQskKBRcw911nPI"
    },
    sleep: async (ms) => { delays.push(ms); },
    runLark: async (args) => {
      if (args[1] === "+base-copy") {
        copyCalls += 1;
        if (copyCalls === 1) {
          throw new Error("{ \"ok\": false, \"error\": { \"code\": 800004046, \"message\": \"base is copying, please try again\" } }");
        }
        return {
          ok: true,
          data: { base: { base_token: "retriedBase", url: "https://transsioner.feishu.cn/base/retriedBase" } }
        };
      }
      if (args[1] === "+workflow-list") return { data: { items: [] } };
      throw new Error(`unexpected ${args[1]}`);
    }
  });

  const copied = await io.copyTemplate({});
  assert.equal(copied.baseToken, "retriedBase");
  assert.equal(copyCalls, 2);
  assert.deepEqual(delays, [3000]);
});

test("unwrapData 兼容 data 包络和裸对象", () => {
  assert.deepEqual(unwrapData({ data: { tables: [1] } }), { tables: [1] });
  assert.deepEqual(unwrapData({ tables: [1] }), { tables: [1] });
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { run } from "../scripts/cli/commands/space.mjs";
import { runAmberCli } from "../scripts/cli/main.mjs";
import {
  AI_TABLE_NAME,
  GIT_TABLE_NAME,
  loadSpaceTemplate
} from "../scripts/lib/schema-fingerprint.mjs";
import {
  SPACE_CODES,
  parseBaseUrl,
  readSpaceState,
  spaceStatePath
} from "../scripts/lib/space.mjs";

test("init 默认使用冻结模板 token 复制空间", async () => {
  const root = tempRoot();
  try {
    const io = createIo();
    const result = await run(request(root, {
      subcommand: "init",
      io
    }));
    assert.equal(result.status, "needs_action");
    assert.equal(result.code, SPACE_CODES.webhookSetupRequired);
    assert.equal(io.calls.copyTemplate, 1);
    assert.equal(io.calls.templateToken, loadSpaceTemplate().templateToken);
    assert.equal(readSpaceState(root).aiTableId, "tbl_ai");
  } finally {
    cleanup(root);
  }
});

test("init 复制后识别两张表并写入 space.json，重复 init 不复制模板", async () => {
  const root = tempRoot();
  try {
    writeFileSync(resolve(root, ".env.local"), "KEEP_ME=1\n", "utf8");
    const io = createIo();
    const first = await run(request(root, {
      subcommand: "init",
      extras: { "template-token": "tpl-token" },
      io
    }));
    assert.equal(first.status, "needs_action");
    assert.equal(first.code, SPACE_CODES.webhookSetupRequired);
    assert.equal(io.calls.copyTemplate, 1);
    assert.ok(Array.isArray(first.data.workflowHints));
    assert.equal(first.data.workflowHints.length, 2);

    const state = readSpaceState(root);
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.baseToken, "base_token_1");
    assert.equal(state.aiTableId, "tbl_ai");
    assert.equal(state.commitTableId, "tbl_git");
    assert.equal(state.webhooksVerified, false);

    const envLocal = readFileSync(resolve(root, ".env.local"), "utf8");
    assert.match(envLocal, /KEEP_ME=1/);
    assert.match(envLocal, /AMBER_BASE_TOKEN=base_token_1/);
    assert.match(envLocal, /AMBER_AI_TABLE_ID=tbl_ai/);
    assert.match(envLocal, /AMBER_COMMIT_TABLE_ID=tbl_git/);
    assert.doesNotMatch(envLocal, /FEISHU_CHANGE_WEBHOOK_URL=https?:/);

    const second = await run(request(root, {
      subcommand: "init",
      extras: { "template-token": "tpl-token" },
      io
    }));
    assert.equal(second.code, SPACE_CODES.webhookSetupRequired);
    assert.equal(io.calls.copyTemplate, 1);
  } finally {
    cleanup(root);
  }
});

test("connect 解析 Base URL，wiki 路径失败", async () => {
  const parsed = parseBaseUrl("https://example.feishu.cn/base/ABC123?table=tblx");
  assert.deepEqual(parsed, {
    baseToken: "ABC123",
    baseUrl: "https://example.feishu.cn/base/ABC123"
  });
  assert.equal(parseBaseUrl("https://example.feishu.cn/wiki/DOC"), null);
  assert.equal(parseBaseUrl("not-a-url"), null);

  const root = tempRoot();
  try {
    const invalid = await run(request(root, {
      subcommand: "connect",
      args: ["https://example.feishu.cn/wiki/DOC"],
      io: createIo()
    }));
    assert.equal(invalid.status, "failed");
    assert.equal(invalid.code, SPACE_CODES.invalidBaseUrl);

    const io = createIo({
      copyTemplate: async () => {
        throw new Error("connect 不应复制模板");
      }
    });
    const connected = await run(request(root, {
      subcommand: "connect",
      args: ["https://example.feishu.cn/base/ABC123"],
      io
    }));
    assert.equal(connected.status, "needs_action");
    assert.equal(connected.code, SPACE_CODES.webhookSetupRequired);
    const state = readSpaceState(root);
    assert.equal(state.baseToken, "ABC123");
    assert.equal(state.aiTableId, "tbl_ai");
  } finally {
    cleanup(root);
  }
});

test("双 webhook 2xx 且 findRecord 成功后空间就绪", async () => {
  const root = tempRoot();
  try {
    const posted = [];
    const io = createIo({
      postWebhook: async (url, payload, token) => {
        posted.push({ url, payload, token });
        return { status: 200, body: { ok: true } };
      },
      findRecord: async ({ eventId }) => ({ id: `rec-${eventId}` })
    });
    const result = await run(request(root, {
      subcommand: "init",
      extras: {
        "template-token": "tpl-token",
        "ai-webhook": "https://hooks.test/ai",
        "git-webhook": "https://hooks.test/git"
      },
      io
    }));
    assert.equal(result.status, "ok");
    assert.equal(result.code, SPACE_CODES.spaceReady);
    assert.equal(result.data.configured, true);
    assert.equal(result.data.aiWebhookConfigured, true);
    assert.doesNotMatch(JSON.stringify(result), /hooks\.test/);

    assert.equal(posted.length, 2);
    assert.equal(posted[0].payload.setup_test, true);
    assert.ok(posted[0].payload["事件 ID"] || posted[0].payload.event_id);
    assert.equal(posted[1].payload.setup_test, true);
    assert.ok(posted[1].payload.事件ID || posted[1].payload.event_id);

    const state = readSpaceState(root);
    assert.equal(state.webhooksVerified, true);
    assert.equal(state.aiWebhookUrl, "https://hooks.test/ai");
    const envLocal = readFileSync(resolve(root, ".env.local"), "utf8");
    assert.match(envLocal, /FEISHU_CHANGE_WEBHOOK_URL=https:\/\/hooks\.test\/ai/);
    assert.match(envLocal, /FEISHU_COMMIT_WEBHOOK_URL=https:\/\/hooks\.test\/git/);
  } finally {
    cleanup(root);
  }
});

test("Webhook HTTP 非 2xx 返回 failed，不写入 webhook", async () => {
  const root = tempRoot();
  try {
    const io = createIo({
      postWebhook: async () => ({ status: 500, body: "nope" })
    });
    const result = await run(request(root, {
      subcommand: "connect",
      args: ["https://example.feishu.cn/base/XYZ"],
      extras: {
        "ai-webhook": "https://hooks.test/ai",
        "git-webhook": "https://hooks.test/git"
      },
      io
    }));
    assert.equal(result.status, "failed");
    assert.equal(result.code, SPACE_CODES.webhookHttpFailed);
    const envLocal = existsSync(resolve(root, ".env.local"))
      ? readFileSync(resolve(root, ".env.local"), "utf8")
      : "";
    assert.doesNotMatch(envLocal, /FEISHU_CHANGE_WEBHOOK_URL=https:\/\/hooks\.test/);
    assert.equal(readSpaceState(root)?.webhooksVerified, false);
  } finally {
    cleanup(root);
  }
});

test("只提供一个 webhook 返回 webhook_incomplete；找不到记录则失败", async () => {
  const root = tempRoot();
  try {
    const incomplete = await run(request(root, {
      subcommand: "init",
      extras: {
        "template-token": "tpl-token",
        "ai-webhook": "https://hooks.test/ai"
      },
      io: createIo()
    }));
    assert.equal(incomplete.status, "needs_action");
    assert.equal(incomplete.code, SPACE_CODES.webhookIncomplete);

    const missing = await run(request(root, {
      subcommand: "status",
      extras: {
        "ai-webhook": "https://hooks.test/ai",
        "git-webhook": "https://hooks.test/git"
      },
      io: createIo({
        postWebhook: async () => ({ status: 201, body: {} }),
        findRecord: async () => null
      })
    }));
    assert.equal(missing.status, "failed");
    assert.equal(missing.code, SPACE_CODES.webhookRecordMissing);
  } finally {
    cleanup(root);
  }
});

test("status 未初始化、就绪态脱敏，额外字段不阻塞", async () => {
  const root = tempRoot();
  try {
    const missing = await run(request(root, { subcommand: "status", io: createIo() }));
    assert.equal(missing.status, "needs_action");
    assert.equal(missing.code, SPACE_CODES.spaceMissing);

    const extraIo = createIo({
      listFields: async ({ tableId }) => {
        const fields = tableFields(tableId);
        return tableId === "tbl_git"
          ? [...fields, { name: "备注", type: "text" }]
          : fields;
      }
    });
    const inited = await run(request(root, {
      subcommand: "init",
      extras: { "template-token": "tpl-token" },
      io: extraIo
    }));
    assert.equal(inited.status, "needs_action");
    assert.equal(inited.code, SPACE_CODES.webhookSetupRequired);
    assert.ok(inited.data.extraFields.includes(`${GIT_TABLE_NAME}.备注`));

    const secret = "https://open.feishu.cn/open-apis/bot/v2/hook/super-secret-token";
    const state = readSpaceState(root);
    writeFileSync(spaceStatePath(root), `${JSON.stringify({
      ...state,
      aiWebhookUrl: secret,
      gitWebhookUrl: secret,
      webhooksVerified: true,
      baseToken: "tok_LIVE_SECRET_abc"
    }, null, 2)}\n`, "utf8");
    writeFileSync(resolve(root, ".env.local"), [
      "AMBER_BASE_TOKEN=tok_LIVE_SECRET_abc",
      `FEISHU_CHANGE_WEBHOOK_URL=${secret}`,
      `FEISHU_COMMIT_WEBHOOK_URL=${secret}`
    ].join("\n"), "utf8");

    const status = await run(request(root, {
      subcommand: "status",
      io: extraIo
    }));
    assert.equal(status.status, "ok");
    assert.equal(status.code, SPACE_CODES.spaceReady);
    const dumped = JSON.stringify(status);
    assert.doesNotMatch(dumped, /super-secret-token/);
    assert.doesNotMatch(dumped, /tok_LIVE_SECRET_abc/);
    assert.equal(status.data.aiWebhookConfigured, true);
    assert.equal(status.data.gitWebhookConfigured, true);
    assert.equal(status.data.configured, true);
  } finally {
    cleanup(root);
  }
});

test("CLI 路由器把注入的 io 传给 space init", async () => {
  const root = tempRoot();
  try {
    const io = createIo();
    const { result, exitCode } = await runAmberCli(
      ["space", "init", "--json", "--target", root, "--template-token", "tpl-token"],
      { stdout: { write() {} }, cwd: root, io }
    );
    assert.equal(result.status, "needs_action");
    assert.equal(result.code, SPACE_CODES.webhookSetupRequired);
    assert.equal(exitCode, 2);
    assert.equal(io.calls.copyTemplate, 1);
    assert.equal(readSpaceState(root).aiTableId, "tbl_ai");
  } finally {
    cleanup(root);
  }
});

function request(targetRoot, { subcommand, args = [], extras = {}, env = {}, io, flags = {} }) {
  return {
    command: "space",
    subcommand,
    rest: [subcommand, ...args],
    args,
    positional: ["space", subcommand, ...args],
    flags,
    extras,
    env,
    cwd: targetRoot,
    targetRoot,
    userHome: targetRoot,
    io
  };
}

function createIo(overrides = {}) {
  const calls = { copyTemplate: 0, openUrl: [], templateToken: "" };
  const io = {
    async copyTemplate({ templateToken } = {}) {
      calls.copyTemplate += 1;
      calls.templateToken = templateToken;
      return {
        baseToken: "base_token_1",
        baseUrl: "https://example.feishu.cn/base/base_token_1"
      };
    },
    async listTables({ baseToken }) {
      return [
        { id: "tbl_ai", name: AI_TABLE_NAME },
        { id: "tbl_git", name: GIT_TABLE_NAME },
        { id: "tbl_extra", name: "其他表", baseToken }
      ];
    },
    async listFields({ tableId }) {
      return tableFields(tableId);
    },
    async openUrl(url) {
      calls.openUrl.push(url);
    },
    async postWebhook() {
      return { status: 200, body: {} };
    },
    ...overrides
  };
  io.calls = calls;
  return io;
}

function tableFields(tableId) {
  const template = loadSpaceTemplate();
  const name = tableId === "tbl_git" ? GIT_TABLE_NAME : AI_TABLE_NAME;
  return template.tables.find((table) => table.name === name).fields;
}

function tempRoot() {
  return mkdtempSync(resolve(tmpdir(), "amber-space-"));
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

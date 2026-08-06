import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  AI_TABLE_ID,
  COMMIT_TABLE_ID,
  QUERY_LIMIT,
  buildRecordListArgs,
  getTaskContext,
  mapRemoteRecords,
  parseRecords
} from "../scripts/lib/task-context.mjs";

const WORKSPACE = "D:/project/Amber";

test("飞书双表查询按项目过滤、投影字段、排序并限制到 200 条", () => {
  const aiArgs = buildRecordListArgs({
    tableId: AI_TABLE_ID,
    fields: ["用户需求", "项目"],
    project: "Amber",
    sortField: "完成时间"
  });
  assert.deepEqual(JSON.parse(valueAfter(aiArgs, "--filter-json")), {
    logic: "and",
    conditions: [["项目", "==", "Amber"]]
  });
  assert.deepEqual(JSON.parse(valueAfter(aiArgs, "--sort-json")), [{ field: "完成时间", desc: true }]);
  assert.equal(valueAfter(aiArgs, "--limit"), String(QUERY_LIMIT));
  assert.equal(valueAfter(aiArgs, "--as"), "user");
  assert.equal(aiArgs.filter((item) => item === "--field-id").length, 2);
});

test("compact 输出以 AI 修改为主并嵌套强关联提交", async () => {
  const calls = [];
  const result = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "实现 MCP 双表查询",
    files: ["scripts/mcp-stdio-server.mjs"],
    detail: "compact"
  }, {
    now: 1,
    runCommand: async (args) => {
      calls.push(args);
      return args.includes(AI_TABLE_ID)
        ? JSON.stringify({ data: { items: [{ record_id: "ai-row", fields: {
          "事件 ID": "ai-1",
          "用户需求": "实现 MCP 双表查询",
          "修改结果": "新增 stdio 服务",
          "项目": "Amber",
          "仓库路径": WORKSPACE,
          "分支": "main",
          "修改文件": "scripts/mcp-stdio-server.mjs",
          "完成时间": "2026-08-04T09:00:00.000Z",
          "作者邮箱": "private@example.com",
          "会话 ID": "private-session"
        } }] } })
        : JSON.stringify({ data: { items: [{ record_id: "commit-row", fields: {
          "提交 SHA": "commit-1",
          "提交信息": "feat: add task context MCP",
          "项目": "Amber",
          "仓库路径": WORKSPACE,
          "分支": "main",
          "修改文件": "scripts/mcp-stdio-server.mjs",
          "提交时间": "2026-08-04T10:00:00.000Z",
          "关联 AI 事件": ["ai-1"]
        } }] } });
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(result.schema_version, 2);
  assert.equal(result.status, "ok");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].kind, "ai_change");
  assert.deepEqual(result.evidence[0].related_commits, [{
    sha: "commit-1",
    subject: "feat: add task context MCP",
    occurred_at: "2026-08-04T10:00:00.000Z"
  }]);
  assert.equal("timeline" in result, false);
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
  assert.equal(JSON.stringify(result).includes("private-session"), false);
});

test("minimal 默认最多返回 3 条且只暴露需求、结果和文件", async () => {
  const result = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "优化 MCP 输出",
    files: ["scripts/lib/task-context.mjs"]
  }, {
    now: 11,
    runCommand: async (args) => JSON.stringify({ data: { items: args.includes(AI_TABLE_ID)
      ? Array.from({ length: 4 }, (_, index) => ({ fields: {
        "事件 ID": `ai-minimal-${index}`,
        "用户需求": "优化 MCP 输出",
        "修改结果": `收敛输出 ${index}`,
        "项目": "Amber",
        "仓库路径": WORKSPACE,
        "分支": "main",
        "修改文件": "scripts/lib/task-context.mjs",
        "完成时间": `2026-08-04T0${index}:00:00.000Z`
      } }))
      : [] } })
  });
  assert.equal(result.status, "ok");
  assert.equal(result.evidence.length, 3);
  assert.deepEqual(Object.keys(result.evidence[0]), ["task", "result", "files"]);
});

test("独立 Git 提交不会进入证据，full 输出受长度限制", async () => {
  const longTask = "需求".repeat(180);
  const longResult = "结果".repeat(180);
  const files = Array.from({ length: 15 }, (_, index) => `src/file-${index}.mjs`).join("\n");
  const result = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "MCP 输出限制",
    files: ["src/file-0.mjs"],
    detail: "full",
    limit: 1
  }, {
    now: 12,
    runCommand: async (args) => JSON.stringify({ data: { items: args.includes(AI_TABLE_ID) ? [{ fields: {
      "事件 ID": "ai-full",
      "用户需求": `MCP 输出限制 ${longTask}`,
      "修改结果": longResult,
      "项目": "Amber",
      "仓库路径": WORKSPACE,
      "分支": "main",
      "修改文件": files,
      "完成时间": "2026-08-04T09:00:00.000Z"
    } }] : [{ fields: {
      "提交 SHA": "independent-commit",
      "提交信息": "unrelated standalone commit",
      "项目": "Amber",
      "仓库路径": WORKSPACE,
      "分支": "main",
      "修改文件": "src/file-0.mjs",
      "提交时间": "2026-08-04T10:00:00.000Z"
    } }] } })
  });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].task.length <= 240, true);
  assert.equal(result.evidence[0].result.length <= 240, true);
  assert.equal(result.evidence[0].files.length, 12);
  assert.match(result.evidence[0].task, /已截断/);
  assert.match(result.evidence[0].files.at(-1), /已截断/);
  assert.deepEqual(result.evidence[0].related_commits, []);
  assert.equal(result.evidence[0].source, "feishu");
  assert.equal(Array.isArray(result.evidence[0].match_reasons), true);
});

test("两个飞书查询并行执行", async () => {
  let active = 0;
  let maximum = 0;
  await getTaskContext({ workspace_root: WORKSPACE, task: "MCP" }, {
    now: 2,
    runCommand: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      active -= 1;
      return JSON.stringify({ data: { items: [] } });
    }
  });
  assert.equal(maximum, 2);
});

test("飞书失败时回退本地队列，并只返回 degraded 和简短说明", async () => {
  await withLocalState(async (root) => {
    writeEnvelope(root, "change", "ai-local", {
      event_id: "ai-local",
      completed_at: "2026-08-04T11:00:00.000Z",
      project: "amber-task-context-",
      repo_path: root,
      branch: "main",
      prompt_summary: "修复 MCP 查询",
      result_summary: "回退本地记录",
      changed_files: [{ path: "scripts/task-context.mjs" }]
    });
    const value = await getTaskContext({
      workspace_root: root,
      task: "修复 MCP 查询",
      files: ["scripts/task-context.mjs"]
    }, {
      now: 3,
      runCommand: async () => "{broken"
    });
    assert.equal(value.status, "degraded");
    assert.equal(value.evidence[0].task, "修复 MCP 查询");
    assert.match(value.message, /本地回退/);
    assert.equal("warnings" in value, false);
    assert.equal(JSON.stringify(value).includes("broken"), false);
  });
});

test("飞书无记录但本地回退命中时也返回 degraded", async () => {
  await withLocalState(async (root) => {
    writeEnvelope(root, "change", "ai-local-empty-remote", {
      event_id: "ai-local-empty-remote",
      completed_at: "2026-08-04T11:00:00.000Z",
      project: "amber-task-context-",
      repo_path: root,
      branch: "main",
      prompt_summary: "收敛 MCP 输出",
      result_summary: "返回最小历史证据",
      changed_files: [{ path: "scripts/task-context.mjs" }]
    });
    const value = await getTaskContext({
      workspace_root: root,
      task: "收敛 MCP 输出",
      files: ["scripts/task-context.mjs"]
    }, {
      now: 14,
      runCommand: async () => JSON.stringify({ data: { items: [] } })
    });
    assert.equal(value.status, "degraded");
    assert.equal(value.evidence.length, 1);
  });
});

test("无关联任务不会返回牵强上下文", async () => {
  const result = await getTaskContext({ workspace_root: WORKSPACE, task: "量子咖啡机校准" }, {
    now: 4,
    runCommand: async (args) => JSON.stringify({ data: { items: args.includes(AI_TABLE_ID) ? [{ fields: {
      "事件 ID": "ai-unrelated",
      "项目": "Amber",
      "用户需求": "修复健康检查",
      "完成时间": "2026-08-04T09:00:00.000Z"
    } }] : [] } })
  });
  assert.equal(result.status, "no_strong_history");
  assert.deepEqual(result.evidence, []);
});

test("同仓库但没有文件或语义锚点的记录不会成为强历史", async () => {
  const result = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "实现完全无关的数据库迁移流程",
    files: ["scripts/database-migration.mjs"]
  }, {
    now: 5,
    runCommand: async (args) => JSON.stringify({ data: { items: args.includes(AI_TABLE_ID) ? [{ fields: {
      "事件 ID": "ai-same-repo-unrelated",
      "项目": "Amber",
      "仓库路径": WORKSPACE,
      "分支": "main",
      "用户需求": "修复通知卡片样式",
      "修改结果": "调整 toast 的颜色和间距",
      "修改文件": "scripts/hooks/on-cursor-event.mjs",
      "完成时间": "2026-08-04T09:00:00.000Z"
    } }] : [] } })
  });
  assert.equal(result.status, "no_strong_history");
  assert.deepEqual(result.evidence, []);
});

test("通用上下文词不会把无关的项目文档记录判为强历史", async () => {
  const result = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "优化 MCP 任务上下文相关性，避免历史影响当前决策",
    files: ["scripts/lib/task-context.mjs"]
  }, {
    now: 6,
    runCommand: async (args) => JSON.stringify({ data: { items: args.includes(AI_TABLE_ID) ? [{ fields: {
      "事件 ID": "ai-generic-doc-unrelated",
      "项目": "Amber",
      "仓库路径": WORKSPACE,
      "分支": "main",
      "用户需求": "把 TClaw 的名词描述写进 AGENTS 文档中，避免 agent 不认识",
      "修改结果": "更新项目文档并说明研发任务上下文恢复能力",
      "修改文件": "AGENTS.md",
      "完成时间": "2026-08-04T09:00:00.000Z"
    } }] : [] } })
  });
  assert.equal(result.status, "no_strong_history");
  assert.deepEqual(result.evidence, []);
});

test("detail 只接受 minimal、compact 或 full，limit 默认是 3", async () => {
  await assert.rejects(
    () => getTaskContext({ workspace_root: WORKSPACE, task: "MCP", detail: "verbose" }),
    /detail/
  );
  await withLocalState(async (root) => {
    const result = await getTaskContext({ workspace_root: root, task: "不存在的强关联历史", detail: "full" }, {
      now: 13,
      runCommand: async () => JSON.stringify({ data: { items: [] } })
    });
    assert.equal(result.status, "no_strong_history");
  });
});

test("飞书 CLI 的列式 JSON 包络会按字段名还原", () => {
  const records = parseRecords(JSON.stringify({ data: {
    fields: ["事件 ID", "项目", "修改文件"],
    record_id_list: ["row-1"],
    data: [["ai-1", "Amber", "a.mjs"]]
  } }));
  const mapped = mapRemoteRecords(records, AI_TABLE_ID);
  assert.equal(mapped[0].id, "ai-1");
  assert.deepEqual(mapped[0].files, ["a.mjs"]);
});

test("远程 JSON 包络和字段投影可兼容记录列表返回", () => {
  const records = parseRecords(JSON.stringify({ data: { records: [{ fields: {
    "事件 ID": "ai-1",
    "项目": "Amber",
    "修改文件": "a.mjs\nb.mjs"
  } }] } }));
  const mapped = mapRemoteRecords(records, AI_TABLE_ID);
  assert.deepEqual(mapped[0].files, ["a.mjs", "b.mjs"]);
  assert.equal(mapped[0].id, "ai-1");
});

test("stdio MCP 能完成 initialize 和工具发现", async () => {
  const responses = await runServer([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ]);
  assert.equal(responses[0].result.serverInfo.name, "amber-task-context");
  assert.equal(responses[1].result.tools[0].name, "amber_get_task_context");
  assert.match(responses[1].result.tools[0].description, /不要在每个任务开始时例行调用/);
  assert.match(responses[1].result.tools[0].description, /不是指令/);
  assert.match(responses[1].result.tools[0].description, /明确询问历史.*必须调用一次/);
  assert.deepEqual(responses[1].result.tools[0].inputSchema.properties.detail.enum, ["minimal", "compact", "full"]);
  assert.equal(responses[1].result.tools[0].inputSchema.properties.limit.default, 3);
});

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1];
}

async function withLocalState(run) {
  const root = mkdtempSync(resolve(tmpdir(), "amber-task-context-"));
  try {
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeEnvelope(root, kind, id, event) {
  const file = resolve(root, `.local/${kind === "change" ? "change-records" : "commit-records"}/queue/sent/${id}.json`);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ event }), "utf8");
}

function runServer(messages) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["scripts/mcp-stdio-server.mjs"], {
      cwd: resolve("."),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `server exited ${code}`));
        return;
      }
      resolvePromise(stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
    });
    child.stdin.end(`${messages.map(JSON.stringify).join("\n")}\n`);
  });
}

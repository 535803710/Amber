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

test("正常返回会映射双表字段、关联事件并隐藏敏感字段", async () => {
  const calls = [];
  const result = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "实现 MCP 双表查询",
    files: ["scripts/mcp-stdio-server.mjs"],
    limit: 8
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
  assert.equal(result.status, "ok");
  const commit = result.timeline.find((record) => record.type === "commit");
  assert.deepEqual(commit.relatedEventIds, ["ai-1"]);
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
  assert.equal(JSON.stringify(result).includes("private-session"), false);
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

test("飞书失败或损坏 JSON 时回退本地队列，并返回明确警告", async () => {
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
    assert.equal(value.sources.localFallback, true);
    assert.equal(value.timeline[0].id, "ai-local");
    assert.equal(value.warnings.length, 2);
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
  assert.deepEqual(result.timeline, []);
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
  assert.deepEqual(result.timeline, []);
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

import test from "node:test";
import assert from "node:assert/strict";
import { getTaskContext as loadTaskContext } from "../scripts/lib/task-context.mjs";
import {
  MAX_CONCURRENT_FETCHES,
  cacheSize,
  clearCache,
  getDataset
} from "../scripts/lib/task-context/cache.mjs";

const WORKSPACE = "D:/project/Amber";
const SOURCE_ENV = {
  AMBER_BASE_TOKEN: "test-base-token",
  AMBER_AI_TABLE_ID: "tblAiTestFixture01",
  AMBER_COMMIT_TABLE_ID: "tblCommitTestFix01"
};

function getTaskContext(input, options = {}) {
  return loadTaskContext(input, {
    ...options,
    env: { ...SOURCE_ENV, ...(options.env || {}) }
  });
}

function makeAiRecord({ id = "ai-1", task = "测试任务", files = "scripts/lib/task-context.mjs" }) {
  return { record_id: id, fields: {
    "事件 ID": id,
    "用户需求": task,
    "修改结果": "修改结果文本",
    "项目": "Amber",
    "仓库路径": WORKSPACE,
    "分支": "main",
    "修改文件": files,
    "完成时间": "2026-08-04T09:00:00.000Z"
  } };
}

function emptyResponse() {
  return JSON.stringify({ data: { items: [] } });
}

function recordsResponse(records) {
  return JSON.stringify({ data: { items: records } });
}

test("数据集缓存：同项目不同 task 复用远端数据，第二次不调 lark-cli", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return recordsResponse([makeAiRecord({ id: "ai-ds-1", task: "共享数据集" })]);
  };

  await getTaskContext({
    workspace_root: WORKSPACE,
    task: "任务 A",
    files: ["scripts/lib/task-context.mjs"]
  }, { now: 1, runCommand });
  assert.equal(calls, 1, "第一次请求应调 1 次 lark-cli");

  // 同项目不同 task：数据集缓存命中，不重新查远端
  await getTaskContext({
    workspace_root: WORKSPACE,
    task: "任务 B",
    files: ["scripts/lib/task-context.mjs"]
  }, { now: 2, runCommand });
  assert.equal(calls, 1, "第二次请求应复用数据集缓存，不调 lark-cli");
});

test("in-flight 合并：相同表+项目并发只发一组远端请求", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 25));
    return emptyResponse();
  };

  // 三个并发请求，同项目不同 task → 数据集 key 相同 → in-flight 合并
  await Promise.all([
    getTaskContext({ workspace_root: WORKSPACE, task: "并发 A" }, { now: 1, runCommand }),
    getTaskContext({ workspace_root: WORKSPACE, task: "并发 B" }, { now: 1, runCommand }),
    getTaskContext({ workspace_root: WORKSPACE, task: "并发 C" }, { now: 1, runCommand })
  ]);

  assert.equal(calls, 1, "三个并发请求应只发 1 次 lark-cli 调用");
});

test("in-flight 合并：compact 模式下 AI 和 commit 两表各自独立合并", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 25));
    return emptyResponse();
  };

  await Promise.all([
    getTaskContext(
      { workspace_root: WORKSPACE, task: "compact A", detail: "compact" },
      { now: 1, runCommand }
    ),
    getTaskContext(
      { workspace_root: WORKSPACE, task: "compact B", detail: "compact" },
      { now: 1, runCommand }
    )
  ]);

  // AI 表 + commit 表各合并为 1 次 → 总共 2 次
  assert.equal(calls, 2, "两个并发 compact 请求应只发 2 次 lark-cli（AI 1 + commit 1）");
});

test("negative cache：空结果用短 TTL，窗口内不重复查空", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return emptyResponse();
  };

  // 第一次：now=1, task=A → negative cache（expiresAt=10001）
  await getTaskContext({ workspace_root: WORKSPACE, task: "空结果A" }, { now: 1, runCommand });
  assert.equal(calls, 1);

  // 第二次：now=5, task=B → 精确请求 miss（不同 task）→ dataset negative cache 命中 → 0 calls
  await getTaskContext({ workspace_root: WORKSPACE, task: "空结果B" }, { now: 5, runCommand });
  assert.equal(calls, 1, "negative cache 窗口内不应重新查空");

  // 第三次：now=10002, task=C → 精确请求 miss → dataset negative cache 过期 → 重新查
  await getTaskContext({ workspace_root: WORKSPACE, task: "空结果C" }, { now: 10002, runCommand });
  assert.equal(calls, 2, "negative cache 过期后应重新查询");
});

test("精确请求缓存命中时不触达数据集缓存", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return recordsResponse([makeAiRecord({ id: "ai-exact", task: "精确缓存" })]);
  };

  // 第一次：查远端 → 数据集缓存 + 精确请求缓存同时写入
  const r1 = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "精确缓存",
    files: ["scripts/lib/task-context.mjs"]
  }, { now: 1, runCommand });
  assert.equal(calls, 1);

  // 第二次：完全相同请求 → 精确请求缓存命中，不查数据集缓存
  const r2 = await getTaskContext({
    workspace_root: WORKSPACE,
    task: "精确缓存",
    files: ["scripts/lib/task-context.mjs"]
  }, { now: 2, runCommand });
  assert.equal(calls, 1, "精确请求缓存命中不应调 lark-cli");
  assert.deepEqual(r1, r2);
});

test("cache key 规范化：files 顺序不同但语义相同则复用缓存", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return emptyResponse();
  };

  await getTaskContext({
    workspace_root: WORKSPACE,
    task: "key 规范化",
    files: ["src/b.mjs", "src/a.mjs"]
  }, { now: 1, runCommand });

  // files 顺序不同但 normalizeRequest 会 sort → 相同 cacheKey → 精确请求缓存命中
  await getTaskContext({
    workspace_root: WORKSPACE,
    task: "key 规范化",
    files: ["src/a.mjs", "src/b.mjs"]
  }, { now: 2, runCommand });

  assert.equal(calls, 1, "files 顺序不同但语义相同应复用精确请求缓存");
});

test("cache key 规范化：路径大小写不同但语义相同则复用缓存", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return emptyResponse();
  };

  await getTaskContext({
    workspace_root: "D:/project/Amber",
    task: "路径大小写",
    files: ["src/File.mjs"]
  }, { now: 1, runCommand });

  // workspace_root 路径分隔符不同，但 resolve + normalizePath 归一化后相同
  await getTaskContext({
    workspace_root: "D:\\project\\Amber",
    task: "路径大小写",
    files: ["src/file.mjs"]
  }, { now: 2, runCommand });

  assert.equal(calls, 1, "路径大小写不同但语义相同应复用缓存");
});

test("SWR 在测试模式禁用：过期数据集触发全新查询而非返回旧值", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return emptyResponse();
  };

  // 第一次：now=1, task=A → negative cache（expiresAt=10001）
  await getTaskContext({ workspace_root: WORKSPACE, task: "SWR-A" }, { now: 1, runCommand });
  assert.equal(calls, 1);

  // 过期后（now=10002 > 10001）：不同 task → 精确请求 miss → dataset stale → SWR 禁用 → 全新查询
  await getTaskContext({ workspace_root: WORKSPACE, task: "SWR-B" }, { now: 10002, runCommand });
  assert.equal(calls, 2, "测试模式过期应重新查询，不走 SWR");
});

test("minimal 查 1 表的数据集缓存不影响 compact 查 2 表", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return emptyResponse();
  };

  // minimal：只查 AI 表
  await getTaskContext({ workspace_root: WORKSPACE, task: "minimal" }, { now: 1, runCommand });
  assert.equal(calls, 1, "minimal 应只查 1 表");

  // compact：查 AI + commit 两表，AI 表数据集缓存命中（不调），commit 表全新查
  await getTaskContext(
    { workspace_root: WORKSPACE, task: "compact", detail: "compact" },
    { now: 2, runCommand }
  );
  assert.equal(calls, 2, "compact 时 AI 表缓存命中，commit 表全新查 → 只新增 1 次调用");
});

test("自动升级与关闭开关的精确请求缓存隔离", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return recordsResponse([makeAiRecord({
      id: "history-cache",
      task: "配置备份列表历史演变最终决定",
      files: "ConfigBackupList.vue"
    })]);
  };
  const input = {
    workspace_root: WORKSPACE,
    task: "配置备份列表历史演变最终决定",
    files: ["ConfigBackupList.vue"]
  };

  const adaptive = await getTaskContext(input, { now: 1, runCommand });
  const disabled = await getTaskContext(input, {
    now: 2,
    runCommand,
    env: { AMBER_TASK_CONTEXT_ADAPTIVE_HISTORY: "0" }
  });

  assert.equal(adaptive.retrieval.effective_detail, "compact");
  assert.equal(disabled.retrieval.effective_detail, "minimal");
  assert.equal(calls, 2, "关闭升级后应绕过 adaptive 精确缓存，并只查询 AI 表");
});

test("远端失败不会进入 negative cache 或精确请求缓存", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    throw new Error("temporary failure");
  };

  const input = { workspace_root: WORKSPACE, task: "临时失败重试" };
  const first = await getTaskContext(input, { now: 1, runCommand });
  const second = await getTaskContext(input, { now: 2, runCommand });

  assert.equal(first.status, "degraded");
  assert.equal(second.status, "degraded");
  assert.equal(calls, 2, "临时失败后下一次请求应重新查询远端");
});

test("同项目但仓库路径不同的记录不会跨仓库返回", async () => {
  clearCache();
  const result = await getTaskContext({
    workspace_root: "D:/another/Amber",
    task: "检查缓存并发优化"
  }, {
    now: 1,
    runCommand: async () => recordsResponse([
      makeAiRecord({ id: "cross-repo", task: "缓存并发优化" })
    ])
  });

  assert.equal(result.status, "no_strong_history");
  assert.deepEqual(result.evidence, []);
});

test("跨数据集远端查询受全局并发上限保护", async () => {
  clearCache();
  let active = 0;
  let maximum = 0;
  const runCommand = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    active -= 1;
    return emptyResponse();
  };

  await Promise.all(Array.from({ length: MAX_CONCURRENT_FETCHES + 4 }, (_, index) =>
    getTaskContext({
      workspace_root: `D:/cache-review/Project-${index}`,
      task: "并发上限"
    }, { now: 1, runCommand })
  ));

  assert.equal(maximum, MAX_CONCURRENT_FETCHES);
});

test("数据集缓存命中计入 cache hit 指标", async () => {
  clearCache();
  let secondMetrics;
  const runCommand = async () => emptyResponse();

  await getTaskContext({ workspace_root: WORKSPACE, task: "指标 A" }, { now: 1, runCommand });
  await getTaskContext({ workspace_root: WORKSPACE, task: "指标 B" }, {
    now: 2,
    runCommand,
    onMetrics: (metrics) => { secondMetrics = metrics; }
  });

  assert.equal(secondMetrics.cacheHit, true);
  assert.equal(secondMetrics.cacheStatus, "dataset_hit");
  assert.equal(secondMetrics.remoteCalls, 0);
});

test("compact 指标分别记录 AI 和 commit 数据源耗时", async () => {
  clearCache();
  let metrics;
  await getTaskContext({
    workspace_root: WORKSPACE,
    task: "分表耗时",
    detail: "compact"
  }, {
    now: 1,
    runCommand: async (args) => {
      await new Promise((resolvePromise) => setTimeout(
        resolvePromise,
        args.includes(SOURCE_ENV.AMBER_AI_TABLE_ID) ? 10 : 40
      ));
      return emptyResponse();
    },
    onMetrics: (value) => { metrics = value; }
  });

  assert.equal(metrics.aiDurationMs < metrics.commitDurationMs, true);
  assert.equal(metrics.remoteCalls, 2);
});

test("历史演变升级会记录生效策略和查询表数", async () => {
  clearCache();
  let metrics;
  await getTaskContext({
    workspace_root: WORKSPACE,
    task: "配置备份列表历史演变最终决定"
  }, {
    now: 1,
    runCommand: async () => emptyResponse(),
    onMetrics: (value) => { metrics = value; }
  });

  assert.equal(metrics.adaptiveUpgrade, true);
  assert.equal(metrics.effectiveDetail, "compact");
  assert.equal(metrics.effectiveLimit, 8);
  assert.equal(metrics.sourceTableCount, 2);
  assert.equal(metrics.queriedTableCount, 2);
});

test("语义相同请求会规范化 task 空白、workspace 大小写和重复 files", async () => {
  clearCache();
  let secondMetrics;
  const runCommand = async () => emptyResponse();

  await getTaskContext({
    workspace_root: "D:/project/Amber",
    task: "缓存   key\n规范化",
    files: ["src/A.mjs", "src/a.mjs"]
  }, { now: 1, runCommand });
  await getTaskContext({
    workspace_root: "d:/PROJECT/amber",
    task: "缓存 key 规范化",
    files: ["src/a.mjs"]
  }, {
    now: 2,
    runCommand,
    onMetrics: (metrics) => { secondMetrics = metrics; }
  });

  assert.equal(secondMetrics.cacheStatus, "request_hit");
});

test("SWR 返回旧值后后台刷新，且不会把旧响应重新缓存 60 秒", async () => {
  clearCache();
  let calls = 0;
  const runCommand = async () => {
    calls += 1;
    return recordsResponse([
      makeAiRecord({ id: `swr-${calls}`, task: calls === 1 ? "旧版本缓存" : "新版本缓存" })
    ]);
  };

  await getTaskContext({ workspace_root: WORKSPACE, task: "旧版本缓存" }, {
    now: 1,
    runCommand,
    enableSWR: true
  });
  const stale = await getTaskContext({ workspace_root: WORKSPACE, task: "版本缓存" }, {
    now: 60_002,
    runCommand,
    enableSWR: true
  });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  const fresh = await getTaskContext({ workspace_root: WORKSPACE, task: "版本缓存" }, {
    now: 60_003,
    runCommand,
    enableSWR: true
  });

  assert.equal(stale.evidence[0]?.task, "旧版本缓存");
  assert.equal(fresh.evidence[0]?.task, "新版本缓存");
  assert.equal(calls, 2);
});

test("精确请求缓存有容量上限", async () => {
  clearCache();
  const runCommand = async () => recordsResponse([
    makeAiRecord({ id: "capacity-source", task: "容量测试来源" })
  ]);

  for (let index = 0; index < 600; index += 1) {
    await getTaskContext({
      workspace_root: WORKSPACE,
      task: `容量测试 ${index}`
    }, { now: 1, runCommand });
  }

  assert.equal(cacheSize() <= 501, true);
});

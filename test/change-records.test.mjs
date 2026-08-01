import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  beginChangeTurn,
  claimReadyQueueItems,
  completeChangeTurn,
  enqueueChangeEvent,
  getChangeRecordStatus,
  listReadyQueueItems,
  replayFailedEvents,
  toWebhookPayload
} from "../scripts/lib/change-records.mjs";
import { processReadyItems } from "../scripts/change-record-worker.mjs";
import {
  claimReadyCommitItems,
  enqueueCommitEvent,
  getCommitRecordStatus,
  listPendingCommitItems,
  parseScanRoots,
  readyCommitItems,
  resolveScanRoots,
  scanCommitRecords
} from "../scripts/lib/commit-records.mjs";
import { deliver, startCommitRecordWorker } from "../scripts/commit-record-worker.mjs";
import {
  extractCursorPromptFromHookLog,
  extractCursorResponseFromHookLog,
  normalizeHookPayload,
  parseHookJson
} from "../scripts/hooks/on-change-event.mjs";

test("hook payload parser accepts a UTF-8 BOM", () => {
  assert.deepEqual(
    parseHookJson("\uFEFF{\"hook_event_name\":\"UserPromptSubmit\",\"cwd\":\"D:/repo\"}"),
    { hook_event_name: "UserPromptSubmit", cwd: "D:/repo" }
  );
});

test("commit scan roots parse multiple directories and remove duplicates", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-scan-roots-"));
  const first = resolve(root, "first");
  const second = resolve(root, "second");
  mkdirSync(first, { recursive: true });
  mkdirSync(second, { recursive: true });
  try {
    assert.deepEqual(parseScanRoots(`${first};${second};${first}`), [first, second, first]);
    assert.deepEqual(resolveScanRoots({ env: { COMMIT_RECORD_SCAN_ROOTS: `${first};${second};${first}` } }), [first, second]);
    assert.deepEqual(resolveScanRoots({ env: { COMMIT_RECORD_SCAN_ROOTS: "relative;missing" } }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit scanner stays idle and clears removed scan baselines when no roots are configured", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-scan-disabled-"));
  const state = resolve(root, "state");
  try {
    const result = scanCommitRecords({ rootDir: state, scanRoots: [] });
    assert.deepEqual(result.scanRoots, []);
    assert.equal(result.repositories, 0);
    assert.equal(result.events.length, 0);
    const scannerState = JSON.parse(readFileSync(resolve(state, ".local/commit-records/scanner-state.json"), "utf8"));
    assert.deepEqual(scannerState.repositories, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit scanner baselines existing history then records a new local commit", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-commit-test-"));
  const projects = resolve(root, "projects");
  const repo = resolve(projects, "repo");
  const state = resolve(root, "state");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  try {
    assert.equal(scanCommitRecords({ rootDir: state, scanRoot: projects }).events.length, 0);
    writeFileSync(resolve(repo, "feature.txt"), "feature\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add feature"]);
    const result = scanCommitRecords({ rootDir: state, scanRoot: projects });
    assert.equal(result.events.length, 1);
    const [item] = readyCommitItems({ rootDir: state });
    assert.equal(listPendingCommitItems({ rootDir: state }).length, 1);
    assert.equal(item.envelope.event.event_type, "git_commit");
    assert.equal(item.envelope.event.commit_subject, "add feature");
    assert.deepEqual(item.envelope.event.changed_files, [{ status: "A", path: "feature.txt" }]);

    scanCommitRecords({ rootDir: state, scanRoots: [] });
    const readded = scanCommitRecords({ rootDir: state, scanRoots: [projects] });
    assert.equal(readded.events.length, 0, "re-adding a removed root must establish a fresh baseline");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit scanner preserves UTF-8 changed file names", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-commit-utf8-path-"));
  const projects = resolve(root, "projects");
  const repo = resolve(projects, "repo");
  const state = resolve(root, "state");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);

  try {
    assert.equal(scanCommitRecords({ rootDir: state, scanRoot: projects }).events.length, 0);
    writeFileSync(resolve(repo, "中文验收.txt"), "ok\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add utf8 path"]);

    const result = scanCommitRecords({ rootDir: state, scanRoot: projects });
    assert.deepEqual(result.events[0].changed_files, [{ status: "A", path: "中文验收.txt" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit scanner does not replay history after a temporary Git read failure", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-commit-recovery-"));
  const projects = resolve(root, "projects");
  const repo = resolve(projects, "repo");
  const state = resolve(root, "state");
  const gitDir = resolve(repo, ".git");
  const backupGitDir = resolve(repo, ".git-backup");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);

  try {
    assert.equal(scanCommitRecords({ rootDir: state, scanRoot: projects }).events.length, 0);

    renameSync(gitDir, backupGitDir);
    mkdirSync(gitDir);
    assert.equal(scanCommitRecords({ rootDir: state, scanRoot: projects }).events.length, 0);

    rmSync(gitDir, { recursive: true, force: true });
    renameSync(backupGitDir, gitDir);
    const recovered = scanCommitRecords({ rootDir: state, scanRoot: projects });

    assert.equal(recovered.events.length, 0);
    assert.equal(listPendingCommitItems({ rootDir: state }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit scanner repairs a legacy empty-ref state without replaying history", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-commit-legacy-state-"));
  const projects = resolve(root, "projects");
  const repo = resolve(projects, "repo");
  const state = resolve(root, "state");
  const stateFile = resolve(state, ".local/commit-records/scanner-state.json");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  mkdirSync(resolve(stateFile, ".."), { recursive: true });
  writeFileSync(
    stateFile,
    `${JSON.stringify({ repositories: { [repo]: { refs: {}, initializedAt: "2026-07-30T00:00:00.000Z" } } }, null, 2)}\n`,
    "utf8"
  );

  try {
    const recovered = scanCommitRecords({ rootDir: state, scanRoot: projects });

    assert.equal(recovered.events.length, 0);
    assert.equal(listPendingCommitItems({ rootDir: state }).length, 0);
    const scannerState = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.ok(Object.keys(scannerState.repositories[repo].refs).length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit scanner records the first commit created after an empty repository baseline", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-empty-repo-"));
  const projects = resolve(root, "projects");
  const repo = resolve(projects, "repo");
  const state = resolve(root, "state");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);

  try {
    assert.equal(scanCommitRecords({ rootDir: state, scanRoot: projects }).events.length, 0);
    writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial"]);

    const result = scanCommitRecords({ rootDir: state, scanRoot: projects });
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].commit_subject, "initial");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit worker scans independently while a delivery batch is still running", async () => {
  let scanCount = 0;
  let deliveryCount = 0;
  const worker = startCommitRecordWorker({
    scanIntervalMs: 10,
    deliveryIntervalMs: 10,
    scan: () => {
      scanCount += 1;
    },
    deliverBatch: async () => {
      deliveryCount += 1;
      await sleep(200);
    },
    onError: (error) => {
      throw error;
    }
  });

  try {
    await sleep(60);
    assert.ok(scanCount >= 3, `expected at least 3 scans, got ${scanCount}`);
    assert.equal(deliveryCount, 1, "a running delivery batch must not overlap itself");
  } finally {
    worker.stop();
  }
});

test("commit delivery limits each batch and leaves the backlog pending", async () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-commit-state-"));
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"code":0}');
  });
  const url = await listen(server);

  try {
    for (const id of ["first", "second", "third"]) {
      enqueueCommitEvent(sampleCommitEvent(id), { rootDir: state });
    }

    assert.equal(readyCommitItems({ rootDir: state, limit: 2 }).length, 2);
    const result = await deliver(false, { rootDir: state, webhookUrl: url, batchSize: 2 });
    assert.deepEqual(result, { ready: 2, sent: 2, failed: 0 });
    assert.equal(requestCount, 2);
    const status = getCommitRecordStatus({ rootDir: state });
    assert.equal(status.sent, 2);
    assert.equal(status.pending, 1);
  } finally {
    server.close();
    rmSync(state, { recursive: true, force: true });
  }
});

test("two change workers claim one pending event exactly once", () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-outbox-claim-"));
  try {
    enqueueChangeEvent(sampleEvent("claim-once"), { rootDir: state });

    const first = claimReadyQueueItems({ rootDir: state, limit: 1 });
    const second = claimReadyQueueItems({ rootDir: state, limit: 1 });

    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
    assert.equal(getChangeRecordStatus({ rootDir: state }).processing, 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("two commit workers claim one pending event exactly once", () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-commit-outbox-claim-"));
  try {
    enqueueCommitEvent(sampleCommitEvent("commit-claim-once"), { rootDir: state });

    const first = claimReadyCommitItems({ rootDir: state, limit: 1 });
    const second = claimReadyCommitItems({ rootDir: state, limit: 1 });

    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
    assert.equal(getCommitRecordStatus({ rootDir: state }).processing, 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("stale change processing claims are returned to pending and reclaimed", () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-outbox-recovery-"));
  try {
    enqueueChangeEvent(sampleEvent("stale-change"), { rootDir: state });
    const firstAt = new Date(Date.now() + 1_000);
    const secondAt = new Date(firstAt.getTime() + 2_000);
    const first = claimReadyQueueItems({ rootDir: state, now: firstAt, processingLeaseMs: 1_000 });
    const recovered = claimReadyQueueItems({ rootDir: state, now: secondAt, processingLeaseMs: 1_000 });

    assert.equal(first.length, 1);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].envelope.event.event_id, "stale-change");
    assert.equal(getChangeRecordStatus({ rootDir: state }).processing, 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("stale commit processing claims are returned to pending and reclaimed", () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-commit-outbox-recovery-"));
  try {
    enqueueCommitEvent(sampleCommitEvent("stale-commit"), { rootDir: state });
    const firstAt = new Date(Date.now() + 1_000);
    const secondAt = new Date(firstAt.getTime() + 2_000);
    const first = claimReadyCommitItems({ rootDir: state, now: firstAt, processingLeaseMs: 1_000 });
    const recovered = claimReadyCommitItems({ rootDir: state, now: secondAt, processingLeaseMs: 1_000 });

    assert.equal(first.length, 1);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].envelope.event.event_id, "stale-commit");
    assert.equal(getCommitRecordStatus({ rootDir: state }).processing, 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("concurrent change deliveries send one webhook", async () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-outbox-delivery-"));
  let requestCount = 0;
  const server = createServer(async (_request, response) => {
    requestCount += 1;
    await sleep(40);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"code":0}');
  });
  const url = await listen(server);

  try {
    enqueueChangeEvent(sampleEvent("concurrent-change"), { rootDir: state });
    await Promise.all([
      processReadyItems({ rootDir: state, webhookUrl: url }),
      processReadyItems({ rootDir: state, webhookUrl: url })
    ]);
    const status = getChangeRecordStatus({ rootDir: state });
    assert.equal(requestCount, 1);
    assert.equal(status.pending, 0);
    assert.equal(status.processing, 0);
    assert.equal(status.sent, 1);
  } finally {
    server.close();
    rmSync(state, { recursive: true, force: true });
  }
});

test("concurrent commit deliveries send one webhook", async () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-commit-outbox-delivery-"));
  let requestCount = 0;
  const server = createServer(async (_request, response) => {
    requestCount += 1;
    await sleep(40);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"code":0}');
  });
  const url = await listen(server);

  try {
    enqueueCommitEvent(sampleCommitEvent("concurrent-commit"), { rootDir: state });
    await Promise.all([
      deliver(false, { rootDir: state, webhookUrl: url }),
      deliver(false, { rootDir: state, webhookUrl: url })
    ]);
    const status = getCommitRecordStatus({ rootDir: state });
    assert.equal(requestCount, 1);
    assert.equal(status.pending, 0);
    assert.equal(status.processing, 0);
    assert.equal(status.sent, 1);
  } finally {
    server.close();
    rmSync(state, { recursive: true, force: true });
  }
});

test("Cursor hook payload uses workspace root as cwd", () => {
  assert.equal(
    normalizeHookPayload({ workspace_roots: ["/d:/project/repo"] }, "Cursor").cwd,
    "d:/project/repo"
  );
});

test("Cursor hook parser recovers stable fields from malformed Chinese JSON", () => {
  const payload = parseHookJson(
    '{"conversation_id":"session-1","generation_id":"turn-1","prompt":"中文"坏掉",' +
      '"session_id":"session-1","hook_event_name":"beforeSubmitPrompt",' +
      '"workspace_roots":["/d:/project/repo"]}'
  );

  assert.deepEqual(payload, {
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "session-1",
    generation_id: "turn-1",
    session_id: "session-1",
    status: "",
    workspace_roots: ["/d:/project/repo"]
  });
});

test("Cursor prompt is recovered from its UTF-8 hook log", () => {
  const log = [
    "beforeSubmitPrompt",
    "INPUT:",
    "{",
    '  "conversation_id": "session-1",',
    '  "generation_id": "turn-1",',
    '  "prompt": "env.itsm\\n中增加注释  sg-intra-paas.transsion  是新加坡演练环境地址",',
    '  "hook_event_name": "beforeSubmitPrompt"',
    "}",
    "",
    "OUTPUT:",
    "{}"
  ].join("\n");

  assert.equal(
    extractCursorPromptFromHookLog(log, "session-1", "turn-1"),
    "env.itsm\n中增加注释  sg-intra-paas.transsion  是新加坡演练环境地址"
  );
});

test("Cursor response prefers the UTF-8 hook log over a mojibake stdin payload", () => {
  const log = [
    "afterAgentResponse",
    "INPUT:",
    "{",
    '  "conversation_id": "session-1",',
    '  "generation_id": "turn-1",',
    '  "text": "已修改文件：动作：新增文件 → 动作：修改文件",',
    '  "hook_event_name": "afterAgentResponse"',
    "}",
    "",
    "OUTPUT:",
    "{}"
  ].join("\n");

  assert.equal(
    extractCursorResponseFromHookLog(
      log,
      "session-1",
      "turn-1",
      "宸蹭慨鏀?鏂囦欢"
    ),
    "已修改文件：动作：新增文件 → 动作：修改文件"
  );
});

test("pre-existing dirty files are excluded from the turn", () => {
  withRepo(({ repo, state }) => {
    writeFileSync(resolve(repo, "before.txt"), "dirty before turn\n", "utf8");
    const begin = beginChangeTurn(hookInput("ChatGPT", repo, "s1", "t1", "change task"), {
      rootDir: state
    });
    assert.equal(begin.ok, true);

    writeFileSync(resolve(repo, "task.txt"), "new task line\n", "utf8");
    const done = completeChangeTurn(
      { ...hookInput("ChatGPT", repo, "s1", "t1"), last_assistant_message: "done" },
      { rootDir: state }
    );

    assert.equal(done.queued, true);
    assert.deepEqual(done.event.changed_files, [{ status: "A", path: "task.txt" }]);
    assert.equal(done.event.additions, 1);
    assert.equal(done.event.deletions, 0);
  });
});

test("add, modify, delete, rename, staged and untracked changes are summarized", () => {
  withRepo(({ repo, state }) => {
    writeFileSync(resolve(repo, "modify.txt"), "old\n", "utf8");
    writeFileSync(resolve(repo, "delete.txt"), "delete me\n", "utf8");
    writeFileSync(resolve(repo, "rename.txt"), "same content\nline two\n", "utf8");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "fixtures"]);

    beginChangeTurn(hookInput("Cursor", repo, "s2", "t2", "multi change"), {
      rootDir: state
    });
    writeFileSync(resolve(repo, "modify.txt"), "old\nnew\n", "utf8");
    rmSync(resolve(repo, "delete.txt"));
    git(repo, ["mv", "rename.txt", "renamed.txt"]);
    writeFileSync(resolve(repo, "untracked-中文.txt"), "hello\n", "utf8");
    writeFileSync(resolve(repo, "staged.txt"), "staged\n", "utf8");
    git(repo, ["add", "staged.txt"]);

    const done = completeChangeTurn(hookInput("Cursor", repo, "s2", "t2"), {
      rootDir: state
    });
    const statuses = new Map(done.event.changed_files.map((item) => [item.path, item.status]));

    assert.equal(statuses.get("modify.txt"), "M");
    assert.equal(statuses.get("delete.txt"), "D");
    assert.equal(statuses.get("renamed.txt"), "R");
    assert.equal(statuses.get("staged.txt"), "A");
    assert.equal(statuses.get("untracked-中文.txt"), "A");
    assert.equal(done.event.changed_file_count, 5);
    assert.equal(done.event.additions, 3);
    assert.equal(done.event.deletions, 1);
  });
});

test("no file change produces no queue item", () => {
  withRepo(({ repo, state }) => {
    beginChangeTurn(hookInput("ChatGPT", repo, "s3", "t3"), { rootDir: state });
    const done = completeChangeTurn(hookInput("ChatGPT", repo, "s3", "t3"), {
      rootDir: state
    });
    assert.equal(done.skipped, "no_changes");
    assert.equal(getChangeRecordStatus({ rootDir: state }).pending, 0);
  });
});

test("AI change records use the repository Git author and map it to Feishu fields", () => {
  withRepo(({ repo, state }) => {
    beginChangeTurn(hookInput("ChatGPT", repo, "author-session", "author-turn"), {
      rootDir: state
    });
    writeFileSync(resolve(repo, "author.txt"), "author\n", "utf8");
    const done = completeChangeTurn(hookInput("ChatGPT", repo, "author-session", "author-turn"), {
      rootDir: state
    });

    assert.equal(done.event.author_name, "Test");
    assert.equal(done.event.author_email, "test@example.com");
    const payload = toWebhookPayload(done.event);
    assert.equal(payload["作者"], "Test");
    assert.equal(payload["作者邮箱"], "test@example.com");
  });
});

test("Cursor completion can match a baseline created before generation_id exists", () => {
  withRepo(({ repo, state }) => {
    beginChangeTurn(
      {
        source: "Cursor",
        cwd: repo,
        conversation_id: "conversation",
        prompt: "change"
      },
      { rootDir: state }
    );
    writeFileSync(resolve(repo, "cursor.txt"), "cursor\n", "utf8");
    const done = completeChangeTurn(
      {
        source: "Cursor",
        cwd: repo,
        conversation_id: "conversation",
        generation_id: "generation"
      },
      { rootDir: state }
    );
    assert.equal(done.queued, true);
    assert.equal(done.event.session_id, "conversation");
    assert.equal(done.event.turn_id, "generation");
  });
});

test("duplicate event IDs are queued only once and payload maps Base fields", () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-state-"));
  try {
    const event = sampleEvent("duplicate");
    assert.equal(enqueueChangeEvent(event, { rootDir: state }).queued, true);
    assert.equal(enqueueChangeEvent(event, { rootDir: state }).duplicate, true);
    assert.equal(getChangeRecordStatus({ rootDir: state }).pending, 1);
    const payload = toWebhookPayload(event);
    assert.equal(payload["事件 ID"], "duplicate");
    assert.equal(payload["工具"], "ChatGPT");
    assert.equal(payload["文件数"], 1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("worker sends Bearer webhook and moves successful event to sent", async () => {
  const state = mkdtempSync(resolve(tmpdir(), "amber-state-"));
  let received;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received = { authorization: request.headers.authorization, body: JSON.parse(body) };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"code":0}');
    });
  });
  const url = await listen(server);

  try {
    enqueueChangeEvent(sampleEvent("success"), { rootDir: state });
    await processReadyItems({
      rootDir: state,
      webhookUrl: url,
      webhookToken: "secret-token"
    });
    assert.equal(received.authorization, "Bearer secret-token");
    assert.equal(received.body["事件 ID"], "success");
    const status = getChangeRecordStatus({ rootDir: state });
    assert.equal(status.pending, 0);
    assert.equal(status.failed, 0);
    assert.equal(status.sent, 1);
    assert.match(status.lastSuccessAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    server.close();
    rmSync(state, { recursive: true, force: true });
  }
});

test("401 and timeout remain pending for retry; failed items can be replayed", async () => {
  const state401 = mkdtempSync(resolve(tmpdir(), "amber-state-"));
  const unauthorized = createServer((_request, response) => {
    response.writeHead(401);
    response.end("unauthorized");
  });
  const url401 = await listen(unauthorized);
  try {
    enqueueChangeEvent(sampleEvent("unauthorized"), { rootDir: state401 });
    await processReadyItems({ rootDir: state401, webhookUrl: url401 });
    const [item] = listReadyQueueItems({
      rootDir: state401,
      now: new Date(Date.now() + 60_000)
    });
    assert.equal(item.envelope.attempts, 1);
    assert.match(item.envelope.lastError, /HTTP 401/);
  } finally {
    unauthorized.close();
    rmSync(state401, { recursive: true, force: true });
  }

  const stateTimeout = mkdtempSync(resolve(tmpdir(), "amber-state-"));
  const hanging = createServer(() => {});
  const urlTimeout = await listen(hanging);
  try {
    enqueueChangeEvent(sampleEvent("timeout"), { rootDir: stateTimeout });
    await processReadyItems({
      rootDir: stateTimeout,
      webhookUrl: urlTimeout,
      requestTimeoutMs: 20
    });
    const [item] = listReadyQueueItems({
      rootDir: stateTimeout,
      now: new Date(Date.now() + 60_000)
    });
    assert.equal(item.envelope.attempts, 1);
    assert.match(item.envelope.lastError, /timed out/);

    const failedPath = resolve(
      stateTimeout,
      ".local/change-records/queue/failed/timeout.json"
    );
    mkdirSync(resolve(failedPath, ".."), { recursive: true });
    writeFileSync(failedPath, readFileSync(item.filePath, "utf8"), "utf8");
    rmSync(item.filePath);
    assert.equal(replayFailedEvents({ rootDir: stateTimeout }).replayed, 1);
    assert.equal(getChangeRecordStatus({ rootDir: stateTimeout }).pending, 1);
  } finally {
    hanging.closeAllConnections?.();
    hanging.close();
    rmSync(stateTimeout, { recursive: true, force: true });
  }
});

function withRepo(run) {
  const root = mkdtempSync(resolve(tmpdir(), "amber-test-"));
  const repo = resolve(root, "repo");
  const state = resolve(root, "state");
  mkdirSync(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  try {
    run({ root, repo, state });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
}

function hookInput(source, cwd, sessionId, turnId, prompt = "") {
  return { source, cwd, session_id: sessionId, turn_id: turnId, prompt };
}

function sampleCommitEvent(eventId) {
  return {
    schema_version: 1,
    event_type: "git_commit",
    event_id: eventId,
    detected_at: "2026-08-01T00:00:00.000Z",
    committed_at: "2026-08-01T00:00:00.000Z",
    project: "sample",
    repo_path: "D:\\sample",
    branch: "main",
    commit_sha: `${eventId}-sha`,
    short_sha: eventId,
    parent_shas: [],
    commit_kind: "normal",
    ref_update_type: "forward",
    author_name: "Test",
    commit_subject: eventId,
    commit_message: eventId,
    changed_files: [],
    changed_file_count: 0,
    additions: 0,
    deletions: 0,
    related_ai_event_ids: []
  };
}

function sampleEvent(eventId) {
  return {
    schema_version: 1,
    event_id: eventId,
    source: "ChatGPT",
    completed_at: "2026-07-30T00:00:00.000Z",
    project: "sample",
    repo_path: "D:\\sample",
    branch: "main",
    head_commit: "abc123",
    session_id: "session",
    turn_id: "turn",
    prompt_summary: "change it",
    result_summary: "changed",
    changed_files: [{ status: "M", path: "file.txt" }],
    changed_file_count: 1,
    additions: 2,
    deletions: 1,
    result_status: "completed",
    collection_quality: "exact"
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function listen(server) {
  return new Promise((resolveUrl) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveUrl(`http://127.0.0.1:${address.port}/webhook`);
    });
  });
}

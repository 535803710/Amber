import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  enqueueChangeEvent,
  getChangeRecordStatus,
} from "../scripts/lib/change-records.mjs";
import {
  enqueueCommitEvent,
  getCommitRecordStatus,
} from "../scripts/lib/commit-records.mjs";
import { readRuntimeConfig } from "../scripts/lib/runtime-config.mjs";

test("本地运行配置支持更新和清空 Webhook", () => {
  const rootDir = mkdtempSync(resolve(tmpdir(), "amber-runtime-config-values-"));
  try {
    writeFileSync(resolve(rootDir, ".env"), "FEISHU_CHANGE_WEBHOOK_URL=https://default.test\n", "utf8");
    writeFileSync(resolve(rootDir, ".env.local"), "FEISHU_CHANGE_WEBHOOK_URL=https://local.test\n", "utf8");
    assert.equal(
      readRuntimeConfig({
        rootDir,
        keys: ["FEISHU_CHANGE_WEBHOOK_URL"],
        env: { FEISHU_CHANGE_WEBHOOK_URL: "https://process.test" },
      }).FEISHU_CHANGE_WEBHOOK_URL,
      "https://local.test",
    );

    writeFileSync(resolve(rootDir, ".env.local"), "FEISHU_CHANGE_WEBHOOK_URL=\n", "utf8");
    assert.equal(
      readRuntimeConfig({
        rootDir,
        keys: ["FEISHU_CHANGE_WEBHOOK_URL"],
        env: { FEISHU_CHANGE_WEBHOOK_URL: "https://process.test" },
      }).FEISHU_CHANGE_WEBHOOK_URL,
      "",
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("运行中的记录 worker 自动应用新保存的 Webhook", async (t) => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-runtime-config-"));
  const target = resolve(base, "Amber");
  const repositoryRoot = resolve(import.meta.dirname, "..");
  mkdirSync(target, { recursive: true });
  cpSync(resolve(repositoryRoot, "scripts"), resolve(target, "scripts"), { recursive: true });
  writeFileSync(resolve(target, ".env.local"), "", "utf8");

  enqueueChangeEvent(sampleChangeEvent(), { rootDir: target });
  enqueueCommitEvent(sampleCommitEvent(), { rootDir: target });

  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"code":0}');
  });
  const webhookUrl = await listen(server);
  const workers = [
    startWorker(resolve(target, "scripts/change-record-worker.mjs"), target),
    startWorker(resolve(target, "scripts/commit-record-worker.mjs"), target),
  ];

  t.after(async () => {
    await Promise.all(workers.map(stopWorker));
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(base, { recursive: true, force: true });
  });

  await waitFor(() =>
    existsSync(resolve(target, ".local/change-records/worker-state.json")) &&
    existsSync(resolve(target, ".local/commit-records/worker-state.json"))
  );

  writeFileSync(
    resolve(target, ".env.local"),
    [
      `FEISHU_CHANGE_WEBHOOK_URL=${webhookUrl}`,
      `FEISHU_COMMIT_WEBHOOK_URL=${webhookUrl}`,
      "",
    ].join("\n"),
    "utf8",
  );

  await waitFor(() =>
    getChangeRecordStatus({ rootDir: target }).sent === 1 &&
    getCommitRecordStatus({ rootDir: target }).sent === 1
  );

  assert.equal(getChangeRecordStatus({ rootDir: target }).pending, 0);
  assert.equal(getCommitRecordStatus({ rootDir: target }).pending, 0);
});

function startWorker(script, cwd) {
  const env = { ...process.env };
  for (const key of [
    "FEISHU_CHANGE_WEBHOOK_URL",
    "FEISHU_CHANGE_WEBHOOK_TOKEN",
    "FEISHU_COMMIT_WEBHOOK_URL",
    "FEISHU_COMMIT_WEBHOOK_TOKEN",
    "COMMIT_RECORD_SCAN_ROOTS",
  ]) {
    delete env[key];
  }
  const child = spawn(process.execPath, [script], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.getOutput = () => output;
  return child;
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
}

async function waitFor(predicate, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("等待 worker 应用配置超时");
}

function listen(server) {
  return new Promise((resolveUrl) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveUrl(`http://127.0.0.1:${address.port}/webhook`);
    });
  });
}

function sampleChangeEvent() {
  return {
    schema_version: 1,
    event_id: "runtime-change",
    source: "ChatGPT",
    completed_at: "2026-09-03T00:00:00.000Z",
    project: "sample",
    repo_path: "D:\\sample",
    branch: "main",
    prompt_summary: "test",
    result_summary: "changed",
    changed_files: [],
    changed_file_count: 0,
    additions: 0,
    deletions: 0,
    result_status: "completed",
    collection_quality: "exact",
  };
}

function sampleCommitEvent() {
  return {
    schema_version: 1,
    event_type: "git_commit",
    event_id: "runtime-commit",
    detected_at: "2026-09-03T00:00:00.000Z",
    committed_at: "2026-09-03T00:00:00.000Z",
    project: "sample",
    repo_path: "D:\\sample",
    branch: "main",
    commit_sha: "runtime-commit-sha",
    short_sha: "runtime",
    parent_shas: [],
    commit_kind: "normal",
    ref_update_type: "forward",
    author_name: "Test",
    commit_subject: "test",
    commit_message: "test",
    changed_files: [],
    changed_file_count: 0,
    additions: 0,
    deletions: 0,
    related_ai_event_ids: [],
  };
}

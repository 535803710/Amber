import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { listRecordPage, normalizeListQuery } from "../scripts/lib/record-listing.mjs";

test("AI 修改记录按完成时间倒序分页，并仅返回展示投影", () => {
  withRecordState((root) => {
    writeEnvelope(root, "change", "sent", "older", changeEvent({ completedAt: "2026-08-01T08:00:00.000Z" }));
    writeEnvelope(root, "change", "pending", "newer", changeEvent({ completedAt: "2026-08-01T09:00:00.000Z", result: "完成页面" }));

    const page = listRecordPage("change", { pageSize: "1" }, { rootDir: root });
    assert.deepEqual(page.counts, { all: 2, pending: 1, sent: 1, failed: 0 });
    assert.equal(page.pagination.totalPages, 2);
    assert.equal(page.items[0].summary, "增加记录页面");
    assert.equal(page.items[0].sessionId, undefined);
    assert.equal(page.items[0].baselineTree, undefined);
    assert.equal(page.items[0].authorName, "Amber User");
    assert.equal(page.items[0].authorEmail, "amber@example.com");
  });
});

test("提交记录支持状态筛选，并忽略损坏队列文件", () => {
  withRecordState((root) => {
    writeEnvelope(root, "commit", "failed", "failed", commitEvent({ subject: "fix: retry" }), { attempts: 2, lastError: "HTTP 500" });
    writeEnvelope(root, "commit", "sent", "sent", commitEvent({ subject: "feat: shipped" }));
    const corruptFile = resolve(root, ".local/commit-records/queue/pending/corrupt.json");
    mkdirSync(resolve(corruptFile, ".."), { recursive: true });
    writeFileSync(corruptFile, "{broken", "utf8");

    const page = listRecordPage("commit", { status: "failed" }, { rootDir: root });
    assert.equal(page.counts.all, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].summary, "fix: retry");
    assert.equal(page.items[0].lastError, "HTTP 500");
    assert.deepEqual(page.items[0].relatedAiEventIds, ["ai-event"]);
  });
});

test("分页参数拒绝非法状态、非正整数和过大页大小", () => {
  assert.throws(() => normalizeListQuery({ status: "unknown" }), /status/);
  assert.throws(() => normalizeListQuery({ page: "0" }), /page/);
  assert.throws(() => normalizeListQuery({ pageSize: "101" }), /pageSize/);
  assert.deepEqual(normalizeListQuery({ status: "sent", page: "2", pageSize: "10" }), {
    status: "sent", page: 2, pageSize: 10
  });
});

function withRecordState(run) {
  const root = mkdtempSync(resolve(tmpdir(), "amber-record-list-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeEnvelope(root, kind, status, id, event, overrides = {}) {
  const file = resolve(root, `.local/${kind === "change" ? "change-records" : "commit-records"}/queue/${status}/${id}.json`);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ event, attempts: 0, createdAt: "2026-08-01T07:00:00.000Z", ...overrides }), "utf8");
}

function changeEvent({ completedAt, result = "" }) {
  return {
    event_id: `change-${completedAt}`,
    completed_at: completedAt,
    project: "amber",
    branch: "feature/records",
    source: "Cursor",
    author_name: "Amber User",
    author_email: "amber@example.com",
    prompt_summary: "增加记录页面",
    result_summary: result,
    changed_files: [{ status: "M", path: "dashboard/app.js" }],
    changed_file_count: 1,
    additions: 2,
    deletions: 1,
    session_id: "private-session",
    baseline_tree: "private-tree"
  };
}

function commitEvent({ subject }) {
  return {
    event_id: `commit-${subject}`,
    committed_at: "2026-08-01T09:00:00.000Z",
    project: "amber",
    branch: "master",
    author_name: "tester",
    short_sha: "abcd1234",
    commit_subject: subject,
    commit_message: subject,
    changed_files: [{ status: "A", path: "dashboard/records.js" }],
    changed_file_count: 1,
    additions: 10,
    deletions: 0,
    related_ai_event_ids: ["ai-event"]
  };
}

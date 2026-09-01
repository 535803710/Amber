import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { beginChangeTurn, completeChangeTurn } from "../scripts/lib/change-records.mjs";
import { archiveAbortedBaselines } from "../scripts/lib/health-reset.mjs";
import { readRolloutThreadMeta, resolveCodexTurnThread } from "../scripts/lib/codex-thread.mjs";

const PARENT_SESSION = "01a05ba2-0bf1-7431-8880-6301bcea3dd9";
const PARENT_TURN = "01a05bb7-6c5e-71b2-9dc1-bf6e1966002b";

test("rollout session_meta distinguishes a subagent thread from its parent", () => {
  withCodexHome(({ codexHome }) => {
    const parent = writeRollout(codexHome, { threadId: PARENT_SESSION, sessionId: PARENT_SESSION });
    const child = writeRollout(codexHome, {
      threadId: "01a05bba-529d-7052-a200-936bdf9ceea3",
      sessionId: PARENT_SESSION,
      threadSource: "subagent",
      parentThreadId: PARENT_SESSION,
      turnIds: ["01a05bba-5399-7291-af5a-fa83bc401054"]
    });

    assert.deepEqual(readRolloutThreadMeta(parent), {
      sessionId: PARENT_SESSION,
      threadId: PARENT_SESSION,
      parentThreadId: "",
      threadSource: "user"
    });
    assert.equal(readRolloutThreadMeta(child).threadSource, "subagent");
    assert.equal(
      resolveCodexTurnThread(
        { sessionId: PARENT_SESSION, turnId: "01a05bba-5399-7291-af5a-fa83bc401054" },
        { codexHome }
      ).threadId,
      "01a05bba-529d-7052-a200-936bdf9ceea3"
    );
  });
});

test("a Codex subagent turn does not create a baseline and leaves the parent turn intact", () => {
  withRepo(({ repo, state, codexHome }) => {
    writeRollout(codexHome, { threadId: PARENT_SESSION, sessionId: PARENT_SESSION });
    const parentTurn = codexInput(repo, PARENT_SESSION, PARENT_TURN, "重构评分查询");
    assert.equal(beginChangeTurn(parentTurn, { rootDir: state, codexHome }).skipped, undefined);

    for (const [threadId, turnId] of [
      ["01a05bb8-f2b8-7cb3-96cb-0213df1b4584", "01a05bb8-f427-76c1-948e-770b0e719b36"],
      ["01a05bba-529d-7052-a200-936bdf9ceea3", "01a05bba-5399-7291-af5a-fa83bc401054"]
    ]) {
      writeRollout(codexHome, {
        threadId,
        sessionId: PARENT_SESSION,
        threadSource: "subagent",
        parentThreadId: PARENT_SESSION,
        turnIds: [turnId]
      });
      const result = beginChangeTurn(
        codexInput(repo, PARENT_SESSION, turnId, "Act as the Bugbot review subagent."),
        { rootDir: state, codexHome }
      );
      assert.equal(result.skipped, "codex_subagent");
    }

    const baselineDir = resolve(state, ".local/change-records/baselines/chatgpt");
    assert.deepEqual(readdirSync(baselineDir), [`${PARENT_SESSION}-${PARENT_TURN}.json`]);
    assert.equal(existsSync(resolve(state, ".local/change-records/baselines-reset")), false);

    writeFileSync(resolve(repo, "score.js"), "export const score = 1;\n", "utf8");
    const done = completeChangeTurn(parentTurn, { rootDir: state, codexHome });
    assert.equal(done.queued, true);
    assert.equal(done.event.turn_id, PARENT_TURN);
    assert.equal(done.event.prompt_summary, "重构评分查询");
    assert.deepEqual(done.event.changed_files, [{ status: "A", path: "score.js" }]);
  });
});

test("a main-thread turn is not mistaken for a subagent when the session already spawned one", () => {
  withRepo(({ repo, state, codexHome }) => {
    writeRollout(codexHome, { threadId: PARENT_SESSION, sessionId: PARENT_SESSION });
    writeRollout(codexHome, {
      threadId: "01a05bba-529d-7052-a200-936bdf9ceea3",
      sessionId: PARENT_SESSION,
      threadSource: "subagent",
      parentThreadId: PARENT_SESSION,
      turnIds: ["01a05bba-5399-7291-af5a-fa83bc401054"]
    });

    const nextTurn = "01a05bbf-1111-7000-9000-000000000001";
    assert.equal(
      beginChangeTurn(codexInput(repo, PARENT_SESSION, nextTurn, "继续"), { rootDir: state, codexHome }).skipped,
      undefined
    );
    const baseline = readJson(
      resolve(state, `.local/change-records/baselines/chatgpt/${PARENT_SESSION}-${nextTurn}.json`)
    );
    assert.equal(baseline.threadId, PARENT_SESSION);
  });
});

test("consecutive main-thread turns still supersede the unfinished baseline", () => {
  withRepo(({ repo, state, codexHome }) => {
    writeRollout(codexHome, { threadId: PARENT_SESSION, sessionId: PARENT_SESSION });
    const firstTurn = "01a05bc0-1111-7000-9000-000000000001";
    const secondTurn = "01a05bc0-2222-7000-9000-000000000002";
    beginChangeTurn(codexInput(repo, PARENT_SESSION, firstTurn, "第一轮"), { rootDir: state, codexHome });
    beginChangeTurn(codexInput(repo, PARENT_SESSION, secondTurn, "第二轮"), { rootDir: state, codexHome });

    const archiveRoot = resolve(state, ".local/change-records/baselines-reset");
    const [runId] = readdirSync(archiveRoot);
    const manifest = readJson(resolve(archiveRoot, runId, "manifest.json"));
    assert.equal(manifest.reason, "superseded");
    assert.deepEqual(manifest.entries.map((entry) => entry.key), [`${PARENT_SESSION}-${firstTurn}`]);
  });
});

test("a new main-thread turn supersedes a pre-upgrade baseline that has no threadId", () => {
  withRepo(({ repo, state, codexHome }) => {
    writeRollout(codexHome, { threadId: PARENT_SESSION, sessionId: PARENT_SESSION });
    const oldTurn = "01a05bc1-1111-7000-9000-000000000001";
    const nextTurn = "01a05bc1-2222-7000-9000-000000000002";
    beginChangeTurn(codexInput(repo, PARENT_SESSION, oldTurn, "升级前的一轮"), { rootDir: state, codexHome });

    const baselineDir = resolve(state, ".local/change-records/baselines/chatgpt");
    const oldFile = resolve(baselineDir, `${PARENT_SESSION}-${oldTurn}.json`);
    const legacy = readJson(oldFile);
    delete legacy.threadId;
    writeFileSync(oldFile, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    beginChangeTurn(codexInput(repo, PARENT_SESSION, nextTurn, "继续"), { rootDir: state, codexHome });

    const archiveRoot = resolve(state, ".local/change-records/baselines-reset");
    const [runId] = readdirSync(archiveRoot);
    const manifest = readJson(resolve(archiveRoot, runId, "manifest.json"));
    assert.equal(manifest.reason, "superseded");
    assert.deepEqual(manifest.entries.map((entry) => entry.key), [`${PARENT_SESSION}-${oldTurn}`]);
    assert.equal(existsSync(oldFile), false);
    assert.equal(readJson(resolve(baselineDir, `${PARENT_SESSION}-${nextTurn}.json`)).threadId, PARENT_SESSION);
  });
});

test("a Codex subagent turn does not supersede a pre-upgrade parent baseline", () => {
  withRepo(({ repo, state, codexHome }) => {
    writeRollout(codexHome, { threadId: PARENT_SESSION, sessionId: PARENT_SESSION });
    const oldTurn = "01a05bc2-1111-7000-9000-000000000001";
    const subagentTurn = "01a05bba-5399-7291-af5a-fa83bc401054";
    const baselineDir = resolve(state, ".local/change-records/baselines/chatgpt");
    mkdirSync(baselineDir, { recursive: true });
    const parentFile = resolve(baselineDir, `${PARENT_SESSION}-${oldTurn}.json`);
    writeFileSync(
      parentFile,
      JSON.stringify({
        schemaVersion: 1,
        source: "ChatGPT",
        sessionId: PARENT_SESSION,
        turnId: oldTurn,
        key: `${PARENT_SESSION}-${oldTurn}`,
        cwd: repo,
        repoRoot: repo,
        project: "repo",
        startedAt: "2026-09-01T06:45:45.000Z"
      }),
      "utf8"
    );
    writeRollout(codexHome, {
      threadId: "01a05bba-529d-7052-a200-936bdf9ceea3",
      sessionId: PARENT_SESSION,
      threadSource: "subagent",
      parentThreadId: PARENT_SESSION,
      turnIds: [subagentTurn]
    });

    const result = beginChangeTurn(
      codexInput(repo, PARENT_SESSION, subagentTurn, "Act as the Bugbot review subagent."),
      { rootDir: state, codexHome }
    );

    assert.equal(result.skipped, "codex_subagent");
    assert.equal(existsSync(parentFile), true);
    assert.equal(existsSync(resolve(state, ".local/change-records/baselines-reset")), false);
  });
});

test("health reconciliation archives leftover subagent baselines that legacy lookups could not resolve", () => {
  withCodexHome(({ root, codexHome }) => {
    const startedAt = "2026-09-01T06:48:57.615Z";
    const subagentTurn = "01a05bba-5399-7291-af5a-fa83bc401054";
    const mainTurn = "01a05bb7-6c5e-71b2-9dc1-bf6e1966002b";
    const baselineDir = resolve(root, ".local/change-records/baselines/chatgpt");
    mkdirSync(baselineDir, { recursive: true });

    writeRollout(codexHome, {
      threadId: PARENT_SESSION,
      sessionId: PARENT_SESSION,
      startedAt,
      turnIds: [mainTurn],
      terminal: { turnId: mainTurn, type: "task_complete" }
    });
    writeRollout(codexHome, {
      threadId: "01a05bba-529d-7052-a200-936bdf9ceea3",
      sessionId: PARENT_SESSION,
      threadSource: "subagent",
      parentThreadId: PARENT_SESSION,
      startedAt,
      turnIds: [subagentTurn],
      terminal: { turnId: subagentTurn, type: "task_complete" }
    });

    // The stranded baseline predates threadId, so the reason must be recovered from the rollouts.
    for (const turnId of [subagentTurn, mainTurn]) {
      writeFileSync(
        resolve(baselineDir, `${PARENT_SESSION}-${turnId}.json`),
        JSON.stringify({ source: "ChatGPT", sessionId: PARENT_SESSION, turnId, key: `${PARENT_SESSION}-${turnId}`, startedAt }),
        "utf8"
      );
    }

    const result = archiveAbortedBaselines({
      rootDir: root,
      codexHome,
      now: Date.parse(startedAt) + 31 * 60_000
    });

    assert.equal(result.archivedCount, 1);
    assert.equal(result.entries[0].reason, "codex_subagent");
    assert.equal(existsSync(resolve(baselineDir, `${PARENT_SESSION}-${subagentTurn}.json`)), false);
    assert.equal(
      existsSync(resolve(baselineDir, `${PARENT_SESSION}-${mainTurn}.json`)),
      true,
      "a completed main-thread turn still needs an alert because its change record was lost"
    );
  });
});

function writeRollout(codexHome, {
  threadId,
  sessionId,
  threadSource = "user",
  parentThreadId = "",
  startedAt = new Date().toISOString(),
  turnIds = [],
  terminal = null
}) {
  const date = new Date(startedAt);
  const directory = resolve(
    codexHome,
    "sessions",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  );
  mkdirSync(directory, { recursive: true });
  const lines = [
    JSON.stringify({
      timestamp: startedAt,
      type: "session_meta",
      payload: {
        session_id: sessionId,
        id: threadId,
        ...(parentThreadId ? { parent_thread_id: parentThreadId } : {}),
        thread_source: threadSource,
        cwd: "D:\\project\\omp-node-servive"
      }
    }),
    ...turnIds.map((turnId) => JSON.stringify({
      timestamp: startedAt,
      type: "event_msg",
      payload: { type: "task_started", turn_id: turnId }
    })),
    ...(terminal
      ? [JSON.stringify({
          timestamp: startedAt,
          type: "event_msg",
          payload: { type: terminal.type, turn_id: terminal.turnId }
        })]
      : [])
  ];
  const filePath = resolve(directory, `rollout-${startedAt.replace(/[:.]/g, "-")}-${threadId}.jsonl`);
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

function codexInput(cwd, sessionId, turnId, prompt = "") {
  return { source: "ChatGPT", cwd, session_id: sessionId, turn_id: turnId, prompt };
}

function withCodexHome(run) {
  const root = mkdtempSync(resolve(tmpdir(), "amber-subagent-"));
  try {
    run({ root, codexHome: resolve(root, "codex-home") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withRepo(run) {
  const root = mkdtempSync(resolve(tmpdir(), "amber-subagent-repo-"));
  const repo = resolve(root, "repo");
  mkdirSync(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(resolve(repo, "initial.txt"), "initial\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  try {
    run({ root, repo, state: resolve(root, "state"), codexHome: resolve(root, "codex-home") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

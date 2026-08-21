import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  closeAllWatchers,
  createRepositoryWatcher,
  getWatcherStatus
} from "../scripts/lib/commit-watch.mjs";

test("watcher status reports inactive when no watchers are registered", () => {
  closeAllWatchers();
  const status = getWatcherStatus();
  assert.equal(status.status, "inactive");
  assert.equal(status.watchedRepositoryCount, 0);
  assert.equal(status.lastEventAt, null);
  assert.deepEqual(status.errors, []);
});

test("createRepositoryWatcher registers and closes a repository watcher", () => {
  closeAllWatchers();
  const repo = createTempRepo();
  try {
    const handle = createRepositoryWatcher({
      repoPath: repo,
      debounceMs: 50,
      maxWaitMs: 200,
      onTrigger: () => {}
    });
    const status = getWatcherStatus();
    assert.equal(status.status, "active");
    assert.equal(status.watchedRepositoryCount, 1);

    handle.close();
    const afterClose = getWatcherStatus();
    assert.equal(afterClose.watchedRepositoryCount, 0);
  } finally {
    closeAllWatchers();
    rmSync(repo, { recursive: true, force: true });
  }
});

test("closeAllWatchers clears all registered watchers", () => {
  closeAllWatchers();
  const repo1 = createTempRepo();
  const repo2 = createTempRepo();
  try {
    createRepositoryWatcher({
      repoPath: repo1,
      debounceMs: 50,
      maxWaitMs: 200,
      onTrigger: () => {}
    });
    createRepositoryWatcher({
      repoPath: repo2,
      debounceMs: 50,
      maxWaitMs: 200,
      onTrigger: () => {}
    });
    assert.equal(getWatcherStatus().watchedRepositoryCount, 2);

    closeAllWatchers();
    assert.equal(getWatcherStatus().watchedRepositoryCount, 0);
    assert.equal(getWatcherStatus().status, "inactive");
  } finally {
    closeAllWatchers();
    rmSync(repo1, { recursive: true, force: true });
    rmSync(repo2, { recursive: true, force: true });
  }
});

test("createRepositoryWatcher accepts injected timers without throwing", () => {
  closeAllWatchers();
  const repo = createTempRepo();
  try {
    const timers = createFakeTimers();
    const handle = createRepositoryWatcher({
      repoPath: repo,
      debounceMs: 750,
      maxWaitMs: 5000,
      onTrigger: () => {},
      timers
    });
    assert.equal(getWatcherStatus().status, "active");
    assert.equal(getWatcherStatus().watchedRepositoryCount, 1);
    handle.close();
  } finally {
    closeAllWatchers();
    rmSync(repo, { recursive: true, force: true });
  }
});

function createTempRepo() {
  const root = mkdtempSync(resolve(tmpdir(), "amber-watch-test-"));
  mkdirSync(root, { recursive: true });
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  writeFileSync(resolve(root, "initial.txt"), "initial\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
}

function createFakeTimers() {
  const timeouts = new Map();
  const intervals = new Map();
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timeouts.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    }
  };
}
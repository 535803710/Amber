import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { superviseWatchers } from "../scripts/lib/watch-supervisor.mjs";

test("UI watcher failure leaves record workers running", () => {
  const ui = fakeWatcher("ui");
  const records = fakeWatcher("records");
  const commits = fakeWatcher("commits");
  const fatalErrors = [];
  const warnings = [];

  superviseWatchers([ui, records, commits], {
    onFatal: (message) => fatalErrors.push(message),
    onWarning: (message) => warnings.push(message)
  });

  ui.emit("exit", 1, null);

  assert.deepEqual(fatalErrors, []);
  assert.equal(records.killed, false);
  assert.equal(commits.killed, false);
  assert.match(warnings[0], /ui.*继续运行/i);
});

test("optional watcher failure is restarted without stopping record workers", () => {
  const ui = fakeWatcher("ui");
  const replacement = fakeWatcher("ui");
  const records = fakeWatcher("records");
  const children = [ui, records];
  const states = [];

  superviseWatchers(children, {
    restartOptional: (child) => {
      assert.equal(child, ui);
      return replacement;
    },
    scheduleRestart: (callback) => callback(),
    onOptionalState: (state) => states.push(state)
  });

  ui.emit("exit", 1, null);

  assert.equal(children[0], replacement);
  assert.equal(records.killed, false);
  assert.deepEqual(states.map((state) => state.status), ["restarting", "running"]);
});

test("record worker failure remains fatal", () => {
  const ui = fakeWatcher("ui");
  const records = fakeWatcher("records");
  const commits = fakeWatcher("commits");
  const fatalErrors = [];

  superviseWatchers([ui, records, commits], {
    onFatal: (message, code) => fatalErrors.push({ message, code })
  });

  records.emit("exit", 1, null);

  assert.deepEqual(fatalErrors, [
    { message: "[records] 异常退出 (code 1)", code: 1 }
  ]);
});

function fakeWatcher(label) {
  const watcher = new EventEmitter();
  watcher.label = label;
  watcher.killed = false;
  watcher.kill = () => {
    watcher.killed = true;
  };
  return watcher;
}

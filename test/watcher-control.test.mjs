import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  startWatcher,
  resolveWatcherStartCommand,
  waitForWatcherStart
} from "../scripts/lib/watcher-control.mjs";

test("Windows background startup uses the PowerShell process launcher", () => {
  const launch = resolveWatcherStartCommand("win32");

  assert.equal(launch.command, "powershell.exe");
  assert.deepEqual(launch.args.slice(0, 4), [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File"
  ]);
  assert.match(launch.args[4], /start-watch-background\.ps1$/i);
  assert.deepEqual(launch.args.slice(-2), ["-Profile", "core"]);
});

test("Windows background startup forwards the full runtime profile", () => {
  const launch = resolveWatcherStartCommand("win32", "full");
  assert.deepEqual(launch.args.slice(-2), ["-Profile", "full"]);
});

test("watcher startup fails when the launcher exits without starting services", async () => {
  await assert.rejects(
    () => waitForWatcherStart({
      getStatus: () => ({ running: false, healthRunning: false }),
      timeoutMs: 10,
      pollIntervalMs: 1,
      sleep: async () => {}
    }),
    /启动后未进入运行状态/
  );
});

test("watcher startup waits for both watcher and health monitor", async () => {
  let checks = 0;
  const status = await waitForWatcherStart({
    getStatus: () => {
      checks += 1;
      return checks < 2
        ? { running: true, healthRunning: false }
        : { running: true, healthRunning: true, pid: 123 };
    },
    timeoutMs: 100,
    pollIntervalMs: 1,
    sleep: async () => {}
  });

  assert.equal(checks, 2);
  assert.equal(status.pid, 123);
});

test("concurrent watcher starts share one launcher", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-watcher-start-"));
  let launchCount = 0;
  let running = false;
  const options = {
    getStatus: () => ({ running, healthRunning: running, pid: running ? 321 : null }),
    launchWatcher: () => {
      launchCount += 1;
      running = true;
      return { pid: 654, failure: new Promise(() => {}), stop: () => {} };
    },
    timeoutMs: 100,
    pollIntervalMs: 1
  };

  const [first, second] = await Promise.all([
    startWatcher(root, options),
    startWatcher(root, options)
  ]);

  assert.equal(launchCount, 1);
  assert.equal(first.pid, 321);
  assert.deepEqual(second, first);
});

test("watcher startup surfaces launcher failures", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-watcher-failure-"));
  let stopped = false;

  await assert.rejects(
    () => startWatcher(root, {
      getStatus: () => ({ running: false, healthRunning: false }),
      launchWatcher: () => ({
        pid: 987,
        failure: Promise.reject(new Error("PowerShell launcher failed")),
        stop: () => { stopped = true; }
      }),
      timeoutMs: 100,
      pollIntervalMs: 1
    }),
    /PowerShell launcher failed/
  );

  assert.equal(stopped, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveWatcherStartCommand } from "../scripts/lib/watcher-control.mjs";

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
});

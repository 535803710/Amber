import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRuntimeProfile,
  runtimeWatcherLabels
} from "../scripts/lib/runtime-profile.mjs";

test("core profile starts only AI and Git record workers", () => {
  assert.equal(resolveRuntimeProfile([], "core"), "core");
  assert.deepEqual(runtimeWatcherLabels("core"), ["records", "commits"]);
});

test("full profile retains Windows toast and UI prompt listeners", () => {
  assert.equal(resolveRuntimeProfile(["--profile", "full"]), "full");
  assert.deepEqual(runtimeWatcherLabels("full"), ["toast", "ui", "records", "commits"]);
});

test("runtime profile rejects unsupported values", () => {
  assert.throws(() => resolveRuntimeProfile(["--profile", "other"]), /core 或 full/);
  assert.throws(() => runtimeWatcherLabels("other"), /core 或 full/);
});

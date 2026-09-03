import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

test("Dashboard 配置写入磁盘并在服务重启后恢复", async (t) => {
  const base = mkdtempSync(resolve(tmpdir(), "amber-dashboard-config-"));
  const target = resolve(base, "installed Amber with spaces");
  const scanRoot = resolve(target, "projects");
  const repositoryRoot = resolve(import.meta.dirname, "..");
  cpSync(resolve(repositoryRoot, "scripts"), resolve(target, "scripts"), { recursive: true });
  mkdirSync(scanRoot, { recursive: true });

  const port = await findFreePort();
  const env = cleanConfigEnv(process.env);
  let child = null;
  t.after(async () => {
    await stopChild(child);
    rmSync(base, { recursive: true, force: true });
  });

  child = startDashboard(resolve(target, "scripts/dashboard-server.mjs"), port, env);
  await waitForDashboard(port, child);
  await postJson(port, "/api/feishu-settings", {
    webhookUrl: "https://example.test/general",
    webhookSecret: "general-secret"
  });
  await postJson(port, "/api/change-record-settings", {
    webhookUrl: "https://example.test/change",
    webhookToken: "change-token"
  });
  await postJson(port, "/api/commit-record-settings", {
    webhookUrl: "https://example.test/commit",
    webhookToken: "commit-token",
    scanRoots: [scanRoot]
  });
  await stopChild(child);
  child = null;

  const envLocal = readFileSync(resolve(target, ".env.local"), "utf8");
  assert.match(envLocal, /FEISHU_WEBHOOK_URL=https:\/\/example\.test\/general/);
  assert.match(envLocal, /FEISHU_CHANGE_WEBHOOK_URL=https:\/\/example\.test\/change/);
  assert.match(envLocal, /FEISHU_COMMIT_WEBHOOK_URL=https:\/\/example\.test\/commit/);
  assert.match(envLocal, /FEISHU_COMMIT_WEBHOOK_TOKEN=commit-token/);
  assert.match(envLocal, /COMMIT_RECORD_SCAN_ROOTS=.*projects/);

  child = startDashboard(resolve(target, "scripts/dashboard-server.mjs"), port, env);
  const state = await waitForDashboard(port, child, "/api/state");
  assert.equal(state.feishu.configured, true);
  assert.equal(state.feishu.secretConfigured, true);
  assert.match(state.changeRecords.webhookMasked, /^https:\/\/example\.test\//);
  assert.equal(state.changeRecords.tokenConfigured, true);
  assert.equal(state.commitRecords.configured, true);
  assert.equal(state.commitRecords.tokenConfigured, true);
  assert.equal(state.commitRecords.scanConfigured, true);
  assert.match(state.commitRecords.webhookMasked, /^https:\/\/example\.test\//);
  assert.deepEqual(state.commitRecords.scanRoots, [scanRoot]);

  const invalid = await fetch(`http://127.0.0.1:${port}/api/commit-record-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl: "file:///invalid", scanRoots: [scanRoot] })
  });
  assert.equal(invalid.status, 400);

  const cleared = await postJson(port, "/api/commit-record-settings", {
    clearWebhook: true,
    clearToken: true,
    scanRoots: [scanRoot]
  });
  assert.equal(cleared.configured, false);
  assert.equal(cleared.tokenConfigured, false);
  const clearedEnv = readFileSync(resolve(target, ".env.local"), "utf8");
  assert.doesNotMatch(clearedEnv, /FEISHU_COMMIT_WEBHOOK_(URL|TOKEN)=/);
});

test("Dashboard 提供完整的 Git 提交记录配置入口", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const html = readFileSync(resolve(repositoryRoot, "dashboard/index.html"), "utf8");
  const app = readFileSync(resolve(repositoryRoot, "dashboard/app.js"), "utf8");

  for (const id of [
    "commitWebhookUrl",
    "commitWebhookToken",
    "clearCommitWebhook",
    "clearCommitToken",
    "commitScanRoots",
    "saveCommitRecordSettingsBtn"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }
  assert.match(app, /api\("\/api\/commit-record-settings"/);
});

function startDashboard(script, port, env) {
  const child = spawn(process.execPath, [script, "--port", String(port)], {
    cwd: dirname(script),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.getOutput = () => output;
  return child;
}

async function waitForDashboard(port, child, pathname = "/api/settings") {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dashboard 提前退出：${child.getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // 服务仍在启动。
    }
    await delay(50);
  }
  throw new Error(`Dashboard 启动超时：${child.getOutput()}`);
}

async function postJson(port, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

function cleanConfigEnv(source) {
  const env = { ...source };
  for (const key of [
    "FEISHU_WEBHOOK_URL",
    "FEISHU_WEBHOOK_SECRET",
    "FEISHU_CHANGE_WEBHOOK_URL",
    "FEISHU_CHANGE_WEBHOOK_TOKEN",
    "FEISHU_COMMIT_WEBHOOK_URL",
    "FEISHU_COMMIT_WEBHOOK_TOKEN",
    "COMMIT_RECORD_SCAN_ROOTS"
  ]) {
    delete env[key];
  }
  return env;
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveStop) => {
    child.once("exit", resolveStop);
    child.kill();
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

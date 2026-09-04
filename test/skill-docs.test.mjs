import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SKILL = readFileSync(resolve(ROOT, "skills/amber/SKILL.md"), "utf8");
const ONBOARDING = readFileSync(resolve(ROOT, "skills/amber/references/onboarding.md"), "utf8");
const TROUBLESHOOTING = readFileSync(resolve(ROOT, "skills/amber/references/troubleshooting.md"), "utf8");
const FORBIDDEN_SECRETS = [
  "Inmhb4Vl0alBIAsvzaxcxC0Ln0d",
  "tblppOxOQCQkAzoY",
  "tbl9MKpf3sAHG4tR"
];
const TRIGGERS = [
  "帮我接入 Amber",
  "打开 Amber 控制台",
  "检查 Amber 是否正常",
  "把这个项目加入 Amber",
  "更新 Amber",
  "恢复上一个版本"
];
const COMMANDS = [
  "install",
  "space init",
  "space connect",
  "space status",
  "project add",
  "project remove",
  "project list",
  "open",
  "status",
  "doctor",
  "update",
  "rollback",
  "uninstall"
];
const ERROR_CODES = [
  "windows_only",
  "template_token_missing",
  "webhook_setup_required",
  "schema_mismatch",
  "project_key_required",
  "dashboard_unhealthy",
  "update_health_failed"
];

test("SKILL.md 含必填段落、触发语和 CLI 入口", () => {
  assert.match(SKILL, /^---\r?\nname:\s*amber\r?\n/m);
  assert.match(SKILL, /^## 触发/m);
  assert.match(SKILL, /^## 调用 CLI|^## 命令/m);
  assert.match(SKILL, /^## 安全边界/m);
  assert.match(SKILL, /^## 结果解释/m);
  for (const trigger of TRIGGERS) {
    assert.match(SKILL, new RegExp(escapeRegExp(trigger)));
  }
  assert.match(SKILL, /node bin\/amber\.mjs/);
  assert.match(SKILL, /%AMBER_HOME%\\amber\.bat/);
  assert.match(SKILL, /npx --yes --registry=https:\/\/npm-fe\.transsion\.com\/ @amber\/cli@beta/);
  for (const command of COMMANDS) {
    assert.match(SKILL, new RegExp(escapeRegExp(command)));
  }
  assert.match(SKILL, /references\/onboarding\.md/);
  assert.match(SKILL, /references\/troubleshooting\.md/);
});

test("SKILL.md 写明安全边界并解释 CLI JSON", () => {
  assert.match(SKILL, /不把 webhook.*token.*读进对话|不把 webhook、token/i);
  assert.match(SKILL, /不扩大采集范围/);
  assert.match(SKILL, /不访问用户 Base 以外/);
  assert.match(SKILL, /只编排/);
  assert.match(SKILL, /不自己改 IDE JSON/);
  assert.match(SKILL, /status/);
  assert.match(SKILL, /code/);
  assert.match(SKILL, /actions/);
});

test("Skill 文档禁止事项：不含默认密钥，不教 Agent 手改 IDE JSON", () => {
  for (const document of [SKILL, ONBOARDING, TROUBLESHOOTING]) {
    for (const secret of FORBIDDEN_SECRETS) {
      assert.equal(document.includes(secret), false);
    }
    assert.equal(/writeFileSync\([^)]*mcp\.json/i.test(document), false);
    assert.equal(/直接(?:修改|编辑|写入).*(?:mcp\.json|hooks\.json|settings\.json)/.test(document), false);
  }
  assert.match(ONBOARDING, /不要手改 IDE JSON|不自己改 IDE JSON|不要去改 Hook JSON/);
});

test("onboarding.md 覆盖首次安装到 project add", () => {
  assert.match(ONBOARDING, /首次安装/);
  assert.match(ONBOARDING, /Hook 信任/);
  assert.match(ONBOARDING, /space init/);
  assert.match(ONBOARDING, /两个 webhook|两个「接收到 Webhook|粘贴两个 webhook|分别从两个工作流/i);
  assert.match(ONBOARDING, /project add/);
  assert.match(ONBOARDING, /npx --yes --registry=https:\/\/npm-fe\.transsion\.com\/ @amber\/cli@beta install/);
});

test("troubleshooting.md 为每个常见 code 给出 doctor 恢复步骤", () => {
  assert.match(TROUBLESHOOTING, /doctor --json/);
  for (const code of ERROR_CODES) {
    assert.match(TROUBLESHOOTING, new RegExp(`^## ${code}\\b`, "m"));
    const section = sectionAfter(TROUBLESHOOTING, code);
    assert.match(section, /doctor/);
  }
});

function sectionAfter(markdown, heading) {
  const match = markdown.split(new RegExp(`^## ${heading}\\b.*$`, "m"))[1] || "";
  return match.split(/^## /m)[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FORBIDDEN_AI_TABLE_ID,
  FORBIDDEN_BASE_TOKEN,
  FORBIDDEN_COMMIT_TABLE_ID,
  auditPackageFiles,
  collectPublishableFiles
} from "../scripts/lib/pack-audit.mjs";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SECRETS = [FORBIDDEN_BASE_TOKEN, FORBIDDEN_AI_TABLE_ID, FORBIDDEN_COMMIT_TABLE_ID];

test("当前仓库 collectPublishableFiles 不含人员复测文档和 .env.local", () => {
  const files = collectPublishableFiles(REPOSITORY_ROOT);
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes(".env.example"));
  assert.ok(files.includes("skills/amber/SKILL.md"));
  assert.equal(files.some((file) => file.includes("杨金辉")), false);
  assert.equal(files.some((file) => file.includes("Windows-MVP-第二台机器")), false);
  assert.equal(files.some((file) => /(^|\/)docs(\/|$)/.test(file)), false);
  assert.equal(files.some((file) => /(^|\/)test(\/|$)/.test(file)), false);
  assert.equal(files.some((file) => /(^|\/)\.local(\/|$)/.test(file)), false);
  assert.equal(files.some((file) => /(^|\/)\.env\.local$/.test(file)), false);
});

test("故意塞入 token 的 fixture 不能发布", () => {
  const result = auditPackageFiles(
    [
      "scripts/lib/task-context/constants.mjs",
      "docs/Windows-MVP-mvp.3-杨金辉复测步骤-2026-09-03.md",
      "docs/Windows-MVP-第二台机器试测问题-2026-09-03.md",
      ".env.local",
      ".local/change-records/queue/sent/example.json",
      "README.md"
    ],
    {
      "scripts/lib/task-context/constants.mjs": [
        `export const AMBER_BASE_TOKEN = "${FORBIDDEN_BASE_TOKEN}";`,
        `export const AI_TABLE_ID = "${FORBIDDEN_AI_TABLE_ID}";`,
        `export const COMMIT_TABLE_ID = "${FORBIDDEN_COMMIT_TABLE_ID}";`
      ].join("\n"),
      "README.md": "https://open.feishu.cn/open-apis/bot/v2/hook/11111111-2222-3333-4444-555555555555"
    }
  );
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.path.endsWith("constants.mjs") && /Base token/.test(item.reason)));
  assert.ok(result.findings.some((item) => item.path.endsWith("constants.mjs") && /AI table id/.test(item.reason)));
  assert.ok(result.findings.some((item) => item.path.endsWith("constants.mjs") && /commit table id/.test(item.reason)));
  assert.ok(result.findings.some((item) => item.path.includes("杨金辉")));
  assert.ok(result.findings.some((item) => item.path.includes("Windows-MVP-第二台机器")));
  assert.ok(result.findings.some((item) => item.path === ".env.local"));
  assert.ok(result.findings.some((item) => item.path.startsWith(".local/")));
  assert.ok(result.findings.some((item) => item.path === "README.md" && /webhook/.test(item.reason)));
});

test("干净 fixture 可以通过发布审计", () => {
  const result = auditPackageFiles(
    ["LICENSE", "README.md", ".env.example", "skills/amber/SKILL.md"],
    {
      LICENSE: "Copyright 2026 Amber contributors\n",
      "README.md": "# Amber\n未配置 Base token 与表 ID 时 MCP 不能读飞书，回退本地队列。\n",
      ".env.example": "AMBER_BASE_TOKEN=\nAMBER_AI_TABLE_ID=\nFEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-token\n",
      "skills/amber/SKILL.md": "# Amber\nSkill 只编排不自己改 IDE JSON。\n"
    }
  );
  assert.deepEqual(result, { ok: true, findings: [] });
});

test(".env.example 与 constants.mjs 不再含默认 Base 密钥", () => {
  const example = readFileSync(resolve(REPOSITORY_ROOT, ".env.example"), "utf8");
  const constants = readFileSync(
    resolve(REPOSITORY_ROOT, "scripts/lib/task-context/constants.mjs"),
    "utf8"
  );
  for (const secret of SECRETS) {
    assert.equal(example.includes(secret), false, `.env.example 仍含 ${secret}`);
    assert.equal(constants.includes(secret), false, `constants.mjs 仍含 ${secret}`);
  }
});

test("当前仓库可发布文件通过敏感信息审计", () => {
  const files = collectPublishableFiles(REPOSITORY_ROOT);
  const contents = Object.fromEntries(
    files.map((file) => [file, readFileSync(resolve(REPOSITORY_ROOT, file), "utf8")])
  );
  const result = auditPackageFiles(files, contents);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test("package.json 指向公司 npm registry", () => {
  const pkg = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.name, "@amber/cli");
  assert.equal(pkg.private, false);
  assert.equal(pkg.publishConfig?.registry, "https://npm-fe.transsion.com/");
});

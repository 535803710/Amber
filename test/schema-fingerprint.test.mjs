import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  AI_TABLE_NAME,
  GIT_TABLE_NAME,
  REQUIRED_AI_FIELDS,
  REQUIRED_GIT_FIELDS,
  compareSpaceSchema,
  fingerprintSpaceTemplate,
  fingerprintTable,
  loadSpaceTemplate
} from "../scripts/lib/schema-fingerprint.mjs";

test("冻结模板指向真实 Amber 空间，表名与契约字段稳定", () => {
  const template = loadSpaceTemplate();
  assert.equal(template.templateToken, "JDHxbOPw9aBWrQskKBRcw911nPI");
  assert.equal(
    template.templateUrl,
    "https://transsioner.feishu.cn/base/JDHxbOPw9aBWrQskKBRcw911nPI"
  );
  const names = template.tables.map((table) => table.name);
  assert.deepEqual(names, [AI_TABLE_NAME, GIT_TABLE_NAME]);
  assert.equal(AI_TABLE_NAME, "VibeCoding修改记录");
  assert.equal(GIT_TABLE_NAME, "Git提交记录");

  const ai = template.tables.find((table) => table.name === AI_TABLE_NAME);
  const git = template.tables.find((table) => table.name === GIT_TABLE_NAME);
  for (const field of REQUIRED_AI_FIELDS) {
    assert.ok(ai.fields.some((item) => item.name === field), `缺少 AI 字段 ${field}`);
  }
  for (const field of REQUIRED_GIT_FIELDS) {
    assert.ok(git.fields.some((item) => item.name === field), `缺少 Git 字段 ${field}`);
  }

  assert.equal(fingerprintTable(ai), "385e5f70c30685c4");
  assert.equal(fingerprintTable(git), "8e0a7dc4c542ed30");
  assert.equal(ai.fingerprint, fingerprintTable(ai));
  assert.equal(git.fingerprint, fingerprintTable(git));
  assert.deepEqual(fingerprintSpaceTemplate(template), fingerprintSpaceTemplate(loadSpaceTemplate()));
  assert.match(fingerprintTable(ai), /^[a-f0-9]{16}$/);
});

test("字段缺失或改名判定不兼容，额外字段只警告", () => {
  const template = loadSpaceTemplate();
  const missingAuthor = withFields(template, AI_TABLE_NAME, (fields) =>
    fields.filter((field) => fieldName(field) !== "作者")
  );
  const missing = compareSpaceSchema(missingAuthor, template);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "schema_mismatch");
  assert.ok(missing.missingFields.includes(`${AI_TABLE_NAME}.作者`));

  const renamed = withFields(template, AI_TABLE_NAME, (fields) =>
    fields.map((field) => fieldName(field) === "作者" ? { name: "作者名称", type: "text" } : field)
  );
  const renamedResult = compareSpaceSchema(renamed, template);
  assert.equal(renamedResult.ok, false);
  assert.ok(renamedResult.missingFields.includes(`${AI_TABLE_NAME}.作者`));
  assert.ok(renamedResult.extraFields.includes(`${AI_TABLE_NAME}.作者名称`));

  const extra = withFields(template, GIT_TABLE_NAME, (fields) => [
    ...fields,
    { name: "备注", type: "text" }
  ]);
  const extraResult = compareSpaceSchema(extra, template);
  assert.equal(extraResult.ok, true);
  assert.equal(extraResult.code, "schema_ok");
  assert.deepEqual(extraResult.extraFields, [`${GIT_TABLE_NAME}.备注`]);
  assert.deepEqual(extraResult.missingFields, []);
});

test("loadSpaceTemplate 可读取自定义路径", () => {
  const root = mkdtempSync(resolve(tmpdir(), "amber-template-"));
  try {
    const template = loadSpaceTemplate();
    const custom = resolve(root, "custom.json");
    writeFileSync(custom, JSON.stringify(template), "utf8");
    assert.equal(
      fingerprintTable(loadSpaceTemplate(custom).tables[0]),
      fingerprintTable(template.tables[0])
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fieldName(field) {
  return typeof field === "string" ? field : field.name;
}

function withFields(template, tableName, mapFields) {
  return {
    tables: template.tables.map((table) => (
      table.name === tableName
        ? { ...table, fields: mapFields(table.fields) }
        : table
    ))
  };
}

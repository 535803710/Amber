import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPACE_TEMPLATE_VERSION = 1;
export const AI_TABLE_NAME = "VibeCoding修改记录";
export const GIT_TABLE_NAME = "Git提交记录";

export const DEFAULT_SPACE_TEMPLATE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/feishu/amber-space.v1.json"
);

export const REQUIRED_AI_FIELDS = Object.freeze([
  "作者",
  "作者邮箱",
  "修改记录",
  "完成时间",
  "工具",
  "项目",
  "仓库路径",
  "分支",
  "HEAD 提交",
  "用户需求",
  "修改结果",
  "修改文件",
  "文件数",
  "新增行",
  "删除行",
  "结果状态",
  "采集质量",
  "会话 ID",
  "轮次 ID",
  "事件 ID"
]);

export const REQUIRED_GIT_FIELDS = Object.freeze([
  "提交标题",
  "提交说明",
  "项目",
  "仓库路径",
  "分支",
  "修改文件",
  "提交时间",
  "事件ID",
  "提交SHA",
  "关联AI事件ID",
  "作者",
  "远端地址"
]);

export function loadSpaceTemplate(path = DEFAULT_SPACE_TEMPLATE_PATH) {
  const template = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("飞书 Amber 空间模板无效。");
  }
  const tables = Array.isArray(template.tables) ? template.tables : [];
  if (!tables.some((table) => tableName(table) === AI_TABLE_NAME)) {
    throw new Error(`飞书 Amber 空间模板缺少表：${AI_TABLE_NAME}`);
  }
  if (!tables.some((table) => tableName(table) === GIT_TABLE_NAME)) {
    throw new Error(`飞书 Amber 空间模板缺少表：${GIT_TABLE_NAME}`);
  }
  return template;
}

export function fingerprintTable(table) {
  const name = tableName(table);
  const fields = fieldNames(table).join("\n");
  return createHash("sha256")
    .update(`${name}\n${fields}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function fingerprintSpaceTemplate(template) {
  const source = template || loadSpaceTemplate();
  const fingerprints = {};
  for (const table of source.tables || []) {
    fingerprints[tableName(table)] = fingerprintTable(table);
  }
  return fingerprints;
}

export function compareSpaceSchema(actual, template) {
  const expected = template || loadSpaceTemplate();
  const actualTables = indexTables(actual?.tables || actual || []);
  const expectedTables = Array.isArray(expected?.tables) ? expected.tables : [];
  const tables = [];
  const missingFields = [];
  const extraFields = [];
  const extraTables = [];

  for (const expectedTable of expectedTables) {
    const name = tableName(expectedTable);
    const actualTable = actualTables.get(name);
    const expectedNames = fieldNames(expectedTable);
    const actualNames = actualTable ? fieldNames(actualTable) : [];
    const expectedSet = new Set(expectedNames);
    const actualSet = new Set(actualNames);
    const tableMissing = expectedNames.filter((field) => !actualSet.has(field));
    const tableExtra = actualNames.filter((field) => !expectedSet.has(field));
    const missingTable = !actualTable;
    const ok = !missingTable && tableMissing.length === 0;

    if (missingTable) {
      missingFields.push(...expectedNames.map((field) => `${name}.${field}`));
    } else {
      missingFields.push(...tableMissing.map((field) => `${name}.${field}`));
      extraFields.push(...tableExtra.map((field) => `${name}.${field}`));
    }

    tables.push({
      name,
      ok,
      missingTable,
      fingerprint: actualTable ? fingerprintTable(actualTable) : "",
      expectedFingerprint: fingerprintTable(expectedTable),
      missingFields: missingTable ? [...expectedNames] : tableMissing,
      extraFields: tableExtra
    });
  }

  for (const [name] of actualTables) {
    if (!expectedTables.some((table) => tableName(table) === name)) {
      extraTables.push(name);
    }
  }

  return {
    ok: missingFields.length === 0,
    code: missingFields.length === 0 ? "schema_ok" : "schema_mismatch",
    missingFields,
    extraFields,
    extraTables,
    tables
  };
}

function indexTables(tables) {
  const list = Array.isArray(tables) ? tables : [];
  const map = new Map();
  for (const table of list) {
    const name = tableName(table);
    if (name) map.set(name, table);
  }
  return map;
}

function tableName(table) {
  if (typeof table === "string") return table.trim();
  return String(table?.name || "").trim();
}

function fieldNames(table) {
  const fields = Array.isArray(table?.fields) ? table.fields : [];
  const names = fields
    .map((field) => (typeof field === "string" ? field : field?.name))
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "en"));
}

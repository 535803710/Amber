import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { timestamp } from "./constants.mjs";

// 路径归一化：反斜杠→正斜杠、小写、去尾斜杠
export function normalizePath(value) {
  let normalized = String(value || "").replaceAll("\\", "/").toLowerCase();
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

// 当前分支提示（读 .git/HEAD）；失败返回空串
function currentBranchHint(workspaceRoot) {
  const marker = resolve(workspaceRoot, ".git", "HEAD");
  try {
    const content = readFileSync(marker, "utf8").trim();
    return content.startsWith("ref: refs/heads/") ? content.slice("ref: refs/heads/".length) : "";
  } catch {
    return "";
  }
}

// 中文二元 + 拉丁分词；过滤停用词
function tokenize(value) {
  const normalized = String(value).toLowerCase();
  const latinTokens = normalized.match(/[a-z0-9_./-]{2,}/g) || [];
  const cjkRuns = normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
  const cjkTokens = cjkRuns.flatMap((run) => {
    const tokens = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
    if (run.length <= 8) tokens.push(run);
    return tokens;
  });
  const stopWords = new Set([
    "修改", "代码", "功能", "问题", "页面", "调整", "继续", "实现", "修复", "新增", "完成", "配置",
    "需求", "结果", "方案", "验证", "测试", "支持", "处理", "描述", "名称", "名词", "更新", "能力",
    "目标", "流程", "步骤", "使用", "数据", "信息", "原因", "之前", "过去", "是否", "可能", "需要",
    "提供", "查询", "调用", "记录", "项目", "文档", "说明", "研发", "现场", "恢复", "系统", "任务",
    "上下", "下文", "上下文", "当前", "历史", "决策", "避免", "无关", "相关", "相关性", "影响", "优化",
    "change", "changes", "code", "context", "current", "decision", "docs", "fix", "history", "implement",
    "issue", "project", "record", "task", "update"
  ]);
  return [...new Set([...latinTokens, ...cjkTokens])].filter((token) => !stopWords.has(token));
}

function recordsRelatedFile(record, request) {
  return record.project === request.project && record.files.some((file) => request.files.includes(normalizePath(file)));
}

function scoreRecord(record, request, taskWords, fileSet) {
  let score = 0;
  const matchReasons = [];
  const exactRepository = normalizePath(record.repository) === normalizePath(request.workspaceRoot);
  const sameProject = record.project === request.project;
  const repositoryCompatible = exactRepository || (!record.repository && sameProject);
  const sameBranch = record.branch && record.branch === currentBranchHint(request.workspaceRoot);
  const exactFile = record.files.some((file) => fileSet.has(normalizePath(file)));
  const corpus = `${record.task}\n${record.result}`.toLowerCase();
  const keywordHits = [...new Set(taskWords.filter((word) => corpus.includes(word)))];
  const semanticAnchor = keywordHits.length >= 2;
  const fileSemanticAnchor = exactFile && keywordHits.length >= 1;
  const eligible = repositoryCompatible && (semanticAnchor || fileSemanticAnchor);

  if (sameProject) score += 1;
  if (exactRepository) {
    score += 3;
    matchReasons.push("same_repository");
  }
  if (sameBranch) {
    score += 2;
    matchReasons.push("same_branch");
  }
  if (exactFile) {
    score += 6;
    matchReasons.push("exact_file");
  }
  if (keywordHits.length) {
    score += keywordHits.length * 2;
    matchReasons.push("task_keywords");
  }
  if (recordsRelatedFile(record, request)) score += 1;

  return {
    relevance: score,
    eligible,
    confidence: eligible ? "high" : "none",
    matchReasons
  };
}

export function rankRecords(records, request) {
  const taskWords = tokenize(request.task);
  const fileSet = new Set(request.files);
  return records.map((record) => ({
    ...record,
    ...scoreRecord(record, request, taskWords, fileSet)
  })).sort((left, right) =>
    right.relevance - left.relevance
    || timestamp(right.occurredAt) - timestamp(left.occurredAt)
    || right.id.localeCompare(left.id)
  );
}

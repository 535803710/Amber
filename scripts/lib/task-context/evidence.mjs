import { text, timestamp } from "./constants.mjs";

const HISTORY_TEXT_LIMIT = 600;
const HISTORY_HEAD_LIMIT = 159;
const HISTORY_TAIL_LIMIT = 238;
const HISTORY_KEYWORD_WINDOW_LIMIT = 100;
const FILE_TEXT_LIMIT = 240;
const FILE_LIMIT = 12;
const RELATED_COMMIT_LIMIT = 3;
const TEXT_TRUNCATION_MARKER = "…（已截断）";
const FILE_TRUNCATION_MARKER = "…（其余文件已截断）";

export function deduplicateRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.type}:${record.id}`;
    if (!record.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function toEvidence(record, commits, detail, task) {
  const core = {
    task: summarizeHistoryText(record.task, task),
    result: summarizeHistoryText(record.result, task),
    occurred_at: record.occurredAt,
    files: limitFiles(record.files)
  };
  if (detail === "minimal") return core;

  const relatedCommits = commits
    .filter((commit) => commit.relatedEventIds.includes(record.id))
    .sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))
    .slice(0, RELATED_COMMIT_LIMIT)
    .map((commit) => toRelatedCommit(commit, detail));
  const compact = {
    kind: "ai_change",
    ...core,
    occurred_at: record.occurredAt,
    branch: record.branch,
    related_commits: relatedCommits
  };
  if (detail === "compact") return compact;

  return {
    id: record.id,
    ...compact,
    repository: record.repository,
    source: record.source,
    confidence: record.confidence,
    match_reasons: record.matchReasons,
    relevance: record.relevance
  };
}

function toRelatedCommit(commit, detail) {
  const compact = {
    sha: limitPlainText(commit.commitSha || commit.id),
    subject: limitPlainText(commit.result),
    occurred_at: commit.occurredAt
  };
  if (detail === "compact") return compact;
  return {
    id: commit.id,
    ...compact,
    files: limitFiles(commit.files),
    source: commit.source
  };
}

export function statusMessage(status) {
  if (status === "degraded") return "历史来源不完整，已尝试本地回退，结果可能不完整。";
  if (status === "no_strong_history") return "未找到与当前任务强关联的 AI 修改记录。";
  return "";
}

function limitPlainText(value) {
  const normalized = text(value);
  if (normalized.length <= FILE_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, FILE_TEXT_LIMIT - TEXT_TRUNCATION_MARKER.length)}${TEXT_TRUNCATION_MARKER}`;
}

function limitFiles(files) {
  const normalized = Array.isArray(files) ? files.map(limitPlainText).filter(Boolean) : [];
  if (normalized.length < FILE_LIMIT) return normalized;
  return [...normalized.slice(0, FILE_LIMIT - 1), FILE_TRUNCATION_MARKER];
}

function summarizeHistoryText(value, task) {
  const normalized = text(value);
  if (normalized.length <= HISTORY_TEXT_LIMIT) return normalized;

  const spans = [
    { start: 0, end: HISTORY_HEAD_LIMIT },
    { start: normalized.length - HISTORY_TAIL_LIMIT, end: normalized.length }
  ];
  const lower = normalized.toLowerCase();
  let matched = 0;
  for (const term of snippetTerms(task)) {
    const index = lower.indexOf(term);
    if (index < 0) continue;
    spans.push({
      start: Math.max(0, index - Math.floor(HISTORY_KEYWORD_WINDOW_LIMIT / 2)),
      end: Math.min(normalized.length, index + term.length + Math.ceil(HISTORY_KEYWORD_WINDOW_LIMIT / 2))
    });
    matched += 1;
    if (matched === 2) break;
  }

  if (matched === 0) {
    return `${normalized.slice(0, 300)}…${normalized.slice(-299)}`;
  }

  const merged = mergeSpans(spans);
  return merged.map((span) => normalized.slice(span.start, span.end)).join("…");
}

function snippetTerms(task) {
  const value = String(task || "").toLowerCase();
  const latin = value.match(/[a-z0-9_./-]{2,}/g) || [];
  const cjkRuns = value.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
  const cjkBigrams = cjkRuns.flatMap((run) => {
    const values = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      values.push(run.slice(index, index + 2));
    }
    return values;
  });
  return [...new Set([...latin, ...cjkBigrams])]
    .sort((left, right) => right.length - left.length);
}

function mergeSpans(spans) {
  return spans
    .sort((left, right) => left.start - right.start)
    .reduce((merged, span) => {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end) {
        previous.end = Math.max(previous.end, span.end);
      } else {
        merged.push({ ...span });
      }
      return merged;
    }, []);
}

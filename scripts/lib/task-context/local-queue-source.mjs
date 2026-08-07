import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { text } from "./constants.mjs";

export function readLocalRecords(workspaceRoot) {
  return [
    ...readLocalQueue(workspaceRoot, ".local/change-records/queue", "change"),
    ...readLocalQueue(workspaceRoot, ".local/commit-records/queue", "commit")
  ];
}

function readLocalQueue(workspaceRoot, relativeRoot, type) {
  const root = resolve(workspaceRoot, relativeRoot);
  if (!existsSync(root)) return [];
  return ["pending", "sent", "failed"].flatMap((status) => {
    const directory = resolve(root, status);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson(resolve(directory, entry.name))?.event)
      .filter(Boolean)
      .map((event) => type === "change" ? mapLocalAi(event) : mapLocalCommit(event));
  });
}

function mapLocalAi(event) {
  return {
    id: text(event.event_id),
    type: "change",
    task: text(event.prompt_summary),
    result: text(event.result_summary),
    project: text(event.project),
    repository: text(event.repo_path),
    branch: text(event.branch),
    files: filePaths(event.changed_files),
    occurredAt: text(event.completed_at),
    relatedEventIds: [],
    source: "local"
  };
}

function mapLocalCommit(event) {
  return {
    id: text(event.event_id || event.commit_sha),
    commitSha: text(event.commit_sha),
    type: "commit",
    task: "",
    result: text(event.commit_subject || event.commit_message),
    project: text(event.project),
    repository: text(event.repo_path),
    branch: text(event.branch),
    files: filePaths(event.changed_files),
    occurredAt: text(event.committed_at),
    relatedEventIds: Array.isArray(event.related_ai_event_ids) ? event.related_ai_event_ids.map(text).filter(Boolean) : [],
    source: "local"
  };
}

function filePaths(value) {
  return Array.isArray(value) ? value.map((item) => text(item?.path || item)).filter(Boolean) : [];
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
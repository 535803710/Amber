#!/usr/bin/env node

/** 飞书/手环展示用分类（短文案） */
export const NOTIFY_CATEGORY_LABELS = {
  done: "完成",
  action: "需要操作",
  error: "异常",
  info: "提示",
  test: "测试",
  running: "进行中"
};

const TOAST_DONE_PATTERNS = [/^\s*done\b/i, /view the agent'?s output/i, /任务完成/i];
const TOAST_ACTION_PATTERNS = [
  /input needed/i,
  /command approval/i,
  /answer the agent/i,
  /需要你回答/i,
  /需要你确认/i,
  /需要批准/i,
  /等你回答/i,
  /需要你确认/i
];

/**
 * 根据 status + 原始消息推断展示分类
 */
export function resolveNotifyCategory(status, rawMessage = "") {
  const normalizedStatus = String(status || "info").toLowerCase();
  const haystack = String(rawMessage || "");

  if (normalizedStatus === "done") {
    return "done";
  }
  if (normalizedStatus === "error") {
    return "error";
  }
  if (normalizedStatus === "wait" || normalizedStatus === "ask") {
    return "action";
  }
  if (normalizedStatus === "test") {
    return "test";
  }
  if (normalizedStatus === "running") {
    return "running";
  }

  if (matchesAny(haystack, TOAST_ACTION_PATTERNS)) {
    return "action";
  }
  if (matchesAny(haystack, TOAST_DONE_PATTERNS)) {
    return "done";
  }

  return "info";
}

export function getNotifyCategoryLabel(status, rawMessage = "") {
  const category = resolveNotifyCategory(status, rawMessage);
  return NOTIFY_CATEGORY_LABELS[category] || NOTIFY_CATEGORY_LABELS.info;
}

/** 从 app / 进程名识别编辑器 */
export function resolveEditorFromAppName(appName) {
  const name = String(appName || "").toLowerCase();
  if (/chatgpt/.test(name)) {
    return "ChatGPT";
  }
  if (/codex/.test(name)) {
    return "Codex";
  }
  if (/cursor/.test(name)) {
    return "Cursor";
  }
  return null;
}

/**
 * 推断飞书第一行展示的编辑器名
 */
export function resolveEditorName({ source, appName, processName, message } = {}) {
  const explicit = normalizeEditorName(source || process.env.AMBER_EDITOR);
  if (explicit) {
    return explicit;
  }

  const fromApp = resolveEditorFromAppName(appName) || resolveEditorFromAppName(processName);
  if (fromApp) {
    return fromApp;
  }

  const fromMessage = resolveEditorFromMessage(message);
  if (fromMessage) {
    return fromMessage;
  }

  const legacyTitle = normalizeEditorName(process.env.VIBECODING_NOTIFY_TITLE);
  if (legacyTitle) {
    return legacyTitle;
  }

  return "Cursor";
}

/**
 * 从内部 message 提取任务名（飞书第三行）
 */
export function extractTaskName(message, status) {
  let text = String(message || "").trim();
  if (!text) {
    return "";
  }

  text = text.replace(/^\[(完成|需要操作|异常|提示|测试|进行中)\]\s*/, "");

  const doneMatch = text.match(/^(.+?)完成$/);
  if (doneMatch) {
    return trimTaskName(doneMatch[1]);
  }

  const failMatch = text.match(/^(.+?)失败[：:]/);
  if (failMatch) {
    return trimTaskName(failMatch[1]);
  }

  const timeoutMatch = text.match(/^(.+?)超时[：:]/);
  if (timeoutMatch) {
    return trimTaskName(timeoutMatch[1]);
  }

  const startFailMatch = text.match(/^(.+?)启动失败[：:]/);
  if (startFailMatch) {
    return trimTaskName(startFailMatch[1]);
  }

  text = cleanTaskBoilerplate(text);
  if (!text || isGenericTaskName(text)) {
    return "";
  }

  return trimTaskName(text);
}

/**
 * 飞书正文：编辑器名 + 分类 + 任务名（手环友好）
 */
export function formatFeishuText({ source, appName, processName, status, message, task }) {
  const label = getNotifyCategoryLabel(status, message);
  const editor = resolveEditorName({ source, appName, processName, message });
  const taskName = String(task || "").trim() || extractTaskName(message, status);

  if (taskName) {
    return `${editor}\n${label}\n${taskName}`;
  }

  return `${editor}\n${label}`;
}

/**
 * 从 Windows toast 提取短摘要（仅用于日志/去重，不发送到飞书正文）
 */
export function compactToastSummary(item) {
  const title = String(item?.title || "").trim();
  const body = String(item?.body || "").trim();
  let text = [title, body].filter(Boolean).join(" ");

  text = text
    .replace(/^\s*done\s*[·•?\u00b7\-–—]*\s*/i, "")
    .replace(/^\s*input needed\s*[·•?\u00b7\-–—]*\s*/i, "")
    .replace(/^\s*command approval\s*[·•?\u00b7\-–—]*\s*/i, "")
    .replace(/\s*open cursor to answer the agent'?s questions?\.?\s*/gi, " ")
    .replace(/\s*open cursor to view the agent'?s output\.?\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 80) {
    return `${text.slice(0, 77)}...`;
  }

  return text || "系统通知";
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeEditorName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "chatgpt") {
    return "ChatGPT";
  }
  if (normalized === "codex") {
    return "Codex";
  }
  if (normalized === "cursor") {
    return "Cursor";
  }
  return null;
}

function resolveEditorFromMessage(message) {
  const text = String(message || "");

  if (/^\[codex\]/i.test(text) || /^codex[\s：:]/i.test(text)) {
    return "Codex";
  }
  if (/^\[cursor\]/i.test(text) || /^cursor[\s：:]/i.test(text)) {
    return "Cursor";
  }

  const lower = text.toLowerCase();
  const hasCodex = /\bcodex\b/.test(lower);
  const hasCursor = /\bcursor\b/.test(lower);
  if (hasCodex && !hasCursor) {
    return "Codex";
  }
  if (hasCursor && !hasCodex) {
    return "Cursor";
  }

  return null;
}

function cleanTaskBoilerplate(text) {
  return String(text || "")
    .replace(/^\s*done\s*[·•?\u00b7\-–—]*\s*/i, "")
    .replace(/^\s*input needed\s*[·•?\u00b7\-–—]*\s*/i, "")
    .replace(/^\s*command approval\s*[·•?\u00b7\-–—]*\s*/i, "")
    .replace(/\s*open cursor to answer the agent'?s questions?\.?\s*/gi, " ")
    .replace(/\s*open cursor to view the agent'?s output\.?\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericTaskName(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const genericPatterns = [
    /^系统通知$/,
    /^agent\s*提问$/,
    /^view the agent'?s output\.?$/,
    /^input needed$/,
    /^command approval$/,
    /^done$/
  ];

  return genericPatterns.some((pattern) => pattern.test(normalized));
}

function trimTaskName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length > 36) {
    return `${trimmed.slice(0, 33)}...`;
  }

  return trimmed;
}

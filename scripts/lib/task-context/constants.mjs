// task-context 子模块共享的配置常量与基础值归一化辅助

export const AMBER_BASE_TOKEN = "Inmhb4Vl0alBIAsvzaxcxC0Ln0d";
export const AI_TABLE_ID = "tblppOxOQCQkAzoY";
export const COMMIT_TABLE_ID = "tbl9MKpf3sAHG4tR";
export const QUERY_LIMIT = 200;
export const QUERY_TIMEOUT_MS = 8_000;
export const CACHE_TTL_MS = 60_000;
export const DEFAULT_RESULT_LIMIT = 3;
export const MAX_RESULT_LIMIT = 10;

// 字符串/数字/对象 → trim 后的字符串；递归取 text/name/value 字段
export function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") return text(value.text || value.name || value.value);
  return "";
}

// ISO 或非 ISO 时间字符串 → 毫秒数；无效返回 0
export function timestamp(value) {
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? 0 : result;
}

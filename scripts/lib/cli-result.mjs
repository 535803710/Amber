export const CLI_STATUSES = Object.freeze(["ok", "needs_action", "failed"]);

export const CLI_EXIT_CODES = Object.freeze({
  ok: 0,
  failed: 1,
  needs_action: 2
});

const SECRET_PATTERN = /(?:token|authorization|bearer|webhook|secret|password)\s*[:=]\s*(?:bearer\s+)?\S+/gi;
const URL_SECRET_PATTERN = /https?:\/\/[^\s]+(?:hook|token|key)[^\s]*/gi;

export function formatCliResult(input = {}) {
  const status = CLI_STATUSES.includes(input.status) ? input.status : "failed";
  const actions = Array.isArray(input.actions)
    ? input.actions.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const data = input.data && typeof input.data === "object" && !Array.isArray(input.data)
    ? input.data
    : {};
  return {
    status,
    code: String(input.code || defaultCode(status)).trim() || defaultCode(status),
    message: redactCliText(String(input.message || defaultMessage(status))),
    actions,
    data
  };
}

export function exitCodeFor(result) {
  if (result?.status === "ok") return CLI_EXIT_CODES.ok;
  if (result?.status === "needs_action") return CLI_EXIT_CODES.needs_action;
  return CLI_EXIT_CODES.failed;
}

export function printCliResult(result, { json = false, stdout = process.stdout } = {}) {
  const payload = formatCliResult(result);
  if (json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }
  stdout.write(`${payload.message}\n`);
  for (const action of payload.actions) {
    stdout.write(`- ${action}\n`);
  }
  return payload;
}

export function redactCliText(value) {
  return String(value || "")
    .replace(SECRET_PATTERN, "[redacted]")
    .replace(URL_SECRET_PATTERN, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultCode(status) {
  if (status === "ok") return "ok";
  if (status === "needs_action") return "needs_action";
  return "failed";
}

function defaultMessage(status) {
  if (status === "ok") return "完成。";
  if (status === "needs_action") return "需要继续操作。";
  return "命令失败。";
}

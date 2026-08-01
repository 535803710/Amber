import { createHmac } from "node:crypto";
import { assertWebhookSuccess, postJson } from "../change-record-worker.mjs";

export function planHealthAlerts(issues = [], previousState = {}, now = Date.now(), repeatMs) {
  const active = previousState?.active && typeof previousState.active === "object"
    ? previousState.active
    : {};
  const current = new Map(
    issues
      .filter((issue) => issue?.id && (issue.severity === "warning" || issue.severity === "critical"))
      .map((issue) => [issue.id, issue])
  );
  const events = [];
  const nextActive = {};

  for (const [id, issue] of current) {
    const previous = active[id];
    const escalated = previous && severityRank(issue.severity) > severityRank(previous.severity);
    const repeated = previous && issue.severity === "critical" &&
      Number.isFinite(previous.lastNotifiedAt) && now - previous.lastNotifiedAt >= repeatMs;
    const neverNotified = previous && !Number.isFinite(previous.lastNotifiedAt);
    const shouldNotify = !previous || neverNotified || escalated || repeated;
    if (shouldNotify) {
      events.push({
        type: "problem",
        reason: !previous ? "new" : escalated ? "escalated" : "repeat",
        issue
      });
    }
    nextActive[id] = {
      severity: issue.severity,
      component: issue.component,
      message: issue.message,
      startedAt: previous?.startedAt || issue.startedAt,
      lastNotifiedAt: shouldNotify ? now : previous.lastNotifiedAt
    };
  }

  for (const [id, previous] of Object.entries(active)) {
    if (!current.has(id)) {
      events.push({
        type: "recovered",
        issue: {
          id,
          component: previous.component,
          severity: previous.severity,
          message: previous.message,
          startedAt: previous.startedAt
        }
      });
    }
  }

  return {
    events,
    state: {
      active: nextActive,
      updatedAt: new Date(now).toISOString()
    }
  };
}

export function buildHealthAlertPayload(events, now = Date.now()) {
  const lines = ["Amber 采集健康"];
  for (const event of events) {
    const issue = event.issue;
    const prefix = event.type === "recovered" ? "已恢复" : event.reason === "repeat" ? "持续异常" : "异常";
    lines.push(`${prefix}｜${issue.component}｜${issue.message}`);
  }
  return {
    msg_type: "text",
    content: { text: `${lines.join("\n")}\n检查时间：${new Date(now).toISOString()}` }
  };
}

export async function sendHealthAlerts(events, {
  webhookUrl,
  webhookSecret = "",
  requestTimeoutMs = 8_000,
  post = postJson
} = {}) {
  if (!events.length || !webhookUrl) return { sent: false, skipped: true };
  const payload = buildHealthAlertPayload(events);
  if (webhookSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = createFeishuSign(timestamp, webhookSecret);
  }
  const response = await post(webhookUrl, payload, "", requestTimeoutMs);
  assertWebhookSuccess(response);
  return { sent: true, response };
}

function severityRank(value) {
  return value === "critical" ? 2 : value === "warning" ? 1 : 0;
}

function createFeishuSign(timestamp, secret) {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

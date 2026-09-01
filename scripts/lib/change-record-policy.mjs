import { homedir } from "node:os";
import { resolve, sep } from "node:path";

const MEMORY_WRITER_PROMPT = /^##\s+Memory Writing Agent(?::|\b)/i;

export function ignoredChangeReason(input = {}, { codexHome } = {}) {
  if (String(input.source || "").toLowerCase() !== "chatgpt") return null;

  const home = resolve(codexHome || process.env.CODEX_HOME || resolve(homedir(), ".codex"));
  const memories = resolve(home, "memories");
  const paths = [input.cwd, input.repoRoot]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!paths.some((path) => isSameOrChild(path, memories))) return null;

  return matchesMemoryWriterPrompt(input)
    ? "internal_memory_agent"
    : null;
}

export function extractChangePrompt(input = {}) {
  return promptFieldText(input) || messageTexts(input).join("\n");
}

function matchesMemoryWriterPrompt(input) {
  const prompt = promptFieldText(input);
  const texts = prompt ? [prompt] : messageTexts(input);
  return texts.some((text) => MEMORY_WRITER_PROMPT.test(String(text).trimStart()));
}

function promptFieldText(input) {
  return firstText(
    input.prompt,
    input.user_message,
    input.userMessage,
    input.message,
    input.input
  );
}

function messageTexts(input) {
  const messages = input.input_messages || input["input-messages"];
  if (!Array.isArray(messages)) return [];
  return messages
    .map((item) => (typeof item === "string" ? item : item?.content || ""))
    .map((text) => String(text || ""))
    .filter(Boolean);
}

function isSameOrChild(path, root) {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function normalizePath(value) {
  const path = resolve(String(value || ""));
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

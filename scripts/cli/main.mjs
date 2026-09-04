import { exitCodeFor, formatCliResult, printCliResult } from "../lib/cli-result.mjs";
import { resolveAmberRoot, resolveUserHome } from "./context.mjs";
import { parseCliArgs } from "./parse-args.mjs";

const COMMAND_LOADERS = {
  install: () => import("./commands/install.mjs"),
  space: () => import("./commands/space.mjs"),
  project: () => import("./commands/project.mjs"),
  open: () => import("./commands/open.mjs"),
  status: () => import("./commands/status.mjs"),
  doctor: () => import("./commands/doctor.mjs"),
  update: () => import("./commands/update.mjs"),
  rollback: () => import("./commands/rollback.mjs"),
  uninstall: () => import("./commands/uninstall.mjs")
};

export async function runAmberCli(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout || process.stdout;
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    return finish(formatCliResult({
      status: "failed",
      code: "invalid_args",
      message: error.message
    }), { json: argv.includes("--json"), stdout });
  }

  if (parsed.flags.help || parsed.command === "help") {
    return finish(formatCliResult({
      status: "ok",
      code: "help",
      message: helpText(),
      data: { commands: Object.keys(COMMAND_LOADERS) }
    }), { json: parsed.flags.json, stdout });
  }

  const loader = COMMAND_LOADERS[parsed.command];
  if (!loader) {
    return finish(formatCliResult({
      status: "failed",
      code: "unknown_command",
      message: `未知命令：${parsed.command}`,
      actions: ["运行 amber --help 查看可用命令"]
    }), { json: parsed.flags.json, stdout });
  }

  const request = {
    command: parsed.command,
    subcommand: parsed.subcommand,
    rest: parsed.rest,
    args: parsed.args,
    positional: parsed.positional,
    flags: parsed.flags,
    extras: parsed.extras,
    env,
    cwd,
    targetRoot: resolveAmberRoot({ flags: parsed.flags, env, cwd }),
    userHome: resolveUserHome({ flags: parsed.flags, env }),
    io: options.io
  };

  try {
    const module = await loadCommand(loader, parsed.command);
    const result = formatCliResult(await module.run(request));
    return finish(result, { json: parsed.flags.json, stdout });
  } catch (error) {
    return finish(formatCliResult({
      status: "failed",
      code: error.code || "command_failed",
      message: error.message || "命令失败。"
    }), { json: parsed.flags.json, stdout });
  }
}

async function loadCommand(loader, name) {
  try {
    const module = await loader();
    if (typeof module.run !== "function") {
      throw Object.assign(new Error(`命令未导出 run：${name}`), { code: "command_unavailable" });
    }
    return module;
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND") {
      throw Object.assign(new Error(`命令尚未实现：${name}`), { code: "command_unavailable" });
    }
    throw error;
  }
}

function finish(result, options) {
  printCliResult(result, options);
  return { result, exitCode: exitCodeFor(result) };
}

function helpText() {
  return [
    "Amber CLI",
    "",
    "  amber install",
    "  amber space init|connect|status",
    "  amber project add|remove|list",
    "  amber open",
    "  amber status",
    "  amber doctor",
    "  amber update",
    "  amber rollback",
    "  amber uninstall",
    "",
    "全局选项：--json  --target <path>  --user-home <path>  --help"
  ].join("\n");
}

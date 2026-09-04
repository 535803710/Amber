import { formatCliResult } from "../../lib/cli-result.mjs";
import { addProject, listProjects, removeProject } from "../../lib/projects.mjs";

export async function run(request = {}) {
  const options = {
    targetRoot: request.targetRoot,
    cwd: request.cwd,
    io: request.io,
    explicitKey: request.extras?.key
  };

  switch (String(request.subcommand || "").trim()) {
    case "add":
      return formatCliResult(addProject({
        ...options,
        path: request.args?.[0]
      }));
    case "remove":
      return formatCliResult(removeProject({
        ...options,
        selector: request.args?.[0]
      }));
    case "list":
      return formatCliResult(listProjects(options));
    default:
      return formatCliResult({
        status: "failed",
        code: "unknown_subcommand",
        message: `未知子命令：${request.subcommand || ""}`,
        actions: ["运行 amber project add|remove|list"]
      });
  }
}

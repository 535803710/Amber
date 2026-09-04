import {
  collectLarkDoctorChecks,
  collectTeamSetupChecks,
  doctorWarn,
  inspectLocalSpace,
  readDesiredProfile,
  readPackageVersion,
  redactDoctorChecks
} from "../../lib/team-setup.mjs";
import { getWatcherStatus } from "../../lib/watcher-control.mjs";

const NEEDS_ACTION_IDS = new Set([
  "ai_webhook",
  "git_webhook",
  "git_scan_roots",
  "autostart",
  "runtime_processes",
  "lark_auth",
  "ai_table",
  "git_table",
  "amber_space",
  "space_schema",
  "projects"
]);

export async function run(request = {}) {
  const {
    flags = {},
    targetRoot,
    userHome,
    env = process.env
  } = request;
  const { checks: baseChecks } = collectTeamSetupChecks({
    targetRoot,
    userHome,
    env,
    skipSystem: flags.skipSystem,
    watcher: request.watcher,
    getStatus: request.getWatcherStatus || getWatcherStatus
  });
  const space = inspectLocalSpace(targetRoot, env);
  const checks = [...baseChecks];
  if (!flags.skipLive) {
    const larkChecks = typeof request.larkChecks === "function"
      ? await request.larkChecks(request)
      : collectLarkDoctorChecks(targetRoot, env);
    checks.push(...larkChecks);
  }
  const moduleChecks = await loadOptionalModuleChecks(request);
  if (Array.isArray(request.extraChecks)) moduleChecks.push(...request.extraChecks);
  if (!moduleChecks.some((item) => item.id === "amber_space" || item.id === "space_schema")) {
    checks.push(doctorWarn("amber_space", "Amber 空间", space.ready, space.ready ? "已配置" : "尚未连接空间或 Webhook"));
  }
  checks.push(...moduleChecks);

  const mapped = checks.map((item) => (
    item.status === "fail" && NEEDS_ACTION_IDS.has(item.id) ? { ...item, status: "warn" } : item
  ));
  const redacted = redactDoctorChecks(mapped, { userHome, targetRoot });
  const result = summarizeChecks(redacted);
  return {
    ...result,
    actions: result.actions,
    data: {
      schemaVersion: 1,
      version: readPackageVersion(targetRoot),
      profile: readDesiredProfile(targetRoot),
      checks: redacted
    }
  };
}

function summarizeChecks(checks) {
  if (checks.some((item) => item.status === "fail")) {
    return {
      status: "failed",
      code: "doctor_failed",
      message: "Amber 检查未通过。",
      actions: ["根据 data.checks 中的 FAIL 项修复后重试 amber doctor"]
    };
  }
  if (checks.some((item) => item.status === "warn")) {
    const code = needsActionCode(checks);
    return {
      status: "needs_action",
      code,
      message: "Amber 仍需完成配置。",
      actions: actionsFor(code)
    };
  }
  return {
    status: "ok",
    code: "healthy",
    message: "Amber 运行正常。",
    actions: []
  };
}

function needsActionCode(checks) {
  const ids = new Set(checks.filter((item) => item.status === "warn").map((item) => item.id));
  if (ids.has("ai_webhook") || ids.has("git_webhook")) return "webhook_setup_required";
  if (ids.has("amber_space") || ids.has("space_schema") || ids.has("ai_table") || ids.has("git_table")) {
    return "space_missing";
  }
  if (ids.has("lark_auth")) return "lark_login_required";
  if (ids.has("runtime_processes") || ids.has("autostart")) return "runtime_not_running";
  return "needs_action";
}

function actionsFor(code) {
  if (code === "webhook_setup_required" || code === "space_missing") return ["运行 amber space init"];
  if (code === "lark_login_required") return ["完成 lark-cli 登录后重试 amber doctor"];
  if (code === "runtime_not_running") return ["运行 amber.bat start"];
  return ["运行 amber doctor --json 查看详情"];
}

async function loadOptionalModuleChecks(request) {
  if (Array.isArray(request.moduleChecks)) return request.moduleChecks;
  const checks = [];
  const spaceCommand = await optionalImport(new URL("./space.mjs", import.meta.url).href);
  const spaceLib = await optionalImport(new URL("../../lib/space.mjs", import.meta.url).href);
  const projectsLib = await optionalImport(new URL("../../lib/projects.mjs", import.meta.url).href);
  const projectCommand = await optionalImport(new URL("./project.mjs", import.meta.url).href);
  try {
    if (!request.flags?.skipLive && typeof spaceCommand?.run === "function") {
      const result = await spaceCommand.run({ ...request, command: "space", subcommand: "status" });
      if (Array.isArray(result?.data?.checks)) {
        checks.push(...result.data.checks);
      } else if (result) {
        const schemaFailed = result.code === "schema_mismatch";
        checks.push(schemaFailed
          ? { id: "space_schema", label: "空间表结构", status: "fail", detail: result.message || "" }
          : doctorWarn("amber_space", "Amber 空间", result.status === "ok", result.message || ""));
      }
    } else if (typeof spaceLib?.readSpaceState === "function") {
      const space = spaceLib.readSpaceState(request.targetRoot);
      checks.push(doctorWarn(
        "amber_space",
        "Amber 空间",
        Boolean(space?.baseToken),
        space?.baseToken ? "已连接" : "尚未连接空间"
      ));
    }
  } catch {
    // 空间模块未就绪时跳过，不让 doctor 崩溃。
  }
  try {
    if (typeof projectsLib?.listProjects === "function") {
      const result = projectsLib.listProjects(request);
      const count = Array.isArray(result?.data?.projects) ? result.data.projects.length : 0;
      checks.push(doctorWarn("projects", "已注册项目", true, `${count} 个项目`));
    } else if (typeof projectCommand?.run === "function") {
      const result = await projectCommand.run({ ...request, command: "project", subcommand: "list" });
      if (Array.isArray(result?.data?.checks)) checks.push(...result.data.checks);
    }
  } catch {
    // 项目模块未就绪时跳过，不让 doctor 崩溃。
  }
  return checks;
}

async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

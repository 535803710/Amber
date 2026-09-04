import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { inspectLocalSpace } from "../../lib/team-setup.mjs";
import { getWatcherStatus } from "../../lib/watcher-control.mjs";

export async function run(request = {}) {
  const {
    targetRoot,
    env = process.env,
    getWatcherStatus: getStatus = getWatcherStatus
  } = request;
  const runtimeInstalled = existsSync(resolve(targetRoot, "scripts/mcp-stdio-server.mjs"));
  const watcher = getStatus(targetRoot);
  const space = typeof request.getSpaceStatus === "function"
    ? await request.getSpaceStatus(request)
    : await defaultSpaceStatus(request);
  const projectCount = typeof request.getProjectCount === "function"
    ? Number(await request.getProjectCount(request)) || 0
    : await defaultProjectCount(request);
  const spaceReady = space?.ready === true || space?.status === "ok";
  const data = {
    runtimeInstalled,
    watcherRunning: Boolean(watcher.running),
    healthRunning: Boolean(watcher.healthRunning),
    spaceReady,
    projectCount
  };

  if (!runtimeInstalled) {
    return {
      status: "failed",
      code: "runtime_missing",
      message: "尚未安装 Amber Runtime。",
      actions: ["运行 amber install"],
      data
    };
  }
  if (!spaceReady) {
    return {
      status: "needs_action",
      code: "space_missing",
      message: "尚未连接 Amber 空间。",
      actions: ["运行 amber space init"],
      data
    };
  }
  return {
    status: "ok",
    code: "ready",
    message: "Amber 已就绪。",
    actions: [],
    data
  };
}

async function defaultSpaceStatus(request) {
  const spaceCommand = await optionalImport(new URL("./space.mjs", import.meta.url).href);
  try {
    if (typeof spaceCommand?.run === "function") {
      return await spaceCommand.run({ ...request, command: "space", subcommand: "status" });
    }
  } catch {
    // 空间命令未就绪时回退到本地 .env.local。
  }
  return inspectLocalSpace(request.targetRoot, request.env);
}

async function defaultProjectCount(request) {
  const projectsLib = await optionalImport(new URL("../../lib/projects.mjs", import.meta.url).href);
  const projectCommand = await optionalImport(new URL("./project.mjs", import.meta.url).href);
  try {
    if (typeof projectsLib?.listProjects === "function") {
      const result = projectsLib.listProjects(request);
      return Array.isArray(result?.data?.projects) ? result.data.projects.length : 0;
    }
    if (typeof projectCommand?.run === "function") {
      const result = await projectCommand.run({ ...request, command: "project", subcommand: "list" });
      return Number(result?.data?.count ?? result?.data?.projects?.length) || 0;
    }
  } catch {
    return 0;
  }
  return 0;
}

async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

import { resolve } from "node:path";

import { startWatcher, stopWatcher } from "../../lib/watcher-control.mjs";
import {
  assertValidRuntimePackage,
  planUpdate,
  rollbackRuntime
} from "../../lib/runtime-update.mjs";

export async function run(request = {}) {
  const {
    flags = {},
    extras = {},
    args = [],
    rest = [],
    cwd = process.cwd(),
    targetRoot
  } = request;
  const source = extras.source ? resolve(cwd, extras.source) : "";
  if (!source) {
    return {
      status: "needs_action",
      code: "update_source_required",
      message: "一期请提供本地 --source 目录模拟更新包。",
      actions: ["amber update --source <本地包目录> --version <版本>"],
      data: {}
    };
  }

  try {
    assertValidRuntimePackage(source);
  } catch (error) {
    return invalidPackageResult(error);
  }

  const version = String(extras.version || args[0] || rest[0] || "").trim() || undefined;
  const stopRuntime = request.stopRuntime || ((root) => stopWatcher(root));
  const startRuntime = request.startRuntime || ((root) => startWatcher(root));
  const plan = request.planUpdate || planUpdate;
  const rollback = request.rollbackRuntime || rollbackRuntime;
  const doctor = request.doctor;

  await stopRuntime(targetRoot);
  let planned;
  try {
    planned = plan({ currentRoot: targetRoot, nextSource: source, version });
  } catch (error) {
    await startRuntime(targetRoot);
    if (error.code === "update_invalid_package") return invalidPackageResult(error);
    throw error;
  }

  const doctorResult = doctor
    ? await doctor({ ...request, flags: { ...flags, skipLive: true } })
    : await defaultDoctor(request);
  if (doctorResult?.status === "failed") {
    const rolled = rollback({ targetRoot });
    await startRuntime(targetRoot);
    return {
      status: "failed",
      code: "update_health_failed",
      message: "更新后健康检查失败，已自动回滚。",
      actions: ["运行 amber doctor"],
      data: { ...planned, rollback: rolled }
    };
  }

  await startRuntime(targetRoot);
  return {
    status: "ok",
    code: "updated",
    message: `已更新到 ${planned.version}。`,
    actions: [],
    data: planned
  };
}

function invalidPackageResult(error) {
  return {
    status: "failed",
    code: "update_invalid_package",
    message: error.message || "更新包无效。",
    actions: ["检查更新包是否包含 scripts/mcp-stdio-server.mjs"],
    data: {}
  };
}

async function defaultDoctor(request) {
  const doctor = await optionalImport(new URL("./doctor.mjs", import.meta.url).href);
  if (typeof doctor?.run !== "function") return { status: "ok", code: "healthy" };
  return doctor.run({ ...request, flags: { ...request.flags, skipLive: true } });
}

async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

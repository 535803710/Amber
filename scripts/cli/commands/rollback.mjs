import { startWatcher, stopWatcher } from "../../lib/watcher-control.mjs";
import { rollbackRuntime } from "../../lib/runtime-update.mjs";

export async function run(request = {}) {
  const { targetRoot } = request;
  const stopRuntime = request.stopRuntime || ((root) => stopWatcher(root));
  const startRuntime = request.startRuntime || ((root) => startWatcher(root));
  const rollback = request.rollbackRuntime || rollbackRuntime;

  try {
    await stopRuntime(targetRoot);
    const result = rollback({ targetRoot });
    await startRuntime(targetRoot);
    return {
      status: "ok",
      code: "rolled_back",
      message: `已回滚到 ${result.version}。`,
      actions: [],
      data: result
    };
  } catch (error) {
    try {
      await startRuntime(targetRoot);
    } catch {
      // 回滚失败时仍尝试拉起原 Runtime，忽略二次错误。
    }
    return {
      status: "failed",
      code: error.code || "rollback_unavailable",
      message: error.message || "没有可回滚的 Runtime 版本。",
      actions: ["运行 amber status"],
      data: {}
    };
  }
}

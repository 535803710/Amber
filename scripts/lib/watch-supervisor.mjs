const OPTIONAL_WATCHERS = new Set(["toast", "ui"]);

export function superviseWatchers(
  children,
  {
    isProbe = false,
    isStopping = () => false,
    onFatal = () => {},
    onWarning = () => {},
    onProbeComplete = () => {}
  } = {}
) {
  let exitedCount = 0;

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (isStopping()) {
        return;
      }

      const label = child.label;
      const failed = code !== 0 || signal;
      if (!isProbe && OPTIONAL_WATCHERS.has(label)) {
        const detail = failed
          ? signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          : "正常退出";
        onWarning(`[${label}] 已退出（${detail}），核心记录 worker 继续运行`);
        return;
      }

      if (failed) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        onFatal(`[${label}] 异常退出 (${detail})`, code || 1);
        return;
      }

      if (isProbe) {
        exitedCount += 1;
        if (exitedCount >= children.length) {
          onProbeComplete();
        }
        return;
      }

      onFatal(`[${label}] 意外退出`, 1);
    });

    child.on("error", (error) => {
      if (!isProbe && OPTIONAL_WATCHERS.has(child.label)) {
        onWarning(`[${child.label}] 启动失败：${error.message}；核心记录 worker 继续运行`);
        return;
      }
      onFatal(`[${child.label}] 启动失败：${error.message}`, 1);
    });
  }
}

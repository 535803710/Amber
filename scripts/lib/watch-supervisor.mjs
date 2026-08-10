const OPTIONAL_WATCHERS = new Set(["toast", "ui"]);

export function superviseWatchers(
  children,
  {
    isProbe = false,
    isStopping = () => false,
    onFatal = () => {},
    onWarning = () => {},
    onProbeComplete = () => {},
    restartOptional = null,
    scheduleRestart = (callback, delayMs) => setTimeout(callback, delayMs),
    onOptionalState = () => {},
    optionalRestartDelayMs = 1_000,
    optionalRestartLimit = 3,
    optionalRestartResetMs = 60_000,
    now = () => Date.now()
  } = {}
) {
  let exitedCount = 0;
  const restartStates = new Map();

  children.forEach((child, index) => attach(child, index));

  function attach(child, index) {
    let settled = false;
    const startedAt = now();

    child.on("exit", (code, signal) => {
      if (settled || isStopping()) {
        return;
      }
      settled = true;

      const label = child.label;
      const failed = code !== 0 || signal;
      if (!isProbe && OPTIONAL_WATCHERS.has(label)) {
        const detail = failed
          ? signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          : "正常退出";
        handleOptionalFailure(child, index, detail, startedAt);
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
      if (settled || isStopping()) {
        return;
      }
      settled = true;
      if (!isProbe && OPTIONAL_WATCHERS.has(child.label)) {
        handleOptionalFailure(child, index, `启动失败：${error.message}`, startedAt);
        return;
      }
      onFatal(`[${child.label}] 启动失败：${error.message}`, 1);
    });
  }

  function handleOptionalFailure(child, index, detail, startedAt) {
    const label = child.label;
    onWarning(`[${label}] 已退出（${detail}），核心记录 worker 继续运行`);
    if (typeof restartOptional !== "function") {
      return;
    }

    const previous = restartStates.get(label) || { restarts: 0 };
    const restarts = now() - startedAt >= optionalRestartResetMs
      ? 1
      : previous.restarts + 1;
    restartStates.set(label, { restarts });
    if (restarts > optionalRestartLimit) {
      onOptionalState({ label, status: "failed", restarts, detail });
      onWarning(`[${label}] 连续重启失败，等待人工检查`);
      return;
    }

    onOptionalState({ label, status: "restarting", restarts, detail });
    scheduleRestart(() => {
      if (isStopping()) {
        return;
      }
      try {
        const replacement = restartOptional(child);
        if (!replacement) {
          throw new Error("未创建替代 watcher");
        }
        children[index] = replacement;
        attach(replacement, index);
        onOptionalState({ label, status: "running", restarts, detail: null });
      } catch (error) {
        onOptionalState({
          label,
          status: "failed",
          restarts,
          detail: error?.message || String(error)
        });
        onWarning(`[${label}] 重启失败：${error?.message || error}`);
      }
    }, optionalRestartDelayMs);
  }
}

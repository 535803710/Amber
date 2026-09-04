import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function run(request = {}) {
  const {
    env = process.env,
    targetRoot,
    probe = defaultProbe,
    startDashboard = defaultStartDashboard,
    openBrowser = defaultOpenBrowser,
    sleep = delay,
    retries = 20,
    delayMs = 250
  } = request;
  const port = Number.parseInt(env.AMBER_DASHBOARD_PORT || env.PORT || "3847", 10) || 3847;
  const origin = `http://127.0.0.1:${port}`;
  const stateUrl = `${origin}/api/state`;

  let running = await probe(stateUrl);
  let started = false;
  if (!running) {
    await startDashboard({ targetRoot, port, env });
    started = true;
    for (let index = 0; index < retries; index += 1) {
      running = await probe(stateUrl);
      if (running) break;
      await sleep(delayMs);
    }
  }

  if (!running) {
    return {
      status: "failed",
      code: "dashboard_unhealthy",
      message: "Dashboard 未能正常启动。",
      actions: ["检查本机 3847 端口后重试 amber open"],
      data: { url: origin, started }
    };
  }

  await openBrowser(origin);
  return {
    status: "ok",
    code: "opened",
    message: `已打开 Amber 控制台：${origin}`,
    actions: [],
    data: { url: origin, started }
  };
}

async function defaultProbe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function defaultStartDashboard({ targetRoot, port, nodeExecutable = process.execPath }) {
  const child = spawn(nodeExecutable, [resolve(targetRoot, "scripts/dashboard-server.mjs"), "--port", String(port)], {
    cwd: targetRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

function defaultOpenBrowser(url) {
  if (process.platform !== "win32") return;
  const child = spawn("cmd.exe", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const els = {
  subtitle: document.querySelector(".subtitle"),
  watcherTitle: document.getElementById("watcherTitle"),
  lastTitle: document.getElementById("lastTitle"),
  rulesTitle: document.getElementById("rulesTitle"),
  configTitle: document.getElementById("configTitle"),
  logTitle: document.getElementById("logTitle"),
  pidLabel: document.getElementById("pidLabel"),
  accessLabel: document.getElementById("accessLabel"),
  webhookStateLabel: document.getElementById("webhookStateLabel"),
  rulesHint: document.getElementById("rulesHint"),
  waitRuleTitle: document.getElementById("waitRuleTitle"),
  waitRuleDesc: document.getElementById("waitRuleDesc"),
  doneRuleTitle: document.getElementById("doneRuleTitle"),
  doneRuleDesc: document.getElementById("doneRuleDesc"),
  infoRuleTitle: document.getElementById("infoRuleTitle"),
  infoRuleDesc: document.getElementById("infoRuleDesc"),
  clearWebhookLabel: document.getElementById("clearWebhookLabel"),
  clearSecretLabel: document.getElementById("clearSecretLabel"),
  autostartLabel: document.getElementById("autostartLabel"),
  watcherBadge: document.getElementById("watcherBadge"),
  watcherPid: document.getElementById("watcherPid"),
  accessStatus: document.getElementById("accessStatus"),
  feishuStatus: document.getElementById("feishuStatus"),
  accessHint: document.getElementById("accessHint"),
  lastStatus: document.getElementById("lastStatus"),
  logTail: document.getElementById("logTail"),
  notifyOnDone: document.getElementById("notifyOnDone"),
  notifyOnWait: document.getElementById("notifyOnWait"),
  notifyOnInfo: document.getElementById("notifyOnInfo"),
  webhookUrl: document.getElementById("webhookUrl"),
  webhookSecret: document.getElementById("webhookSecret"),
  webhookMeta: document.getElementById("webhookMeta"),
  webhookSecretMeta: document.getElementById("webhookSecretMeta"),
  clearWebhook: document.getElementById("clearWebhook"),
  clearSecret: document.getElementById("clearSecret"),
  autostartBadge: document.getElementById("autostartBadge"),
  autostartStatus: document.getElementById("autostartStatus"),
  settingsMsg: document.getElementById("settingsMsg"),
  connectionMsg: document.getElementById("connectionMsg"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  saveFeishuBtn: document.getElementById("saveFeishuBtn"),
  testNotifyBtn: document.getElementById("testNotifyBtn"),
  toggleAutostartBtn: document.getElementById("toggleAutostartBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  themeToggle: document.getElementById("themeToggle"),
  langToggle: document.getElementById("langToggle"),
  toast: document.getElementById("toast")
};

const THEME_KEY = "mi-notic-theme";
const LANG_KEY = "mi-notic-lang";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const I18N = {
  en: {
    htmlLang: "en",
    documentTitle: "mi-notic console",
    subtitle: "toast -> feishu",
    langToggle: "lang zh",
    langAria: "Switch language",
    languageChanged: "language: english",
    themeAria: "Switch theme",
    themeLight: "theme light",
    themeDark: "theme dark",
    refreshAria: "Refresh state",
    refresh: "refresh",
    refreshBusy: "refreshing...",
    refreshed: "refreshed",
    watcherTitle: "watcher",
    lastTitle: "last",
    rulesTitle: "rules",
    configTitle: "config",
    logTitle: "tail .local/watch-toast.log",
    pidLabel: "pid",
    accessLabel: "access",
    webhookStateLabel: "webhook",
    loading: "loading",
    failed: "failed",
    running: "running",
    stopped: "stopped",
    none: "none",
    allowed: "allowed",
    unknown: "unknown",
    accessReady: "toast watcher ready.",
    accessMissing: (guide) => `Windows notification access is not ready. ${guide || ""}`,
    watcherStart: "watcher start",
    watcherStartBusy: "starting...",
    watcherStarted: "watcher started",
    watcherStop: "watcher stop",
    watcherStopBusy: "stopping...",
    watcherStopped: "watcher stopped",
    rulesHint: "toast filter",
    waitRuleTitle: "wait / ask",
    waitRuleDesc: "action required",
    doneRuleTitle: "done",
    doneRuleDesc: "task complete",
    infoRuleTitle: "info",
    infoRuleDesc: "other toast",
    rulesSave: "rules save",
    saveBusy: "saving...",
    rulesSaved: "rules saved",
    settingsSavedDetail: "saved. new Windows toast only.",
    noRecord: "no record",
    statusLabel: "status",
    timeLabel: "time",
    emptyMessage: "empty message",
    webhookPlaceholder: "https://open.feishu.cn/...",
    secretPlaceholder: "optional",
    currentSet: (value) => `current: ${value}`,
    currentUnset: "current: unset",
    secretSet: "secret: set",
    secretUnset: "secret: unset",
    clearWebhook: "clear webhook",
    clearSecret: "clear secret",
    configSave: "config save",
    configSaved: "config saved",
    configSavedDetail: "config saved.",
    notifyTest: "notify test",
    notifyTestBusy: "sending...",
    notifyTestSent: "test sent",
    autostartLabel: "autostart",
    autostartToggle: "autostart toggle",
    autostartOn: "autostart on",
    autostartOff: "autostart off",
    autostartReload: "reload",
    autostartReloadRequired: "reload required",
    autostartMissing: "Autostart API is not loaded. Restart dashboard server.",
    autostartEnabled: (methods) => `enabled${methods.length ? ` (${methods.join(", ")})` : ""}`,
    autostartDisabled: "disabled",
    autostartEnableBusy: "enabling...",
    autostartDisableBusy: "disabling...",
    autostartEnabledToast: "autostart enabled",
    autostartDisabledToast: "autostart disabled",
    autostartEnabledDetail: "autostart enabled.",
    autostartDisabledDetail: "autostart disabled.",
    logEmpty: "no log. watcher writes to .local/watch-toast.log.",
    webhookSet: "set",
    webhookUnset: "unset",
    requestFailed: (status) => `Request failed (${status})`
  },
  zh: {
    htmlLang: "zh-CN",
    documentTitle: "mi-notic 控制台",
    subtitle: "toast -> 飞书",
    langToggle: "语言 en",
    langAria: "切换语言",
    languageChanged: "语言：中文",
    themeAria: "切换明暗模式",
    themeLight: "主题 浅色",
    themeDark: "主题 深色",
    refreshAria: "刷新状态",
    refresh: "刷新",
    refreshBusy: "刷新中...",
    refreshed: "已刷新",
    watcherTitle: "监听器",
    lastTitle: "最近通知",
    rulesTitle: "通知规则",
    configTitle: "连接配置",
    logTitle: "tail .local/watch-toast.log",
    pidLabel: "进程",
    accessLabel: "权限",
    webhookStateLabel: "webhook",
    loading: "加载中",
    failed: "加载失败",
    running: "监听中",
    stopped: "已停止",
    none: "无",
    allowed: "已授权",
    unknown: "未知",
    accessReady: "toast 监听已就绪。",
    accessMissing: (guide) => `Windows 通知访问未就绪。${guide || ""}`,
    watcherStart: "启动监听",
    watcherStartBusy: "启动中...",
    watcherStarted: "监听已启动",
    watcherStop: "停止监听",
    watcherStopBusy: "停止中...",
    watcherStopped: "监听已停止",
    rulesHint: "toast 过滤",
    waitRuleTitle: "wait / ask",
    waitRuleDesc: "需要操作",
    doneRuleTitle: "done",
    doneRuleDesc: "任务完成",
    infoRuleTitle: "info",
    infoRuleDesc: "其他提示",
    rulesSave: "保存规则",
    saveBusy: "保存中...",
    rulesSaved: "规则已保存",
    settingsSavedDetail: "已保存，只影响之后出现的 Windows toast。",
    noRecord: "暂无记录",
    statusLabel: "状态",
    timeLabel: "时间",
    emptyMessage: "无消息内容",
    webhookPlaceholder: "https://open.feishu.cn/...",
    secretPlaceholder: "可选",
    currentSet: (value) => `当前：${value}`,
    currentUnset: "当前：未配置",
    secretSet: "密钥：已配置",
    secretUnset: "密钥：未配置",
    clearWebhook: "清空 webhook",
    clearSecret: "清空密钥",
    configSave: "保存配置",
    configSaved: "配置已保存",
    configSavedDetail: "配置已保存。",
    notifyTest: "测试通知",
    notifyTestBusy: "发送中...",
    notifyTestSent: "测试通知已发送",
    autostartLabel: "开机自启动",
    autostartToggle: "切换自启动",
    autostartOn: "自启动 开",
    autostartOff: "自启动 关",
    autostartReload: "需重启",
    autostartReloadRequired: "重启后可用",
    autostartMissing: "自启动接口未加载，请重启控制台后端。",
    autostartEnabled: (methods) => `已启用${methods.length ? `（${methods.join("、")}）` : ""}`,
    autostartDisabled: "未启用",
    autostartEnableBusy: "开启中...",
    autostartDisableBusy: "关闭中...",
    autostartEnabledToast: "自启动已开启",
    autostartDisabledToast: "自启动已关闭",
    autostartEnabledDetail: "自启动已开启。",
    autostartDisabledDetail: "自启动已关闭。",
    logEmpty: "暂无日志。监听器会写入 .local/watch-toast.log。",
    webhookSet: "已配置",
    webhookUnset: "未配置",
    requestFailed: (status) => `请求失败 (${status})`
  }
};

const STATUS_LABELS = {
  en: {
    ask: "wait",
    done: "done",
    error: "error",
    info: "info",
    running: "running",
    test: "test",
    wait: "wait"
  },
  zh: {
    ask: "需要操作",
    done: "任务完成",
    error: "错误",
    info: "提示",
    running: "运行中",
    test: "测试",
    wait: "需要操作"
  }
};

let toastTimer = null;
let latestState = null;
let currentLanguage = resolveLanguage();

function getStoredTheme() {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function resolveTheme() {
  return getStoredTheme() || (darkQuery.matches ? "dark" : "light");
}

function getStoredLanguage() {
  const value = localStorage.getItem(LANG_KEY);
  return value === "zh" || value === "en" ? value : null;
}

function resolveLanguage() {
  const stored = getStoredLanguage();
  if (stored) {
    return stored;
  }
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function t(key, ...args) {
  const value = I18N[currentLanguage][key] ?? I18N.en[key];
  return typeof value === "function" ? value(...args) : value;
}

function setText(element, key, ...args) {
  element.textContent = t(key, ...args);
}

function setCommandTitle(element, key) {
  element.replaceChildren(createTextBlock("span", "", "$"), document.createTextNode(` ${t(key)}`));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? t("themeLight") : t("themeDark");
  els.themeToggle.setAttribute("aria-label", t("themeAria"));
}

function toggleTheme() {
  const next = resolveTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function applyLanguage(language, { persist = false } = {}) {
  currentLanguage = language;
  if (persist) {
    localStorage.setItem(LANG_KEY, language);
  }

  document.documentElement.lang = t("htmlLang");
  document.title = t("documentTitle");
  setText(els.subtitle, "subtitle");
  setText(els.langToggle, "langToggle");
  els.langToggle.setAttribute("aria-label", t("langAria"));
  setText(els.refreshBtn, "refresh");
  els.refreshBtn.setAttribute("aria-label", t("refreshAria"));
  setText(els.startBtn, "watcherStart");
  setText(els.stopBtn, "watcherStop");
  setText(els.toggleAutostartBtn, "autostartToggle");
  setCommandTitle(els.watcherTitle, "watcherTitle");
  setCommandTitle(els.lastTitle, "lastTitle");
  setCommandTitle(els.rulesTitle, "rulesTitle");
  setCommandTitle(els.configTitle, "configTitle");
  setCommandTitle(els.logTitle, "logTitle");
  setText(els.pidLabel, "pidLabel");
  setText(els.accessLabel, "accessLabel");
  setText(els.webhookStateLabel, "webhookStateLabel");
  setText(els.rulesHint, "rulesHint");
  setText(els.waitRuleTitle, "waitRuleTitle");
  setText(els.waitRuleDesc, "waitRuleDesc");
  setText(els.doneRuleTitle, "doneRuleTitle");
  setText(els.doneRuleDesc, "doneRuleDesc");
  setText(els.infoRuleTitle, "infoRuleTitle");
  setText(els.infoRuleDesc, "infoRuleDesc");
  setText(els.saveSettingsBtn, "rulesSave");
  setText(els.clearWebhookLabel, "clearWebhook");
  setText(els.clearSecretLabel, "clearSecret");
  setText(els.saveFeishuBtn, "configSave");
  setText(els.testNotifyBtn, "notifyTest");
  setText(els.autostartLabel, "autostartLabel");
  els.webhookUrl.placeholder = t("webhookPlaceholder");
  els.webhookSecret.placeholder = t("secretPlaceholder");
  applyTheme(resolveTheme());

  if (latestState) {
    renderState(latestState);
  } else {
    els.watcherBadge.textContent = t("loading");
    els.autostartBadge.textContent = t("loading");
    els.lastStatus.textContent = t("noRecord");
    els.logTail.textContent = t("loading");
  }
}

function toggleLanguage() {
  const next = currentLanguage === "zh" ? "en" : "zh";
  applyLanguage(next, { persist: true });
  showToast(t("languageChanged"), "success");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  const data = parseResponse(text);
  if (!response.ok) {
    throw new Error(data?.error || text || t("requestFailed", response.status));
  }
  return data;
}

function parseResponse(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function showToast(message, tone = "info") {
  els.toast.hidden = false;
  els.toast.className = `toast ${tone}`;
  els.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

async function withBusy(button, busyText, task) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;

  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(currentLanguage === "zh" ? "zh-CN" : "en-US");
}

function renderState(state) {
  latestState = state;
  const running = state.watcher?.running;
  els.watcherBadge.textContent = running ? t("running") : t("stopped");
  els.watcherBadge.className = `badge ${running ? "on" : "off"}`;
  els.watcherPid.textContent = running ? `#${state.watcher.pid}` : t("none");

  const accessOk = state.notificationAccess?.ok;
  els.accessStatus.textContent = accessOk ? t("allowed") : state.notificationAccess?.accessStatus || t("unknown");
  renderFeishuState(state.feishu || { configured: state.feishuConfigured });
  renderAutostartState(state.autostart);

  els.accessHint.textContent = accessOk
    ? t("accessReady")
    : t("accessMissing", state.notificationAccess?.guide);

  els.startBtn.disabled = running;
  els.stopBtn.disabled = !running;
  setText(els.startBtn, "watcherStart");
  setText(els.stopBtn, "watcherStop");

  els.notifyOnDone.checked = state.settings.notifyOnDone;
  els.notifyOnWait.checked = state.settings.notifyOnWait;
  els.notifyOnInfo.checked = state.settings.notifyOnInfo;

  renderLastStatus(state.lastStatus);

  els.logTail.textContent = state.logTail?.length
    ? state.logTail.join("\n")
    : t("logEmpty");
  els.logTail.scrollTop = els.logTail.scrollHeight;
}

function renderFeishuState(feishu) {
  const configured = Boolean(feishu?.configured);
  els.feishuStatus.textContent = configured ? t("webhookSet") : t("webhookUnset");
  els.feishuStatus.className = configured ? "ok" : "warn";
  els.webhookMeta.textContent = configured
    ? t("currentSet", feishu.webhookMasked || feishu.webhookHost || t("webhookSet"))
    : t("currentUnset");
  els.webhookSecretMeta.textContent = feishu?.secretConfigured
    ? t("secretSet")
    : t("secretUnset");
}

function renderAutostartState(autostart) {
  if (!autostart) {
    els.autostartBadge.textContent = t("autostartReload");
    els.autostartBadge.className = "badge off";
    els.autostartStatus.textContent = t("autostartMissing");
    els.toggleAutostartBtn.textContent = t("autostartReloadRequired");
    els.toggleAutostartBtn.disabled = true;
    return;
  }

  const installed = Boolean(autostart?.installed);
  els.autostartBadge.textContent = installed ? t("autostartOn") : t("autostartOff");
  els.autostartBadge.className = `badge ${installed ? "on" : "off"}`;
  els.autostartStatus.textContent = installed
    ? t("autostartEnabled", autostart.methods || [])
    : autostart?.error || t("autostartDisabled");
  els.toggleAutostartBtn.textContent = installed ? t("autostartOff") : t("autostartOn");
  els.toggleAutostartBtn.disabled = false;
}

function renderLastStatus(lastStatus) {
  els.lastStatus.replaceChildren();

  if (!lastStatus) {
    els.lastStatus.className = "last-status empty";
    els.lastStatus.textContent = t("noRecord");
    return;
  }

  els.lastStatus.className = "last-status";

  const statusLine = document.createElement("div");
  statusLine.className = "status-line";

  const category = document.createElement("div");
  category.append(
    createTextBlock("div", "status-label", t("statusLabel")),
    createTextBlock("div", "status-value", getStatusLabel(lastStatus))
  );

  const time = document.createElement("div");
  time.className = "status-time";
  time.append(
    createTextBlock("div", "status-label", t("timeLabel")),
    createTextBlock("div", "", formatTime(lastStatus.updatedAt))
  );

  const message = createTextBlock("p", "status-message", lastStatus.message || t("emptyMessage"));

  statusLine.append(category, time);
  els.lastStatus.append(statusLine, message);
}

function getStatusLabel(lastStatus) {
  const status = String(lastStatus.status || "").toLowerCase();
  return STATUS_LABELS[currentLanguage][status] || lastStatus.label || lastStatus.status || "-";
}

function createTextBlock(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  return element;
}

async function refreshState() {
  const state = await api("/api/state");
  renderState(state);
}

async function saveSettings() {
  const payload = {
    notifyOnDone: els.notifyOnDone.checked,
    notifyOnWait: els.notifyOnWait.checked,
    notifyOnInfo: els.notifyOnInfo.checked
  };
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  els.settingsMsg.textContent = t("settingsSavedDetail");
}

async function saveFeishuSettings() {
  const payload = {
    clearWebhook: els.clearWebhook.checked,
    clearSecret: els.clearSecret.checked
  };
  const webhookUrl = els.webhookUrl.value.trim();
  const webhookSecret = els.webhookSecret.value.trim();

  if (webhookUrl) {
    payload.webhookUrl = webhookUrl;
  }
  if (webhookSecret) {
    payload.webhookSecret = webhookSecret;
  }

  await api("/api/feishu-settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  els.webhookUrl.value = "";
  els.webhookSecret.value = "";
  els.clearWebhook.checked = false;
  els.clearSecret.checked = false;
  syncClearControls();
  els.connectionMsg.textContent = t("configSavedDetail");
}

async function toggleAutostart() {
  if (!latestState?.autostart) {
    throw new Error(t("autostartMissing"));
  }

  const enabled = !latestState?.autostart?.installed;
  await api("/api/autostart", {
    method: "POST",
    body: JSON.stringify({ enabled })
  });
  els.connectionMsg.textContent = enabled ? t("autostartEnabledDetail") : t("autostartDisabledDetail");
}

function syncClearControls() {
  els.webhookUrl.disabled = els.clearWebhook.checked;
  els.webhookSecret.disabled = els.clearSecret.checked;
}

els.startBtn.addEventListener("click", async () => {
  await runAction(els.startBtn, t("watcherStartBusy"), t("watcherStarted"), () =>
    api("/api/watcher/start", { method: "POST" })
  );
});

els.stopBtn.addEventListener("click", async () => {
  await runAction(els.stopBtn, t("watcherStopBusy"), t("watcherStopped"), () =>
    api("/api/watcher/stop", { method: "POST" })
  );
});

els.saveSettingsBtn.addEventListener("click", () => {
  runAction(els.saveSettingsBtn, t("saveBusy"), t("rulesSaved"), saveSettings);
});

els.saveFeishuBtn.addEventListener("click", () => {
  runAction(els.saveFeishuBtn, t("saveBusy"), t("configSaved"), saveFeishuSettings);
});

els.testNotifyBtn.addEventListener("click", async () => {
  await runAction(els.testNotifyBtn, t("notifyTestBusy"), t("notifyTestSent"), () =>
    api("/api/test-notify", { method: "POST" })
  );
});

els.toggleAutostartBtn.addEventListener("click", () => {
  const enabling = !latestState?.autostart?.installed;
  runAction(
    els.toggleAutostartBtn,
    enabling ? t("autostartEnableBusy") : t("autostartDisableBusy"),
    enabling ? t("autostartEnabledToast") : t("autostartDisabledToast"),
    toggleAutostart
  );
});

els.refreshBtn.addEventListener("click", () => {
  runAction(els.refreshBtn, t("refreshBusy"), t("refreshed"), refreshState);
});

els.themeToggle.addEventListener("click", toggleTheme);
els.langToggle.addEventListener("click", toggleLanguage);
darkQuery.addEventListener("change", () => {
  if (!getStoredTheme()) {
    applyTheme(resolveTheme());
  }
});
els.clearWebhook.addEventListener("change", syncClearControls);
els.clearSecret.addEventListener("change", syncClearControls);

async function runAction(button, busyText, successMessage, action) {
  try {
    await withBusy(button, busyText, action);
    showToast(successMessage, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    refreshState().catch(() => {});
  }
}

applyLanguage(currentLanguage);
refreshState().catch((error) => {
  els.watcherBadge.textContent = t("failed");
  showToast(error.message, "error");
});

syncClearControls();

setInterval(() => {
  refreshState().catch(() => {});
}, 5000);

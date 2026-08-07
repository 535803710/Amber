const els = {
  subtitle: document.querySelector(".subtitle"),
  watcherTitle: document.getElementById("watcherTitle"),
  lastTitle: document.getElementById("lastTitle"),
  rulesTitle: document.getElementById("rulesTitle"),
  configTitle: document.getElementById("configTitle"),
  recordsTitle: document.getElementById("recordsTitle"),
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
  healthAlertsTitle: document.getElementById("healthAlertsTitle"),
  healthAlertsDesc: document.getElementById("healthAlertsDesc"),
  brandKicker: document.getElementById("brandKicker"),
  brandTitle: document.getElementById("brandTitle"),
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
  healthAlertsEnabled: document.getElementById("healthAlertsEnabled"),
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
  recordsBadge: document.getElementById("recordsBadge"),
  recordsPendingLabel: document.getElementById("recordsPendingLabel"),
  recordsFailedLabel: document.getElementById("recordsFailedLabel"),
  recordsLastLabel: document.getElementById("recordsLastLabel"),
  recordsPending: document.getElementById("recordsPending"),
  recordsFailed: document.getElementById("recordsFailed"),
  recordsLastSuccess: document.getElementById("recordsLastSuccess"),
  recordsWebhookUrl: document.getElementById("recordsWebhookUrl"),
  recordsWebhookToken: document.getElementById("recordsWebhookToken"),
  recordsWebhookMeta: document.getElementById("recordsWebhookMeta"),
  recordsTokenMeta: document.getElementById("recordsTokenMeta"),
  clearRecordsWebhook: document.getElementById("clearRecordsWebhook"),
  clearRecordsToken: document.getElementById("clearRecordsToken"),
  clearRecordsWebhookLabel: document.getElementById("clearRecordsWebhookLabel"),
  clearRecordsTokenLabel: document.getElementById("clearRecordsTokenLabel"),
  saveRecordsBtn: document.getElementById("saveRecordsBtn"),
  replayRecordsBtn: document.getElementById("replayRecordsBtn"),
  openBaseLink: document.getElementById("openBaseLink"),
  recordsMsg: document.getElementById("recordsMsg"),
  commitRecordsBadge: document.getElementById("commitRecordsBadge"),
  commitRepositoryCount: document.getElementById("commitRepositoryCount"),
  commitRecordsPending: document.getElementById("commitRecordsPending"),
  commitRecordsFailed: document.getElementById("commitRecordsFailed"),
  commitLastScan: document.getElementById("commitLastScan"),
  commitScanRoots: document.getElementById("commitScanRoots"),
  commitScanRootsLabel: document.getElementById("commitScanRootsLabel"),
  commitScanRootsHint: document.getElementById("commitScanRootsHint"),
  commitScanRootsMeta: document.getElementById("commitScanRootsMeta"),
  chooseCommitScanRootBtn: document.getElementById("chooseCommitScanRootBtn"),
  saveCommitScanRootsBtn: document.getElementById("saveCommitScanRootsBtn"),
  commitScanRootsMsg: document.getElementById("commitScanRootsMsg"),
  replayCommitRecordsBtn: document.getElementById("replayCommitRecordsBtn"),
  healthTitle: document.getElementById("healthTitle"),
  healthBadge: document.getElementById("healthBadge"),
  healthComponents: document.getElementById("healthComponents"),
  healthIssues: document.getElementById("healthIssues"),
  healthCheckedAt: document.getElementById("healthCheckedAt"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  saveFeishuBtn: document.getElementById("saveFeishuBtn"),
  testNotifyBtn: document.getElementById("testNotifyBtn"),
  toggleAutostartBtn: document.getElementById("toggleAutostartBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  themeToggle: document.getElementById("themeToggle"),
  langToggle: document.getElementById("langToggle"),
  navDashboard: document.getElementById("navDashboard"),
  navChangeRecords: document.getElementById("navChangeRecords"),
  navCommitRecords: document.getElementById("navCommitRecords"),
  toast: document.getElementById("toast")
};

const THEME_KEY = "amber-theme";
const LANG_KEY = "amber-lang";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const I18N = {
  en: {
    htmlLang: "en",
    documentTitle: "Amber 控制台",
    subtitle: "Turn fleeting AI collaboration into durable engineering memory",
    brandKicker: "AI collaboration memory",
    brandTitle: "Amber",
    navDashboard: "dashboard",
    navChangeRecords: "AI changes",
    navCommitRecords: "Git commits",
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
    recordsTitle: "change records",
    logTitle: "tail .local/watch-all.log",
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
    healthAlertsTitle: "collection alerts",
    healthAlertsDesc: "send Feishu alerts for collection issues",
    rulesSave: "rules save",
    saveBusy: "saving...",
    rulesSaved: "rules saved",
    settingsSavedDetail: "saved. new Windows toast only.",
    healthReset: "archive stale",
    healthResetBusy: "archiving...",
    healthResetDone: (count) => `archived ${count} stale baseline(s)`,
    healthResetConfirm: (source) => `Archive stale ${source} baselines? This will not delete sent records or Git history.`,
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
    logEmpty: "no log. the watch stack writes to .local/watch-all.log.",
    webhookSet: "set",
    webhookUnset: "unset",
    recordsPending: "pending",
    recordsFailed: "failed",
    recordsLast: "last success",
    recordsConfigured: "configured",
    recordsUnconfigured: "not configured",
    recordsSave: "save",
    recordsRetry: "retry failed",
    recordsOpen: "open Base",
    recordsClearWebhook: "clear webhook",
    recordsClearToken: "clear token",
    recordsTokenSet: "token: set",
    recordsTokenUnset: "token: unset",
    recordsSaved: "change record config saved",
    recordsReplayed: (count) => `${count} failed event(s) replayed`,
    healthTitle: "collection health",
    healthHealthy: "healthy",
    healthWarning: "warning",
    healthCritical: "critical",
    healthDisabled: "disabled",
    healthCheckedAt: (value) => `checked: ${value}`,
    healthNoIssues: "no active issues",
    healthRuntime: "runtime",
    healthCursor: "Cursor Hook",
    healthChatgpt: "ChatGPT Hook",
    healthGitScan: "Git scan",
    healthAiDelivery: "AI delivery",
    healthGitDelivery: "Git delivery",
    healthTaskContext: "MCP queries",
    healthTaskContextDetail: (details) => `${details.callCount || 0} calls · P50 ${formatDuration(details.p50Ms)} · P95 ${formatDuration(details.p95Ms)} · cache ${formatPercent(details.cacheHitRate)} · remote ${details.remoteCalls || 0} · timeout ${formatPercent(details.timeoutRate)} · errors ${formatPercent(details.errorRate)} · last ${formatTime(details.lastCalledAt)}`,
    healthAlertChannel: "alert channel",
    healthAlertsOff: "alerts off",
    healthUnknown: "unknown",
    healthOn: "on",
    healthOff: "off",
    commitScanRootsLabel: "scan roots (one absolute path per line)",
    commitScanRootsHint: "Git commits are discovered from configured roots; project hooks are not modified.",
    commitScanRootsPlaceholder: "D:/project",
    commitScanRootsCurrent: (value) => `current: ${value}`,
    commitScanRootsUnset: "current: unset",
    commitScanRootsSave: "save scan roots",
    commitScanRootsSaved: "Git scan roots saved",
    chooseCommitScanRoot: "choose folder",
    chooseCommitScanRootBusy: "opening...",
    chooseCommitScanRootAdded: "folder added; save to apply",
    commitScanRootsConfigured: "configured",
    commitScanRootsUnconfigured: "scan not configured",
    requestFailed: (status) => `Request failed (${status})`
  },
  zh: {
    htmlLang: "zh-CN",
    documentTitle: "Amber 控制台",
    subtitle: "将转瞬即逝的 AI 协作，沉淀为可持续使用的研发记忆",
    brandKicker: "AI 协作研发记忆",
    brandTitle: "琥珀计划",
    navDashboard: "控制台",
    navChangeRecords: "AI 修改记录",
    navCommitRecords: "Git 提交记录",
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
    configTitle: "通知链接配置",
    recordsTitle: "修改记录",
    logTitle: "tail .local/watch-all.log",
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
    healthAlertsTitle: "采集异常告警",
    healthAlertsDesc: "异常时发送飞书提醒",
    rulesSave: "保存规则",
    saveBusy: "保存中...",
    rulesSaved: "规则已保存",
    settingsSavedDetail: "已保存，只影响之后出现的 Windows toast。",
    healthReset: "归档残留",
    healthResetBusy: "归档中...",
    healthResetDone: (count) => `已归档 ${count} 条残留 baseline`,
    healthResetConfirm: (source) => `确认归档 ${source} 的残留 baseline？不会删除已发送记录或 Git 历史。`,
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
    logEmpty: "暂无日志。监听进程组会写入 .local/watch-all.log。",
    webhookSet: "已配置",
    webhookUnset: "未配置",
    recordsPending: "待发送",
    recordsFailed: "失败",
    recordsLast: "最近成功",
    recordsConfigured: "已配置",
    recordsUnconfigured: "未配置",
    recordsSave: "保存配置",
    recordsRetry: "重试失败",
    recordsOpen: "打开 Base",
    recordsClearWebhook: "清空 webhook",
    recordsClearToken: "清空 token",
    recordsTokenSet: "token：已配置",
    recordsTokenUnset: "token：未配置",
    recordsSaved: "修改记录配置已保存",
    recordsReplayed: (count) => `已重放 ${count} 条失败记录`,
    healthTitle: "采集健康",
    healthHealthy: "正常",
    healthWarning: "警告",
    healthCritical: "严重",
    healthDisabled: "未启用",
    healthCheckedAt: (value) => `检查时间：${value}`,
    healthNoIssues: "暂无异常",
    healthRuntime: "运行进程",
    healthCursor: "Cursor Hook",
    healthChatgpt: "ChatGPT Hook",
    healthGitScan: "Git 扫描",
    healthAiDelivery: "AI 投递",
    healthGitDelivery: "Git 投递",
    healthTaskContext: "MCP 查询",
    healthTaskContextDetail: (details) => `${details.callCount || 0} 次 · P50 ${formatDuration(details.p50Ms)} · P95 ${formatDuration(details.p95Ms)} · 缓存 ${formatPercent(details.cacheHitRate)} · 远端 ${details.remoteCalls || 0} 次 · 超时 ${formatPercent(details.timeoutRate)} · 错误 ${formatPercent(details.errorRate)} · 最近 ${formatTime(details.lastCalledAt)}`,
    healthAlertChannel: "告警通道",
    healthAlertsOff: "告警已关闭",
    healthUnknown: "未知",
    healthOn: "已运行",
    healthOff: "未运行",
    commitScanRootsLabel: "扫描目录（每行一个绝对路径）",
    commitScanRootsHint: "配置目录后自动发现 Git 提交；不修改项目 Hook。",
    commitScanRootsPlaceholder: "D:/project",
    commitScanRootsCurrent: (value) => `当前：${value}`,
    commitScanRootsUnset: "当前：未配置",
    commitScanRootsSave: "保存扫描范围",
    commitScanRootsSaved: "Git 扫描范围已保存",
    chooseCommitScanRoot: "选择文件夹",
    chooseCommitScanRootBusy: "打开中...",
    chooseCommitScanRootAdded: "目录已添加，请保存后生效",
    commitScanRootsConfigured: "已配置",
    commitScanRootsUnconfigured: "待配置",
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
let choosingCommitScanRoot = false;
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
  setText(els.brandKicker, "brandKicker");
  setText(els.brandTitle, "brandTitle");
  setText(els.navDashboard, "navDashboard");
  setText(els.navChangeRecords, "navChangeRecords");
  setText(els.navCommitRecords, "navCommitRecords");
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
  setCommandTitle(els.recordsTitle, "recordsTitle");
  setCommandTitle(els.healthTitle, "healthTitle");
  setCommandTitle(els.logTitle, "logTitle");
  setText(els.pidLabel, "pidLabel");
  setText(els.accessLabel, "accessLabel");
  setText(els.webhookStateLabel, "webhookStateLabel");
  setText(els.recordsPendingLabel, "recordsPending");
  setText(els.recordsFailedLabel, "recordsFailed");
  setText(els.recordsLastLabel, "recordsLast");
  setText(els.clearRecordsWebhookLabel, "recordsClearWebhook");
  setText(els.clearRecordsTokenLabel, "recordsClearToken");
  setText(els.saveRecordsBtn, "recordsSave");
  setText(els.replayRecordsBtn, "recordsRetry");
  setText(els.openBaseLink, "recordsOpen");
  setText(els.commitScanRootsLabel, "commitScanRootsLabel");
  setText(els.commitScanRootsHint, "commitScanRootsHint");
  setText(els.chooseCommitScanRootBtn, "chooseCommitScanRoot");
  setText(els.saveCommitScanRootsBtn, "commitScanRootsSave");
  els.commitScanRoots.placeholder = t("commitScanRootsPlaceholder");
  setText(els.rulesHint, "rulesHint");
  setText(els.waitRuleTitle, "waitRuleTitle");
  setText(els.waitRuleDesc, "waitRuleDesc");
  setText(els.doneRuleTitle, "doneRuleTitle");
  setText(els.doneRuleDesc, "doneRuleDesc");
  setText(els.infoRuleTitle, "infoRuleTitle");
  setText(els.infoRuleDesc, "infoRuleDesc");
  setText(els.healthAlertsTitle, "healthAlertsTitle");
  setText(els.healthAlertsDesc, "healthAlertsDesc");
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

function formatDuration(value) {
  const milliseconds = Number(value) || 0;
  return milliseconds >= 1_000 ? `${(milliseconds / 1_000).toFixed(1)}s` : `${Math.round(milliseconds)}ms`;
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
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
  renderChangeRecords(state.changeRecords || {});
  renderCommitRecords(state.commitRecords || {});
  renderHealth(state.health || {});
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
  els.healthAlertsEnabled.checked = state.settings.healthAlertsEnabled !== false;

  renderLastStatus(state.lastStatus);

  els.logTail.textContent = state.logTail?.length
    ? state.logTail.join("\n")
    : t("logEmpty");
  els.logTail.scrollTop = els.logTail.scrollHeight;
}

function renderChangeRecords(records) {
  const configured = Boolean(records.configured && records.tokenConfigured);
  els.recordsBadge.textContent = configured ? t("recordsConfigured") : t("recordsUnconfigured");
  els.recordsBadge.className = `badge ${configured ? "on" : "off"}`;
  els.recordsPending.textContent = String(records.pending ?? 0);
  els.recordsFailed.textContent = String(records.failed ?? 0);
  els.recordsLastSuccess.textContent = formatTime(records.lastSuccessAt);
  els.recordsWebhookMeta.textContent = records.webhookMasked
    ? t("currentSet", records.webhookMasked)
    : t("currentUnset");
  els.recordsTokenMeta.textContent = records.tokenConfigured
    ? t("recordsTokenSet")
    : t("recordsTokenUnset");
  els.openBaseLink.href = records.baseUrl || "#";
}

function renderCommitRecords(records) {
  const configured = Boolean(records.scanConfigured);
  els.commitRecordsBadge.textContent = configured ? t("commitScanRootsConfigured") : t("commitScanRootsUnconfigured");
  els.commitRecordsBadge.className = `badge ${configured ? "on" : "off"}`;
  els.commitRepositoryCount.textContent = String(records.repositoryCount ?? 0);
  els.commitRecordsPending.textContent = String(records.pending ?? 0);
  els.commitRecordsFailed.textContent = String(records.failed ?? 0);
  els.commitLastScan.textContent = formatTime(records.lastScanAt);
  const roots = records.scanRoots || [];
  if (!choosingCommitScanRoot && document.activeElement !== els.commitScanRoots) {
    els.commitScanRoots.value = roots.join("\n");
  }
  els.commitScanRootsMeta.textContent = roots.length
    ? t("commitScanRootsCurrent", roots.join("; "))
    : t("commitScanRootsUnset");
}

function renderHealth(health) {
  const labels = {
    runtime: "healthRuntime",
    cursor: "healthCursor",
    chatgpt: "healthChatgpt",
    gitScan: "healthGitScan",
    aiDelivery: "healthAiDelivery",
    gitDelivery: "healthGitDelivery",
    taskContext: "healthTaskContext",
    alertChannel: "healthAlertChannel"
  };
  const statusLabels = {
    healthy: "healthHealthy",
    warning: "healthWarning",
    critical: "healthCritical",
    disabled: "healthDisabled"
  };
  const status = health.status || "disabled";
  els.healthBadge.textContent = t(statusLabels[status] || "healthUnknown");
  els.healthBadge.className = `badge health-${status}`;
  els.healthComponents.replaceChildren();
  for (const [key, labelKey] of Object.entries(labels)) {
    const component = health.components?.[key] || { status: "disabled", details: {} };
    const item = document.createElement("div");
    item.className = `health-item health-${component.status || "disabled"}`;
    const title = document.createElement("strong");
    title.textContent = t(labelKey);
    const state = document.createElement("span");
    state.textContent = t(statusLabels[component.status] || "healthUnknown");
    const detail = document.createElement("small");
    detail.textContent = healthDetail(key, component.details || {});
    item.append(title, state, detail);
    els.healthComponents.append(item);
  }

  els.healthIssues.replaceChildren();
  if (!health.issues?.length) {
    const empty = document.createElement("p");
    empty.className = "health-empty";
    empty.textContent = t("healthNoIssues");
    els.healthIssues.append(empty);
  } else {
    for (const issue of health.issues) {
      const item = document.createElement("div");
      item.className = `health-issue ${issue.severity || "warning"}`;
      const message = createTextBlock(
        "span",
        "health-issue-message",
        `${issue.severity === "critical" ? "!" : "i"} ${issue.message}`
      );
      item.append(message);
      if (issue.id?.endsWith("_baseline_stale")) {
        const resetButton = createTextBlock("button", "btn btn-ghost btn-small", t("healthReset"));
        resetButton.type = "button";
        resetButton.addEventListener("click", () => {
          const source = issue.component === "chatgpt" ? "ChatGPT" : "Cursor";
          if (!window.confirm(t("healthResetConfirm", source))) return;
          runAction(
            resetButton,
            t("healthResetBusy"),
            (result) => t("healthResetDone", result?.archivedCount || 0),
            async () => {
              return api("/api/health/reset", {
                method: "POST",
                body: JSON.stringify({ source: issue.component })
              });
            }
          );
        });
        item.append(resetButton);
      }
      els.healthIssues.append(item);
    }
  }
  els.healthCheckedAt.textContent = t("healthCheckedAt", formatTime(health.checkedAt));
}

function healthDetail(key, details) {
  if (key === "runtime") {
    const watcher = details.running ? `watch pid ${details.pid || "-"}` : t("stopped");
    return `${watcher} · health ${details.healthRunning ? t("healthOn") : t("healthOff")}`;
  }
  if (key === "cursor" || key === "chatgpt") {
    return `${details.activeBaselines || 0} baseline · ${formatTime(details.lastCompleteAt || details.lastBeginAt)}`;
  }
  if (key === "gitScan") {
    return `${details.repositoryCount || 0} repos · ${formatTime(details.lastScanAt)}`;
  }
  if (key === "taskContext") {
    return t("healthTaskContextDetail", details);
  }
  if (key === "alertChannel") {
    if (details.enabled === false) return t("healthAlertsOff");
    return details.configured ? t("webhookSet") : t("webhookUnset");
  }
  const queue = `pending ${details.pending || 0} · processing ${details.processing || 0} · failed ${details.failed || 0}`;
  const oldest = details.oldestPendingAt || details.oldestProcessingAt;
  return oldest ? `${queue} · ${formatTime(oldest)}` : queue;
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
    notifyOnInfo: els.notifyOnInfo.checked,
    healthAlertsEnabled: els.healthAlertsEnabled.checked
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
  els.recordsWebhookUrl.disabled = els.clearRecordsWebhook.checked;
  els.recordsWebhookToken.disabled = els.clearRecordsToken.checked;
}

async function saveChangeRecordSettings() {
  const payload = {
    clearWebhook: els.clearRecordsWebhook.checked,
    clearToken: els.clearRecordsToken.checked
  };
  if (els.recordsWebhookUrl.value.trim()) {
    payload.webhookUrl = els.recordsWebhookUrl.value.trim();
  }
  if (els.recordsWebhookToken.value.trim()) {
    payload.webhookToken = els.recordsWebhookToken.value.trim();
  }
  await api("/api/change-record-settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  els.recordsWebhookUrl.value = "";
  els.recordsWebhookToken.value = "";
  els.clearRecordsWebhook.checked = false;
  els.clearRecordsToken.checked = false;
  syncClearControls();
  els.recordsMsg.textContent = t("recordsSaved");
}

async function saveCommitScanRoots() {
  const scanRoots = els.commitScanRoots.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  await api("/api/commit-record-settings", {
    method: "POST",
    body: JSON.stringify({ scanRoots })
  });
  els.commitScanRootsMsg.textContent = t("commitScanRootsSaved");
}

async function chooseCommitScanRoot() {
  const roots = els.commitScanRoots.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  choosingCommitScanRoot = true;
  try {
    const result = await api("/api/choose-folder", { method: "POST" });
    if (!result.path) return;

    const key = result.path.toLowerCase();
    if (!roots.some((root) => root.toLowerCase() === key)) {
      roots.push(result.path);
      els.commitScanRoots.value = roots.join("\n");
      els.commitScanRootsMsg.textContent = t("chooseCommitScanRootAdded");
    }
  } finally {
    choosingCommitScanRoot = false;
  }
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

els.saveRecordsBtn.addEventListener("click", () => {
  runAction(els.saveRecordsBtn, t("saveBusy"), t("recordsSaved"), saveChangeRecordSettings);
});

els.replayRecordsBtn.addEventListener("click", () => {
  runAction(els.replayRecordsBtn, t("saveBusy"), t("recordsRetry"), async () => {
    const result = await api("/api/change-records/replay", { method: "POST" });
    els.recordsMsg.textContent = t("recordsReplayed", result.replayed || 0);
  });
});

els.replayCommitRecordsBtn.addEventListener("click", () => {
  runAction(els.replayCommitRecordsBtn, "处理中", "重试失败", async () => {
    await api("/api/commit-records/replay", { method: "POST" });
    await refreshState();
  });
});

els.saveCommitScanRootsBtn.addEventListener("click", () => {
  runAction(els.saveCommitScanRootsBtn, t("saveBusy"), t("commitScanRootsSaved"), saveCommitScanRoots);
});

els.chooseCommitScanRootBtn.addEventListener("click", () => {
  withBusy(els.chooseCommitScanRootBtn, t("chooseCommitScanRootBusy"), chooseCommitScanRoot)
    .catch((error) => showToast(error.message, "error"));
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
els.clearRecordsWebhook.addEventListener("change", syncClearControls);
els.clearRecordsToken.addEventListener("change", syncClearControls);

async function runAction(button, busyText, successMessage, action) {
  try {
    const result = await withBusy(button, busyText, action);
    showToast(typeof successMessage === "function" ? successMessage(result) : successMessage, "success");
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

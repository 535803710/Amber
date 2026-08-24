const RECORD_TYPE = document.documentElement.dataset.recordType;
const PAGE_SIZE = 20;
const THEME_KEY = "amber-theme";
const LANG_KEY = "amber-lang";

const els = {
  title: document.getElementById("pageTitle"),
  subtitle: document.getElementById("subtitle"),
  filters: document.getElementById("statusFilters"),
  count: document.getElementById("recordCount"),
  list: document.getElementById("recordList"),
  pagination: document.getElementById("pagination"),
  refreshButton: document.getElementById("refreshRecords"),
  themeToggle: document.getElementById("themeToggle"),
  langToggle: document.getElementById("langToggle")
};

const I18N = {
  zh: {
    pageTitle: { change: "AI 修改记录", commit: "Git 提交记录" },
    subtitle: { change: "本地采集队列的只读浏览", commit: "本地扫描队列的只读浏览" },
    nav: { dashboard: "控制台", change: "AI 修改记录", commit: "Git 提交记录" },
    themeLight: "主题 浅色",
    themeDark: "主题 深色",
    langToggle: "语言 en",
    refresh: "刷新",
    refreshBusy: "刷新中…",
    status: { all: "全部", pending: "待发送", sent: "已发送", failed: "失败" },
    count: (shown, total) => `显示 ${shown} / ${total} 条记录`,
    loading: "正在加载记录…",
    empty: "当前筛选条件下暂无记录。",
    loadFailed: "记录加载失败",
    project: "项目",
    branch: "分支",
    source: "来源",
    author: "作者",
    email: "邮箱",
    commit: "提交",
    changes: "变更",
    result: "结果",
    request: "需求",
    message: "提交正文",
    files: "修改文件",
    attempts: "重试次数",
    error: "最近错误",
    related: "关联 AI 记录",
    details: "展开详情",
    previous: "上一页",
    next: "下一页",
    page: (current, total) => `第 ${current} / ${total} 页`,
    additions: (value) => `+${value}`,
    deletions: (value) => `-${value}`,
    time: "时间",
    send: "发送",
    sendBusy: "发送中…",
    sendSuccess: "已发送",
    syncAll: "全量同步待发送",
    syncBusy: "同步中…",
    syncProgress: (state) => `同步进度：${state.processed}/${state.total}，成功 ${state.sent}，失败 ${state.failed}`
  },
  en: {
    pageTitle: { change: "AI change records", commit: "Git commit records" },
    subtitle: { change: "Read-only view of local collection queues", commit: "Read-only view of local scan queues" },
    nav: { dashboard: "dashboard", change: "AI changes", commit: "Git commits" },
    themeLight: "theme light",
    themeDark: "theme dark",
    langToggle: "lang zh",
    refresh: "refresh",
    refreshBusy: "refreshing...",
    status: { all: "all", pending: "pending", sent: "sent", failed: "failed" },
    count: (shown, total) => `showing ${shown} / ${total} records`,
    loading: "Loading records…",
    empty: "No records match this filter.",
    loadFailed: "Failed to load records",
    project: "project",
    branch: "branch",
    source: "source",
    author: "author",
    email: "email",
    commit: "commit",
    changes: "changes",
    result: "result",
    request: "request",
    message: "commit message",
    files: "changed files",
    attempts: "attempts",
    error: "last error",
    related: "related AI records",
    details: "details",
    previous: "previous",
    next: "next",
    page: (current, total) => `page ${current} / ${total}`,
    additions: (value) => `+${value}`,
    deletions: (value) => `-${value}`,
    time: "time",
    send: "send",
    sendBusy: "sending…",
    sendSuccess: "sent",
    syncAll: "sync all pending",
    syncBusy: "syncing…",
    syncProgress: (state) => `sync: ${state.processed}/${state.total}, sent ${state.sent}, failed ${state.failed}`
  }
};

let language = resolveLanguage();
let state = { status: "all", page: 1 };
let hasLoadedRecords = false;
let refreshInFlight = null;

function resolveLanguage() {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function t(key, ...args) {
  const value = I18N[language][key];
  return typeof value === "function" ? value(...args) : value;
}

function resolveTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark"
    ? saved
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? t("themeLight") : t("themeDark");
}

function applyLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = `${t("pageTitle")[RECORD_TYPE]} · Amber`;
  els.title.textContent = t("pageTitle")[RECORD_TYPE];
  els.subtitle.textContent = t("subtitle")[RECORD_TYPE];
  els.langToggle.textContent = t("langToggle");
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.textContent = t("nav")[link.dataset.nav];
    link.classList.toggle("active", link.dataset.nav === RECORD_TYPE);
  });
  applyTheme(resolveTheme());
  updateRefreshButton();
}

function refreshRecords({ preserveList = hasLoadedRecords } = {}) {
  if (refreshInFlight) return refreshInFlight;

  if (!preserveList) {
    els.list.replaceChildren(createText("p", "record-message", t("loading")));
    els.pagination.replaceChildren();
  }

  updateRefreshButton(true);
  refreshInFlight = loadRecords().finally(() => {
    refreshInFlight = null;
    updateRefreshButton();
  });
  return refreshInFlight;
}

async function loadRecords() {
  const requestedState = { ...state };

  try {
    const params = new URLSearchParams({
      status: requestedState.status,
      page: String(requestedState.page),
      pageSize: String(PAGE_SIZE)
    });
    const [response, syncResponse] = await Promise.all([
      fetch(`/api/${RECORD_TYPE === "change" ? "change-records" : "commit-records"}?${params}`),
      RECORD_TYPE === "commit" ? fetch("/api/commit-records/sync") : Promise.resolve(null)
    ]);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("loadFailed"));
    const sync = syncResponse ? await syncResponse.json() : null;
    state = { status: requestedState.status, page: data.pagination.page };
    renderFilters(data.counts);
    renderCommitActions(sync);
    renderRecords(data.items);
    renderPagination(data.pagination);
    els.count.textContent = t("count", data.items.length, data.pagination.totalItems);
    hasLoadedRecords = true;
  } catch (error) {
    if (hasLoadedRecords) {
      els.count.textContent = `${t("loadFailed")}：${error.message}`;
    } else {
      els.count.textContent = "";
      els.list.replaceChildren(createText("p", "record-message error-message", `${t("loadFailed")}：${error.message}`));
    }
  }
}

function updateRefreshButton(busy = Boolean(refreshInFlight)) {
  if (!els.refreshButton) return;
  els.refreshButton.disabled = busy;
  els.refreshButton.textContent = t(busy ? "refreshBusy" : "refresh");
}

function renderFilters(counts) {
  els.filters.replaceChildren(...["all", "pending", "sent", "failed"].map((status) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-button${state.status === status ? " active" : ""}`;
    button.textContent = `${t("status")[status]} (${counts[status] || 0})`;
    button.addEventListener("click", () => {
      if (state.status === status) return;
      state = { status, page: 1 };
      refreshRecords();
    });
    return button;
  }));
}

function renderCommitActions(sync) {
  const existing = document.getElementById("commitDeliveryActions");
  if (RECORD_TYPE !== "commit") {
    existing?.remove();
    return;
  }

  const container = existing || document.createElement("div");
  container.id = "commitDeliveryActions";
  container.className = "delivery-actions";
  container.replaceChildren();
  const button = createText("button", "btn btn-primary", sync?.running ? t("syncBusy") : t("syncAll"));
  button.type = "button";
  button.disabled = Boolean(sync?.running);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api("/api/commit-records/sync", { method: "POST" });
    } finally {
      refreshRecords();
    }
  });
  container.append(button);
  if (sync?.running || sync?.finishedAt) {
    container.append(createText("span", "hint", t("syncProgress", sync)));
  }
  els.filters.after(container);
}

function renderRecords(items) {
  if (items.length === 0) {
    els.list.replaceChildren(createText("p", "record-message", t("empty")));
    return;
  }
  els.list.replaceChildren(...items.map(createRecordCard));
}

function createRecordCard(record) {
  const card = document.createElement("article");
  card.className = "record-card";
  const head = document.createElement("div");
  head.className = "record-card-head";
  const titleText = RECORD_TYPE === "change" ? (record.promptSummary || record.summary) : record.summary;
  const title = createText("h2", "record-summary", titleText);
  const badge = createText("span", `badge record-status ${record.queueStatus}`, t("status")[record.queueStatus]);
  head.append(title, badge);

  const meta = document.createElement("dl");
  meta.className = "record-meta";
  appendMeta(meta, t("project"), record.project || "-");
  appendMeta(meta, t("branch"), record.branch || "-");
  if (RECORD_TYPE === "change") {
    appendMeta(meta, t("source"), record.source || "-");
    appendMeta(meta, t("author"), record.authorName || "-");
    if (record.authorEmail) appendMeta(meta, "email", record.authorEmail);
  } else {
    appendMeta(meta, t("author"), record.authorName || "-");
  }
  if (RECORD_TYPE === "commit") appendMeta(meta, t("commit"), record.shortSha || "-");
  appendMeta(meta, t("changes"), `${t("additions", record.additions)} / ${t("deletions", record.deletions)} · ${record.changedFileCount}`);
  appendMeta(meta, t("time"), formatTime(record.occurredAt));

  card.append(head, meta);
  if (RECORD_TYPE === "commit" && record.queueStatus === "pending") {
    card.append(createSendButton(record));
  }
  card.append(createDetails(record));
  return card;
}

function createSendButton(record) {
  const button = createText("button", "btn btn-primary record-send", t("send"));
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = t("sendBusy");
    try {
      await api(`/api/commit-records/${encodeURIComponent(record.id)}/send`, { method: "POST" });
      button.textContent = t("sendSuccess");
      await refreshRecords();
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
  });
  return button;
}

function createDetails(record) {
  const details = document.createElement("details");
  details.className = "record-details";
  details.append(createText("summary", "", t("details")));
  const body = document.createElement("div");
  body.className = "record-detail-body";

  if (RECORD_TYPE === "change") {
    appendDetail(body, t("request"), record.promptSummary);
    appendDetail(body, t("result"), record.resultSummary);
  } else {
    appendDetail(body, t("message"), record.commitMessage);
    appendDetail(body, t("related"), record.relatedAiEventIds.join("\n"));
  }
  appendDetail(body, t("files"), formatFiles(record.changedFiles));
  appendDetail(body, t("attempts"), String(record.attempts));
  appendDetail(body, t("error"), record.lastError);
  details.append(body);
  return details;
}

function renderPagination(pagination) {
  const previous = createPageButton(t("previous"), pagination.hasPreviousPage, pagination.page - 1);
  const label = createText("span", "pagination-label", t("page", pagination.page, pagination.totalPages));
  const next = createPageButton(t("next"), pagination.hasNextPage, pagination.page + 1);
  els.pagination.replaceChildren(previous, label, next);
}

function createPageButton(label, enabled, targetPage) {
  const button = createText("button", "btn btn-ghost", label);
  button.type = "button";
  button.disabled = !enabled;
  button.addEventListener("click", () => {
    state = { ...state, page: targetPage };
    refreshRecords();
  });
  return button;
}

function appendMeta(target, label, value) {
  const item = document.createElement("div");
  item.className = "record-meta-item";
  item.append(createText("dt", "", label), createText("dd", "", value));
  target.append(item);
}

function appendDetail(target, label, value) {
  if (!value) return;
  const section = document.createElement("section");
  section.append(createText("h3", "", label), createText("pre", "", value));
  target.append(section);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || t("loadFailed"));
  return data;
}

function formatFiles(files) {
  return files.length
    ? files.map((file) => `${file.status}${file.oldPath ? ` ${file.oldPath} →` : ""} ${file.path}`).join("\n")
    : "-";
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "-" : date.toLocaleString(language === "zh" ? "zh-CN" : "en-US");
}

function createText(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

els.themeToggle.addEventListener("click", () => {
  const next = resolveTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
els.langToggle.addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  localStorage.setItem(LANG_KEY, language);
  applyLanguage();
  refreshRecords();
});
els.refreshButton?.addEventListener("click", () => {
  refreshRecords({ preserveList: true });
});

applyLanguage();
refreshRecords();

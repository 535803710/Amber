// 进程内缓存层
// 精确请求缓存 + 数据集缓存 + in-flight 合并 + negative cache + SWR

const store = new Map();          // 精确请求缓存：key = 规范化请求 JSON
const datasetStore = new Map();   // 数据集缓存：key = `${tableId}:${project}`
const inflight = new Map();       // in-flight 合并：key = dataset key
const fetchWaiters = [];
let activeFetches = 0;

export const NEGATIVE_TTL_MS = 10_000;   // 空结果 10 秒后过期
export const MAX_CONCURRENT_FETCHES = 4;

const MAX_REQUEST_CACHE_ENTRIES = 500;
const MAX_DATASET_CACHE_ENTRIES = 100;

// ---- 精确请求缓存 ----

export function getCached(key, now) {
  const entry = store.get(key);
  if (!entry) return { value: null, hit: false, stale: false };
  if (entry.expiresAt > now) return { value: entry.value, hit: true, stale: false };
  store.delete(key);
  return { value: null, hit: false, stale: true };
}

export function setCached(key, value, ttlMs, now) {
  store.delete(key);
  store.set(key, { expiresAt: now + ttlMs, value });
  trimOldest(store, MAX_REQUEST_CACHE_ENTRIES);
}

// ---- 数据集缓存 ----

export function getDataset(key, now) {
  const entry = datasetStore.get(key);
  if (!entry) return { value: null, hit: false, stale: false };
  if (entry.expiresAt > now) return { value: entry.value, hit: true, stale: false };
  return { value: entry.value, hit: false, stale: true };
}

export function setDataset(key, value, ttlMs, now) {
  datasetStore.delete(key);
  datasetStore.set(key, { expiresAt: now + ttlMs, value });
  trimOldest(datasetStore, MAX_DATASET_CACHE_ENTRIES);
}

// 空结果用更短 TTL，避免频繁重复查空
export function setNegativeDataset(key, value, now) {
  setDataset(key, value, NEGATIVE_TTL_MS, now);
}

// ---- In-flight 合并 ----

export function getInflight(key) {
  return inflight.get(key) || null;
}

export function setInflight(key, promise) {
  inflight.set(key, promise);
  promise.then(
    () => clearInflight(key, promise),
    () => clearInflight(key, promise)
  );
}

export async function withFetchSlot(run) {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise((resolvePromise) => { fetchWaiters.push(resolvePromise); });
  }
  activeFetches += 1;
  try {
    return await run();
  } finally {
    activeFetches -= 1;
    fetchWaiters.shift()?.();
  }
}

// ---- 清理 ----

export function clearCache() {
  store.clear();
  datasetStore.clear();
  inflight.clear();
}

export function cacheSize() {
  return store.size + datasetStore.size;
}

function clearInflight(key, promise) {
  if (inflight.get(key) === promise) inflight.delete(key);
}

function trimOldest(target, maximum) {
  while (target.size > maximum) {
    target.delete(target.keys().next().value);
  }
}

// 双通道数据加载器 —— 「打开即有内容，后台自动刷新」
// 参考 StarHub 的成功模式：
//   1. 页面加载时先读 /data/*.json 静态快照（毫秒级首屏）
//   2. 同时调用 /api/* Serverless API 获取最新数据
//   3. API 成功后替换快照内容；API 失败则保留快照（零降级体验）
//
// 用法:
//   import { loadWithSnapshot } from './snapshot';
//   const { data, source } = await loadWithSnapshot('/api/articles', 'articles.json');
//   // data = 数据, source = 'snapshot' | 'api' | 'snapshot-fallback'

// 快照缓存（同一会话内不重复请求同一快照）
const _snapshotCache = new Map(); // key → { data, ts }
const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000; // 5 分钟内认为快照新鲜

/**
 * 双通道加载：先返回快照，同时请求 API，API 成功后回调
 *
 * @param {string} apiPath - API 路径（如 /api/articles）
 * @param {string} snapshotFile - 快照文件名（如 articles.json）
 * @param {object} opts - 选项
 * @param {function} opts.onUpdate - API 数据到达后的回调 (data) => void
 * @param {number} opts.snapshotTtl - 快照缓存 TTL（毫秒）
 * @returns {Promise<{data: any, source: string}>} 首次返回的数据（可能是快照或 API）
 */
export async function loadWithSnapshot(apiPath, snapshotFile, opts = {}) {
  const { onUpdate, snapshotTtl = SNAPSHOT_CACHE_TTL } = opts;

  // 1. 先尝试读快照（同步/快速）
  let snapshotData = null;
  try {
    snapshotData = await loadSnapshot(snapshotFile, snapshotTtl);
  } catch {
    // 快照加载失败不影响后续流程
  }

  // 2. 同时请求 API
  try {
    const apiData = await fetchApi(apiPath);
    if (apiData && apiData.ok !== false) {
      // API 成功 → 如果有 onUpdate 且快照已先返回，通知更新
      if (snapshotData && onUpdate) {
        onUpdate(apiData);
      }
      return { data: apiData, source: 'api' };
    }
  } catch {
    // API 失败 → 降级到快照
  }

  // 3. API 失败但有快照 → 返回快照
  if (snapshotData) {
    return { data: snapshotData, source: 'snapshot-fallback' };
  }

  // 4. 都失败
  return { data: null, source: 'none' };
}

/**
 * 纯快照加载（不走 API）——用于首屏渲染
 */
export async function loadSnapshotOnly(snapshotFile) {
  try {
    const data = await loadSnapshot(snapshotFile, SNAPSHOT_CACHE_TTL);
    return { data, source: 'snapshot' };
  } catch {
    return { data: null, source: 'none' };
  }
}

/**
 * 预加载所有快照（页面初始化时调用，加速后续访问）
 */
export async function preloadSnapshots() {
  const files = ['articles.json', 'videos.json', 'hot.json', 'daily.json', 'sources.json', 'groups.json', 'meta.json'];
  const promises = files.map(f => loadSnapshot(f, SNAPSHOT_CACHE_TTL).catch(() => null));
  return Promise.all(promises);
}

// ─── 内部工具 ───

async function loadSnapshot(filename, ttl) {
  // 会话内缓存
  const cached = _snapshotCache.get(filename);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;

  const url = `/data/${filename}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    // 快照走 CDN 缓存，不需要每次都请求
    cache: 'force-cache',
  });
  if (!res.ok) throw new Error(`Snapshot ${filename}: HTTP ${res.status}`);
  const data = await res.json();
  _snapshotCache.set(filename, { data, ts: Date.now() });
  return data;
}

async function fetchApi(path) {
  const res = await fetch(path, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`API ${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * 清除快照缓存（写操作后调用，强制下次重新加载）
 */
export function clearSnapshotCache(filename) {
  if (filename) {
    _snapshotCache.delete(filename);
  } else {
    _snapshotCache.clear();
  }
}

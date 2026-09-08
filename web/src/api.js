// fetch 封装：统一 JSON、错误抛出含 status 与后端 error 文案（T6）
// 2026-09-05 P0：自动注入 Bearer token；401 时清 token 并广播 'qwis:unauthorized'（LoginGate 负责弹登录框）
// 1.4 增强：GET 请求 5s TTL 内存缓存（相同 path+query 复用 Promise），写操作自动失效前缀匹配的缓存
import { getToken, setToken } from './auth';

// ---- 1.4 GET 请求去重缓存 ----
const _getCache = new Map(); // key → { promise, ts }
const GET_CACHE_TTL = 5000; // 5 秒

function cacheGet(key, fetcher) {
  const now = Date.now();
  const entry = _getCache.get(key);
  if (entry && now - entry.ts < GET_CACHE_TTL) return entry.promise;
  const promise = fetcher().then(
    (data) => { _getCache.set(key, { promise: Promise.resolve(data), ts: Date.now() }); return data; },
    (err) => { _getCache.delete(key); throw err; } // 失败不缓存
  );
  _getCache.set(key, { promise, ts: now });
  return promise;
}

// 失效前缀匹配的缓存条目（写操作后调用）
function invalidateCache(prefix) {
  for (const key of _getCache.keys()) {
    if (!prefix || key === prefix || key.startsWith(prefix + '?') || key.startsWith(prefix + '&')) {
      _getCache.delete(key);
    }
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    // 1.4：GET 请求走缓存去重
    if (method === 'GET') {
      return cacheGet(path, () => fetch(path, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: undefined,
      }).then(handleResponse));
    }

    res = await fetch(path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const err = new Error('网络请求失败：' + (e.message || e));
    err.status = 0;
    throw err;
  }
  // 写操作自动失效相关 GET 缓存
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    // 提取 API 路径前缀（如 /api/sources/123/toggle → /api/sources）
    const prefix = path.replace(/\/\d+([?/].*)?$/, '').replace(/\?.*$/, '');
    invalidateCache(prefix);
    // 通用失效：settings 变更可能影响多处
    if (path.startsWith('/api/settings')) invalidateCache('/api/settings');
  }
  return handleResponse(res);
}

// 2026-09-05b A1 修复：二进制上传通道（DataTab 快照导入）
// 裸 fetch 不带 Bearer 会在鉴权链下必 401 且不广播 qwis:unauthorized；此处复用同一套 401/错误契约
async function upload(path, file) {
  let res;
  try {
    const headers = { 'Content-Type': 'application/octet-stream' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    res = await fetch(path, { method: 'POST', headers, body: file });
  } catch (e) {
    const err = new Error('网络请求失败：' + (e.message || e));
    err.status = 0;
    throw err;
  }
  return handleResponse(res);
}

function handleResponse(res) {
  return (async () => {
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* 非 JSON 响应 */
    }
    if (res.status === 401 && data && data.needLogin) {
      setToken(''); // 过期/无效 token 清掉，避免带着死 token 反复 401
      try {
        window.dispatchEvent(new CustomEvent('qwis:unauthorized'));
      } catch {
        /* SSR/测试环境无 window */
      }
    }
    if (!res.ok || (data && data.ok === false)) {
      const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  })();
}

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  put: (path, body) => request(path, { method: 'PUT', body: body ?? {} }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload, // A1：二进制上传（自动带 Bearer + 401 广播）
  invalidate: invalidateCache, // 1.4：手动失效缓存（供外部组件在写操作后调用）
};

export { qs };

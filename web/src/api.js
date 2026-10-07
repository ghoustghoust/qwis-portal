// fetch 封装：统一 JSON、错误抛出含 status 与后端 error 文案（T6）
// 2026-09-05 P0：自动注入 Bearer token；401 时清 token 并广播 'qwis:unauthorized'（LoginGate 负责弹登录框）
// 1.4 增强：GET 请求 5s TTL 内存缓存（相同 path+query 复用 Promise），写操作自动失效前缀匹配的缓存
// 2026-10-06 性能批：
//   ① TTL 90s → 300s（配合云端 s-maxage，跳转回访 5 分钟内秒开；要最新数据仍走 force）
//   ② 公开只读端点不再附带 Authorization——Vercel CDN 对带鉴权头的请求一律不缓存，
//     去掉后云端 s-maxage 才生效（CDN 命中 ~100ms vs 冷函数秒级）。
//     不变量：本清单必须是后端 PUBLIC_GET_PATHS 的**子集**（后端多放行无害，少放行 = 401 弹登录）。
//   ③ stale-while-error：CDN/函数抖动时有旧缓存先回旧数据（阅读界面优于报错页），401 除外。
import { getToken, setToken } from './auth';

// 与 api/[...slug].js PUBLIC_GET_PATHS 对齐（只能少不能多）
const PUBLIC_GET_EXACT = new Set([
  '/api/articles', '/api/articles/since', '/api/videos', '/api/hot', '/api/daily',
  '/api/groups', '/api/sources', '/api/status', '/api/status/daily-sources', '/api/settings', '/api/settings/daily',
  '/api/reading', '/api/img', '/api/meta', '/api/mybrief', '/api/mybrief/archive', '/api/weekly',
  '/api/hot/events', '/api/hot/categories', '/api/hot/sources', '/api/hot/groups',
  '/api/opml/export',
]);
function isPublicGet(path) {
  const p = path.split('?')[0];
  if (PUBLIC_GET_EXACT.has(p)) return true;
  return /^\/api\/articles\/\d+$/.test(p)
    || /^\/api\/videos\/\d+(\/play)?$/.test(p)
    || /^\/api\/hot\/events\/\d+$/.test(p);
}

// ---- 1.4 GET 请求去重缓存 ----
// T3-8 批次1b：TTL 5s → 90s——后台切换板块会卸载重挂组件、重发全部 GET，5s 缓存救不了"切回来又要加载半天"。
// 90s 内重复访问直接吃缓存瞬时渲染；需要最新数据的场景（各板块刷新按钮）走 force 绕缓存，结果仍回写缓存。
const _getCache = new Map(); // key → { promise, ts }
const GET_CACHE_TTL = 300000; // 300 秒（2026-10-06 由 90s 上调）

function cacheGet(key, fetcher, force) {
  const now = Date.now();
  const entry = _getCache.get(key);
  if (!force && entry && now - entry.ts < GET_CACHE_TTL) return entry.promise;
  const prev = entry; // 失败兜底用：必须在下面 set 覆盖前捕获（对抗审查 P1：覆盖后 get 到的是本次失败 promise 自身 → 自引用 TypeError，兜底从未生效）
  const promise = fetcher().then(
    (data) => { _getCache.set(key, { promise: Promise.resolve(data), ts: Date.now() }); return data; },
    (err) => {
      // 恢复旧缓存（无则清掉）：失败 promise 不留缓存（防毒化 TTL 窗口）
      if (prev) _getCache.set(key, prev); else _getCache.delete(key);
      // stale-while-error：非 force 且有旧数据先回旧数据；401 必须放行（登录态失效要弹框）
      if (!force && prev && err && err.status !== 401) return prev.promise;
      throw err;
    }
  );
  _getCache.set(key, { promise, ts: now });
  return promise;
}

// 失效前缀匹配的缓存条目（写操作后调用）；except 列出不该跟着失效的同前缀只读键（如轮询端点）
function invalidateCache(prefix, { except } = {}) {
  for (const key of _getCache.keys()) {
    if (!prefix || key === prefix || key.startsWith(prefix + '?') || key.startsWith(prefix + '&')) {
      if (except && except.some((e) => key === e || key.startsWith(e + '?') || key.startsWith(e + '&'))) continue;
      _getCache.delete(key);
    }
  }
}

async function request(path, { method = 'GET', body, force } = {}) {
  let res;
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // 公开只读端点不带 token（让 CDN 缓存生效；后端本来就放行，不扩大攻击面）
    const token = getToken();
    if (token && !(method === 'GET' && isPublicGet(path))) headers.Authorization = `Bearer ${token}`;

    // 1.4：GET 请求走缓存去重（force = 绕缓存强拉，结果仍回写）
    if (method === 'GET') {
      // 轮询端点绕过内存缓存：URL 里的 ts 基线两次消费之间不变，同 key 会吃满 TTL——
      // 300s TTL 下新文章提示延迟从 ≤60s 恶化到 ≤300s（对抗审查 P2）。CDN 侧有 10s 短档兜着。
      if (path.startsWith('/api/articles/since')) {
        return fetch(path, {
          method,
          headers: Object.keys(headers).length ? headers : undefined,
          body: undefined,
        }).then(handleResponse);
      }
      return cacheGet(path, () => fetch(path, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: undefined,
      }).then(handleResponse), force);
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
    // 2026-10-06 收窄：条目级操作（已读/稍后/收藏）不该把 60s 轮询的 since 基线一起清掉
    const except = prefix === '/api/articles' ? ['/api/articles/since'] : undefined;
    invalidateCache(prefix, { except });
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
    if (res.status === 401) {
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
  get: (path, force) => request(path, { force }), // force=true 绕缓存强拉（刷新按钮用）
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  put: (path, body) => request(path, { method: 'PUT', body: body ?? {} }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload, // A1：二进制上传（自动带 Bearer + 401 广播）
  invalidate: invalidateCache, // 1.4：手动失效缓存（供外部组件在写操作后调用）
};

export { qs };

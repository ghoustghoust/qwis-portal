// 登录态管理（2026-09-05 P0 鉴权链路）：token 持久化 + 401 广播
// 约定：token 存 localStorage('qwis.token')，全站（reader/daily/hot/admin）同源共享一次登录。
// api.js 收到 401 时清除 token 并派发 'qwis:unauthorized' 事件，由 LoginGate 弹出登录框。
const TOKEN_KEY = 'qwis.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式等场景静默忽略 */
  }
}

export function isLoggedIn() {
  return !!getToken();
}

export function logout() {
  setToken('');
}

// 登录（直接走 fetch，避免与 api.js 循环依赖）
export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `登录失败（HTTP ${res.status}）`);
  }
  setToken(data.token);
  return data.token;
}

// 探测当前 token 是否仍有效（管理台启动门槛用）
export async function checkAuth() {
  if (!getToken()) return false;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// fetch 封装：超时 15s、重试 2 次、自定义 header/Cookie
async function httpFetch(url, opts = {}) {
  const { timeout = 15000, retries = 2, headers = {}, cookie, dispatcher, ...rest } = opts;
  const finalHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', ...headers };
  if (cookie) finalHeaders['Cookie'] = cookie;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...rest, headers: finalHeaders, signal: ctrl.signal, ...(dispatcher ? { dispatcher } : {}) });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchJson(url, opts = {}) {
  const res = await httpFetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await httpFetch(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

module.exports = { httpFetch, fetchJson, fetchText };

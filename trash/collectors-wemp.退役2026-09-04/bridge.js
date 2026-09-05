# we-mp-rss 集成桥接器（情报系统侧）
# 职责：登录 we-mp-rss → 拉订阅列表 → 与本地 sources(type=wemp) diff → 同步为 RSS 源
#       抓取走 rssAdapter.fetch（we-mp-rss /feed/{id}.atom 无鉴权，且 is_update=True 触发其增量采集）
const { fetchJson, fetchText } = require('../../util/http');
const { db, getSetting } = require('../../db');
const { nowIso } = require('../../util/time');

const WEMP_BASE = process.env.WEMP_BASE_URL || getSetting('wemp.baseUrl', 'http://127.0.0.1:8001');
let tokenCache = { token: null, expiresAt: 0 };

async function login() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const username = process.env.WEMP_USERNAME || getSetting('wemp.username', 'admin');
  const password = process.env.WEMP_PASSWORD || getSetting('wemp.password', 'admin@123');
  const res = await fetch(`${WEMP_BASE}/api/v1/wx/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
  });
  if (!res.ok) throw new Error(`we-mp-rss 登录失败 HTTP ${res.status}`);
  const data = await res.json();
  const token = data && data.data && data.data.access_token;
  if (!token) throw new Error('we-mp-rss 登录无 access_token（检查账号密码）');
  tokenCache = { token, expiresAt: Date.now() + ((data.data.expires_in || 259200) * 1000) - 60000 };
  return token;
}

// we-mp-rss 订阅列表 → [{id, name}]（仅启用状态）
async function listFeeds() {
  const token = await login();
  const headers = { Authorization: `Bearer ${token}` };
  const out = [];
  let page = 1;
  for (;;) {
    const r = await fetchJson(`${WEMP_BASE}/api/v1/wx/mps?page=${page}&size=50`, { headers });
    const list = (r.data && r.data.list) || [];
    out.push(...list.filter((f) => f.status === 1).map((f) => ({ id: f.id, name: f.mp_name || f.id })));
    const total = (r.data && r.data.total) || 0;
    if (page * 50 >= total || !list.length) break;
    page++;
  }
  return out;
}

// 同步：wemp feed → sources(type='wemp') 行（url 指向本机 atom 全文源）
async function syncSources() {
  const feeds = await listFeeds();
  const find = db.prepare("SELECT * FROM sources WHERE type='wemp' AND url=?");
  const insert = db.prepare(
    "INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES('wemp', ?, ?, 1, 'ok', ?)"
  );
  let added = 0;
  for (const f of feeds) {
    const url = `${WEMP_BASE}/feed/${f.id}.atom?limit=20`;
    if (!find.get(url)) {
      insert.run(f.name, url, nowIso());
      added++;
    }
  }
  setWempMeta('lastSyncAt', nowIso());
  setWempMeta('lastResult', { feeds: feeds.length, added });
  return { feeds: feeds.length, added };
}

function setWempMeta(key, value) {
  try { require('../../db').setSetting(`wemp.${key}`, value); } catch { /* settings 表不可用时忽略 */ }
}

module.exports = { login, listFeeds, syncSources, WEMP_BASE };
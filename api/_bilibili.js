// B站采集器（21-bilibili-runner，Turso 版，移植自 server/services/collectors/bilibili/index.js）
// 差异：Cookie 从 Turso credentials 读；无代理层（runner 海外直连）；console 日志
// ⚠️ 双实现：wbi 签名/混淆表/三链路逻辑与本地逐字一致，改动两边同步
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

let _db = null;
function getDb() {
  if (!_db) {
    _db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };

async function fetchJson(url, { headers = {}, cookie } = {}) {
  const res = await fetch(url, {
    headers: { ...HEADERS, ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getCookie() {
  try {
    const r = await getDb().execute("SELECT cookie FROM credentials WHERE platform='bilibili'");
    const row = Array.from(r.rows)[0];
    return row && row.cookie ? row.cookie : null;
  } catch { return null; }
}

// 匿名 buvid Cookie（spi 接口申请，缓存 1h）
let anonCookieCache = null;
async function getAnonCookie() {
  if (anonCookieCache && Date.now() - anonCookieCache.at < 3600e3) return anonCookieCache.cookie;
  const spi = await fetchJson('https://api.bilibili.com/x/frontend/finger/spi');
  if (spi.code !== 0 || !spi.data) return null;
  anonCookieCache = {
    cookie: `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4}; b_nut=${Math.floor(Date.now() / 1000)}`,
    at: Date.now(),
  };
  return anonCookieCache.cookie;
}

async function reqCookie() {
  return (await getCookie()) || (await getAnonCookie().catch(() => null));
}

// ---- wbi 签名（x/space/wbi/arc/search 需要）----
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let wbiCache = null;
async function getWbiKeys(force = false) {
  if (!force && wbiCache && Date.now() - wbiCache.at < 30 * 60e3) return wbiCache;
  const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', {
    cookie: await getCookie(),
  });
  const wbiImg = nav.data && nav.data.wbi_img;
  if (!wbiImg) throw new Error(`获取 wbi 密钥失败 code=${nav.code} ${nav.message || ''}`);
  const imgKey = wbiImg.img_url.split('/').pop().split('.')[0];
  const subKey = wbiImg.sub_url.split('/').pop().split('.')[0];
  const raw = imgKey + subKey;
  const mixinKey = MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
  wbiCache = { mixinKey, at: Date.now() };
  return wbiCache;
}

function signWbi(params, mixinKey) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    clean[k] = String(v).replace(/[!'()*]/g, '');
  }
  const query = Object.keys(clean)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean[k])}`)
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

function parseDuration(s) {
  const parts = String(s || '').split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function stripEm(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

// 主链路：x/space/wbi/arc/search（wbi 签名）；签名失败强制刷新密钥重试一次
async function fetchViaWbi(source, cookie) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { mixinKey } = await getWbiKeys(attempt > 0);
    const params = {
      mid: source.uid,
      ps: 30,
      tid: 0,
      pn: 1,
      keyword: '',
      order: 'pubdate',
      platform: 'web',
      web_location: 1550101,
      wts: Math.floor(Date.now() / 1000),
    };
    const res = await fetchJson(
      `https://api.bilibili.com/x/space/wbi/arc/search?${signWbi(params, mixinKey)}`,
      { headers: { Referer: `https://space.bilibili.com/${source.uid}` }, cookie }
    );
    if (res.code !== 0) {
      if ((res.code === -403 || res.code === -799) && attempt === 0) {
        console.log(`[bilibili] wbi 签名校验失败 code=${res.code}，强制刷新密钥重试: ${source.name}`);
        continue;
      }
      throw new Error(`B站视频列表失败 code=${res.code} ${res.message || ''}`);
    }
    const vlist = (res.data && res.data.list && res.data.list.vlist) || [];
    return vlist.map((v) => ({
      platform: 'bilibili',
      title: v.title,
      url: `https://www.bilibili.com/video/${v.bvid}`,
      vid: v.bvid,
      cover: v.pic ? (v.pic.startsWith('http') ? v.pic : `https:${v.pic}`) : null,
      duration: parseDuration(v.length),
      author: v.author || source.name,
      intro: v.description || '',
      published_at: v.created ? new Date(v.created * 1000).toISOString() : null,
    }));
  }
  throw new Error('B站视频列表失败：两次签名重试均失败');
}

// 兜底链路 A：合集/系列接口（免登录）
async function fetchViaSeries(source, cookie) {
  const videos = [];
  const seen = new Set();
  for (let page = 1; page <= 5; page++) {
    const res = await fetchJson(
      `https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid=${source.uid}&page_num=${page}&page_size=20`,
      { headers: { Referer: `https://space.bilibili.com/${source.uid}` }, cookie }
    );
    if (res.code !== 0) throw new Error(`B站合集接口失败 code=${res.code} ${res.message || ''}`);
    const lists = res.data && res.data.items_lists;
    const seasons = (lists && lists.seasons_list) || [];
    for (const s of seasons) {
      for (const v of s.archives || []) {
        if (!v.bvid || seen.has(v.bvid)) continue;
        seen.add(v.bvid);
        videos.push({
          platform: 'bilibili',
          title: v.title,
          url: `https://www.bilibili.com/video/${v.bvid}`,
          vid: v.bvid,
          cover: v.pic ? (v.pic.startsWith('http') ? v.pic : `https:${v.pic}`) : null,
          duration: v.duration || null,
          author: source.name,
          intro: (s.meta && s.meta.description) || '',
          published_at: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
        });
      }
    }
    const total = lists && lists.page ? lists.page.total : 0;
    if (page * 20 >= total || !seasons.length) break;
  }
  return videos;
}

// 兜底链路 B：搜索接口按 UP 主昵称搜视频，按 mid 过滤
async function fetchViaSearch(source, cookie) {
  const res = await fetchJson(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&ps=30&page=1&keyword=${encodeURIComponent(source.name)}`,
    { headers: { Referer: 'https://search.bilibili.com' }, cookie }
  );
  if (res.code !== 0) throw new Error(`B站搜索兜底失败 code=${res.code} ${res.message || ''}`);
  const items = (res.data && res.data.result) || [];
  return items
    .filter((v) => String(v.mid) === String(source.uid))
    .map((v) => ({
      platform: 'bilibili',
      title: stripEm(v.title),
      url: `https://www.bilibili.com/video/${v.bvid}`,
      vid: v.bvid,
      cover: v.pic ? (v.pic.startsWith('http') ? v.pic : `https:${v.pic}`) : null,
      duration: parseDuration(v.duration),
      author: v.author || source.name,
      intro: stripEm(v.description),
      published_at: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
    }));
}

async function fetchViaFallback(source, cookie) {
  const merged = new Map();
  const errs = [];
  for (const fn of [fetchViaSeries, fetchViaSearch]) {
    try {
      for (const v of await fn(source, cookie)) {
        if (!merged.has(v.vid)) merged.set(v.vid, v);
      }
    } catch (err) {
      errs.push(err.message);
    }
  }
  const videos = [...merged.values()].sort((a, b) =>
    String(b.published_at || '').localeCompare(String(a.published_at || ''))
  );
  if (!videos.length && errs.length) throw new Error(errs.join('；'));
  return videos;
}

// 主入口：UP 主最新视频（source 需含 uid/name/url）
async function fetchBiliVideos(source) {
  const cookie = await reqCookie();
  let videos;
  try {
    videos = await fetchViaWbi(source, cookie);
  } catch (err) {
    console.log(`[bilibili] wbi 主链失败（${err.message}），改合集/搜索兜底: ${source.name}`);
    videos = await fetchViaFallback(source, cookie);
  }
  return { videos };
}

// 诊断：Cookie 配置 / wbi 密钥刷新 / 登录态
async function diagnose() {
  const cookie = await getCookie();
  const out = { cookieConfigured: !!cookie, wbiKeyRefreshed: false, loginOk: false, uname: null, message: '' };
  try {
    await getWbiKeys(true);
    out.wbiKeyRefreshed = true;
  } catch (err) {
    out.message = `wbi 密钥获取失败: ${err.message}`;
    return out;
  }
  try {
    const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', { cookie });
    out.loginOk = nav.code === 0 && !!(nav.data && nav.data.isLogin);
    out.uname = nav.data && nav.data.uname ? nav.data.uname : null;
    if (!out.loginOk) out.message = `Cookie 登录态无效 code=${nav.code}（-101 表示未登录/SESSDATA 过期），请更新 Cookie`;
  } catch (err) {
    out.message = `nav 接口请求异常: ${err.message}`;
  }
  return out;
}

module.exports = { fetchBiliVideos, diagnose, signWbi, getWbiKeys };

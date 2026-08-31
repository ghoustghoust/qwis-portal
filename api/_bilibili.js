// B站采集云端版(十一期 M5):移植主系统 server/services/collectors/bilibili/index.js
// wbi 签名(纯计算) + 视频列表;风控失败走合集/搜索兜底;Cookie 读 Turso credentials
// 抖音不上云(需要无头浏览器+登录态,serverless 太脆),仅 bilibili
const crypto = require('crypto');
const { dbGet } = require('./_turso');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };

async function fetchJson(url, { headers = {}, cookie } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getCookie() {
  const row = await dbGet("SELECT data FROM credentials WHERE platform='bilibili'");
  if (!row) return null;
  try {
    const d = JSON.parse(row.data || '{}');
    return d.cookie || null;
  } catch {
    return row.data || null; // 兼容裸 cookie 字符串
  }
}

// 匿名 buvid Cookie(spi 接口申请):无登录 Cookie 时降低风控概率
async function getAnonCookie() {
  const spi = await fetchJson('https://api.bilibili.com/x/frontend/finger/spi', { headers: HEADERS });
  if (spi.code !== 0 || !spi.data) return null;
  return `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4}; b_nut=${Math.floor(Date.now() / 1000)}`;
}

async function reqCookie() {
  return (await getCookie()) || (await getAnonCookie().catch(() => null));
}

// ---- wbi 签名(x/space/wbi/arc/search 需要) ----
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

async function getWbiKeys() {
  const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', {
    headers: HEADERS,
    cookie: await getCookie(),
  });
  const wbiImg = nav.data && nav.data.wbi_img;
  if (!wbiImg) throw new Error('获取 wbi 密钥失败');
  const imgKey = wbiImg.img_url.split('/').pop().split('.')[0];
  const subKey = wbiImg.sub_url.split('/').pop().split('.')[0];
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
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

function uidOf(source) {
  if (source.uid) return String(source.uid);
  const m = String(source.url || '').match(/space\.bilibili\.com\/(\d+)/i);
  return m ? m[1] : null;
}

// 主链路:x/space/wbi/arc/search(wbi 签名)
async function fetchViaWbi(source, cookie) {
  const uid = uidOf(source);
  if (!uid) throw new Error('B站源缺少 uid');
  const mixinKey = await getWbiKeys();
  const params = {
    mid: uid,
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
    { headers: { ...HEADERS, Referer: `https://space.bilibili.com/${uid}` }, cookie }
  );
  if (res.code !== 0) throw new Error(`B站视频列表失败 code=${res.code} ${res.message || ''}`);
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

// 兜底链路 A:合集/系列接口(免登录可用)
async function fetchViaSeries(source, cookie) {
  const uid = uidOf(source);
  const videos = [];
  const seen = new Set();
  for (let page = 1; page <= 3; page++) { // 云端最多翻 3 页(主系统 5 页),防超时
    const res = await fetchJson(
      `https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid=${uid}&page_num=${page}&page_size=20`,
      { headers: { ...HEADERS, Referer: `https://space.bilibili.com/${uid}` }, cookie }
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

// 兜底链路 B:搜索接口按 UP 主昵称搜视频,按 mid 过滤
async function fetchViaSearch(source, cookie) {
  const uid = uidOf(source);
  const res = await fetchJson(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&ps=30&page=1&keyword=${encodeURIComponent(source.name)}`,
    { headers: { ...HEADERS, Referer: 'https://search.bilibili.com' }, cookie }
  );
  if (res.code !== 0) throw new Error(`B站搜索兜底失败 code=${res.code} ${res.message || ''}`);
  const items = (res.data && res.data.result) || [];
  return items
    .filter((v) => String(v.mid) === String(uid))
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

// 兜底:合集 + 搜索合并去重,按发布时间倒序
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
  if (!videos.length && errs.length) throw new Error(errs.join(';'));
  return videos;
}

async function fetchBilibili(source) {
  const cookie = await reqCookie();
  let videos;
  try {
    videos = await fetchViaWbi(source, cookie);
  } catch {
    // wbi 接口被风控(HTTP 412 / code -352 / -412 / -799 等)时走合集+搜索兜底
    videos = await fetchViaFallback(source, cookie);
  }
  return { articles: [], videos };
}

module.exports = { fetchBilibili };

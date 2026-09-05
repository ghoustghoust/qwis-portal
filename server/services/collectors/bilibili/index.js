// B站适配器（F28~F35）：UP 主链接/uid 识别、官方 API 抓视频、Cookie 解析直链
const crypto = require('crypto');
const { fetchJson } = require('../../../util/http');
const { db } = require('../../../db');
const log = require('../../../util/log');

// F30 失败提示文案（spec 原文，逐字一致）
const FAIL_MSG = '添加失败：没有识别到 B站 up，请粘贴 space.bilibili.com 的主页链接或直接填写数字 uid';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };

function getCookie() {
  const row = db.prepare("SELECT cookie FROM credentials WHERE platform='bilibili'").get();
  return row && row.cookie ? row.cookie : null;
}

// 匿名 buvid Cookie（spi 接口申请，缓存 1h）：无登录 Cookie 时降低风控概率
let anonCookieCache = null;
async function getAnonCookie() {
  if (anonCookieCache && Date.now() - anonCookieCache.at < 3600e3) return anonCookieCache.cookie;
  const spi = await fetchJson('https://api.bilibili.com/x/frontend/finger/spi', { headers: HEADERS });
  if (spi.code !== 0 || !spi.data) return null;
  anonCookieCache = {
    cookie: `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4}; b_nut=${Math.floor(Date.now() / 1000)}`,
    at: Date.now(),
  };
  return anonCookieCache.cookie;
}

// 请求用 Cookie：优先用户配置的 credentials，否则匿名 buvid
async function reqCookie() {
  return getCookie() || (await getAnonCookie().catch(() => null));
}

function match(input) {
  const s = String(input || '').trim();
  let m = s.match(/space\.bilibili\.com\/(\d+)/i);
  if (m) return { uid: m[1] };
  m = s.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i) || s.match(/^(BV[0-9A-Za-z]+)$/);
  if (m) return { bvid: m[1] };
  if (/^\d{3,}$/.test(s)) return { uid: s };
  return false;
}

async function resolve(input) {
  const m = match(input);
  if (!m) throw new Error(FAIL_MSG);
  try {
    let uid = m.uid || null;
    let fallbackName = null;
    if (!uid && m.bvid) {
      // BV 号视频链接 → api 反查 uid
      const view = await fetchJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${m.bvid}`,
        { headers: HEADERS, cookie: getCookie() }
      );
      if (view.code !== 0 || !view.data || !view.data.owner) throw new Error(`BV 反查失败 code=${view.code}`);
      uid = String(view.data.owner.mid);
      fallbackName = view.data.owner.name;
    }
    // 优先 acc/info 取昵称/头像；无 Cookie 环境常被风控（-799），回退 card 接口
    let name = fallbackName, avatar = null;
    try {
      const info = await fetchJson(
        `https://api.bilibili.com/x/space/acc/info?mid=${uid}`,
        { headers: HEADERS, cookie: getCookie() }
      );
      if (info.code === 0 && info.data) {
        name = info.data.name || name;
        avatar = info.data.face || null;
      }
    } catch { /* 风控时走 card 兜底 */ }
    if (!name || !avatar) {
      const card = await fetchJson(
        `https://api.bilibili.com/x/web-interface/card?mid=${uid}`,
        { headers: HEADERS, cookie: getCookie() }
      );
      if (card.code !== 0 || !card.data || !card.data.card) throw new Error(`card 失败 code=${card.code}`);
      name = name || card.data.card.name;
      avatar = avatar || card.data.card.face || null;
    }
    return {
      name: name || `UP主${uid}`,
      uid,
      avatar,
      url: `https://space.bilibili.com/${uid}`,
    };
  } catch (err) {
    if (err.message === FAIL_MSG) throw err;
    throw new Error(FAIL_MSG); // F30：识别/解析失败统一返回原文提示
  }
}

// ---- wbi 签名（x/space/wbi/arc/search 需要）----
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let wbiCache = null;
// P1 修复：nav 接口风控时（非 code=0 也可能带 wbi_img）容忍性解析；密钥缓存缩短到 30min（官方每日 0 点刷新，避免拿到隔夜密钥后整小时反复签名失败）
async function getWbiKeys(force = false) {
  if (!force && wbiCache && Date.now() - wbiCache.at < 30 * 60e3) return wbiCache;
  const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', {
    headers: HEADERS,
    cookie: getCookie(),
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
  // "12:34" 或 "1:02:03" → 秒
  const parts = String(s || '').split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function stripEm(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

// 主链路：x/space/wbi/arc/search（wbi 签名）；签名校验失败（-403 签名错误）时强制刷新密钥重试一次（P1 修复：密钥每天 0 点刷新，隔夜缓存会导致持续签名失败）
async function fetchViaWbi(source, cookie) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { mixinKey } = await getWbiKeys(attempt > 0); // 第二次强制刷新密钥
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
      {
        headers: { ...HEADERS, Referer: `https://space.bilibili.com/${source.uid}` },
        cookie,
      }
    );
    if (res.code !== 0) {
      // -403 签名校验失败 → 密钥可能已轮换，强制刷新重试；其他错误直接抛出走兜底
      if ((res.code === -403 || res.code === -799) && attempt === 0) {
        log.warn(`wbi 签名校验失败 code=${res.code}，强制刷新密钥重试: ${source.name}`);
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

// 兜底链路 A：合集/系列接口（x/polymer/web-space/seasons_series_list，免登录可用），分页取全部合集内视频
async function fetchViaSeries(source, cookie) {
  const videos = [];
  const seen = new Set();
  for (let page = 1; page <= 5; page++) {
    const res = await fetchJson(
      `https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid=${source.uid}&page_num=${page}&page_size=20`,
      {
        headers: { ...HEADERS, Referer: `https://space.bilibili.com/${source.uid}` },
        cookie,
      }
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

// 兜底链路 B：搜索接口按 UP 主昵称搜视频，按 mid 过滤（覆盖未归入合集的新视频）
async function fetchViaSearch(source, cookie) {
  const res = await fetchJson(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&ps=30&page=1&keyword=${encodeURIComponent(source.name)}`,
    {
      headers: { ...HEADERS, Referer: 'https://search.bilibili.com' },
      cookie,
    }
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

// 兜底：合集 + 搜索合并去重，按发布时间倒序
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

async function fetch(source) {
  const cookie = await reqCookie();
  let videos;
  try {
    videos = await fetchViaWbi(source, cookie);
  } catch (err) {
    // wbi 接口被风控（HTTP 412 / code -352 / -412 / -799 等）时走合集+搜索兜底
    log.warn(`wbi 视频列表失败（${err.message}），改用合集/搜索兜底: ${source.name}`);
    videos = await fetchViaFallback(source, cookie);
  }
  return { articles: [], videos };
}

// F9/F35：带 Cookie 请求 playurl 接口取直链；无 Cookie 或失败返回 null（前端回退官方 embed）
async function getPlayUrl(bvid) {
  const cookie = getCookie();
  if (!cookie) return null;
  const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers: HEADERS,
    cookie,
  });
  if (view.code !== 0 || !view.data) return null;
  const cid = view.data.cid;
  const res = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&platform=html5&high_quality=1`,
    { headers: HEADERS, cookie }
  );
  if (res.code !== 0 || !res.data) return null;
  const durl = res.data.durl;
  return durl && durl[0] ? durl[0].url : null;
}

module.exports = {
  type: 'bilibili',
  defaultIntervalMin: 60,
  FAIL_MSG,
  match,
  resolve,
  fetch,
  getPlayUrl,
  // 运维诊断用：强制刷新 wbi 密钥并验证 Cookie 登录态（/api/sources/bilibili-diagnose 调用）
  _diagnose: async () => {
    const out = { cookieConfigured: !!getCookie(), wbiKeyRefreshed: false, loginOk: false, uname: null, message: '' };
    try {
      await getWbiKeys(true);
      out.wbiKeyRefreshed = true;
    } catch (err) {
      out.message = `wbi 密钥获取失败: ${err.message}`;
      return out;
    }
    try {
      const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', { headers: HEADERS, cookie: getCookie() });
      out.loginOk = nav.code === 0 && !!(nav.data && nav.data.isLogin);
      out.uname = nav.data && nav.data.uname ? nav.data.uname : null;
      if (!out.loginOk) out.message = `Cookie 登录态无效 code=${nav.code}（-101 表示未登录/SESSDATA 过期），请更新 Cookie`;
    } catch (err) {
      out.message = `nav 接口请求异常: ${err.message}`;
    }
    return out;
  },
};

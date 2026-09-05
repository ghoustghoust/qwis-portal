// 抖音适配器（T40/T41，F36~F42）：
//  - match：douyin.com/user/ 主页、v.douyin.com 分享短链（跳转解析）、sec_uid 直填
//  - resolve：Playwright 带已存登录态访问主页取昵称/头像；名称未解析时用原始 sec_uid 显示（F42）
//  - fetch：抓作者视频列表 → videos 表（platform='douyin'）
//  - 严格串行队列（N4）：所有主页访问进同一队列，任意两次访问间隔 ≥10s；
//    最后访问时间持久化到 settings['douyin.lastFetchAt']，服务重启后限速状态可恢复
const { chromium } = require('playwright');
const { db, getSetting, setSetting } = require('../../../db');
const { httpFetch } = require('../../../util/http');
const { nowIso } = require('../../../util/time');
const log = require('../../../util/log');

// F40 失败提示文案（spec 原文，逐字一致）
const FAIL_MSG = '添加失败：没有识别到抖音 uid/sec_uid，请粘贴抖音用户主页链接或直接填写 sec_uid';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---- 严格串行队列（N4）----
// 间隔可用环境变量 DOUYIN_QUEUE_GAP_MS 覆盖（默认 10000ms，测试时可缩短）
function queueGapMs() {
  return Number(process.env.DOUYIN_QUEUE_GAP_MS) || 10000;
}

// 重启恢复：上次访问时间持久化在 settings，进程重启后仍然遵守 ≥10s 间隔
let lastAccessAt = Number(getSetting('douyin.lastFetchAt', 0)) || 0;
let queueChain = Promise.resolve();

// 所有抖音主页访问统一经此入口排队执行
function enqueue(task) {
  const run = queueChain.then(async () => {
    const wait = Math.max(0, lastAccessAt + queueGapMs() - Date.now());
    if (wait > 0) {
      log.info(`抖音串行队列：距上次主页访问不足 ${queueGapMs() / 1000}s，等待 ${(wait / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
    const prev = lastAccessAt;
    lastAccessAt = Date.now();
    setSetting('douyin.lastFetchAt', lastAccessAt); // 先落库再访问，崩溃重启也不破坏限速
    log.info(`抖音串行队列：开始主页访问${prev ? `（距上次 ${((lastAccessAt - prev) / 1000).toFixed(1)}s）` : '（首次）'}`);
    return task();
  });
  queueChain = run.catch(() => {}); // 单个任务失败不阻塞后续任务
  return run;
}

// ---- 登录态（credentials 表，cookie 字段存 Playwright storageState JSON 或 Cookie 头字符串）----
function loadStorageState() {
  const row = db.prepare("SELECT cookie FROM credentials WHERE platform='douyin'").get();
  if (!row || !row.cookie) return null;
  const raw = String(row.cookie);
  try {
    const st = JSON.parse(raw);
    if (st && Array.isArray(st.cookies)) return st;
  } catch { /* 非 JSON：按 Cookie 头字符串处理 */ }
  // 兼容手工粘贴的 Cookie 头字符串："k1=v1; k2=v2"
  const cookies = raw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const eq = p.indexOf('=');
    return { name: p.slice(0, eq), value: p.slice(eq + 1), domain: '.douyin.com', path: '/' };
  }).filter((c) => c.name);
  return cookies.length ? { cookies, origins: [] } : null;
}

// ---- match（F40）----
function match(input) {
  const s = String(input || '').trim();
  if (!s) return false;
  let m = s.match(/douyin\.com\/user\/([\w-]+)/i);
  if (m) return { sec_uid: m[1] };
  if (/^https?:\/\/v\.douyin\.com\/[\w-]+\/?/i.test(s)) return { shortUrl: s };
  // sec_uid 直填：常见以 MS4wLjAB 开头；兜底接受 40 位以上单词字符
  if (/^MS4wLjAB[\w-]{8,}$/i.test(s)) return { sec_uid: s };
  if (/^[A-Za-z0-9_-]{40,}$/.test(s)) return { sec_uid: s };
  return false;
}

// v.douyin.com 短链跟随跳转 → 解析 sec_uid
async function resolveShortUrl(shortUrl) {
  const res = await httpFetch(shortUrl, { redirect: 'follow', timeout: 15000 });
  const finalUrl = res.url || shortUrl;
  const m = String(finalUrl).match(/douyin\.com\/user\/([\w-]+)/i);
  if (m) return m[1];
  // 部分短链跳到视频/合集页，从页面或 modal 参数中再试一次
  const m2 = String(finalUrl).match(/sec_uid=([\w-]+)/i);
  if (m2) return m2[1];
  throw new Error(`短链未解析出 sec_uid: ${finalUrl}`);
}

// ---- Playwright 访问主页（带登录态，headless；登录流程见 routes/auth.js 的有头模式）----
async function withProfilePage(secUid, fn) {
  return enqueue(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const contextOpts = { userAgent: UA, viewport: { width: 1280, height: 900 } };
      const storageState = loadStorageState();
      if (storageState) contextOpts.storageState = storageState;
      const context = await browser.newContext(contextOpts);
      const page = await context.newPage();
      const apiPayloads = [];
      // 页面自身发起的 aweme/post 接口响应（若触发）顺手接住
      page.on('response', async (resp) => {
        try {
          if (/aweme\/v\d+\/web\/aweme\/post/.test(resp.url())) {
            apiPayloads.push(await resp.json());
          }
        } catch { /* 忽略单个响应解析失败 */ }
      });
      const url = `https://www.douyin.com/user/${secUid}`;
      log.info(`抖音主页访问: ${url}${storageState ? '（带登录态）' : '（无登录态）'}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000); // 等前端渲染/首批数据
      const result = await fn(page, apiPayloads);
      return result;
    } finally {
      await browser.close().catch(() => {});
    }
  });
}

// 从页面 SSR 数据（script#RENDER_DATA，URL 编码 JSON）中递归找作者信息/视频列表
function findInRenderData(root, pred) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (!Array.isArray(cur) && pred(cur)) return cur;
    for (const v of Object.values(cur)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

async function readRenderData(page) {
  try {
    const raw = await page.$eval('script#RENDER_DATA', (el) => el.textContent || '');
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

// 昵称/头像：RENDER_DATA → 页面 DOM → <title>
async function extractProfile(page, secUid) {
  const data = await readRenderData(page);
  let name = null;
  let avatar = null;
  if (data) {
    const user = findInRenderData(data, (o) =>
      typeof o.nickname === 'string' && o.nickname &&
      (o.sec_uid === secUid || o.secUid === secUid || o.avatar_thumb || o.avatarThumb || o.avatar_larger));
    if (user) {
      name = user.nickname;
      const av = user.avatar_larger || user.avatarThumb || user.avatar_thumb;
      avatar = av && Array.isArray(av.url_list) ? av.url_list[0] : (av && av.urlList && av.urlList[0]) || null;
    }
  }
  if (!name) {
    name = await page.evaluate(() => {
      const h1 = document.querySelector('[data-e2e="user-info"] h1, h1');
      if (h1 && h1.textContent) return h1.textContent.trim();
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) return og.content.replace(/的主页.*$/, '').trim();
      return null;
    }).catch(() => null);
  }
  if (!avatar) {
    avatar = await page.evaluate(() => {
      const img = document.querySelector('[data-e2e="user-info"] img, img[src*="douyinpic"]');
      return img ? img.src : null;
    }).catch(() => null);
  }
  return { name, avatar };
}

async function resolve(input) {
  const m = match(input);
  if (!m) throw new Error(FAIL_MSG);
  let secUid = m.sec_uid || null;
  if (!secUid && m.shortUrl) {
    try {
      secUid = await resolveShortUrl(m.shortUrl);
    } catch (err) {
      log.error('抖音短链解析失败:', err.message);
      throw new Error(FAIL_MSG);
    }
  }
  if (!secUid) throw new Error(FAIL_MSG);
  // 访问主页取昵称/头像；失败不阻断添加（F42：名称未解析时显示原始 sec_uid）
  let name = null;
  let avatar = null;
  try {
    const prof = await withProfilePage(secUid, (page) => extractProfile(page, secUid));
    name = prof.name;
    avatar = prof.avatar;
  } catch (err) {
    log.warn(`抖音主页解析昵称/头像失败（${err.message}），按 F42 以 sec_uid 作为显示名`);
  }
  return {
    name: name || secUid, // F42：未解析时显示原始 sec_uid
    uid: secUid,
    avatar,
    url: `https://www.douyin.com/user/${secUid}`,
  };
}

// ---- fetch：抓作者视频列表 ----
function mapAweme(a, sourceName) {
  const vid = a.aweme_id || a.awemeId;
  if (!vid) return null;
  const v = a.video || {};
  const coverObj = v.cover || v.origin_cover || v.originCover;
  const cover = coverObj && Array.isArray(coverObj.url_list) ? coverObj.url_list[0]
    : (coverObj && coverObj.urlList && coverObj.urlList[0]) || null;
  const createTime = a.create_time || a.createTime;
  const playAddr = v.play_addr || v.playAddr;
  return {
    platform: 'douyin',
    title: a.desc || a.preview_title || `抖音视频 ${vid}`,
    url: `https://www.douyin.com/video/${vid}`,
    vid: String(vid),
    cover,
    duration: v.duration ? Math.round(v.duration / 1000) : null,
    author: (a.author && a.author.nickname) || sourceName || '',
    intro: a.desc || '',
    published_at: createTime ? new Date(Number(createTime) * 1000).toISOString() : null,
    play_uri: (playAddr && playAddr.uri) || null, // 播放时凭此换完整流（含声音）
  };
}

async function extractVideos(page, apiPayloads, sourceName) {
  // 1) 页面自身 aweme/post 接口响应
  for (const p of apiPayloads) {
    const list = (p && p.aweme_list) || [];
    const videos = list.map((a) => mapAweme(a, sourceName)).filter(Boolean);
    if (videos.length) return videos;
  }
  // 2) SSR RENDER_DATA 内嵌首批作品
  const data = await readRenderData(page);
  if (data) {
    const holder = findInRenderData(data, (o) => Array.isArray(o.aweme_list) && o.aweme_list.length)
      || findInRenderData(data, (o) => Array.isArray(o.awemeList) && o.awemeList.length);
    const list = holder ? (holder.aweme_list || holder.awemeList) : [];
    const videos = list.map((a) => mapAweme(a, sourceName)).filter(Boolean);
    if (videos.length) return videos;
    // 兜底：递归找所有带 aweme_id 的对象
    const collected = new Map();
    const stack = [data];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);
      if (!Array.isArray(cur) && (cur.aweme_id || cur.awemeId)) {
        const v = mapAweme(cur, sourceName);
        if (v && !collected.has(v.vid)) collected.set(v.vid, v);
      }
      for (const val of Object.values(cur)) {
        if (val && typeof val === 'object') stack.push(val);
      }
    }
    if (collected.size) return [...collected.values()];
  }
  return [];
}

async function fetch(source) {
  const secUid = source.uid;
  if (!secUid) throw new Error('抖音订阅源缺少 sec_uid');
  const videos = await withProfilePage(secUid, (page, apiPayloads) =>
    extractVideos(page, apiPayloads, source.name));
  if (!videos.length) {
    throw new Error('抖音视频列表为空：未登录态下主页可能触发验证码/登录墙，请通过「设置-抖音」扫码登录后重试');
  }
  log.info(`抖音抓取完成: ${source.name} → ${videos.length} 条视频`);
  return { articles: [], videos };
}

// ---- Cookie 头字符串（播放端点签名用）----
function cookieHeader() {
  const st = loadStorageState();
  if (!st || !st.cookies) return '';
  return st.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// 播放直链：优先用入库的 play_uri（抓取时存的 play_addr.uri，不过期）调官方播放端点
// → 302 出新鲜签名的完整 mp4（画面+声音）。无 play_uri 时回退 Playwright 页面捕获。
async function getPlayUrl(vid) {
  const row = db.prepare('SELECT play_uri FROM videos WHERE vid=? AND platform=?').get(String(vid), 'douyin');
  if (row && row.play_uri) {
    try {
      const r = await httpFetch(`https://www.douyin.com/aweme/v1/play/?video_id=${row.play_uri}&line=0`, {
        headers: { Cookie: cookieHeader(), Referer: 'https://www.douyin.com/' },
        redirect: 'manual',
        timeout: 15000,
      });
      const loc = r.headers.get('location');
      if ((r.status === 301 || r.status === 302) && loc) {
        log.info(`抖音直链（play_uri 完整流）: ${vid}`);
        return loc;
      }
    } catch (err) {
      log.warn(`抖音 play_uri 换流失败，回退页面捕获: ${err.message}`);
    }
  }
  return capturePlayUrl(vid);
}

// 页面捕获兜底：Playwright 带登录态打开视频 modal 页，点击播放并捕获媒体流
// （/aweme/v1/play/ 完整流 > CDN 视频轨 > 跳过纯音频流）；走串行队列（N4）
async function capturePlayUrl(vid) {
  return enqueue(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const contextOpts = { userAgent: UA, viewport: { width: 1280, height: 900 } };
      const storageState = loadStorageState();
      if (storageState) contextOpts.storageState = storageState;
      const context = await browser.newContext(contextOpts);
      const page = await context.newPage();
      let playEndpoint = null; // /aweme/v1/play/：完整 mp4（画面+声音），首选
      let videoStream = null;  // CDN video/tos/：可能是纯视频轨（无声），兜底
      page.on('response', (r) => {
        const u = r.url();
        // 跳过纯音频流（media-audio-und 只有声音没画面）
        if (/media-audio|audio-und|audio_only/i.test(u)) return;
        if (/\/aweme\/v\d+\/play\//.test(u)) { playEndpoint = playEndpoint || u; return; }
        const ct = r.headers()['content-type'] || '';
        if ((/video\/tos\//.test(u) && !/\.m3u8/.test(u)) || (/video\/mp4/.test(ct) && !/audio/i.test(u))) {
          videoStream = videoStream || u;
        }
      });
      // 详情接口 JSON → play_addr.url_list（最可靠的完整流来源）
      page.on('response', async (r) => {
        if (playEndpoint || !/\/aweme\/v\d+\/web\/aweme\/detail/.test(r.url())) return;
        try {
          const j = await r.json();
          const detail = j && (j.aweme_detail || (j.aweme_list || [])[0]);
          const urls = detail && detail.video && detail.video.play_addr && detail.video.play_addr.url_list;
          if (urls && urls.length) {
            let u0 = urls.find((x) => /\/aweme\/v\d+\/play\//.test(x)) || urls[0];
            if (u0.startsWith('//')) u0 = 'https:' + u0;
            playEndpoint = u0;
          }
        } catch { /* 单个响应解析失败忽略 */ }
      });
      const url = `https://www.douyin.com/discover?modal_id=${vid}`;
      log.info(`抖音视频页访问（取直链）: ${url}${storageState ? '（带登录态）' : '（无登录态）'}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // 等待 video 元素出现后真实点击触发播放（headless 自动播放常被拦）
      await page.waitForSelector('video', { timeout: 15000 }).catch(() => {});
      for (let i = 0; i < 3 && !playEndpoint; i++) {
        await page.evaluate(() => {
          const v = document.querySelector('video');
          if (v) { v.muted = true; v.play().catch(() => {}); }
        });
        await page.waitForTimeout(4000);
      }
      const playUrl = playEndpoint || videoStream; // 完整流优先，纯视频轨兜底
      log.info(`抖音直链解析${playUrl ? `成功（${playEndpoint ? '完整流' : '视频轨'}）` : '失败（未捕获媒体流）'}: ${vid}`);
      return playUrl;
    } finally {
      await browser.close().catch(() => {});
    }
  });
}

// ---- F37/F38: 扫码登录（有头浏览器，登录态存 credentials 表 platform='douyin'）----
// 契约：POST /api/auth/douyin/start 拉起本机浏览器 → 后台轮询 cookie 检测登录成功 → 存 storageState → 自动关窗
let loginBrowser = null;
let loginInFlight = null; // 启动中的 Promise 占位：消除「检查 loginBrowser → await launch」之间的竞态窗口（并发双击只起一个浏览器）

function getLoginStatus() {
  const row = db.prepare("SELECT cookie, updated_at FROM credentials WHERE platform='douyin'").get();
  return { loggedIn: !!(row && row.cookie), updatedAt: (row && row.updated_at) || null };
}

function startLogin() {
  if (loginInFlight || loginBrowser) return Promise.resolve({ started: true, already: true });
  loginInFlight = doStartLogin().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

async function doStartLogin() {
  const browser = await chromium.launch({ headless: false });
  loginBrowser = browser;
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 后台等待登录成功（sessionid cookie 出现），最多 5 分钟，超时自动关窗
    (async () => {
      const deadline = Date.now() + 5 * 60e3;
      try {
        while (Date.now() < deadline) {
          const cookies = await context.cookies().catch(() => []);
          if (cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')) {
            const state = await context.storageState();
            db.prepare(
              'INSERT INTO credentials(platform, cookie, updated_at) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET cookie=excluded.cookie, updated_at=excluded.updated_at'
            ).run('douyin', JSON.stringify(state), nowIso());
            log.info('抖音登录态已保存到 credentials 表');
            break;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        log.warn('抖音登录等待异常:', err.message);
      } finally {
        if (loginBrowser === browser) loginBrowser = null;
        await browser.close().catch(() => {});
      }
    })();
    return { started: true };
  } catch (err) {
    if (loginBrowser === browser) loginBrowser = null;
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = {
  type: 'douyin',
  defaultIntervalMin: 360,
  FAIL_MSG,
  match,
  resolve,
  fetch,
  getPlayUrl,
  getLoginStatus,
  startLogin,
  enqueue, // 导出串行队列入口，供 scheduler 调用（N4）
  _internals: { loadStorageState, resolveShortUrl, extractVideos, mapAweme }, // 测试用
};

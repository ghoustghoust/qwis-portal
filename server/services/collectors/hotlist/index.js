// 热榜聚合适配器（九期 M1）：newsnow /api/s?id=xxx&latest → articles
// 兼容 60s API(/v2/60s 每日精选新闻)——响应结构自动识别
// source.url 规范：hotlist://{newsnow源id}（如 hotlist://zhihu）或 hotlist60s://60s
// 说明：热榜条目为标题级（发现层），summary=平台提供的概述(hover)，score=热度值(归一化)
// 无 hover 的平台(微博等)：正文补抓原文页(Readability，每轮限 5 条防请求风暴)，兜底显示标题+原文链接
const { fetchJson } = require('../../../util/http');
const { getSetting } = require('../../../db');

const DEFAULT_BASE = 'https://newsnow.busiyi.world';
const DEFAULT_60S_BASE = 'https://60s.viki.moe';

function baseUrl() {
  return process.env.HOTLIST_BASE_URL || getSetting('hotlist.baseUrl', DEFAULT_BASE);
}

function d60sBase() {
  return process.env.D60S_BASE_URL || DEFAULT_60S_BASE;
}

// "1001 万热度" → 10010000；"123 万" → 1230000；纯数字原样
function parseHeat(info) {
  if (!info) return null;
  const m = String(info).match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === '万') n *= 1e4;
  if (m[2] === '亿') n *= 1e8;
  return Math.round(n);
}

function mapNewsnow(data, platform, category) {
  // 2026-09-11：按榜内名次每条递减 60s，避免同源同刻时间戳并列成块（与云端 collect 对齐）
  const updatedMs = data.updatedTime ? Number(data.updatedTime) : null;
  return (data.items || [])
    .filter((it) => it && it.url && it.title)
    .map((it, idx) => {
      const title = String(it.title).trim();
      let hover = (it.extra && it.extra.hover) || '';
      // 上游编码问题防御:hover 含乱码特征(西里尔/修饰字母等)则丢弃摘要
      if (/[Ѐ-ӿˈ-˿锟锛銆]/.test(hover)) hover = '';
      return {
        title,
        url: it.url,
        author: platform,
        summary: hover,
        // 无 hover 的平台(微博等):先给兜底内容(标题+原文链接),正文补抓在 fetch 里做
        content_html: hover
          ? `<p>${hover}</p><p><a href="${it.url}" target="_blank" rel="noopener">查看原文 →</a></p>`
          : `<p>${title}</p><p><a href="${it.url}" target="_blank" rel="noopener">查看原文 →</a></p>`,
        published_at: updatedMs ? new Date(updatedMs - idx * 60000).toISOString() : null,
        category,
        score: parseHeat(it.extra && it.extra.info),
      };
    });
}

function map60s(data, category) {
  const d = data.data || {};
  const date = d.date ? new Date(d.date + 'T08:00:00+08:00').toISOString() : null;
  return (d.news || [])
    .map((title, i) => String(title || '').trim())
    .filter(Boolean)
    .map((title, i) => ({
      title,
      // 60s 无原文链接：用日期+序号构造稳定 url 供去重
      url: `https://60s.viki.moe/v2/60s#${d.date || 'today'}-${i + 1}`,
      author: '每天60秒读懂世界',
      summary: '',
      content_html: `<p>${title}</p>`,
      published_at: date,
      category,
      score: null,
    }));
}

module.exports = {
  type: 'hotlist',
  match() { return false; }, // 不参与 URL 粘贴识别，源由 seed 脚本/设置页创建
  defaultIntervalMin: 30,

  // 手动添加：input 为 newsnow 源 id（如 zhihu）或 '60s'
  async resolve(input) {
    const id = String(input || '').trim();
    if (!id) throw new Error('请输入热榜源 id（如 zhihu）');
    if (id === '60s') return { name: '每天60秒读懂世界', url: 'hotlist60s://60s' };
    return { name: id, url: `hotlist://${id}` };
  },

  async fetch(source) {
    const url = source.url || '';
    if (url.startsWith('hotlist60s://')) {
      const data = await fetchJson(`${d60sBase()}/v2/60s`);
      if (data.code !== 200) throw new Error(`60s 接口异常 code=${data.code}`);
      return { articles: map60s(data, '综合') };
    }
    const id = url.replace(/^hotlist:\/\//, '');
    if (!id) throw new Error('热榜源缺少 newsnow id');
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }
    const api = `${baseUrl()}/api/s?id=${encodeURIComponent(id)}&latest`;
    const data = await fetchJson(api);
    const items = mapNewsnow(data, extra.platform || id, extra.domain || null);
    // 正文补抓:所有薄内容条目(含只有 hover 摘要的)抓原文页(Readability),
    // 每轮限 10 条防请求风暴;知乎/微博等登录墙站点会自然失败并保留摘要兜底
    const thin = items.filter((a) => (a.content_html || '').length < 1000).slice(0, 10);
    if (thin.length) {
      const { fetchFulltext } = require('../rss');
      for (const a of thin) {
        try {
          const full = await fetchFulltext(a.url);
          if (full && full.content && full.content.length > (a.content_html || '').length) {
            a.content_html = full.content;
            if (!a.summary) a.summary = full.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
            if (full.cover && !a.cover) a.cover = full.cover;
          }
        } catch { /* 单条失败保留兜底内容 */ }
      }
    }
    return { articles: items };
  },
};

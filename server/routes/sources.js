// 订阅源 API（T12）：CRUD / toggle / refresh / delete，GET 带未读数
const express = require('express');
const { db } = require('../db');
const { nowIso } = require('../util/time');
const log = require('../util/log'); // ✅ P0 修复：引入脱敏工具
const registry = require('../services/collectors/registry');
const { fetchSource, markSourceError, intervalMinFor, unfreezeSource } = require('../services/collectors/store');

const router = express.Router();

const VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];

// 解析 extra，把源级间隔 intervalMin 提到顶层（无覆盖则不输出该字段）
function withInterval(r) {
  let extra = {};
  try { extra = JSON.parse(r.extra || '{}'); } catch { /* 非法 JSON 视为无 */ }
  const n = Number(extra.intervalMin);
  const out = { ...r };
  if (Number.isFinite(n) && n > 0) out.intervalMin = n;
  // 九期：透出最近错误 (健康度展示)
  if (extra.lastError) out.lastError = log.mask(extra.lastError); // ✅ 脱敏
  if (extra.lastErrorAt) out.lastErrorAt = extra.lastErrorAt;
  return out;
}

// GET /api/sources?type=&enabled=  （带未读数/视频数 + 源级间隔 intervalMin，F2）
router.get('/', (req, res) => {
  const conds = [];
  const args = [];
  if (req.query.type) { conds.push('type=?'); args.push(req.query.type); }
  if (req.query.enabled !== undefined) { conds.push('enabled=?'); args.push(Number(req.query.enabled)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM sources ${where} ORDER BY id`).all(...args);
  const unreadStmt = db.prepare('SELECT COUNT(*) c FROM articles WHERE source_id=? AND read_at IS NULL');
  const videoStmt = db.prepare('SELECT COUNT(*) c FROM videos WHERE source_id=?');
  const items = rows.map((r) => ({
    ...withInterval(r),
    unread: VIDEO_TYPES.includes(r.type) ? videoStmt.get(r.id).c : unreadStmt.get(r.id).c,
  }));
  res.json({ ok: true, items });
});

// PUT /api/sources/:id/interval {intervalMin: 分钟数|null} —— 源级刷新间隔覆盖（F2）；null 恢复跟随全局
router.put('/:id/interval', (req, res) => {
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  const { intervalMin } = req.body || {};
  let extra = {};
  try { extra = JSON.parse(s.extra || '{}'); } catch { /* 重置为干净对象 */ }
  if (intervalMin === null || intervalMin === undefined) {
    delete extra.intervalMin;
  } else {
    const n = Number(intervalMin);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok: false, error: 'intervalMin 必须是正数分钟数或 null' });
    extra.intervalMin = n;
  }
  db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), s.id);
  // P0-1 修复：新间隔立即生效——按最新 extra.intervalMin 重算 next_fetch_at
  // （此前唯一写点在 fetchSource，新间隔要等旧 deadline（可能按 8h 算）到期抓一次后才生效）
  const updated = db.prepare('SELECT * FROM sources WHERE id=?').get(s.id);
  const next = new Date(Date.now() + intervalMinFor(updated) * 60000).toISOString();
  db.prepare('UPDATE sources SET next_fetch_at=? WHERE id=?').run(next, s.id);
  try { require('../services/scheduler').reschedule(); } catch { /* 调度未启动时忽略 */ }
  res.json({ ok: true, intervalMin: extra.intervalMin ?? null, nextFetchAt: next });
});

// POST /api/sources {url, name?, type?} —— detectByUrl→resolve→入库，失败透传适配器文案
router.post('/', async (req, res) => {
  const { url, name, type } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ ok: false, error: '缺少 url' });
  const input = String(url).trim();
  try {
    let adapter;
    if (type) {
      adapter = registry.getAdapter(type);
      if (!adapter) return res.status(400).json({ ok: false, error: `未知订阅源类型: ${type}` });
    } else {
      const hit = registry.detectByUrl(input);
      if (!hit) return res.status(400).json({ ok: false, error: '没有识别到订阅源类型' });
      adapter = hit.adapter;
    }
    const info = await adapter.resolve(input); // 失败抛出原文提示（如 F30）
    const r = db.prepare(
      'INSERT INTO sources(type, name, url, avatar, uid, extra, enabled, status, created_at) VALUES(?,?,?,?,?,?,1,?,?)'
    ).run(info.type || adapter.type, name || info.name || input, info.url || input, info.avatar || null,
      info.uid || null, JSON.stringify(info.extra || {}), 'ok', nowIso());
    const item = db.prepare('SELECT * FROM sources WHERE id=?').get(r.lastInsertRowid);
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// PUT /api/sources/:id/toggle —— 手动启用时走统一解冻语义(清 fail_count + 错误标记,store.unfreezeSource)
router.put('/:id/toggle', (req, res) => {
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  const enabled = s.enabled ? 0 : 1;
  if (enabled) unfreezeSource(s.id);
  else db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(s.id);
  res.json({ ok: true, enabled });
});

// POST /api/sources/:id/refresh —— 立即 fetch
router.post('/:id/refresh', async (req, res) => {
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  try {
    const r = await fetchSource(s);
    res.json({ ok: true, ...r });
  } catch (err) {
    const { failCount, autoPaused } = markSourceError(s, err.message);
    res.status(500).json({ ok: false, error: err.message, failCount, autoPaused });
  }
});

// POST /api/sources/refresh-all —— 一键全刷 (九期):串行抓所有 enabled 源，逐个记录成败
// 支持 ?skipBreaker=1 时跳过熔断检查；?type=bilibili|douyin|rss 时按类型过滤；返回详细结果供前端展示
router.post('/refresh-all', async (req, res) => {
  const skipBreaker = req.query.skipBreaker === '1'; // 临时参数：跳过熔断器检查
  const filterType = req.query.type; // 可选参数：按 type 过滤（bilibili/douyin/rss/wemp 等）
  
  // 构建查询条件
  let conds = ['enabled=1'];
  let args = [];
  if (filterType) {
    conds.push('type=?');
    args.push(filterType);
  }
  const where = conds.join(' AND ');
  
  const rows = db.prepare(`SELECT * FROM sources WHERE ${where} ORDER BY id`).all(...args);
  const results = [];
  for (const s of rows) {
    try {
      const r = await fetchSource(s);
      results.push({ id: s.id, name: s.name, ok: true, articles: r.articles, videos: r.videos, notModified: r.notModified });
    } catch (err) {
      // 如果要求跳过熔断器，则仅记错误但不触发自动暂停逻辑
      if (skipBreaker) {
        let extra = {};
        try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
        extra.lastError = log.mask(String(err.message || '未知错误')).slice(0, 300);
        extra.lastErrorAt = nowIso();
        db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), s.id); // P0-3 修复：补上 id 的 ? 占位符（原 SQL 语法错误导致 skipBreaker 路径必 500）
        results.push({ id: s.id, name: s.name, ok: false, error: err.message, autoPaused: false });
      } else {
        // 批量路径静默逐源报警(silent),结尾汇总一条,防 87 源失败打爆渠道限流
        const { failCount, autoPaused } = markSourceError(s, err.message, { silent: true });
        results.push({ id: s.id, name: s.name, ok: false, error: err.message, failCount, autoPaused });
      }
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  const failedItems = results.filter((r) => !r.ok);
  // 汇总报警(一条):批量刷新有失败时,受事件开关/冷却约束
  if (!skipBreaker && failedItems.length) {
    const pausedN = failedItems.filter((r) => r.autoPaused).length;
    require('../services/alerts').dispatch('source_error', {
      title: `批量刷新失败 ${failedItems.length}/${results.length} 源${pausedN ? `,其中 ${pausedN} 个已熔断停用` : ''}`,
      text: failedItems.slice(0, 10).map((r) => `· ${r.name}: ${String(r.error || '').slice(0, 80)}`).join('\n'),
    }).catch(() => {});
  }
  res.json({ ok: true, total: results.length, succeeded: okCount, failed: results.length - okCount, results });
});

// DELETE /api/sources/:id —— 连同其文章/视频一起删除
router.delete('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  db.prepare('DELETE FROM articles WHERE source_id=?').run(s.id);
  db.prepare('DELETE FROM videos WHERE source_id=?').run(s.id);
  db.prepare('DELETE FROM sources WHERE id=?').run(s.id);
  res.json({ ok: true });
});

module.exports = router;

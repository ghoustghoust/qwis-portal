// 源库 API：GET /library（全量列表）/ POST /batch（批量操作）/ POST /autoclassify（自动分类预览/执行）
// 挂载在 /api/sources 之前（决策 10），避免被 sources.js 的路由截胡
const express = require('express');
const { db } = require('../db');
const { nowIso } = require('../util/time');
const log = require('../util/log');
const { VIDEO_TYPES, kindOfType, autoClassifySourceId, previewReclassify, applyReclassify } = require('../services/classify');
const { unfreezeSource } = require('../services/collectors/store');

const router = express.Router();

// ── GET /library —— 全量源列表（含 itemCount + contentKind） ──
router.get('/library', (req, res) => {
  const sources = db.prepare('SELECT * FROM sources ORDER BY id').all();
  // 聚合计数：文章源 GROUP BY source_id，视频源 GROUP BY source_id
  const articleCounts = {};
  const videoCounts = {};
  for (const row of db.prepare('SELECT source_id, COUNT(*) c FROM articles GROUP BY source_id').all()) {
    articleCounts[row.source_id] = row.c;
  }
  for (const row of db.prepare('SELECT source_id, COUNT(*) c FROM videos GROUP BY source_id').all()) {
    videoCounts[row.source_id] = row.c;
  }
  const items = sources.map((s) => {
    const kind = kindOfType(s.type);
    const itemCount = kind === 'video' ? (videoCounts[s.id] || 0) : (articleCounts[s.id] || 0);
    // extra 脱敏（复用 sources.js 的白名单模式）
    let extra = {};
    try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
    const safeExtra = {};
    const PUBLIC_KEYS = ['intervalMin', 'lastError', 'lastErrorAt', 'marksFeatured', 'aggregator', 'domain', 'etag', 'lastModified', 'categoryLocked', 'origin'];
    for (const k of PUBLIC_KEYS) {
      if (extra[k] !== undefined) safeExtra[k] = extra[k];
    }
    return {
      ...s,
      extra: JSON.stringify(safeExtra),
      contentKind: kind,
      itemCount,
    };
  });
  res.json({ ok: true, items });
});

// ── POST /batch —— 批量操作 ──
router.post('/batch', (req, res) => {
  const { ids, action, groupId } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, error: '缺少 ids' });
  const validActions = ['enable', 'disable', 'focus', 'unfocus', 'move'];
  if (!validActions.includes(action)) return res.status(400).json({ ok: false, error: `action 须为 ${validActions.join('|')}` });
  if (action === 'move' && groupId === undefined) return res.status(400).json({ ok: false, error: 'move 需要 groupId' });

  let succeeded = 0;
  const errors = [];

  for (const id of ids) {
    const sid = Number(id);
    if (!Number.isFinite(sid)) { errors.push({ id, error: '无效 id' }); continue; }
    const source = db.prepare('SELECT * FROM sources WHERE id=?').get(sid);
    if (!source) { errors.push({ id: sid, error: 'not found' }); continue; }

    try {
      if (action === 'enable') {
        unfreezeSource(sid);
        // 错峰：next_fetch_at = now + random(0, 6h)
        const jitter = Math.floor(Math.random() * 6 * 60 * 60 * 1000);
        const next = new Date(Date.now() + jitter).toISOString();
        db.prepare('UPDATE sources SET next_fetch_at=? WHERE id=?').run(next, sid);
      } else if (action === 'disable') {
        db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(sid);
      } else if (action === 'focus') {
        db.prepare('UPDATE sources SET focus=1 WHERE id=?').run(sid);
      } else if (action === 'unfocus') {
        db.prepare('UPDATE sources SET focus=0 WHERE id=?').run(sid);
      } else if (action === 'move') {
        // kind 校验
        if (groupId !== null) {
          const g = db.prepare('SELECT * FROM groups WHERE id=?').get(groupId);
          if (!g) { errors.push({ id: sid, error: '分组不存在' }); continue; }
          const sourceKind = kindOfType(source.type);
          if (sourceKind !== g.kind) { errors.push({ id: sid, error: '文件夹类型不匹配' }); continue; }
        }
        db.prepare('UPDATE sources SET group_id=? WHERE id=?').run(groupId ?? null, sid);
        // 批量移动 = 人工改归 → 写 categoryLocked
        let extra = {};
        try { extra = JSON.parse(source.extra || '{}'); } catch { /* ignore */ }
        extra.categoryLocked = 1;
        db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), sid);
      }
      succeeded++;
    } catch (err) {
      errors.push({ id: sid, error: err.message });
    }
  }

  res.json({ ok: true, succeeded, failed: errors.length, errors: errors.length ? errors : undefined });
});

// ── POST /autoclassify —— 自动分类预览 / 执行 ──
router.post('/autoclassify', (req, res) => {
  const { dryRun, apply, ids, includeLocked, showAll } = req.body || {};

  if (dryRun) {
    // 预览模式：不落库
    const result = previewReclassify({ includeLocked: !!includeLocked, showAll: !!showAll });
    return res.json({ ok: true, ...result });
  }

  if (apply) {
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, error: 'apply 需要 ids 数组' });
    const result = applyReclassify(ids.map(Number));
    return res.json({ ok: true, ...result });
  }

  res.status(400).json({ ok: false, error: '需要 dryRun:true 或 apply:true' });
});

module.exports = router;

// 源库 API：GET /library（全量列表）/ POST /batch（批量操作）/ POST /autoclassify（自动分类预览/执行）
// 挂载在 /api/sources 之前（决策 10），避免被 sources.js 的路由截胡
const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const { nowIso } = require('../util/time');
const log = require('../util/log');
const { VIDEO_TYPES, kindOfType, autoClassifySourceId, previewReclassify, applyReclassify } = require('../services/classify');
const { unfreezeSource } = require('../services/collectors/store');
const axes = require('../../lib/source-axes');

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

// lib/source-axes 的 deps 注入（await 对同步返回值同样成立，本地同步 getSetting 可直接喂给 async 助手）
const axesDeps = { getSetting, setSetting };

// ── POST /batch —— 批量操作 ──
// 27b（2026-09-15）：action 扩展为四轴 + 组级操作——
//   列轴：spotlight/unspotlight（focus/unfocus 为兼容别名）、mute/unmute、visible/invisible
//   订阅轴：subscribe/unsubscribe（写 settings subscription.ids，不动 sources 任何列）
//   参数轴：interval {intervalMin|null}（组级调频）、failover {failoverGroup|''}（failover 组标记）
//   组级：body 带 groupScopeId 时作用于该组全部成员（单条 SQL，不逐行循环）
router.post('/batch', async (req, res) => {
  try {
  const { ids, action, groupId, groupScopeId, intervalMin, failoverGroup } = req.body || {};
  const validActions = axes.AXIS_ALL_ACTIONS;
  if (!validActions.includes(action)) return res.status(400).json({ ok: false, error: `action 须为 ${validActions.join('|')}` });
  if (action === 'move' && groupId === undefined) return res.status(400).json({ ok: false, error: 'move 需要 groupId' });

  // ── 组级快路径：作用于整组成员 ──
  if (groupScopeId !== undefined && groupScopeId !== null) {
    const gid = Number(groupScopeId);
    if (!Number.isFinite(gid)) return res.status(400).json({ ok: false, error: 'groupScopeId 无效' });
    const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
    if (!g) return res.status(404).json({ ok: false, error: '分组不存在' });
    try {
      if (action === 'subscribe' || action === 'unsubscribe') {
        const members = db.prepare('SELECT id FROM sources WHERE group_id=?').all(gid).map((r) => r.id);
        const total = await axes.setSubscribed(axesDeps, members, action === 'subscribe');
        return res.json({ ok: true, succeeded: members.length, failed: 0, group: g.name, subscriptionTotal: total });
      }
      if (action === 'move') return res.status(400).json({ ok: false, error: '组级操作不支持 move（请用 ids 逐个移动）' });
      const stmt = axes.groupAxisStmt(action, gid, { intervalMin, failoverGroup });
      if (!stmt) return res.status(400).json({ ok: false, error: `组级不支持 action=${action}` });
      const r = db.prepare(stmt.sql).run(...stmt.args);
      return res.json({ ok: true, succeeded: r.changes, failed: 0, group: g.name });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, error: '缺少 ids' });

  // 订阅轴（读改写 settings 一次，不逐 id 循环）
  if (action === 'subscribe' || action === 'unsubscribe') {
    const total = await axes.setSubscribed(axesDeps, ids, action === 'subscribe');
    return res.json({ ok: true, succeeded: ids.length, failed: 0, subscriptionTotal: total });
  }

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
      } else if (axes.AXIS_COL_ACTIONS[action]) {
        const [col, val] = axes.AXIS_COL_ACTIONS[action];
        db.prepare(`UPDATE sources SET ${col}=? WHERE id=?`).run(val, sid);
      } else if (action === 'interval') {
        if (intervalMin === null || intervalMin === undefined) {
          db.prepare("UPDATE sources SET extra=json_remove(COALESCE(extra,'{}'),'$.intervalMin') WHERE id=?").run(sid);
        } else {
          const n = Number(intervalMin);
          if (!Number.isFinite(n) || n <= 0) { errors.push({ id: sid, error: 'intervalMin 必须是正数分钟数或 null' }); continue; }
          db.prepare("UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.intervalMin', ?) WHERE id=?").run(n, sid);
        }
      } else if (action === 'failover') {
        const fg = String(failoverGroup || '').trim();
        if (fg) db.prepare("UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.failoverGroup', ?) WHERE id=?").run(fg, sid);
        else db.prepare("UPDATE sources SET extra=json_remove(COALESCE(extra,'{}'),'$.failoverGroup') WHERE id=?").run(sid);
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
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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

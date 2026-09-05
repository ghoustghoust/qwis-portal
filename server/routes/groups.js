// 分组 API（T12）：CRUD + POST /api/groups/move（拖拽落点）
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// GET /api/groups?kind=article|video （带源数量）
router.get('/', (req, res) => {
  const conds = [];
  const args = [];
  if (req.query.kind) { conds.push('kind=?'); args.push(req.query.kind); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM groups ${where} ORDER BY sort, id`).all(...args);
  const countStmt = db.prepare('SELECT COUNT(*) c FROM sources WHERE group_id=?');
  const items = rows.map((g) => ({ ...g, sourceCount: countStmt.get(g.id).c }));
  res.json({ ok: true, items });
});

// POST /api/groups {kind, name}
router.post('/', (req, res) => {
  const { kind, name } = req.body || {};
  if (!kind || !name) return res.status(400).json({ ok: false, error: '缺少 kind/name' });
  if (!['article', 'video'].includes(kind)) return res.status(400).json({ ok: false, error: 'kind 须为 article|video' });
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM groups WHERE kind=?').get(kind).m;
  const r = db.prepare('INSERT INTO groups(kind, name, sort) VALUES(?,?,?)').run(kind, name, maxSort + 1);
  res.json({ ok: true, item: db.prepare('SELECT * FROM groups WHERE id=?').get(r.lastInsertRowid) });
});

// PUT /api/groups/:id {name?, sort?}
router.put('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'not found' });
  const { name, sort } = req.body || {};
  db.prepare('UPDATE groups SET name=?, sort=? WHERE id=?')
    .run(name !== undefined ? name : g.name, sort !== undefined ? Number(sort) : g.sort, g.id);
  res.json({ ok: true });
});

// DELETE /api/groups/:id —— 组内源回到未分组
router.delete('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'not found' });
  db.prepare('UPDATE sources SET group_id=NULL WHERE group_id=?').run(g.id);
  db.prepare('DELETE FROM groups WHERE id=?').run(g.id);
  res.json({ ok: true });
});

// POST /api/groups/move {source_id, group_id|null} —— 拖拽落点
router.post('/move', (req, res) => {
  const { source_id, group_id } = req.body || {};
  if (!source_id) return res.status(400).json({ ok: false, error: '缺少 source_id' });
  const s = db.prepare('SELECT id FROM sources WHERE id=?').get(source_id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  if (group_id !== null && group_id !== undefined) {
    const g = db.prepare('SELECT id FROM groups WHERE id=?').get(group_id);
    if (!g) return res.status(404).json({ ok: false, error: '分组不存在' });
  }
  db.prepare('UPDATE sources SET group_id=? WHERE id=?').run(group_id ?? null, source_id);
  res.json({ ok: true });
});

module.exports = router;

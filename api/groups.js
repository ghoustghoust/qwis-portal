// GET /api/groups?kind= —— {ok, items}(对齐主系统 server/routes/groups.js,补 sourceCount)
const { groups, sources } = require('./_data');

module.exports = function handler(req, res) {
  const srcs = sources();
  let items = groups().map((g) => ({
    ...g,
    sourceCount: srcs.filter((s) => s.group_id === g.id).length,
  }));
  if (req.query.kind) items = items.filter((g) => !g.kind || g.kind === req.query.kind);
  res.json({ ok: true, items });
};

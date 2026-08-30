// GET /api/sources?type= —— {ok, items}(快照已带 unread)
const { sources } = require('./_data');

module.exports = function handler(req, res) {
  let items = sources();
  if (req.query.type) items = items.filter((s) => s.type === req.query.type);
  res.json({ ok: true, items });
};

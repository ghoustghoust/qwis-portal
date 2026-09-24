// 只读探针 #9：给「朴素贝叶斯 / 互补贝叶斯 / TF-IDF 质心」三臂造**行为标签语料**
// 为什么不等人工标注：用户要的是"它干掉的是我要的文章还是垃圾"，而库里已经躺着他自己的判断——
//   正样本 = 真读过 / 稍后读 / 进过精选（他亲选或系统判定值得读）
//   负样本 = 保留策略自己判定"可删"的那 9,472 行（7 天前、未读、未标记、非精选）
// 只取 title + summary，**绝不取 content_html**（那列 587 MB，探针不许制造本题要量级的读放大）。
const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const { whereFor, cutoffIso } = require('../lib/retention');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const POS = '(read_at IS NOT NULL OR later = 1 OR COALESCE(featured,0) = 1)';
(async () => {
  const stat = await db.execute(`SELECT
      SUM(CASE WHEN ${POS} THEN 1 ELSE 0 END) pos,
      SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) by_read,
      SUM(CASE WHEN later = 1 THEN 1 ELSE 0 END) by_later,
      SUM(CASE WHEN COALESCE(featured,0)=1 THEN 1 ELSE 0 END) by_feat,
      SUM(CASE WHEN NOT (${POS}) THEN 1 ELSE 0 END) neg_pool FROM articles`);
  console.log('类别盘点：', JSON.stringify(stat.rows[0]));

  const pos = (await db.execute(`SELECT id, title, summary, source_id, read_at, later, COALESCE(featured,0) f
    FROM articles WHERE ${POS}`)).rows;
  // 负样本按 3× 正样本随机抽（natural prior 与 balanced 两种口径都要能算，所以负样本要够但别全取）
  const negN = Math.min(3 * pos.length, Number(stat.rows[0].neg_pool));
  const neg = (await db.execute({
    sql: `SELECT id, title, summary, source_id FROM articles
      WHERE NOT (${POS}) AND ${whereFor('runner', 'retention')} ORDER BY RANDOM() LIMIT ?`,
    args: [cutoffIso(7), negN],
  })).rows;

  const out = path.join(__dirname, '..', 'data', 'prescreen-lab');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'corpus.jsonl');
  const lines = [
    ...pos.map((r) => ({ id: r.id, y: 1, title: r.title || '', summary: r.summary || '', why: r.read_at ? 'read' : r.later ? 'later' : 'featured' })),
    ...neg.map((r) => ({ id: r.id, y: 0, title: r.title || '', summary: r.summary || '' })),
  ];
  fs.writeFileSync(file, lines.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const bs = (rows) => (rows.reduce((a, r) => a + (r.summary || '').length, 0) / (rows.length || 1)).toFixed(0);
  const ts = (rows) => (rows.reduce((a, r) => a + (r.title || '').length, 0) / (rows.length || 1)).toFixed(1);
  const nosum = (rows) => rows.filter((r) => !String(r.summary || '').trim()).length;
  console.log(`\n写出 ${file}`);
  console.log(`  正=${pos.length}（读 ${stat.rows[0].by_read} / 稍后 ${stat.rows[0].by_later} / 精选 ${stat.rows[0].by_feat}，有重叠）标题均长 ${ts(pos)} 字，摘要均长 ${bs(pos)} 字，无摘要 ${nosum(pos)} 条`);
  console.log(`  负=${neg.length}（从 ${stat.rows[0].neg_pool} 条可删池里随机抽）标题均长 ${ts(neg)} 字，摘要均长 ${bs(neg)} 字，无摘要 ${nosum(neg)} 条`);
  console.log(`  ⚠️ 上面两行的"摘要均长/无摘要"就是**混淆变量**：若正负两边的摘要来源不同（AI 写过 vs RSS 原样），`);
  console.log(`     分类器会去学"有没有摘要"这种形态特征而不是内容 —— 三臂评分脚本必须单独报这个诊断。`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());

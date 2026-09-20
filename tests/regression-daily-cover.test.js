// AI 策展版日报的封面图契约锁（B120）。
// 单独成文件而不是并进 regression-daily-ai.test.js，是坑 #64 的同族：那份锁在顶层读 `.env` +
// require `api/_ai`，F2P 把锁复制进基线树时 `.env` 不在（它被 gitignore），整个文件加载崩 →
// base 侧只有"文件名红"没有"用例名红"，取证无法归因（坑 #67）。本文件零外部依赖，只读源码。
// 取证纪律（坑 #68）：关键词版的条目**本来就带 cover**，所以"最新一期 daily_reports 有图"不能当
// 本修复的证据 —— 必须按 AI 版形态指纹（条目有 reason/scores）筛出产出者，再看图在不在。
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const srcOf = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

test('1. runner 的 AI 版条目投影必须带 cover（/daily 的封面图只有这一个字段来源）', () => {
  // 线上实测（新库 38 份 daily_reports 逐份数）：AI 版 3 份、条目带 cover 的行数 0；
  // 关键词版 33 份、带 cover 的 29 份。差别不在采集（候选 SQL 早已 SELECT a.cover），
  // 只在组装栏目的 fmt() 投影漏了这个字段。
  const src = srcOf('tools', 'collect-turso.js');
  // runDailyAi 与 runMyBrief 各有一份同名 fmt —— 不先切作用域就会锁到错的那份
  const scoped = src.slice(src.indexOf('async function runDailyAi('));
  assert.ok(scoped !== src, '找不到 runDailyAi —— 本锁的作用域前提已经不成立，改写了就要同步改锁');
  const grab = (text) => {
    const m = /const fmt = \(a\) => \(\{([\s\S]*?)\}\);/.exec(text);
    return m ? m[1] : null;
  };
  const body = grab(scoped);
  assert.ok(body, '找不到 runDailyAi 的 fmt 投影');
  assert.match(body, /\bcover\b/, 'AI 版条目投影没带 cover → /daily 整页无封面图');

  // 负向自证（坑 #45：不配这条就是恒真的锁）：从同一段投影里删掉 cover 属性，判据必须变红
  const stripped = body.replace(/cover\s*:\s*[^,\n]+,?\s*/, '');
  assert.notEqual(stripped, body, '负向样本没构造出来（cover 的写法变了，本探针要跟着改）');
  assert.ok(!/\bcover\b/.test(stripped), '删掉 cover 后判据仍为绿 → 这条断言恒真，等于没锁');
});

test('2. 候选 SQL 必须真的把 a.cover 取出来（否则投影写了也只拿到 null）', () => {
  const src = srcOf('tools', 'collect-turso.js');
  const scoped = src.slice(src.indexOf('async function runDailyAi('));
  assert.match(scoped, /SELECT[a-zA-Z0-9_.,\s]*a\.cover[a-zA-Z0-9_.,\s]*FROM articles/,
    'runDailyAi 的候选 SQL 不再 SELECT a.cover → 投影里的 cover 恒为 null，图还是出不来');
});

test('3. 前端对端：DailyCard 仍按 item.cover 渲染 <img>（字段有人读，锁才连着可见面）', () => {
  const card = srcOf('web', 'src', 'components', 'ColumnSection.jsx');
  const n = (card.match(/item\.cover\s*\?[\s\S]{0,220}<img/g) || []).length;
  assert.ok(n >= 2, `前端按 item.cover 渲染 <img> 的位置从实测 2 处变成 ${n} 处 —— 本锁与可见面脱钩，要么产品改了要么锁该改`);
});

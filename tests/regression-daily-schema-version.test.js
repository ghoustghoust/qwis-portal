// B112 日报产物档位（schemaVersion）写入侧回归锁（spec 40-1 残余 + 「与 W14 同批钉」，2026-09-21）。
//
// 实测病根（收口前）：5 个生成日报的写入点里只有 runner 的 AI 那份写对了形态 ——
//   · `runDailyAi` 写 `schemaVersion: 2`（值对，但是**裸字面量**：档位升版时这一处会漏改）
//   · `runDaily` 的降级分支用 `json_set(stats, '$.schemaVersion', '1')`（**带引号 → 落成 JSON 字符串**）
//   · 云端内联 / 云端 cron / 本地引擎三份**根本不写**这个字段
//   → 现役库近 14 天实测分布 `(无)` 48 行 / 数字 2 19 行 / 字符串 "1" 1 行。
// 读层 `isAiDailyReport` 用 Number() 兜住了三种形态，所以表面看不出问题；但 `pickDailyReport`
// 的"AI 版优先于更新的裸报告"整条判据就建在这个字段上 —— 字段不该是三种类型。
//
// 判据与白盒 W14 共用 lib/daily-writers 那一份事实（坑 #58/#59）；本文件只写"怎么报"。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
// 惰性取（坑 #64/#67）：F2P 会在"基线树里还没有这些常量/函数"的 worktree 里跑本文件，
// 顶层 require 会让它崩在加载期，读成"锁假了"而不是"改前红"。
const DW = () => require('../lib/daily-writers');
const BG = () => require('../lib/brief-guards');

// 造一棵最小假仓库放坏样本；返回派生判据对该样本的读数
function probe(src, rel = 'api/w.js') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b112-'));
  try {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, src);
    return { writers: DW().findDailyReportWriters(dir), typed: DW().findStatsSchemaTypeViolations(dir) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const INSERT = "'INSERT INTO daily_reports(generated_at, stats) VALUES(?, ?)'";
const writerWith = (statsLine) => `async function gen(){
  const stats = { ${statsLine} };
  await qRun(${INSERT}, [nowIso(), JSON.stringify(stats)]);
}
`;

test('Q1 活代码：5 个生成写入点全部显式带档位且走常量，SQL 里没有字符串形态', () => {
  const all = DW().findDailyReportWriters(ROOT);
  const writers = all.filter((w) => !w.dynamic);
  assert.ok(writers.length >= 5, `生成类写入点只剩 ${writers.length} 个 —— 扫描面缩水时"全过"没有意义`);
  assert.deepEqual(writers.filter((w) => !w.schema || !w.schema.carried).map((w) => `${w.file}::${w.fn}`), [],
    '这些生成器没写档位字段（或没走 DAILY_SCHEMA_VERSION 常量）');
  assert.deepEqual(writers.filter((w) => w.schema && (w.schema.bare || w.schema.stringTyped)).map((w) => `${w.file}::${w.fn}`), [],
    '这些生成器把档位写成了裸数字或带引号字符串');
  assert.deepEqual(DW().findStatsSchemaTypeViolations(ROOT), [], 'SQL 里仍有把 $.schemaVersion 绑成带引号值的语句');
});

test('Q2 负向自证：不写档位 / 写裸数字 / 写成字符串 三种坏形状都要被点名', () => {
  const none = probe(writerWith('candidates: 3'));
  assert.equal(none.writers.length, 1, `夹具没被认成写入点：${JSON.stringify(none.writers)}`);
  assert.equal(none.writers[0].schema.carried, false, '完全不写档位却没被判出来（恒绿判据）');

  const bare = probe(writerWith('schemaVersion: 2, candidates: 3'));
  assert.equal(bare.writers[0].schema.bare, true, '裸数字档位没被判出来');
  assert.equal(bare.writers[0].schema.carried, false, '裸数字不该算"走常量"');

  const str = probe(`async function fix(){
  await qRun("UPDATE daily_reports SET stats = json_set(stats, '$.schemaVersion', '1') WHERE id = ?", [1]);
}
`);
  assert.equal(str.typed.length, 1, `SQL 里字符串形态的档位赋值没被判出来：${JSON.stringify(str.typed)}`);
  assert.match(str.typed[0].file, /api\/w\.js$/, '违规没点名文件');
  assert.equal(str.typed[0].line, 2, `违规没点名行号（应 2，实得 ${str.typed[0].line}）`);
});

test('Q3 反向：走常量的三种合法形状不许被误判，整表复制路径不参与本判据', () => {
  const ok = probe(writerWith('schemaVersion: DAILY_SCHEMA_VERSION.KEYWORD, candidates: 3'));
  assert.deepEqual([ok.writers[0].schema, ok.typed], [{ carried: true, bare: false, stringTyped: false }, []],
    '合法形状被误伤（判据第一版必错，坑 #62/#63）');
  const bind = probe(`async function fix(){
  await qRun("UPDATE daily_reports SET stats = json_set(stats, '$.schemaVersion', ?) WHERE id = ?", [1]);
}
`);
  assert.deepEqual(bind.typed, [], '绑定参数的 json_set 被当成字符串形态 = 反向样本失守');
  const comment = probe(`async function gen(){
  // 老数据里 schemaVersion: 2 是裸数字，别学它
  const stats = { schemaVersion: DAILY_SCHEMA_VERSION.AI };
  await qRun(${INSERT}, [nowIso(), JSON.stringify(stats)]);
}
`);
  assert.equal(comment.writers[0].schema.bare, false, '注释里举的反例被当成代码（坑 #63 的注释版）');
  const copies = DW().findDailyReportWriters(ROOT).filter((w) => w.dynamic);
  assert.ok(copies.length >= 3 && copies.every((w) => w.schema === null),
    '整表复制类写入点（备份恢复/迁移）必须记 null：它们原样搬 stats，要求"写档位"是错的');
});

test('Q4 坑 #70 类型行为锁：档位经 SQL 落库时的四种形态（裸绑 JS 数字 = real 是实测抓到的新坑）', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE daily_reports (id INTEGER PRIMARY KEY, stats TEXT)');
  db.prepare('INSERT INTO daily_reports(id, stats) VALUES(1, ?)').run('{}');
  const shape = (sql, ...v) => {
    db.prepare('UPDATE daily_reports SET stats = ?').run('{}');
    db.prepare(sql).run(...v);
    return db.prepare("SELECT json_type(stats,'$.schemaVersion') t FROM daily_reports").get().t;
  };
  // ① 只把 JS number 当绑定参数塞进 json_set：驱动给的是 double → JSON 存成 `1.0`，
  //    json_type = 'real'。**这条是本轮实测才看到的**，第一版我以为"绑数字就对了"。
  assert.equal(shape("UPDATE daily_reports SET stats = json_set(stats, '$.schemaVersion', ?) WHERE id=1", 1), 'real');
  // ② 必须 CAST 才是 integer（runner 的降级分支现在就是这么写的）
  assert.equal(shape("UPDATE daily_reports SET stats = json_set(stats, '$.schemaVersion', CAST(? AS INTEGER)) WHERE id=1", 1), 'integer');
  // ③ 收口前那份带引号的字面量 = text（库里真有 1 行是这样的）
  assert.equal(shape("UPDATE daily_reports SET stats = json_set(stats, '$.schemaVersion', '1') WHERE id=1"), 'text');
  // ④ 另外四份生成器走 JSON.stringify 整个 stats → integer，天然正确
  assert.equal(shape('UPDATE daily_reports SET stats = ? WHERE id=1', JSON.stringify({ schemaVersion: 2 })), 'integer');
  db.close();
});

test('Q5 读侧不许收紧：三种历史形态（缺失/数字/字符串）都必须仍被 Number() 正确判读', () => {
  const bg = BG();
  const { DAILY_SCHEMA_VERSION, isAiDailyReport } = bg;
  assert.deepEqual(DAILY_SCHEMA_VERSION, { KEYWORD: 1, AI: 2 }, '档位值被改 —— 存量行会整体变档，属产品决策不是重构');
  assert.equal(isAiDailyReport({ stats: '{"candidates":3}' }), false, '缺档位的裸报告必须判 false');
  assert.equal(isAiDailyReport({ stats: JSON.stringify({ schemaVersion: DAILY_SCHEMA_VERSION.AI }) }), true);
  assert.equal(isAiDailyReport({ stats: JSON.stringify({ schemaVersion: DAILY_SCHEMA_VERSION.KEYWORD }) }), false);
  // 历史脏形态：库里真有字符串 "1"/"2"，读侧不许改成只认数字（那会让 19 行 AI 报告突然降级）
  assert.equal(isAiDailyReport({ stats: '{"schemaVersion":"2"}' }), true, '字符串 "2" 判读变了 = 存量数据会被降级');
  assert.equal(isAiDailyReport({ stats: '{"schemaVersion":"1"}' }), false);
  assert.equal(isAiDailyReport({ stats: 'not-json' }), false, '坏 JSON 必须降级为"不是 AI 版"，不是抛错');
  assert.equal(isAiDailyReport({ stats: { schemaVersion: DAILY_SCHEMA_VERSION.AI } }), true, 'stats 已是对象时也要能判（迁移/恢复路径传对象）');
});

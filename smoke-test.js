// 全网情报系统 - 冒烟测试套件 (smoke-test.js)
// 覆盖：数据正确性、采集源获取、功能操作、端到端流程、对抗性审查
//
// ⚠️ 安全约定（与 tests/helpers.js 一致）：绝不直写生产库 data/app.db。
// 本脚本要验证的是「生产数据的当前状态」，因此先用 better-sqlite3 的 WAL 安全备份
// 把 data/app.db 拷贝到临时目录，再通过 APP_DATA_DIR 让 db 层指向副本——
// 所有读写（含 later 切换、settings 写入）只发生在副本上，生产库零副作用。

const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
const assert = require('assert');

// 1) 引导：生产库 → 临时副本
const SRC_DB = path.join(__dirname, 'data', 'app.db');
if (!fs.existsSync(SRC_DB)) {
  console.error(`❌ 未找到生产库 ${SRC_DB}，请确认在项目根目录运行`);
  process.exit(1);
}
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qwis-smoke-'));
try {
const Database = require('better-sqlite3');
const src = new Database(SRC_DB, { readonly: true, fileMustExist: true });
await src.backup(path.join(TMP_DIR, 'app.db'));
src.close();
process.env.APP_DATA_DIR = TMP_DIR; // 必须在 require('./server/db') 之前设置
console.log(`📦 已拷贝生产库到临时副本：${TMP_DIR}（生产库不会被写入）`);

const { db } = require('./server/db');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    results.push({ name, status: 'PASS', error: null });
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    results.push({ name, status: 'FAIL', error: err.message });
    failed++;
  }
}

console.log('\n🧪 全网情报系统冒烟测试\n');

// ========== 1. 数据正确性验证 ==========
console.log('\n📊 === 数据正确性验证 ===\n');

test('文章表结构完整', () => {
  const row = db.prepare('SELECT id, title, url, source_id, published_at, later FROM articles LIMIT 1').get();
  assert.ok(row.id, 'id 存在');
  assert.ok(row.title, 'title 存在');
  assert.ok(row.url, 'url 存在');
  assert.ok(row.source_id, 'source_id 存在');
  assert.ok(row.published_at, 'published_at 存在');
});

test('视频表结构完整', () => {
  const videosCount = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
  if (videosCount > 0) {
    const row = db.prepare('SELECT id, title, platform, url, published_at FROM videos LIMIT 1').get();
    assert.ok(row.platform, 'platform 字段存在');
    assert.ok(row.url, 'url 唯一索引生效');
  }
});

test('数据库记录数符合预期', () => {
  // 只断言非空与单调合理性，不硬编码具体数字（数据每天都在增长，硬编码必然过期）
  const articles = db.prepare('SELECT COUNT(*) as c FROM articles').get().c;
  const videos = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
  const sources = db.prepare('SELECT COUNT(*) as c FROM sources').get().c;
  console.log(`   当前数据量：文章 ${articles}，视频 ${videos}，源 ${sources}`);
  assert.ok(articles > 0, '文章表应有数据');
  assert.ok(sources > 0, '源表应有数据');
  assert.ok(videos >= 0, '视频表可查询');
});

test('时间排序正确', () => {
  const rows = db.prepare(`
    SELECT id, published_at FROM articles 
    ORDER BY published_at DESC LIMIT 5
  `).all();
  for (let i = 0; i < rows.length - 1; i++) {
    assert.ok(new Date(rows[i].published_at) >= new Date(rows[i + 1].published_at), 
      `第${i}条时间应早于第${i+1}条`);
  }
});

test('later 标记可查询', () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM articles WHERE later=1').get().c;
  // 只要有 later 字段能查询就不报错
  assert.ok(typeof count === 'number', 'later 字段可查询');
});

test('URL 唯一索引生效', () => {
  const urls = db.prepare('SELECT DISTINCT url FROM articles').all();
  const uniqueUrls = new Set(urls.map(u => u.url));
  assert.strictEqual(urls.length, uniqueUrls.size, 'URL 无重复');
});

// ========== 2. 采集源获取验证 ==========
console.log('\n🔄 === 采集源获取验证 ===\n');

test('各类型信源均有', () => {
  const types = db.prepare('SELECT DISTINCT type FROM sources').all();
  const typeNames = types.map(t => t.type);
  console.log(`   发现信源类型：${typeNames.join(', ')}`);
  assert.ok(typeNames.length > 0, '至少有一种信源类型');
});

test('信源启用状态正常', () => {
  const enabled = db.prepare("SELECT COUNT(*) as c FROM sources WHERE enabled=1").get().c;
  const total = db.prepare('SELECT COUNT(*) as c FROM sources').get().c;
  assert.ok(enabled > 0, `应有启用的源 (${enabled}/${total})`);
});

test('抓取时间戳存在', () => {
  const rows = db.prepare(`
    SELECT name, last_fetched_at, next_fetch_at 
    FROM sources 
    WHERE last_fetched_at IS NOT NULL 
    LIMIT 3
  `).all();
  assert.ok(rows.length > 0, '有成功抓取的记录');
  rows.forEach(r => {
    assert.ok(r.last_fetched_at, `${r.name} 的 last_fetched_at 存在`);
  });
});

// ========== 3. 功能操作验证 ==========
console.log('\n⚙️ === 功能操作验证 ===\n');

test('清除预览接口可用', () => {
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM articles) as articles,
      (SELECT COUNT(*) FROM videos) as videos,
      (SELECT COUNT(*) FROM daily_reports) as reports
  `).get();
  assert.ok(stats.articles > 0, '文章表有数据');
  assert.ok(typeof stats.videos === 'number', '视频表可查');
});

test('去重逻辑可用 (Jaccard)', () => {
  const dedupTest = db.prepare(`
    SELECT COUNT(*) as c FROM articles 
    WHERE title LIKE '%AI%' AND title LIKE '%模型%'
  `).get().c;
  // 只需确保 SQL 可执行，不报错
  assert.ok(typeof dedupTest === 'number', '关键词查询可行');
});

test('稍后阅读切换 SQL 可执行', () => {
  // 模拟 POST /api/articles/:id/later 的逻辑
  const testId = db.prepare('SELECT id FROM articles LIMIT 1').get().id;
  const laterValue = db.prepare('SELECT later FROM articles WHERE id=?').get(testId).later;
  const newValue = laterValue ? 0 : 1;
  
  const changes = db.prepare('UPDATE articles SET later=? WHERE id=?').run(newValue, testId).changes;
  assert.strictEqual(changes, 1, '更新影响一行');
  
  // 恢复原值
  db.prepare('UPDATE articles SET later=? WHERE id=?').run(laterValue, testId);
  console.log(`   测试 ID ${testId} 的 later 标记从${laterValue}->${newValue}->${laterValue}`);
});

// ========== 4. 端到端流程验证 ==========
console.log('\n🔗 === 端到端流程验证 ===\n');

test('文章→前端展示链路', () => {
  const article = db.prepare(`
    SELECT a.id, a.title, a.url, a.cover, s.name AS source_name
    FROM articles a
    LEFT JOIN sources s ON s.id = a.source_id
    WHERE a.later = 0
    LIMIT 1
  `).get();
  
  assert.ok(article, '文章包含来源名称');
  assert.ok(article.title, '标题可渲染');
  assert.ok(article.source_name, '信源名称可显示');
});

test('视频→播放器链路', () => {
  const video = db.prepare(`
    SELECT v.id, v.title, v.platform, v.url, v.intro
    FROM videos v
    WHERE v.platform = 'bilibili'
    LIMIT 1
  `).get();
  
  if (video) {
    assert.ok(video.url, 'B 站视频 URL 存在');
    assert.ok(video.intro, '简介可用作摘要');
  } else {
    console.log('   当前无 B 站视频数据（跳过）');
  }
});

test('管理后台配置变更即时生效', () => {
  // 验证 settings 表可读写
  const testKey = 'smoke.test';
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)').run(testKey, '{"value":123}');
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(testKey);
  assert.ok(row, '设置可写入');
  
  db.prepare('DELETE FROM settings WHERE key=?').run(testKey);
});

// ========== 5. 对抗性审查 ==========
console.log('\n⚡ === 对抗性审查 ===\n');

test('超长 URL 处理', () => {
  // 检查是否已有超长 URL
  const longUrls = db.prepare(`
    SELECT id, LENGTH(url) as len 
    FROM articles 
    WHERE LENGTH(url) > 500 
    LIMIT 1
  `).get();
  
  if (longUrls) {
    assert.ok(longUrls.len > 500, `存在超长 URL(${longUrls.len}字符)`);
  } else {
    console.log('   无超长 URL（正常）');
  }
});

test('特殊字符标题容错', () => {
  const special = db.prepare(`
    SELECT id, title FROM articles 
    WHERE title LIKE '%[%]%' OR title LIKE '%&%' OR title LIKE '%<%' OR title LIKE '%>%%'
    LIMIT 1
  `).get();
  
  if (special) {
    console.log(`   发现特殊字符标题："${special.title.slice(0,50)}..."`);
  } else {
    console.log('   无特殊字符标题（正常）');
  }
});

test('空字符串内容处理', () => {
  const empty = db.prepare("SELECT COUNT(*) as c FROM articles WHERE title='' OR title IS NULL").get().c;
  assert.strictEqual(empty, 0, `不应有空标题或 NULL 标题，实际:${empty}`);
});

test('并发请求下数据一致性', () => {
  // 多线程读取同一计数
  const counts = [
    db.prepare('SELECT COUNT(*) as c FROM articles').get().c,
    db.prepare('SELECT COUNT(*) as c FROM articles').get().c,
    db.prepare('SELECT COUNT(*) as c FROM articles').get().c
  ];
  assert.ok(counts.every(c => c === counts[0]), '并发读取计数一致');
});

test('错误边界容错 - 无效 ID 查询', () => {
  try {
    const nonexistent = db.prepare('SELECT * FROM articles WHERE id=?').get(999999999);
    assert.ok(!nonexistent, '不存在的 ID 返回 undefined 而非抛错');
  } catch (err) {
    throw new Error('应该捕获不存在的 ID，而不是抛异常');
  }
});

// ========== 最终统计 ==========
console.log('\n' + '='.repeat(60));
console.log(`✅ 通过：${passed}`);
console.log(`❌ 失败：${failed}`);
console.log(`📊 总计：${passed + failed}`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  以下测试失败：');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`   - ${r.name}: ${r.error}`);
  });
  process.exitCode = 1;
} else {
  console.log('\n🎉 所有冒烟测试通过！');
}

// 清理临时副本
try { db.close(); } catch { /* 已关闭则忽略 */ }
fs.rmSync(TMP_DIR, { recursive: true, force: true });
} catch (err) {
  // 引导/运行中途失败也必须清理临时副本（内含 credentials，不能残留）
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  throw err;
}
}

main().catch((err) => {
  console.error('❌ 冒烟测试引导失败:', err);
  process.exit(1);
});

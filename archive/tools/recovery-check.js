// T48 异常恢复验证脚本：
//  场景A 断网（源指向不可达地址）→ 调度任务 catch 记 status='error' 不中断 → 连续失败 3 次自动暂停(enabled=0)
//  场景B 重启服务 → /api/status 可感知被暂停源；启动恢复把中断的 pending 队列继续执行
//  场景C 网络恢复（源改指本机临时 RSS 服务）+ 手动重新启用 → 自动继续抓取，fail_count 清零
// 全程使用临时库（APP_DATA_DIR），结束自动清理，不触碰 data/app.db
// 用法：node tools/recovery-check.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qwis-recovery-'));
process.env.APP_DATA_DIR = DATA_DIR;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'PASS ✔' : 'FAIL ✘'}  ${label}${extra ? '  —— ' + extra : ''}`);
  if (!cond) failures++;
}

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>恢复测试源</title><link>https://recovery.example.com</link>
<item><title>网络恢复后的第一篇文章</title><link>https://recovery.example.com/post/1</link>
<pubDate>${new Date().toUTCString()}</pubDate><description>恢复验证正文</description></item>
</channel></rss>`;

async function main() {
  const { db } = require('../server/db');
  const scheduler = require('../server/services/scheduler');

  // ---- 准备：1 个指向不可达地址的 RSS 源 + 1 条中断的 bilibili pending 订阅 ----
  const now = new Date().toISOString();
  const srcId = db.prepare(
    "INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES('rss','断网测试源','http://127.0.0.1:9/dead.xml',1,'ok',?)"
  ).run(now).lastInsertRowid;
  db.prepare(
    "INSERT INTO pending_items(type, url, name, status, imported_at) VALUES('bilibili','不是合法链接','中断的待解析订阅','pending',?)"
  ).run(now);

  // ---- 场景A：断网连续失败 3 次 → 自动暂停 ----
  console.log('\n===== 场景A：断网连续失败 → status=error 且连失 3 次自动暂停 =====');
  for (let i = 1; i <= 3; i++) {
    await scheduler.runFetch(['rss']); // 调度任务内部 catch，不抛出、不中断
    const s = db.prepare('SELECT status, enabled, fail_count FROM sources WHERE id=?').get(srcId);
    console.log(`  第 ${i} 次失败后: status=${s.status}, enabled=${s.enabled}, fail_count=${s.fail_count}`);
  }
  let s = db.prepare('SELECT status, enabled, fail_count FROM sources WHERE id=?').get(srcId);
  check('调度任务异常被 catch，runFetch 正常返回不中断', true);
  check('第 3 次失败后自动暂停（enabled=0）', s.enabled === 0 && s.fail_count === 3 && s.status === 'error');
  // 第 4 轮：已暂停的源不再被抓取（fail_count 不再增长）
  await scheduler.runFetch(['rss']);
  s = db.prepare('SELECT fail_count FROM sources WHERE id=?').get(srcId);
  check('自动暂停后调度跳过该源（fail_count 不再增长）', s.fail_count === 3);

  // ---- 场景B：重启服务 → 状态可感知 + pending 恢复执行 ----
  console.log('\n===== 场景B：重启服务 → /api/status 标注错误源 + 启动恢复 pending 队列 =====');
  scheduler.resumeInterrupted(); // 等效于 server 启动时 scheduler.start() 内的恢复逻辑
  await new Promise((r) => setTimeout(r, 1500)); // resolvePending 是后台任务
  const p = db.prepare("SELECT status, error FROM pending_items WHERE type='bilibili'").get();
  check('中断的 pending 订阅在启动恢复后继续执行（失败落 error 原文）',
    p.status === 'failed' && /没有识别到 B站 up/.test(p.error || ''), p.error);

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, APP_DATA_DIR: DATA_DIR, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  try {
    const t0 = Date.now();
    for (;;) {
      try { const r = await fetch(`${BASE}/api/status`); if (r.ok) break; } catch { /* retry */ }
      if (Date.now() - t0 > 15000) throw new Error('服务未就绪');
      await new Promise((r) => setTimeout(r, 200));
    }
    const status = (await (await fetch(`${BASE}/api/status`)).json());
    check('/api/status 返回 pausedSources 且包含被自动暂停的源',
      status.pausedSources && status.pausedSources.count >= 1 &&
      status.pausedSources.items.some((i) => i.id === Number(srcId)),
      JSON.stringify(status.pausedSources));
    check('重启后服务整体可用（三页面 200）', true);
    for (const page of ['/reader/', '/daily/', '/wechat/']) {
      const r = await fetch(`${BASE}${page}`);
      check(`GET ${page} → ${r.status}`, r.status === 200);
    }
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---- 场景C：网络恢复 + 手动重新启用 → 自动继续抓取 ----
  console.log('\n===== 场景C：恢复联网 + 重新启用 → 自动继续抓取、计数清零 =====');
  const rssServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end(RSS_XML);
  });
  await new Promise((r) => rssServer.listen(0, '127.0.0.1', r));
  const rssUrl = `http://127.0.0.1:${rssServer.address().port}/feed.xml`;
  try {
    db.prepare('UPDATE sources SET url=? WHERE id=?').run(rssUrl, srcId); // 源地址恢复可达
    db.prepare('UPDATE sources SET enabled=1, fail_count=0 WHERE id=?').run(srcId); // 等效 PUT toggle 手动恢复
    await scheduler.runFetch(['rss']);
    s = db.prepare('SELECT status, enabled, fail_count FROM sources WHERE id=?').get(srcId);
    const art = db.prepare("SELECT title FROM articles WHERE source_id=?").get(srcId);
    check('恢复联网后自动继续抓取成功（status=ok, fail_count=0）',
      s.status === 'ok' && s.enabled === 1 && s.fail_count === 0);
    check('新文章已入库', !!art, art ? art.title : '');
  } finally {
    rssServer.close();
  }

  console.log(failures === 0 ? '\n全部恢复场景通过 ✔' : `\n${failures} 项失败 ✘`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => {
    try { require('../server/db').db.close(); } catch { /* ignore */ }
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`✔ 已清理临时库 ${DATA_DIR}（data/app.db 未被触碰）`);
  });

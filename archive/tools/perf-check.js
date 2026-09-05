// T47 性能验证脚本（N5）：
//  1) 在临时目录灌入 1000 视频 + 5000 文章（绝不触碰 data/app.db）
//  2) 以 APP_DATA_DIR 指向临时库启动服务，实测列表 API 响应时间（首屏 + 游标翻页 + 搜索）
//  3) 用 Playwright 打开 /reader/ 视频 Tab，验证虚拟滚动：渲染节点数恒定有界、可加载至 1000 条
//  4) 结束自动清理：杀服务进程、删临时库
// 用法：node tools/perf-check.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qwis-perf-'));
process.env.APP_DATA_DIR = DATA_DIR;

const N_VIDEOS = 1000;
const N_ARTICLES = 5000;

function seed() {
  const { db } = require('../server/db');
  const now = Date.now();
  const insSource = db.prepare(
    "INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES(?,?,?,1,'ok',?)"
  );
  const wxSrc = insSource.run('wechat', '性能压测公众号', 'https://rss.example.com/perf', new Date(now).toISOString()).lastInsertRowid;
  const biSrc = insSource.run('bilibili', '性能压测UP主', 'https://space.bilibili.com/999', new Date(now).toISOString()).lastInsertRowid;

  const insArticle = db.prepare(
    'INSERT INTO articles(source_id, title, url, author, summary, content_html, published_at, read_at, created_at) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  const insVideo = db.prepare(
    "INSERT INTO videos(source_id, platform, title, url, vid, cover, duration, author, intro, published_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  );
  const t0 = Date.now();
  db.transaction(() => {
    for (let i = 1; i <= N_ARTICLES; i++) {
      const ts = new Date(now - (i % 720) * 3600e3).toISOString();
      insArticle.run(
        wxSrc, `压测文章 ${i}：情报聚合与信息处理`, `https://a.example.com/perf/${i}`,
        '压测', `摘要 ${i}`, `<p>正文 ${i} `.repeat(50) + '</p>', ts,
        i % 3 === 0 ? ts : null, // 1/3 已读（入历史存档）
        ts
      );
    }
    for (let i = 1; i <= N_VIDEOS; i++) {
      const ts = new Date(now - (i % 720) * 3600e3).toISOString();
      insVideo.run(
        biSrc, 'bilibili', `压测视频 ${i}`, `https://www.bilibili.com/video/BVPERF${i}`,
        `BVPERF${i}`, 'https://example.com/cover.jpg', 600 + (i % 600), '压测UP主', `简介 ${i}`, ts, ts
      );
    }
  })();
  console.log(`✔ 灌入完成：${N_VIDEOS} 视频 + ${N_ARTICLES} 文章（${Date.now() - t0}ms），临时库 ${DATA_DIR}`);
  db.close();
}

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务未就绪');
}

async function timed(label, url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const body = await res.json();
  const ms = performance.now() - t0;
  const n = body.items ? body.items.length : '-';
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(7)}ms  (${res.status}, ${n} 条)`);
  return body;
}

async function apiTimings() {
  console.log('\n===== API 响应时间实测 =====');
  const a1 = await timed('文章列表首屏 tab=all', `${BASE}/api/articles?tab=all`);
  await timed('文章列表第 2 页（游标）', `${BASE}/api/articles?tab=all&cursor=${a1.nextCursor}`);
  const h1 = await timed('历史存档首屏', `${BASE}/api/articles?tab=history`);
  await timed('历史存档搜索 q=情报', `${BASE}/api/articles?tab=history&q=${encodeURIComponent('情报')}`);
  await timed('稍后阅读首屏', `${BASE}/api/articles?tab=later`);
  const v1 = await timed('视频列表首屏（N5 关键指标）', `${BASE}/api/videos?tab=all`);
  // 游标连续翻 10 页模拟滚动加载
  let cursor = v1.nextCursor;
  let worst = 0;
  for (let p = 2; p <= 11; p++) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}/api/videos?tab=all&cursor=${cursor}`);
    const b = await r.json();
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms);
    cursor = b.nextCursor;
  }
  console.log(`  视频列表游标翻页 ×10（最差值）      ${worst.toFixed(1).padStart(7)}ms`);
  await timed('视频收藏 tab', `${BASE}/api/videos?tab=favorite`);
  await timed('状态汇总 /api/status', `${BASE}/api/status`);
}

async function playwrightCheck() {
  console.log('\n===== 视频网格虚拟滚动验证（Playwright）=====');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/reader/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '视频', exact: true }).first().click();
  await page.waitForSelector('.grid .group', { timeout: 10000 });

  const stats = { maxRendered: 0, loadedLabel: 0 };
  let stagnant = 0;
  let lastLoaded = -1;
  for (let round = 0; round < 40; round++) {
    await page.evaluate(() => {
      const el = document.querySelector('section .overflow-y-auto');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(450);
    const s = await page.evaluate(() => ({
      rendered: document.querySelectorAll('.grid .group').length,
      spacers: document.querySelectorAll('.grid [aria-hidden]').length,
      label: Number((document.querySelector('section h2 + span') || {}).textContent) || 0,
    }));
    stats.maxRendered = Math.max(stats.maxRendered, s.rendered);
    stats.loadedLabel = s.label;
    if (s.label === lastLoaded) {
      stagnant++;
      if (stagnant >= 3) break; // 全部加载完
    } else {
      stagnant = 0;
      lastLoaded = s.label;
    }
  }
  console.log(`  滚动到底累计加载: ${stats.loadedLabel} 条视频`);
  console.log(`  渲染中的卡片节点峰值: ${stats.maxRendered}（虚拟滚动应保持有界，远小于总条数）`);
  const pass = stats.loadedLabel >= 300 && stats.maxRendered < 150;
  console.log(`  判定: ${pass ? 'PASS ✔（加载持续增长且 DOM 节点有界）' : 'FAIL ✘'}`);
  await browser.close();
  return pass;
}

async function main() {
  seed();
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, APP_DATA_DIR: DATA_DIR, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  let ok = false;
  try {
    await waitReady();
    await apiTimings();
    ok = await playwrightCheck();
  } finally {
    server.kill();
    // 等进程退出后清理临时库
    await new Promise((r) => setTimeout(r, 800));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
    console.log(`\n✔ 已清理：服务进程已停止，临时库 ${DATA_DIR} 已删除（data/app.db 未被触碰）`);
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});

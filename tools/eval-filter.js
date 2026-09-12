#!/usr/bin/env node
// 黄金集评测：跑 filterArticle 初筛分布（18-daily-ai-v2 F6）
// 用法: node tools/eval-filter.js [--limit=N]
// 注意：真实调用 Agnes（按 4s 间隔，20 篇约 90s）
const path = require('path');
const fs = require('fs');
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const _ai = require('../api/_ai');

(async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'daily-golden.json'), 'utf8'));
  const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || golden.length;
  const results = [];
  for (const g of golden.slice(0, limit)) {
    const f = await _ai.filterArticle({ title: g.title, source: 'golden', summary: g.summary });
    const hit = g.expect === 'good' ? f.score >= 30 : f.score < 30;
    results.push({ expect: g.expect, score: f.score, ignore: f.ignore, hit, title: g.title.slice(0, 40) });
    console.log(`${hit ? '✓' : '✗'} [${g.expect}] ${f.score} 分 ${f.ignore ? '(忽略)' : ''} ${g.title.slice(0, 40)}`);
  }
  const good = results.filter((r) => r.expect === 'good');
  const bad = results.filter((r) => r.expect === 'bad');
  const goodAvg = good.reduce((n, r) => n + r.score, 0) / (good.length || 1);
  const badAvg = bad.reduce((n, r) => n + r.score, 0) / (bad.length || 1);
  const acc = results.filter((r) => r.hit).length / results.length;
  console.log(`\n=== 优文均分 ${goodAvg.toFixed(1)} / 劣文均分 ${badAvg.toFixed(1)} / 准确率 ${(acc * 100).toFixed(0)}% ===`);
  process.exitCode = 0;
})().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });

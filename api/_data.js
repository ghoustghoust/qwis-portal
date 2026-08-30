// Vercel Serverless 数据层:读取随部署打包的 JSON 快照(public/data/*.json)
// 数据新鲜度 = 本地最近一次 sync(每 2h 导出+部署)。只读,无数据库依赖。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const cache = {};

function load(name) {
  if (!cache[name]) {
    cache[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  }
  return cache[name];
}

module.exports = {
  meta: () => load('meta.json'),
  daily: () => load('daily-latest.json'),
  events: () => load('events.json'),
  articles: () => load('articles.json'),
};

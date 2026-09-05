// 测试公共助手：独立临时数据目录（APP_DATA_DIR 注入，server/db.js 读取），绝不触碰 data/app.db
// 注意：必须先于任何 server/* 模块 require 本文件
const os = require('os');
const path = require('path');
const fs = require('fs');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qwis-test-'));
process.env.APP_DATA_DIR = DATA_DIR;

function cleanup() {
  try {
    const { db } = require('../server/db');
    db.close();
  } catch { /* 未加载则忽略 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
}

module.exports = { DATA_DIR, cleanup };

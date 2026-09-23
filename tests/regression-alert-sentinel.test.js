// BL7 残余：settings.alerts 渠道形状回归锁（只读生产，spec43 §六允许的取证方式）
// 事故原型：渠道被回归测试写坏成 `url:undefined` 的 TEST / 回调是 http://127.0.0.1:1 哨兵，
// 而 preflight 曾因判据过宽显示「1 个可用渠道 ✓」——所以把"渠道 URL 不是哨兵"钉成锁。
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const prodEnv = () => {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return false; // CI 无 .env：只读生产的用例空转放行（本地照旧）
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
  return process.env.TURSO_DATABASE_URL && !process.env.TURSO_DATABASE_URL.startsWith('file:');
};

test('BL7-1 生产 settings.alerts 的渠道不许有哨兵/未定义 URL（只读）', async () => {
  if (!prodEnv()) return;
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || '' });
  const r = await db.execute("SELECT value FROM settings WHERE key='alerts'");
  assert.ok(r.rows[0], 'settings.alerts 不存在');
  const cfg = JSON.parse(r.rows[0].value);
  const channels = Array.isArray(cfg.channels) ? cfg.channels : [];
  const { usableChannels } = require('../lib/alert-channels');
  for (const ch of channels) {
    const url = String((ch.config || {}).url || ch.url || '');
    assert.ok(url && !/undefined|null/i.test(url), `渠道 ${ch.id} 的 URL 是未定义形态（BL7 哨兵）：${ch.id}`);
    assert.ok(!/^(https?:\/\/)?127\.0\.0\.1:1\b/.test(url), `渠道 ${ch.id} 的回调是 127.0.0.1:1 哨兵（BL7 复发形态）`);
  }
  assert.ok(usableChannels(channels).length >= 1, 'usableChannels=0 —— 系统又在哑火（BL7）');
  await db.close();
});

test('BL7-2 锁自身不是写空的：usableChannels 真能拒哨兵形态（负向自证）', () => {
  const { usableChannels } = require('../lib/alert-channels');
  assert.equal(usableChannels([{ id: 'x', enabled: true, config: { url: 'http://127.0.0.1:1' } }]).length, 0);
  assert.equal(usableChannels([{ id: 'x', enabled: true, config: { url: 'undefined' } }]).length, 0);
});

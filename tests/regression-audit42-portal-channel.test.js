// 审计 spec 42 · AU-2：门户同步通道不得默认注册
// 背景：portal Vercel 项目已于 2026-09-19 下线，portal/ 判定为历史快照副本；
// 但 server/services/scheduler/index.js 曾以 getSetting('portal.enabled', true) 默认注册每 2h 同步。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'scheduler', 'index.js'), 'utf8');

// 坏形态：portal 同步开关缺省为 true（未显式配置即自动注册）
const DEFAULT_ON = /getSetting\(\s*['"]portal\.enabled['"]\s*,\s*true\s*\)/;

test('AU-2 正向探针：判据必须能抓到「默认开启」形态（防判据写成永远绿）', () => {
  const bad = "if (getSetting('portal.enabled', true)) { timers.push(setInterval(noop, 2 * 3600e3)); }";
  assert.match(bad, DEFAULT_ON, '检测器看不见坏形态，这条锁没有意义');
});

test('AU-2 真实源码不得默认注册门户同步通道', () => {
  assert.doesNotMatch(SRC, DEFAULT_ON, 'portal.enabled 缺省为 true：未配置即自动跑通道');
});

test('AU-2 停通道只改默认值，不删能力（显式开启仍可注册）', () => {
  assert.match(SRC, /getSetting\(\s*['"]portal\.enabled['"]\s*,\s*false\s*\)/, '应保留可显式开启的开关');
  assert.match(SRC, /jobsPortal\.runPortalSync/, '注册分支应仍存在，只是默认关');
});

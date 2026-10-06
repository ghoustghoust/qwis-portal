// H38 派生锁（用户 10-06 拍 N2）：新增出网实现 = 红。
// 为什么要有这条：本仓有三条互不通用的出网路（云端采集作业自己的代理库与分派器 / 本地进程启动时
// 设置的全局 dispatcher / 云端读层每次现造的带代理调用），"包一层全局请求函数就拦住了全部出口"
// 这句话一律不成立（docs/features/test-harness.md §四）。任何**第四套**网络库引入点出现时，
// 测试装置和安全假设都会跟着失效——而它会被当成"我拦住了全部"读。
// 判据：扫 server/ api/ tools/ lib/（不含 node_modules）里对网络库的 require/import，
// 命中文件数必须 == 已挂号白名单数；新增即红并点名文件，收敛掉某条就摘白名单条目。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 网络库引入形态（字面量，覆盖 require 两种引号 + ESM import；够用——本仓全 CJS，
// 但 import 写法一并扫，防将来混入时漏检）
const NET_RE = /(?:require\(\s*['"]undici['"]\s*\)|require\(\s*['"]node-fetch['"]\s*\)|require\(\s*['"]axios['"]\s*\)|require\(\s*['"]https['"]\s*\)|require\(\s*['"]http['"]\s*\)|from\s+['"]undici['"]|from\s+['"]node-fetch['"]|from\s+['"]axios['"])/;

// 已挂号的出网实现白名单（10-06 全库实扫清单）。**新增引入点 = 把它加进这个名单前先想清楚
// 它走的是哪一条路、测试装置拦不拦得住**；这不是让你随手加号的名单，是让你停下来的闸。
const ALLOWED = [
  'lib/cloud-site.js',          // 云端读层现造带代理调用（第三条路）
  'server/index.js',            // 本地进程启动时 setGlobalDispatcher（第二条路）
  'server/services/alerts.js',  // 本地报警直发（第二条路的同族 Agent）
  'tools/collect-turso.js',     // 云端采集作业自己的代理库（第一条路）
];

const SCAN_DIRS = ['server', 'api', 'tools', 'lib'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'web']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.js$/.test(e.name)) out.push(rel);
  }
  return out;
}

test('H38：网络库引入点不超出挂号白名单（新增出网实现即红）', () => {
  const hits = [];
  for (const f of SCAN_DIRS.flatMap((d) => walk(d))) {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (NET_RE.test(content)) hits.push(f.replace(/\\/g, '/'));
  }
  hits.sort();
  const unexpected = hits.filter((f) => !ALLOWED.includes(f));
  const stale = ALLOWED.filter((f) => !hits.includes(f));
  assert.deepEqual(unexpected, [],
    `发现未挂号的出网实现引入点：${unexpected.join(', ')}——这不是让你随手加进 ALLOWED 的，` +
    '它走的是哪一条出网路、测试装置拦不拦得住，先想清楚（docs/features/test-harness.md §四）');
  assert.deepEqual(stale, [],
    `白名单条目已不再引入网络库（可以摘）：${stale.join(', ')}`);
});

#!/usr/bin/env node
/**
 * 全网情报系统运维工具箱 v2.0（Node 版）
 * 用途：无需 AI Agent 介入的独立运维操作集
 * 用法：
 *   node tools/ops-toolkit.js check          系统健康总览（主服务 + 报警渠道）
 *   node tools/ops-toolkit.js frozen         查看熔断源清单
 *   node tools/ops-toolkit.js unfreeze       批量解冻所有熔断源（带确认）
 *   node tools/ops-toolkit.js unfreeze --yes 跳过确认直接解冻
 *   node tools/ops-toolkit.js diagnose-bili  B 站专项诊断（WBI 密钥 + Cookie 登录态）
 *   node tools/ops-toolkit.js export         导出错误报告 CSV 到 data/
 *   node tools/ops-toolkit.js                显示帮助
 * （reset-wemp 命令与 WeRSS 引擎检测已随 we-mp-rss 退役移除，2026-09-04）
 */
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const { db } = require(path.join(ROOT, 'server', 'db'));
const { mask } = require(path.join(ROOT, 'server', 'util', 'log'));

const API_BASE = `http://localhost:${Number(process.env.PORT || 3000)}`;

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};
const section = (t) => console.log('\n' + C.cyan(`=== ${t} ===`));
const ok = (m) => console.log(C.green(`[OK] ${m}`));
const warn = (m) => console.log(C.yellow(`[WARN] ${m}`));
const fail = (m) => console.log(C.red(`[FAIL] ${m}`));

// ---------- 1. 系统健康总览 ----------
async function cmdCheck() {
  section('系统健康总览');

  // 主服务
  try {
    const r = await fetch(`${API_BASE}/api/health/status`, { signal: AbortSignal.timeout(5000) });
    const h = await r.json();
    if (h.ok) {
      ok(`主服务在线，源统计：总数 ${h.sources.total} / 启用 ${h.sources.enabled} / 异常 ${h.sources.error} / 熔断 ${h.sources.frozen}`);
      if (h.alerts) {
        if (h.alerts.enabledChannelCount === 0) {
          warn('报警渠道数为 0 —— 这就是报警不触发的原因！请到管理后台「报警管理」配置渠道');
        } else {
          ok(`报警渠道已启用 ${h.alerts.enabledChannelCount} 个，冷却 ${h.alerts.cooldownMin} 分钟`);
        }
        const off = Object.entries(h.alerts.eventsEnabled || {}).filter(([, v]) => !v).map(([k]) => k);
        if (off.length) warn(`以下报警事件被禁用：${off.join(', ')}（管理后台 → 报警管理 → 事件开关）`);
      }
      if (h.cookieIssues && h.cookieIssues.length) {
        warn(`检测到 ${h.cookieIssues.length} 个源存在 Cookie/登录态失效特征：${h.cookieIssues.map((s) => s.name).join('、')}`);
        console.log(C.gray('  → 微信读书：管理后台重新扫码授权；B 站：更新 credentials 表 Cookie'));
      }
      return h;
    }
  } catch {
    fail(`主服务不可达（${API_BASE}）—— 请先启动：npm run dev 或 restart-server.bat`);
  }
  return null;
}

// ---------- 2. 熔断源清单 ----------
function cmdFrozen() {
  section('熔断源清单（fail_count >= 3 且已停用）');
  const rows = db.prepare(
    'SELECT id, name, type, fail_count, extra FROM sources WHERE fail_count >= 3 AND enabled=0 ORDER BY fail_count DESC'
  ).all();
  if (!rows.length) { ok('当前无熔断源'); return []; }
  for (const r of rows) {
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch { /* ignore */ }
    console.log(C.yellow(`  [${r.id}] ${r.name} (type=${r.type}, 连失 ${r.fail_count} 次)`));
    if (extra.lastError) console.log(C.gray(`      最近错误: ${mask(extra.lastError).slice(0, 200)}`));
    if (extra.lastErrorAt) console.log(C.gray(`      时间: ${extra.lastErrorAt}`));
  }
  console.log(C.cyan(`\n共 ${rows.length} 个熔断源，可执行: node tools/ops-toolkit.js unfreeze`));
  return rows;
}

// ---------- 3. 批量解冻 ----------
function doUnfreeze() {
  const rows = db.prepare('SELECT id, extra FROM sources WHERE fail_count >= 3 AND enabled=0').all();
  const stmt = db.prepare('UPDATE sources SET enabled=1, fail_count=0, status=?, extra=? WHERE id=?');
  for (const r of rows) {
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch { extra = {}; }
    delete extra.lastError;
    delete extra.lastErrorAt;
    stmt.run('ok', JSON.stringify(extra), r.id);
  }
  return rows.length;
}

async function cmdUnfreeze(skipConfirm) {
  section('批量解冻所有熔断源');
  const cnt = db.prepare('SELECT COUNT(*) c FROM sources WHERE fail_count >= 3 AND enabled=0').get().c;
  if (!cnt) { ok('无熔断源需要恢复'); return; }
  warn(`检测到 ${cnt} 个熔断源，此操作将清零失败计数并重新启用`);
  if (!skipConfirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((res) => rl.question('确认执行？(y/N) ', res));
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') { console.log('已取消'); return; }
  }
  const n = doUnfreeze();
  ok(`已恢复 ${n} 个熔断源（调度器下一轮 60s 内会自动重试抓取）`);
}

// ---------- 4.（已移除）重置 wemp 源 —— we-mp-rss 退役（2026-09-04） ----------

// ---------- 5. B 站专项诊断 ----------
async function cmdDiagnoseBili() {
  section('B 站专项诊断（WBI 密钥 + Cookie 登录态）');
  const bili = require(path.join(ROOT, 'server', 'services', 'collectors', 'bilibili'));
  const d = await bili._diagnose();
  console.log(d.cookieConfigured ? ok('Cookie 已配置') : fail('Cookie 未配置（匿名模式易被风控）'));
  console.log(d.wbiKeyRefreshed ? ok('WBI 密钥刷新成功') : fail('WBI 密钥刷新失败'));
  console.log(d.loginOk ? ok(`登录态有效（${d.uname || ''}）`) : fail('登录态无效'));
  if (d.message) warn(d.message);
  if (!d.loginOk) {
    console.log(C.cyan('\nB 站 Cookie 更新步骤：'));
    console.log(C.gray('  1. 浏览器打开 https://www.bilibili.com/ 并登录'));
    console.log(C.gray('  2. F12 → Application → Cookies → bilibili.com'));
    console.log(C.gray('  3. 复制 SESSDATA / bili_jct / buvid3 拼成完整 Cookie 串'));
    console.log(C.gray('  4. 写入数据库：'));
    console.log(C.gray('     sqlite3 data/app.db "UPDATE credentials SET cookie=\'...\' WHERE platform=\'bilibili\'"'));
  }
  const frozen = db.prepare("SELECT COUNT(*) c FROM sources WHERE type='bilibili' AND fail_count >= 3").get().c;
  if (frozen) warn(`当前仍有 ${frozen} 个 B 站源处于熔断状态，Cookie 修复后执行 unfreeze 恢复`);
}

// ---------- 6. 导出错误报告 ----------
function cmdExport() {
  section('导出错误报告（CSV）');
  const fs = require('fs');
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const out = path.join(ROOT, 'data', `error-report-${ts}.csv`);
  const rows = db.prepare(
    "SELECT id, name, type, fail_count, enabled, status, extra FROM sources WHERE status='error' OR fail_count >= 2 ORDER BY fail_count DESC"
  ).all();
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = ['id,name,type,fail_count,enabled,status,lastError,lastErrorAt'];
  for (const r of rows) {
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch { /* ignore */ }
    lines.push([r.id, r.name, r.type, r.fail_count, r.enabled, r.status,
      mask(extra.lastError || ''), extra.lastErrorAt || ''].map(esc).join(','));
  }
  fs.writeFileSync(out, '\uFEFF' + lines.join('\r\n'), 'utf8');
  ok(`报告已导出: ${out}（${rows.length} 条）`);
}

// ---------- 入口 ----------
(async () => {
  const cmd = process.argv[2];
  try {
    switch (cmd) {
      case 'check': await cmdCheck(); break;
      case 'frozen': cmdFrozen(); break;
      case 'unfreeze': await cmdUnfreeze(process.argv.includes('--yes')); break;
      case 'diagnose-bili': await cmdDiagnoseBili(); break;
      case 'export': cmdExport(); break;
      default:
        console.log('全网情报系统运维工具箱 v2.0');
        console.log('用法: node tools/ops-toolkit.js <命令>');
        console.log('  check          系统健康总览（主服务 + 报警渠道）');
        console.log('  frozen         查看熔断源清单');
        console.log('  unfreeze       批量解冻所有熔断源（--yes 跳过确认）');
        console.log('  diagnose-bili  B 站专项诊断（WBI 密钥 + Cookie 登录态）');
        console.log('  export         导出错误报告 CSV 到 data/');
    }
  } catch (err) {
    fail(`执行异常: ${err.message}`);
    process.exitCode = 1;
  }
})();
